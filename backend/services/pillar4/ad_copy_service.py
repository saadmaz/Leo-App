"""
Ad Copy Generator - Claude-powered multi-platform, multi-variant.

Produces platform-specific ad copy variants with:
- Correct character limits per platform
- Multiple creative angles (problem-aware, solution-aware, social proof, urgency)
- A/B testing rationale for each variant

Supported platforms:
  google_search   - RSA: headlines ≤30 chars (×15), descriptions ≤90 chars (×4)
  google_display  - Short headline ≤30, long headline ≤90, description ≤90
  meta_feed       - Primary ≤125 chars, headline ≤40 chars, description ≤30 chars
  meta_stories    - Primary ≤125 chars, headline ≤40 chars
  tiktok          - Ad text ≤100 chars
  linkedin        - Headline ≤70 chars, body ≤600 chars, description ≤100 chars
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar4 import AdCopyRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND_CHARS = 2000

_PLATFORM_SPECS = {
    "google_search": (
        "Responsive Search Ads (RSA). "
        "Generate 5 headlines (≤30 chars each) and 3 descriptions (≤90 chars each) per variant. "
        "Use 'headlines' (array of strings) and 'descriptions' (array of strings) fields."
    ),
    "google_display": (
        "Display Ads. "
        "Generate 'short_headline' (≤30 chars), 'long_headline' (≤90 chars), "
        "and 'description' (≤90 chars) per variant."
    ),
    "meta_feed": (
        "Meta Feed Ads (Facebook & Instagram). "
        "Generate 'primary_text' (≤125 chars), 'headline' (≤40 chars), "
        "'description' (≤30 chars), and 'cta' per variant."
    ),
    "meta_stories": (
        "Meta Stories Ads. "
        "Generate 'primary_text' (≤125 chars), 'headline' (≤40 chars), "
        "and 'cta' per variant. Note: copy must work without body text visible."
    ),
    "tiktok": (
        "TikTok In-Feed Ads. "
        "Generate 'ad_text' (≤100 chars) and 'cta' per variant. "
        "Copy must be punchy, trend-aware, and native-feeling. Include a 'hook' (first 3 seconds line)."
    ),
    "linkedin": (
        "LinkedIn Single Image Ads. "
        "Generate 'headline' (≤70 chars), 'body' (≤600 chars), "
        "'description' (≤100 chars), and 'cta' per variant."
    ),
}

_ANGLES = ["problem_aware", "solution_aware", "social_proof", "urgency", "aspirational"]

SYSTEM_PROMPT = """\
You are a world-class direct-response copywriter specialising in paid advertising. \
Your copy converts - it is clear, specific, and action-driven.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "platform": "string",
  "platform_specs": "string (summary of character limits applied)",
  "variants": [
    {
      "variant_id": "A" | "B" | "C" | "D" | "E",
      "angle": "string (problem_aware|solution_aware|social_proof|urgency|aspirational)",
      "angle_rationale": "string (1 sentence: why this angle for this audience)",
      "ab_hypothesis": "string (what you expect this variant to outperform on)",
      ... platform-specific copy fields ...
      "cta": "string"
    }
  ],
  "testing_strategy": "string (how to run the A/B test, what to measure first)",
  "brand_voice_notes": "string (how brand voice was applied)"
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: AdCopyRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """SSE generator for multi-variant ad copy."""

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    platform_label = body.platform.replace("_", " ").title()
    title = f"Ad Copy - {platform_label} · {body.product_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "ad_copy", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand_context",
                "label": "Loading brand context…", "status": "running"})

    brand_core = project.get("brandCore") or {}
    brand_context = build_brand_core_context(brand_core)
    platform_spec = _PLATFORM_SPECS.get(body.platform, "Standard ad copy format.")
    usps_str = "\n".join(f"- {u}" for u in body.usp) if body.usp else "Not specified"
    angles = ", ".join(_ANGLES[:body.num_variants])

    user_prompt = (
        f"BRAND CORE:\n{brand_context[:_MAX_BRAND_CHARS]}\n\n"
        f"AD COPY REQUEST:\n"
        f"- Platform: {body.platform}\n"
        f"- Platform Specs: {platform_spec}\n"
        f"- Objective: {body.objective}\n"
        f"- Product: {body.product_name}\n"
        f"- Description: {body.product_description}\n"
        f"- Target Audience: {body.target_audience}\n"
        f"- Tone: {body.tone}\n"
        f"- Number of Variants: {body.num_variants}\n"
        f"- Unique Selling Points:\n{usps_str}\n"
        f"- Angles to use (in order): {angles}\n"
        + (f"- Landing Page: {body.landing_page_url}\n" if body.landing_page_url else "")
        + f"\nGenerate {body.num_variants} ad copy variants now. "
          f"Strictly enforce all character limits. Return valid JSON only."
    )

    yield _sse({"type": "research_step", "step": "brand_context",
                "label": "Brand context loaded", "status": "done"})
    yield _sse({"type": "research_step", "step": "generating",
                "label": f"Writing {body.num_variants} {platform_label} variants…", "status": "running"})

    try:
        raw = await call_claude_raw(user_prompt, system=SYSTEM_PROMPT, max_tokens=3000)
    except Exception as exc:
        logger.error("Claude call failed for ad copy: %s", exc)
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"})
        return

    yield _sse({"type": "research_step", "step": "generating",
                "label": f"{body.num_variants} variants ready", "status": "done"})
    yield _sse({"type": "research_step", "step": "saving",
                "label": "Saving to workspace…", "status": "running"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        logger.error("Ad copy JSON parse failed: %s\nRaw (first 500): %s", exc, raw[:500])
        yield _sse({"type": "error", "message": f"Could not parse response JSON: {exc}"})
        return

    payload["platform"] = body.platform
    payload["product_name"] = body.product_name

    firebase_service.update_pillar1_doc(project_id, doc_id, {
        "status": "ready",
        "payload": payload,
        "credits_spent": 10,
    })

    yield _sse({"type": "research_step", "step": "saving",
                "label": "Saved to workspace", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
