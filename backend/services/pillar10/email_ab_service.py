"""
Email A/B Testing - user provides variant results (or Loops.so API fetches them),
Claude identifies the winner and recommends the next iteration.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar10 import EmailABTestRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500

SYSTEM = """\
You are an email marketing strategist who specialises in A/B test analysis.
You identify winning variants, explain WHY they won in terms of psychology and
audience behaviour, and prescribe the next iteration of testing.

Return ONLY a valid JSON object - no markdown fences.

Schema:
{
  "winner": {
    "variant_name": "string",
    "winning_metric": "string",
    "winning_value": "string",
    "lift_over_control": "string (e.g. '+23% open rate')",
    "statistical_note": "string (is this result significant given the sample sizes?)"
  },
  "variant_analysis": [
    {
      "variant_name": "string",
      "subject_line": "string",
      "calculated_metrics": {
        "open_rate": "string",
        "click_rate": "string",
        "conversion_rate": "string or null",
        "click_to_open_rate": "string"
      },
      "performance_tier": "winner | strong | average | underperformer",
      "why_it_performed": "string (psychological / structural reasons)"
    }
  ],
  "key_learning": "string (the single insight to carry forward)",
  "subject_line_patterns": {
    "what_worked": ["string"],
    "what_did_not_work": ["string"]
  },
  "next_test_recommendation": {
    "test_element": "string",
    "hypothesis": "string",
    "variant_ideas": ["string"],
    "expected_lift": "string"
  },
  "apply_winner_to": ["string (campaigns/sequences where the winning approach should be rolled out)"],
  "send_time_insight": "string or null (any timing observations from the data)",
  "list_health_flags": ["string or null (unsubscribe spikes, low open rates, etc.)"]
}

Rules:
- Calculate click-to-open rate (CTOR = clicks/opens) as a proxy for body copy quality.
- Flag statistical concerns if sends < 500 per variant.
- subject_line_patterns must be actionable and generalisable.
- apply_winner_to must reference specific campaign types or sequences.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _fetch_loops_campaign(campaign_id: str) -> dict:
    """Fetch campaign stats from Loops.so API."""
    if not settings.LOOPS_API_KEY or not campaign_id:
        return {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://app.loops.so/api/v1/campaigns/{campaign_id}",
                headers={"Authorization": f"Bearer {settings.LOOPS_API_KEY}"},
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception as exc:
        logger.warning("Loops.so fetch failed: %s", exc)
    return {}


async def generate(
    project: dict,
    body: EmailABTestRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Email A/B - {body.test_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "email_ab_test", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    # Optional live Loops fetch
    loops_data: dict = {}
    if body.fetch_from_loops and body.loops_campaign_id:
        yield _sse({"type": "research_step", "step": "loops", "label": "Fetching from Loops.so…", "status": "running"})
        loops_data = await _fetch_loops_campaign(body.loops_campaign_id)
        label = "Loops data fetched" if loops_data else "Loops returned no data - using provided results"
        yield _sse({"type": "research_step", "step": "loops", "label": label, "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "loops", "label": "Using provided results", "status": "done"})

    yield _sse({"type": "research_step", "step": "analysing", "label": "Analysing email A/B results…", "status": "running"})

    variant_data = [v.model_dump(exclude_none=True) for v in body.variant_results]

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"EMAIL A/B TEST:\n"
        f"- Test name: {body.test_name}\n"
        f"- Campaign type: {body.campaign_type}\n"
        f"- Element tested: {body.test_element}\n"
        f"- Winner selection metric: {body.winner_selection_metric}\n"
        + (f"- Audience segment: {body.audience_segment}\n" if body.audience_segment else "")
        + (f"- Test duration: {body.test_duration_hours}h\n" if body.test_duration_hours else "")
        + (f"\nLOOPS DATA:\n{json.dumps(loops_data, indent=2)}\n" if loops_data else "")
        + f"\nVARIANT RESULTS:\n{json.dumps(variant_data, indent=2)}\n\n"
        "Analyse the email A/B test results and identify the winner. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=4000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"Analysis failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "analysing", "label": "Analysis complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["test_name"] = body.test_name
    payload["test_element"] = body.test_element
    payload["campaign_type"] = body.campaign_type

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 10})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
