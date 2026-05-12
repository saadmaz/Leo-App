"""
Press Release Writing - pure Claude, brand-aware.

Input:  news type, headline topic, key facts, quote info, tone.
Output: structured press release with headline, dateline, body, quote, boilerplate.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar8 import PressReleaseRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 600

SYSTEM = """\
You are a PR expert who has written press releases for hundreds of technology companies. \
You write releases that get picked up by journalists - not corporate fluff, but newsworthy, \
punchy, factual prose that editors don't need to rewrite.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "headline": "string (under 100 chars - active voice, newsy, not a marketing tagline)",
  "subheadline": "string (optional secondary headline - 1 sentence)",
  "dateline": "string (CITY, Month DD, YYYY -)",
  "lead_paragraph": "string (the who/what/when/where/why in 2-3 sentences - most important facts first)",
  "body_paragraphs": ["string", "..."],
  "quote": {
    "text": "string (a genuine-sounding, non-robotic quote - executive insight not marketing speak)",
    "speaker_name": "string",
    "speaker_title": "string"
  },
  "boilerplate": "string (About [Company] - 2-3 sentences)",
  "media_contact": "string (placeholder: '[Name], [Title] | pr@[company].com | +1-xxx-xxx-xxxx')",
  "embargo_note": "string or null",
  "seo_keywords": ["string"],
  "editorial_notes": "string (optional tips for editors - e.g. 'high-res images available on request')"
}

Rules:
- Lead paragraph answers: Who, What, When, Where, Why - in that order.
- Body paragraphs: context → impact → details → forward look. 3-4 paragraphs.
- Quote must sound like a real human said it - no clichés like 'excited to announce' or 'thrilled to share'.
- Boilerplate ends with website URL as a placeholder: [website].
- Use AP Style for numbers, dates, and titles.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: PressReleaseRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Press Release - {body.headline_topic[:60]}"
    doc = firebase_service.create_pillar1_doc(project_id, "press_release", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "writing", "label": "Drafting press release…", "status": "running"})

    facts_text = "\n".join(f"• {f}" for f in body.key_facts)
    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"PRESS RELEASE REQUEST:\n"
        f"- News type: {body.news_type}\n"
        f"- Company: {body.company_name}\n"
        f"- Core announcement: {body.headline_topic}\n"
        f"- Tone: {body.tone}\n"
        + (f"- Target audience: {body.target_audience}\n" if body.target_audience else "")
        + (f"- Embargo: {body.embargo_date}\n" if body.embargo_date else "")
        + f"\nKEY FACTS:\n{facts_text}\n"
        + (f"\nQUOTE - from {body.quote_name}, {body.quote_title}: {body.quote_hint}\n" if body.quote_name else "")
        + (f"\nBOILERPLATE (provided - use as-is):\n{body.boilerplate}\n" if body.boilerplate else "")
        + "\nWrite the press release. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=4000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI writing failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "writing", "label": "Press release drafted", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["company_name"] = body.company_name
    payload["news_type"] = body.news_type

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 10})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
