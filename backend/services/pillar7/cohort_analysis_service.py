"""
Cohort Analysis - Claude interprets retention / activation / revenue cohort data.

Input: cohort rows with retention percentages per week/period.
Output: pattern analysis, lifecycle insights, actionable fixes.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar7 import CohortAnalysisRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 600

SYSTEM = """\
You are a product analytics expert who specialises in cohort analysis and retention science. \
You find the signal in cohort data that product teams miss.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "analysis_summary": "string (3-4 sentences: biggest retention pattern and root cause)",
  "cohort_type": "string",
  "benchmark_comparison": "string (how this compares to industry benchmarks)",
  "retention_curve_shape": "string (e.g. 'steep initial drop then plateau', 'gradual decay', 'resurrection pattern')",
  "critical_drop_off_period": "string (when the most users are lost - e.g. 'Week 1-2')",
  "cohort_trends": [
    {
      "cohort": "string",
      "avg_retention_pct": number,
      "trend_vs_prev": "improving | stable | declining",
      "notable_observation": "string"
    }
  ],
  "best_cohort": "string (cohort name + why it performed best)",
  "worst_cohort": "string (cohort name + why it struggled)",
  "root_causes": [
    {
      "hypothesis": "string",
      "evidence_from_data": "string",
      "confidence": "high | medium | low"
    }
  ],
  "quick_wins": [
    {
      "action": "string (specific product or marketing action)",
      "expected_impact": "string (e.g. '+5-8pp week2 retention')",
      "effort": "low | medium | high",
      "timeline": "string"
    }
  ],
  "experiments_to_run": [
    {
      "experiment": "string",
      "hypothesis": "string",
      "success_metric": "string"
    }
  ],
  "north_star_metric": "string (the single retention metric to improve most)",
  "six_month_outlook": "string (what retention will look like if current trend continues)"
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: CohortAnalysisRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Cohort Analysis - {body.product_name} · {body.cohort_type}"
    doc = firebase_service.create_pillar1_doc(project_id, "cohort_analysis", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "analysing",
                "label": f"Analysing {len(body.cohorts)} cohorts…", "status": "running"})

    cohorts_json = json.dumps(
        [c.model_dump(exclude_none=True) for c in body.cohorts], indent=2
    )

    prompt = (
        f"BRAND / PRODUCT: {brand_context[:_MAX_BRAND]}\n\n"
        f"COHORT ANALYSIS REQUEST:\n"
        f"- Product: {body.product_name}\n"
        f"- Cohort type: {body.cohort_type}\n"
        + (f"- Business context: {body.business_context}\n" if body.business_context else "")
        + f"\nCOHORT DATA:\n{cohorts_json}\n\n"
        "Identify retention patterns and actionable improvements. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=5000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI analysis failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "analysing", "label": "Analysis complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["product_name"] = body.product_name
    payload.setdefault("cohort_type", body.cohort_type)

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 20})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
