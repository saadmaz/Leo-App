"""
Community Management - Claude drafts brand-aligned replies to social comments.

Flow:
1. Optionally pull live comments from Ayrshare POST /post/comments (requires AYRSHARE_API_KEY)
2. Combine with any manually pasted comments
3. Claude drafts a suggested reply for every comment, matched to tone + brand voice
4. Returns structured list: comment + suggested_reply + priority + action_type
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar6 import CommunityManagementRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_AYRSHARE_BASE = "https://api.ayrshare.com/api"
_MAX_BRAND = 800


SYSTEM = """\
You are a social media community manager expert at crafting replies that feel human, \
on-brand, and drive positive engagement.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "community_summary": "string (2-3 sentences: overall tone of the comments, key themes)",
  "platform_notes": "string (any platform-specific reply etiquette observed)",
  "replies": [
    {
      "comment_id": "string",
      "author": "string",
      "platform": "string",
      "original_comment": "string",
      "sentiment": "positive | neutral | negative | question | complaint | spam",
      "priority": "high | medium | low",
      "action_type": "reply | escalate | delete | ignore",
      "suggested_reply": "string (the actual reply text - platform-appropriate length)",
      "reply_rationale": "string (1 sentence: why this reply angle)",
      "follow_up_action": "string or null (e.g. 'DM to resolve billing issue', 'Tag support team')"
    }
  ],
  "recurring_themes": ["string (topic that appeared in 2+ comments)"],
  "escalation_required": ["string (comment_id values that need human or support-team attention)"],
  "engagement_tips": ["string (tactical tip for improving community response rate/sentiment)"]
}

Rules:
- Replies must feel human, not robotic or corporate.
- Match the brand tone provided - do NOT invent a tone.
- Complaints: acknowledge, empathise, offer to help - never argue or dismiss.
- Questions: answer directly if you have the info, otherwise offer to DM.
- Spam/irrelevant: recommend 'delete' or 'ignore' action_type, no reply text needed.
- Keep reply length appropriate to platform: Twitter ≤280 chars, Instagram/LinkedIn ≤500 chars.
- If brand_guidelines are provided, follow them strictly.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _fetch_ayrshare_comments(post_id: str, profile_key: str) -> list[dict]:
    """Pull comments for a single Ayrshare post ID. Returns [] on any error."""
    headers = {
        "Authorization": f"Bearer {settings.AYRSHARE_API_KEY}",
        "Content-Type": "application/json",
    }
    if profile_key:
        headers["Profile-Key"] = profile_key
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{_AYRSHARE_BASE}/post/comments",
                headers=headers,
                params={"id": post_id},
            )
            resp.raise_for_status()
            data = resp.json()
            # Ayrshare returns { comments: [...] } or a list directly
            return data.get("comments", data) if isinstance(data, dict) else data
    except Exception as exc:
        logger.warning("Ayrshare comments fetch failed for post %s: %s", post_id, exc)
        return []


async def generate(
    project: dict,
    body: CommunityManagementRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = "Community Management - Reply Drafts"
    doc = firebase_service.create_pillar1_doc(project_id, "community_management", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    # ------------------------------------------------------------------
    # Gather comments
    # ------------------------------------------------------------------
    all_comments: list[dict] = []

    # 1. Ayrshare pull (if post IDs given and API key exists)
    if body.ayrshare_post_ids and settings.AYRSHARE_API_KEY:
        yield _sse({"type": "research_step", "step": "fetch", "label": "Fetching comments from Ayrshare…", "status": "running"})
        profile_key = (project.get("ayrshareProfileKey") or "")
        for pid in body.ayrshare_post_ids[:10]:
            raw = await _fetch_ayrshare_comments(pid, profile_key)
            for c in raw[:30]:
                all_comments.append({
                    "comment_id": c.get("id") or c.get("commentId") or pid,
                    "author": c.get("username") or c.get("author") or "unknown",
                    "platform": c.get("platform") or "unknown",
                    "text": c.get("text") or c.get("comment") or "",
                    "sentiment_hint": None,
                })
        yield _sse({"type": "research_step", "step": "fetch",
                    "label": f"Fetched {len(all_comments)} comments", "status": "done"})
    elif body.ayrshare_post_ids:
        yield _sse({"type": "research_step", "step": "fetch",
                    "label": "AYRSHARE_API_KEY not set - skipping live pull", "status": "done"})

    # 2. Manual comments
    if body.manual_comments:
        for mc in body.manual_comments:
            all_comments.append({
                "comment_id": mc.comment_id or f"manual-{len(all_comments)}",
                "author": mc.author or "unknown",
                "platform": mc.platform,
                "text": mc.text,
                "sentiment_hint": mc.sentiment_hint,
            })

    if not all_comments:
        yield _sse({"type": "error", "message": "No comments to process. Provide Ayrshare post IDs or paste comments manually."})
        return

    yield _sse({"type": "research_step", "step": "drafting",
                "label": f"Drafting replies for {len(all_comments)} comments…", "status": "running"})

    comments_json = json.dumps(all_comments, indent=2)
    prompt = (
        f"BRAND / PRODUCT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"REPLY TONE: {body.reply_tone}\n"
        + (f"BRAND GUIDELINES: {body.brand_guidelines}\n" if body.brand_guidelines else "")
        + f"\nCOMMENTS TO REPLY TO ({len(all_comments)} total):\n{comments_json}\n\n"
        "Draft a suggested reply for every comment. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=6000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "drafting", "label": "Replies drafted", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["total_comments"] = len(all_comments)

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 10})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
