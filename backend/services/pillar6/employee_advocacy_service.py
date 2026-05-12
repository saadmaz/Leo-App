"""
Employee Advocacy - Claude generates pre-approved shareable posts in authentic employee voice.

Employees sharing content on their personal accounts generates 8x more engagement than
brand channels. This service writes posts that feel genuinely personal - not corporate.

Flow:
1. Load brand context + voice
2. Claude generates N posts per platform in the employee's authentic voice
3. Each post weaves in the brand key messages naturally (not as bullet points)
4. Optionally drafts the first post per platform to Ayrshare for 1-click approval
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar6 import EmployeeAdvocacyRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_AYRSHARE_BASE = "https://api.ayrshare.com/api"
_MAX_BRAND = 800

# Platform character limits (conservative)
PLATFORM_LIMITS: dict[str, int] = {
    "twitter": 280,
    "x": 280,
    "linkedin": 3000,
    "instagram": 2200,
    "facebook": 2000,
    "threads": 500,
    "tiktok": 2200,
}

SYSTEM = """\
You are a ghostwriter who specialises in employee advocacy content. You write posts \
that sound genuinely human - first-person, specific, a little vulnerable. They should \
NOT sound like press releases, product announcements, or marketing copy.

The goal: employees share these on their personal accounts and their networks engage \
because the posts are authentic and useful, not because they are promotional.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "advocacy_brief": "string (2-3 sentences: the story angle you chose + why it works)",
  "platforms": [
    {
      "platform": "string",
      "character_limit": number,
      "posts": [
        {
          "post_number": number,
          "text": "string (the full post - do NOT exceed the platform character limit)",
          "hook": "string (the opening line or hook)",
          "angle": "string (personal_story | lesson_learned | behind_scenes | hot_take | question | win | tip)",
          "estimated_engagement": "high | medium | low",
          "why_it_works": "string (1 sentence)",
          "hashtags": ["string"],
          "best_time_to_post": "string (e.g. 'Tuesday morning, 8-9am')"
        }
      ]
    }
  ],
  "key_message_weaving": "string (how you embedded the key messages without making it feel promotional)",
  "dos": ["string (what to do when sharing - e.g. 'Add a personal anecdote in the first comment')"],
  "donts": ["string (what to avoid - e.g. \"Don't share if you're also posting a promo the same day\")"],
  "ab_variants": [
    {
      "platform": "string",
      "variant_a": "string (the posted version)",
      "variant_b": "string (alternative angle to test)"
    }
  ]
}

Rules:
- NEVER start a post with the brand name or product name.
- Use 'I' language - first person singular only.
- Include specific numbers or outcomes where possible (even hypothetical ranges).
- Each post must be a DIFFERENT angle - no repetition.
- Do not include phrases from avoid_phrases if provided.
- LinkedIn posts may be longer (up to 1500 chars) with line breaks for readability.
- Twitter/X posts must be concise - hook + insight + optional CTA, max 280 chars.
- Hashtags: max 3 for LinkedIn, max 2 for Twitter, up to 8 for Instagram/TikTok.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _push_to_ayrshare(profile_key: str, platform: str, text: str) -> dict:
    """Draft-post a single post to Ayrshare for employee review."""
    headers = {
        "Authorization": f"Bearer {settings.AYRSHARE_API_KEY}",
        "Content-Type": "application/json",
        "Profile-Key": profile_key,
    }
    platform_slug = platform.lower().replace("x", "twitter")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{_AYRSHARE_BASE}/post",
                headers=headers,
                json={
                    "post": text,
                    "platforms": [platform_slug],
                    "mediaUrls": [],
                    # Use Ayrshare draft status if available (requires Business plan)
                    # "isDraft": True,
                },
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        logger.warning("Ayrshare push failed for platform %s: %s", platform, exc)
        return {"error": str(exc)}


async def generate(
    project: dict,
    body: EmployeeAdvocacyRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Employee Advocacy - {body.topic[:60]}"
    doc = firebase_service.create_pillar1_doc(project_id, "employee_advocacy", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "generating",
                "label": f"Generating {body.num_posts} posts per platform…", "status": "running"})

    platforms_with_limits = [
        {"platform": p, "character_limit": PLATFORM_LIMITS.get(p.lower(), 2000)}
        for p in body.platforms
    ]

    prompt = (
        f"BRAND / PRODUCT CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"EMPLOYEE ADVOCACY REQUEST:\n"
        f"- Topic: {body.topic}\n"
        f"- Key messages to weave in: {json.dumps(body.key_messages)}\n"
        f"- Employee persona: {body.employee_persona}\n"
        f"- Tone: {body.tone}\n"
        f"- Posts per platform: {body.num_posts}\n"
        f"- Platforms: {json.dumps(platforms_with_limits)}\n"
        + (f"- Avoid these phrases: {json.dumps(body.avoid_phrases)}\n" if body.avoid_phrases else "")
        + "\nWrite pre-approved employee advocacy posts. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=8000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "generating", "label": "Posts generated", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    # Optional Ayrshare push of first post per platform
    ayrshare_results: list[dict] = []
    if body.push_to_ayrshare and body.ayrshare_profile_key and settings.AYRSHARE_API_KEY:
        yield _sse({"type": "research_step", "step": "ayrshare", "label": "Pushing to Ayrshare for review…", "status": "running"})
        for platform_block in payload.get("platforms", []):
            posts = platform_block.get("posts", [])
            if posts:
                first_post_text = posts[0].get("text", "")
                if first_post_text:
                    result = await _push_to_ayrshare(
                        body.ayrshare_profile_key,
                        platform_block.get("platform", ""),
                        first_post_text,
                    )
                    ayrshare_results.append({
                        "platform": platform_block.get("platform"),
                        "result": result,
                    })
        yield _sse({"type": "research_step", "step": "ayrshare",
                    "label": f"Pushed {len(ayrshare_results)} posts to Ayrshare", "status": "done"})

    if ayrshare_results:
        payload["ayrshare_push_results"] = ayrshare_results

    payload["topic"] = body.topic
    payload["employee_persona"] = body.employee_persona

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 10})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
