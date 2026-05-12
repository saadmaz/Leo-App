"""
Campaign generation service - drives Claude to produce a full campaign brief
and per-channel content packs from the project's Brand Core.

Yields SSE-compatible event dicts matching the ingestion pipeline format:
  { "type": "step",     "label": "...", "status": "running|done|error" }
  { "type": "progress", "pct": 0-100 }
  { "type": "done",     "campaign": { ... } }
  { "type": "error",    "message": "..." }
"""

import json
import logging
import re
from typing import AsyncIterator, Optional

from backend.config import settings
from backend.services.llm_service import get_gemini_client, build_brand_core_context

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt for one-shot campaign generation
# ---------------------------------------------------------------------------

CAMPAIGN_SYSTEM = """\
You are an expert marketing strategist and copywriter. Using the Brand Core
provided, produce a complete campaign package in a single JSON response.

Return ONLY a valid JSON object - no markdown fences, no explanation.

Schema:
{
  "brief": {
    "name": "string",
    "objective": "string",
    "audience": "string",
    "channels": ["string"],
    "timeline": "string",
    "kpis": ["string"],
    "budgetGuidance": "string",
    "keyMessages": ["string (up to 5)"]
  },
  "contentPacks": {
    "<channel_key>": {
      "captions": [
        { "text": "string", "hashtags": ["string"] }
      ],
      "adCopy": [
        { "headline": "string", "body": "string", "cta": "string" }
      ]
    }
  }
}

Rules:
- channel_key must be one of: instagram, linkedin, twitter, tiktok, meta_ads, google_ads, email
- For organic channels (instagram, linkedin, twitter, tiktok, email): populate captions (3–5 items), leave adCopy empty.
- For paid channels (meta_ads, google_ads): populate adCopy (3 variants), leave captions empty.
- Each caption for Instagram/TikTok should include 3–8 relevant hashtags; LinkedIn/Twitter: 1–3.
- Email captions: include subject line as the first caption's text, body as the second.
- Adhere strictly to character limits: Meta headlines ≤27 chars, Google headlines ≤30 chars.
- Apply the brand's tone, key phrases, and avoided language from the Brand Core.
- keyMessages must be genuine value propositions rooted in the brand's messaging.
"""

_MAX_BRAND_CORE_CHARS = 3000


# ---------------------------------------------------------------------------
# Event helpers
# ---------------------------------------------------------------------------

def _step(label: str, status: str = "running") -> dict:
    return {"type": "step", "label": label, "status": status}

def _progress(pct: int) -> dict:
    return {"type": "progress", "pct": max(0, min(100, pct))}

def _done(campaign: dict) -> dict:
    return {"type": "done", "campaign": campaign}

def _error(message: str) -> dict:
    return {"type": "error", "message": message}


# ---------------------------------------------------------------------------
# JSON parsing (same defensive approach as brand_extractor)
# ---------------------------------------------------------------------------

def _parse_json(raw: str) -> dict:
    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        return json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        logger.error("Campaign generation JSON parse failed - %s\nRaw (first 500): %s", exc, raw[:500])
        raise ValueError(f"Could not parse campaign JSON: {exc}") from exc


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

async def generate_campaign(
    project: dict,
    name: str,
    objective: str,
    audience: str,
    channels: list[str],
    timeline: str,
    kpis: list[str],
    budget_guidance: str,
) -> AsyncIterator[dict]:
    """
    Async generator that calls Claude to produce a campaign brief + content packs.

    Steps emitted:
      10% - Preparing brand context
      25% - Generating campaign brief
      60% - Generating channel content
      90% - Saving to Firestore
     100% - Done
    """
    if not settings.GEMINI_API_KEY:
        yield _error("GEMINI_API_KEY is not set.")
        return

    # 1. Build brand context
    yield _step("Preparing brand context…")
    yield _progress(10)

    brand_core = project.get("brandCore")
    brand_context = build_brand_core_context(brand_core)

    channel_list = ", ".join(channels) if channels else "instagram, email"

    user_prompt = (
        f"BRAND CORE:\n{brand_context[:_MAX_BRAND_CORE_CHARS]}\n\n"
        f"CAMPAIGN REQUEST:\n"
        f"- Name: {name}\n"
        f"- Objective: {objective}\n"
        f"- Target audience: {audience}\n"
        f"- Channels: {channel_list}\n"
        f"- Timeline: {timeline}\n"
        f"- KPIs: {', '.join(kpis) if kpis else 'engagement, reach, conversions'}\n"
        f"- Budget guidance: {budget_guidance or 'not specified'}\n\n"
        "Generate the full campaign package now."
    )

    # 2. Call Gemini
    yield _step("Generating campaign brief…")
    yield _progress(25)

    try:
        from google.genai import types as genai_types
        client = get_gemini_client()
        response = await client.aio.models.generate_content(
            model=project.get("promptModel") or settings.LLM_EXTRACTION_MODEL,
            contents=user_prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction=CAMPAIGN_SYSTEM,
                max_output_tokens=4096,
            ),
        )
    except Exception as exc:
        logger.error("Gemini call failed for campaign generation: %s", exc)
        yield _error(f"AI generation failed: {exc}")
        return

    yield _step("Generating channel content…")
    yield _progress(60)

    raw = response.text.strip()
    try:
        result = _parse_json(raw)
    except ValueError as exc:
        yield _error(str(exc))
        return

    brief = result.get("brief", {})
    content_packs = result.get("contentPacks", {})

    # Merge in the user-supplied values (they're authoritative over what Claude inferred)
    brief.setdefault("name", name)
    brief.setdefault("objective", objective)
    brief.setdefault("audience", audience)
    brief.setdefault("channels", channels)
    brief.setdefault("timeline", timeline)
    brief.setdefault("kpis", kpis)
    brief.setdefault("budgetGuidance", budget_guidance)

    yield _progress(85)
    yield _step("Finalising campaign…")
    yield _progress(90)

    campaign_data = {
        "name": name,
        "brief": brief,
        "contentPacks": content_packs,
        "status": "ready",
        "channels": channels,
        "objective": objective,
        "audience": audience,
        "timeline": timeline,
    }

    yield _progress(100)
    yield _step("Campaign ready", "done")
    yield _done(campaign_data)
