"""
Award Submissions - Firecrawl reads award criteria, Claude drafts the submission.

Input:  award name/URL, company, achievements, category.
Output: structured submission text aligned to the specific award criteria.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar8 import AwardSubmissionRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500
_MAX_AWARD_CONTENT = 3000

SYSTEM = """\
You are an award submission expert who helps companies win industry recognition. \
You write compelling, evidence-based submissions that judges remember - specific, \
achievement-focused, humble yet confident.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "submission_title": "string (the title of the entry)",
  "executive_summary": "string (100-150 words - the elevator pitch of why this entry should win)",
  "main_submission": "string (the full submission text - structured by the award criteria if known, or by Impact → Approach → Results → Future if not)",
  "key_achievements_highlighted": [
    {"achievement": "string", "metric": "string or null", "impact": "string"}
  ],
  "judge_takeaways": ["string (3-5 bullet points a judge should remember)"],
  "supporting_evidence_suggestions": ["string (types of evidence to attach - e.g. 'case study PDF', 'customer testimonial')"],
  "word_count": number,
  "criteria_addressed": ["string (which criteria this submission explicitly addresses)"],
  "submission_tips": ["string"]
}

Rules:
- Lead with impact, not backstory.
- Use specific numbers wherever possible - judges trust data.
- Address each known criterion explicitly.
- Avoid superlatives without evidence ('world-class', 'industry-leading' without proof).
- End the main submission with a forward-looking statement about continued impact.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _firecrawl_scrape(url: str) -> str:
    """Scrape award page content via Firecrawl."""
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
                return data.get("data", {}).get("markdown", "")[:_MAX_AWARD_CONTENT]
    except Exception as exc:
        logger.warning("Firecrawl scrape failed for %s: %s", url, exc)
    return ""


async def generate(
    project: dict,
    body: AwardSubmissionRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Award Submission - {body.award_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "award_submission", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    # Firecrawl award page if URL provided
    award_criteria_text = ""
    if body.award_url:
        yield _sse({"type": "research_step", "step": "scraping", "label": f"Reading {body.award_name} criteria…", "status": "running"})
        award_criteria_text = await _firecrawl_scrape(body.award_url)
        if award_criteria_text:
            yield _sse({"type": "research_step", "step": "scraping", "label": "Award criteria loaded", "status": "done"})
        else:
            yield _sse({"type": "research_step", "step": "scraping", "label": "Could not read award page - proceeding without criteria", "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "scraping", "label": "No award URL provided - using general best practices", "status": "done"})

    yield _sse({"type": "research_step", "step": "writing", "label": "Drafting award submission…", "status": "running"})

    achievements_text = "\n".join(f"• {a}" for a in body.key_achievements)
    data_text = "\n".join(f"• {d}" for d in (body.supporting_data or []))

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"AWARD DETAILS:\n"
        f"- Award: {body.award_name}\n"
        + (f"- Category: {body.award_category}\n" if body.award_category else "")
        + f"- Company: {body.company_name}\n"
        f"- Submission angle: {body.submission_angle}\n"
        + (f"- Word limit: {body.word_limit} words\n" if body.word_limit else "")
        + f"\nKEY ACHIEVEMENTS:\n{achievements_text}\n"
        + (f"\nSUPPORTING DATA:\n{data_text}\n" if data_text else "")
        + (f"\nAWARD CRITERIA (scraped from award page):\n{award_criteria_text}\n" if award_criteria_text else "")
        + "\nDraft the award submission. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=5000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI writing failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "writing", "label": "Submission drafted", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["award_name"] = body.award_name
    payload["company_name"] = body.company_name
    if body.award_category:
        payload["award_category"] = body.award_category

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
