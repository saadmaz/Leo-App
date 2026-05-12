"""
Analyst Relations - Firecrawl reads analyst research, Claude prepares the briefing.

Input:  analyst firm, product, differentiators, optional research URL.
Output: briefing document, positioning narrative, likely questions & answers.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar8 import AnalystRelationsRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 600
_MAX_ANALYST_CONTENT = 3000

SYSTEM = """\
You are an analyst relations strategist who has prepared companies for briefings with \
Gartner, Forrester, IDC, and other top analyst firms. You know what analysts care about: \
market data, differentiation proof points, customer evidence, and roadmap clarity.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "briefing_title": "string",
  "briefing_purpose": "string (1 sentence)",
  "analyst_context": "string (what this firm/analyst typically focuses on - inferred from firm name and coverage URL if available)",
  "executive_summary": "string (the 60-second pitch - what you do, for whom, and why it matters in this analyst's context)",
  "positioning_narrative": "string (400-600 word narrative: market context → problem → your solution → differentiation → traction → roadmap)",
  "key_messages": [
    {"message": "string", "proof_point": "string", "evidence_type": "data|customer|award|analyst_citation"}
  ],
  "competitive_positioning": [
    {
      "vs": "string (competitor or category)",
      "our_advantage": "string",
      "their_advantage": "string (honest acknowledgement)",
      "messaging_angle": "string"
    }
  ],
  "likely_analyst_questions": [
    {"question": "string", "recommended_answer": "string", "trap_to_avoid": "string or null"}
  ],
  "metrics_to_share": [
    {"metric": "string", "value": "string", "context": "string"}
  ],
  "roadmap_talking_points": ["string"],
  "desired_outcome_statement": "string (what success looks like from this briefing)",
  "follow_up_actions": ["string"]
}

Rules:
- Analyst questions section must anticipate the 6-8 hardest questions they will ask.
- Positioning narrative must be readable as a standalone document - analysts may share it.
- Competitive positioning must be honest - analysts know when you're spinning.
- Key messages must each have a specific proof point, not a claim.
- trap_to_avoid in Q&A warns about common mistakes when answering that question.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _firecrawl_scrape(url: str) -> str:
    """Scrape analyst research page via Firecrawl."""
    if not settings.FIRECRAWL_API_KEY:
        return ""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.firecrawl.dev/v1/scrape",
                headers={
                    "Authorization": f"Bearer {settings.FIRECRAWL_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"url": url, "formats": ["markdown"]},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("data", {}).get("markdown", "")[:_MAX_ANALYST_CONTENT]
    except Exception as exc:
        logger.warning("Firecrawl scrape failed for %s: %s", url, exc)
    return ""


async def generate(
    project: dict,
    body: AnalystRelationsRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Analyst Briefing - {body.analyst_firm}" + (f" · {body.analyst_name}" if body.analyst_name else "")
    doc = firebase_service.create_pillar1_doc(project_id, "analyst_relations", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    # Firecrawl analyst research if URL provided
    analyst_research_text = ""
    if body.analyst_coverage_url:
        yield _sse({"type": "research_step", "step": "research", "label": f"Reading {body.analyst_firm} research…", "status": "running"})
        analyst_research_text = await _firecrawl_scrape(body.analyst_coverage_url)
        if analyst_research_text:
            yield _sse({"type": "research_step", "step": "research", "label": "Analyst research loaded", "status": "done"})
        else:
            yield _sse({"type": "research_step", "step": "research", "label": "Could not read research URL - proceeding without it", "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "research", "label": "No research URL - using firm knowledge", "status": "done"})

    yield _sse({"type": "research_step", "step": "briefing", "label": "Preparing briefing document…", "status": "running"})

    diff_text = "\n".join(f"• {d}" for d in body.company_differentiation)
    usecase_text = "\n".join(f"• {u}" for u in body.target_use_cases)
    traction_text = "\n".join(f"• {t}" for t in (body.traction_metrics or []))

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"BRIEFING DETAILS:\n"
        f"- Analyst firm: {body.analyst_firm}\n"
        + (f"- Analyst: {body.analyst_name}\n" if body.analyst_name else "")
        + f"- Purpose: {body.briefing_purpose}\n"
        f"- Company: {body.company_name}\n"
        f"- Product: {body.product_name}\n"
        + (f"- Desired outcome: {body.desired_outcome}\n" if body.desired_outcome else "")
        + f"\nDIFFERENTIATORS:\n{diff_text}\n"
        f"\nTARGET USE CASES:\n{usecase_text}\n"
        + (f"\nTRACTION METRICS:\n{traction_text}\n" if traction_text else "")
        + (f"\nANALYST RESEARCH (scraped):\n{analyst_research_text}\n" if analyst_research_text else "")
        + "\nPrepare the analyst briefing document. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=6000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI briefing failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "briefing", "label": "Briefing prepared", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["analyst_firm"] = body.analyst_firm
    payload["company_name"] = body.company_name
    payload["product_name"] = body.product_name

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 20})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
