"""
Landing Page CRO - Firecrawl reads the page (if URL provided), Claude generates
copy variants for each section. User implements the winners in VWO / Optimizely / their CMS.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar10 import LandingPageCRORequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500
_MAX_PAGE = 3000

SYSTEM = """\
You are a conversion rate optimisation (CRO) expert who has optimised landing pages
for hundreds of SaaS and e-commerce companies.

You generate copy variants that are psychologically grounded - each variant tests
a different persuasion angle (pain-led, benefit-led, social proof, urgency, curiosity, etc.).

Return ONLY a valid JSON object - no markdown fences.

Schema:
{
  "page_analysis": "string (brief assessment of the current page - what's working, what's not)",
  "cro_opportunities": ["string (top 3-5 opportunities ranked by expected impact)"],
  "sections": [
    {
      "section": "string (e.g. 'hero_headline', 'subheadline', 'cta', 'value_proposition')",
      "current_version": "string or null",
      "variants": [
        {
          "variant_id": "string (A, B, C…)",
          "copy": "string (the exact copy)",
          "angle": "string (persuasion angle - e.g. 'pain_led', 'benefit_led', 'social_proof', 'urgency', 'curiosity')",
          "rationale": "string (why this variant should convert better)",
          "which_audience_segment": "string (who this variant speaks to best)"
        }
      ],
      "testing_recommendation": "string (how to set up and measure this section's test)"
    }
  ],
  "implementation_guide": "string (step-by-step for setting up in VWO, Optimizely, or similar)",
  "success_metrics": ["string"],
  "expected_lift_range": "string (realistic lift range based on industry benchmarks)",
  "overall_cro_roadmap": "string (what order to test these sections in and why)"
}

Rules:
- Each section gets exactly the requested number of variants.
- Variants must be meaningfully different - not just word swaps.
- Rationale must reference a specific psychological principle (loss aversion, social proof, FOMO, etc.).
- implementation_guide must be actionable without a developer (visual editors).
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _firecrawl_scrape(url: str) -> str:
    if not settings.FIRECRAWL_API_KEY:
        return ""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.firecrawl.dev/v1/scrape",
                headers={"Authorization": f"Bearer {settings.FIRECRAWL_API_KEY}", "Content-Type": "application/json"},
                json={"url": url, "formats": ["markdown"]},
            )
            if resp.status_code == 200:
                return resp.json().get("data", {}).get("markdown", "")[:_MAX_PAGE]
    except Exception as exc:
        logger.warning("Firecrawl scrape failed for %s: %s", url, exc)
    return ""


async def generate(
    project: dict,
    body: LandingPageCRORequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Landing Page CRO - {body.conversion_goal[:50]}"
    doc = firebase_service.create_pillar1_doc(project_id, "landing_page_cro", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    page_content = ""
    if body.page_url:
        yield _sse({"type": "research_step", "step": "scraping", "label": "Reading landing page…", "status": "running"})
        page_content = await _firecrawl_scrape(body.page_url)
        status = "done" if page_content else "done"
        label = "Page content loaded" if page_content else "Could not read page - using description"
        yield _sse({"type": "research_step", "step": "scraping", "label": label, "status": status})
    else:
        yield _sse({"type": "research_step", "step": "scraping", "label": "No URL - using description", "status": "done"})

    yield _sse({"type": "research_step", "step": "generating", "label": "Generating CRO variants…", "status": "running"})

    sections_text = ", ".join(body.sections_to_optimise)
    pain_text = "\n".join(f"• {p}" for p in (body.pain_points or []))

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"CRO REQUEST:\n"
        f"- Conversion goal: {body.conversion_goal}\n"
        f"- Target audience: {body.target_audience}\n"
        f"- Sections to optimise: {sections_text}\n"
        f"- Variants per section: {body.num_variants}\n"
        + (f"- Current headline: {body.current_headline}\n" if body.current_headline else "")
        + (f"- Current CTA: {body.current_cta}\n" if body.current_cta else "")
        + (f"- Pain points:\n{pain_text}\n" if pain_text else "")
        + (f"\nPAGE CONTENT (scraped):\n{page_content}\n" if page_content else "")
        + (f"\nPAGE DESCRIPTION:\n{body.page_description}\n" if body.page_description else "")
        + "\nGenerate CRO copy variants for each section. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=6000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "generating", "label": "Variants generated", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["conversion_goal"] = body.conversion_goal
    payload["page_url"] = body.page_url

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
