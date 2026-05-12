"""
Funnel Conversion Analysis - Claude explains conversion drops at every funnel step.

Input: funnel steps with user counts.
Output: conversion rates, drop-off diagnosis, fix recommendations.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar7 import FunnelAnalysisRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 600

SYSTEM = """\
You are a conversion rate optimisation (CRO) expert. You diagnose exactly where \
and why funnels leak, and prescribe targeted fixes with expected impact.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "funnel_name": "string",
  "overall_conversion_rate_pct": number,
  "benchmark_assessment": "string (vs industry benchmark if provided)",
  "executive_summary": "string (2-3 sentences: biggest leak and top fix)",
  "steps_analysis": [
    {
      "step_name": "string",
      "users": number,
      "conversion_rate_from_prev_pct": number,
      "drop_off_pct": number,
      "performance": "strong | average | weak | critical",
      "drop_off_diagnosis": "string (why users are likely leaving here)",
      "fix_recommendation": "string (specific, actionable fix)",
      "expected_impact": "string (e.g. '+3-5pp conversion')",
      "effort": "low | medium | high"
    }
  ],
  "biggest_leak": {
    "step": "string",
    "users_lost": number,
    "root_cause": "string",
    "priority_fix": "string"
  },
  "quick_wins": [
    {
      "action": "string",
      "target_step": "string",
      "expected_lift": "string",
      "effort": "low | medium | high"
    }
  ],
  "ab_tests_to_run": [
    {
      "step": "string",
      "test": "string",
      "hypothesis": "string",
      "success_metric": "string"
    }
  ],
  "revenue_opportunity": "string (how much additional revenue if biggest leak is fixed by 20%)",
  "funnel_health_score": number (0-100)
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: FunnelAnalysisRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Funnel Analysis - {body.funnel_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "funnel_analysis", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})
    yield _sse({"type": "research_step", "step": "analysing",
                "label": f"Analysing {len(body.steps)}-step funnel…", "status": "running"})

    steps_json = json.dumps(
        [s.model_dump(exclude_none=True) for s in body.steps], indent=2
    )

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"FUNNEL ANALYSIS:\n"
        f"- Funnel: {body.funnel_name}\n"
        f"- Period: {body.time_period}\n"
        f"- Goal conversion: {body.goal_conversion_event}\n"
        + (f"- Industry benchmark: {body.industry_benchmark}\n" if body.industry_benchmark else "")
        + f"\nFUNNEL STEPS:\n{steps_json}\n\n"
        "Calculate exact conversion rates, diagnose every drop-off, prioritise fixes. Return valid JSON only."
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

    payload["funnel_name"] = body.funnel_name
    payload["time_period"] = body.time_period

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
