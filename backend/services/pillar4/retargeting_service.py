"""
Retargeting Sequence Builder - Claude-powered.

Builds a full retargeting funnel with:
- TOFU / MOFU / BOFU segmentation
- Per touch-point ad copy + timing + creative format
- Audience exclusion logic
- Frequency cap recommendations
- Win-back and loyalty sequences

Audience segments supported:
  website_visitors   - Visited site but didn't convert
  cart_abandoners    - Added to cart but didn't purchase
  past_buyers        - Previous customers (upsell / loyalty)
  video_viewers      - Watched 25%+ of a brand video
  lead_nurture       - Leads who haven't converted (free trial, demo request, etc.)
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar4 import RetargetingRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND_CHARS = 2000

SYSTEM_PROMPT = """\
You are an expert performance marketer specialising in paid retargeting and lifecycle \
advertising. You build sequences that feel personal, not creepy.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "sequence_name": "string",
  "audience_segment": "string",
  "conversion_goal": "string",
  "funnel_overview": "string (2-3 sentences describing the overall retargeting logic)",
  "audience_definition": {
    "inclusion_criteria": ["string"],
    "exclusion_criteria": ["string"],
    "lookback_window_days": number,
    "estimated_audience_size_note": "string"
  },
  "touch_points": [
    {
      "touch_point": number,
      "day": number,
      "funnel_stage": "TOFU" | "MOFU" | "BOFU" | "WIN-BACK",
      "goal": "string",
      "platform": "string",
      "ad_format": "string",
      "frequency_cap": "string (e.g. 2 impressions/day)",
      "copy": {
        "headline": "string",
        "body": "string",
        "cta": "string",
        "cta_url_note": "string (e.g. 'Link to abandoned cart URL')"
      },
      "creative_direction": "string (visual/creative guidance in 1-2 sentences)",
      "audience_refinement": "string (how the audience narrows at this touch point)"
    }
  ],
  "exclusion_logic": ["string (when to stop showing ads)"],
  "budget_guidance": {
    "recommended_split": "string",
    "bofu_weighting": "string"
  },
  "success_metrics": [
    {"metric": "string", "target": "string"}
  ],
  "implementation_notes": ["string"]
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: RetargetingRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """SSE generator for retargeting sequence builder."""

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    segment_label = body.audience_segment.replace("_", " ").title()
    title = f"Retargeting Sequence - {segment_label} · {body.product_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "retargeting_sequence", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand_context",
                "label": "Loading brand context…", "status": "running"})

    brand_core = project.get("brandCore") or {}
    brand_context = build_brand_core_context(brand_core)
    platforms_str = ", ".join(body.platforms)

    user_prompt = (
        f"BRAND CORE:\n{brand_context[:_MAX_BRAND_CHARS]}\n\n"
        f"RETARGETING SEQUENCE REQUEST:\n"
        f"- Product: {body.product_name}\n"
        f"- Description: {body.product_description}\n"
        f"- Audience Segment: {body.audience_segment}\n"
        f"- Platforms: {platforms_str}\n"
        f"- Sequence Length: {body.sequence_length} touch points\n"
        f"- Conversion Goal: {body.conversion_goal}\n\n"
        f"Build a {body.sequence_length}-touch-point retargeting sequence for "
        f"'{segment_label}' across {platforms_str}. "
        f"Space the touch points thoughtfully (not every day). "
        f"Use escalating urgency and shrinking audiences. Return valid JSON only."
    )

    yield _sse({"type": "research_step", "step": "brand_context",
                "label": "Brand context loaded", "status": "done"})
    yield _sse({"type": "research_step", "step": "generating",
                "label": f"Building {body.sequence_length}-touch-point sequence…", "status": "running"})

    try:
        raw = await call_claude_raw(user_prompt, system=SYSTEM_PROMPT, max_tokens=4096)
    except Exception as exc:
        logger.error("Claude call failed for retargeting sequence: %s", exc)
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"})
        return

    yield _sse({"type": "research_step", "step": "generating",
                "label": "Sequence ready", "status": "done"})
    yield _sse({"type": "research_step", "step": "saving",
                "label": "Saving to workspace…", "status": "running"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        logger.error("Retargeting JSON parse failed: %s\nRaw (first 500): %s", exc, raw[:500])
        yield _sse({"type": "error", "message": f"Could not parse response JSON: {exc}"})
        return

    payload["audience_segment"] = body.audience_segment
    payload["product_name"] = body.product_name

    firebase_service.update_pillar1_doc(project_id, doc_id, {
        "status": "ready",
        "payload": payload,
        "credits_spent": 20,
    })

    yield _sse({"type": "research_step", "step": "saving",
                "label": "Saved to workspace", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
