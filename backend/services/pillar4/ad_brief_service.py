"""
Paid Ad Campaign Brief Generator - Claude-powered.

Produces a comprehensive paid advertising brief with:
- Platform-specific strategy and budget allocation
- Audience targeting recommendations
- Creative requirements per platform
- Bidding strategy guidance
- KPIs and tracking setup checklist

Yields SSE-compatible event dicts (same schema as all other Pillar services).
"""
from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar4 import AdBriefRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND_CHARS = 2000

SYSTEM_PROMPT = """\
You are a senior paid media strategist with deep expertise across Google Ads, Meta Ads, \
TikTok Ads, and LinkedIn Ads. Your task is to produce a comprehensive, actionable paid \
advertising campaign brief.

Return ONLY a valid JSON object - no markdown fences, no commentary outside the JSON.

Schema:
{
  "campaign_name": "string",
  "objective": "string",
  "executive_summary": "string (2-3 sentences)",
  "target_audience": {
    "primary": "string",
    "demographics": "string",
    "psychographics": "string",
    "pain_points": ["string"],
    "buying_intent_signals": ["string"]
  },
  "budget_allocation": [
    {
      "platform": "string",
      "percentage": number,
      "daily_budget": "string",
      "rationale": "string"
    }
  ],
  "platform_strategy": [
    {
      "platform": "string",
      "campaign_type": "string",
      "bidding_strategy": "string",
      "targeting_approach": "string",
      "creative_formats": ["string"],
      "key_metrics": ["string"],
      "expected_cpc_range": "string",
      "expected_ctr_range": "string"
    }
  ],
  "creative_requirements": {
    "key_messages": ["string (up to 5)"],
    "tone_and_style": "string",
    "headline_angles": ["string (up to 4, one per angle type)"],
    "image_specs_summary": "string",
    "video_specs_summary": "string"
  },
  "tracking_setup": [
    {"task": "string", "platform": "string", "priority": "high|medium|low"}
  ],
  "kpis": [
    {"metric": "string", "target": "string", "rationale": "string"}
  ],
  "launch_checklist": ["string"],
  "timeline": "string"
}

Rules:
- Be specific with numbers (CPC ranges, CTR benchmarks, budget splits).
- Bidding strategies must use real platform terms (Target CPA, Maximize Conversions, etc.).
- Creative formats must list real ad unit names (Responsive Search Ads, Single Image, Reels, etc.).
- Apply brand voice and messaging from the Brand Core provided.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: AdBriefRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """SSE generator for paid ad campaign brief."""

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Ad Brief - {body.campaign_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "ad_brief", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand_context",
                "label": "Loading brand context…", "status": "running"})

    brand_core = project.get("brandCore") or {}
    brand_context = build_brand_core_context(brand_core)

    platforms_str = ", ".join(body.platforms)
    usps_str = "\n".join(f"- {u}" for u in body.unique_selling_points) if body.unique_selling_points else "Not specified"

    user_prompt = (
        f"BRAND CORE:\n{brand_context[:_MAX_BRAND_CHARS]}\n\n"
        f"CAMPAIGN BRIEF REQUEST:\n"
        f"- Campaign Name: {body.campaign_name}\n"
        f"- Objective: {body.objective}\n"
        f"- Product: {body.product_name}\n"
        f"- Target Audience: {body.target_audience}\n"
        f"- Platforms: {platforms_str}\n"
        f"- Daily Budget: {body.daily_budget}\n"
        f"- Timeline: {body.timeline}\n"
        f"- Unique Selling Points:\n{usps_str}\n"
        + (f"- Landing Page: {body.landing_page_url}\n" if body.landing_page_url else "")
        + "\nGenerate the full paid advertising campaign brief now."
    )

    yield _sse({"type": "research_step", "step": "brand_context",
                "label": "Brand context loaded", "status": "done"})
    yield _sse({"type": "research_step", "step": "generating",
                "label": "Generating campaign brief with Claude…", "status": "running"})

    try:
        raw = await call_claude_raw(user_prompt, system=SYSTEM_PROMPT, max_tokens=4096)
    except Exception as exc:
        logger.error("Claude call failed for ad brief: %s", exc)
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"})
        return

    yield _sse({"type": "research_step", "step": "generating",
                "label": "Brief generated", "status": "done"})
    yield _sse({"type": "research_step", "step": "saving",
                "label": "Saving to workspace…", "status": "running"})

    # Parse JSON
    import re
    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        logger.error("Ad brief JSON parse failed: %s\nRaw (first 500): %s", exc, raw[:500])
        yield _sse({"type": "error", "message": f"Could not parse response JSON: {exc}"})
        return

    payload["campaign_name"] = body.campaign_name
    payload["objective"] = body.objective

    firebase_service.update_pillar1_doc(project_id, doc_id, {
        "status": "ready",
        "payload": payload,
        "credits_spent": 15,
    })

    yield _sse({"type": "research_step", "step": "saving",
                "label": "Saved to workspace", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
