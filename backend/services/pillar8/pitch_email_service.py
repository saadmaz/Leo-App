"""
Pitch Email Generation - Claude writes a personalised journalist pitch.

Input:  journalist details, pitch angle, news hook.
Output: subject line variants + pitch email body with personalisation.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar8 import PitchEmailRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500

SYSTEM = """\
You are a PR professional who has placed hundreds of stories in top-tier media. \
You write pitch emails that journalists actually respond to - personalised, punchy, \
respectful of their time, with a clear news hook.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "subject_lines": [
    {"line": "string", "rationale": "string (why this subject line works)"}
  ],
  "pitch_email": "string (the full email body - plain text, no HTML, max 200 words)",
  "follow_up_template": "string (brief follow-up to send 5 days later if no reply - max 80 words)",
  "personalisation_used": "string (what journalist-specific detail was woven in)",
  "angle_fit_score": number (1-10 - how well the angle fits this journalist's beat),
  "angle_fit_rationale": "string",
  "tips": ["string"]
}

Rules:
- Subject lines: 3 options - direct, curiosity-driven, data-led. All under 60 chars.
- Email body: opens with personalisation → hook → news → why them → CTA (call/email).
- Never start with 'I hope this finds you well' or similar.
- CTA is a specific ask: 'Would you have 15 minutes for a call next week?' or similar.
- Keep the pitch email under 200 words - journalists are busy.
- If exclusive_offer is true, lead with 'I'd like to offer you an exclusive on…'
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: PitchEmailRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Pitch - {body.journalist_name} @ {body.journalist_outlet}"
    doc = firebase_service.create_pillar1_doc(project_id, "pitch_email", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "writing", "label": "Crafting personalised pitch…", "status": "running"})

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"JOURNALIST:\n"
        f"- Name: {body.journalist_name}\n"
        f"- Outlet: {body.journalist_outlet}\n"
        + (f"- Beat: {body.journalist_beat}\n" if body.journalist_beat else "")
        + (f"- Recent article: {body.recent_article}\n" if body.recent_article else "")
        + f"\nPITCH DETAILS:\n"
        f"- Company: {body.company_name}\n"
        f"- News hook: {body.news_hook}\n"
        f"- Pitch angle: {body.pitch_angle}\n"
        f"- Exclusive offer: {body.exclusive_offer}\n"
        f"- Tone: {body.tone}\n"
        + (f"- Key stats: {'; '.join(body.key_stats)}\n" if body.key_stats else "")
        + "\nWrite the pitch email and subject line variants. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=3000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI writing failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "writing", "label": "Pitch drafted", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["journalist_name"] = body.journalist_name
    payload["journalist_outlet"] = body.journalist_outlet
    payload["company_name"] = body.company_name

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 10})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
