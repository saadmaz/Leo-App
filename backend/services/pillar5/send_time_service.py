"""
Send Time Optimiser - Claude analyses audience patterns and recommends optimal send windows.

Works in two modes:
  1. Data-driven: user provides historical open data → Claude finds patterns + recommends
  2. Audience-based: no data → Claude reasons from industry benchmarks + audience profile
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar5 import SendTimeRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

SYSTEM = """\
You are a data-driven email deliverability and engagement specialist. You use audience \
psychology, industry benchmarks, and engagement data to recommend the best send times.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "recommendation_summary": "string (2-3 sentences: top recommendation + rationale)",
  "primary_send_window": {
    "day": "string (e.g. 'Tuesday')",
    "time_range": "string (e.g. '9:00–11:00 AM')",
    "timezone": "string",
    "confidence": "high|medium|low",
    "rationale": "string"
  },
  "secondary_send_window": {
    "day": "string",
    "time_range": "string",
    "timezone": "string",
    "rationale": "string"
  },
  "windows_to_avoid": [
    {"window": "string", "reason": "string"}
  ],
  "day_of_week_analysis": [
    {"day": "string", "relative_open_rate": "high|above_avg|average|below_avg|low", "notes": "string"}
  ],
  "time_of_day_analysis": [
    {"time_block": "string (e.g. '6–9 AM')", "relative_open_rate": "high|above_avg|average|below_avg|low", "notes": "string"}
  ],
  "data_insights": ["string (only if historical data provided - key patterns found)"],
  "personalisation_tip": "string (how to use per-contact send time in Loops/other platforms)",
  "frequency_recommendation": "string (how often to send this email type)",
  "ab_test_suggestion": "string (how to A/B test send time)"
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: SendTimeRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Send Time - {body.email_type.replace('_', ' ').title()} · {body.timezone_focus}"
    doc = firebase_service.create_pillar1_doc(project_id, "send_time", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "analysing", "label": "Analysing audience and benchmarks…", "status": "running"})

    data_section = ""
    if body.existing_open_data:
        rows = "\n".join(
            f"  Day={r.get('day', '?')} Hour={r.get('hour', '?')} OpenRate={r.get('open_rate', '?')}"
            for r in body.existing_open_data
        )
        data_section = f"\nHISTORICAL OPEN DATA:\n{rows}\n"

    brand_context = build_brand_core_context(project.get("brandCore") or {})

    prompt = (
        f"BRAND / PRODUCT CONTEXT:\n{brand_context[:800]}\n\n"
        f"SEND TIME OPTIMISATION REQUEST:\n"
        f"- Audience: {body.audience_description}\n"
        f"- Email Type: {body.email_type}\n"
        f"- Primary Timezone: {body.timezone_focus}\n"
        + (f"- Industry: {body.industry}\n" if body.industry else "")
        + data_section
        + "\nProvide detailed send time recommendations."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=2000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "analysing", "label": "Analysis complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 5})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
