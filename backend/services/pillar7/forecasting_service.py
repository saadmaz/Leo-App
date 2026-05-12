"""
Forecasting Model - Claude-driven regression-style forecast from historical trends.

Input: historical metric time series (monthly/weekly).
Output: base / optimistic / pessimistic forecast scenarios with confidence intervals.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar7 import ForecastingRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 600

SYSTEM = """\
You are a data scientist and growth forecaster. You extrapolate business metrics \
using trend analysis, seasonality recognition, and growth assumptions. \
You always provide scenario ranges - never false precision with a single number.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "forecast_summary": "string (2-3 sentences: key trend and outlook)",
  "forecasts": [
    {
      "metric_name": "string",
      "unit": "string",
      "trend_analysis": {
        "trend_direction": "up | flat | down | volatile",
        "average_period_growth_pct": number,
        "seasonality_detected": boolean,
        "seasonality_note": "string or null",
        "r_squared_estimate": "string (e.g. 'high confidence fit')"
      },
      "historical_summary": {
        "min_value": number,
        "max_value": number,
        "avg_value": number,
        "last_value": number
      },
      "forecast_periods": [
        {
          "period": "string (e.g. 'April 2026')",
          "base_case": number,
          "optimistic": number,
          "pessimistic": number,
          "confidence": "high | medium | low"
        }
      ],
      "key_drivers": ["string (factors that most influence this metric)"],
      "risks_to_forecast": ["string"]
    }
  ],
  "cross_metric_dependencies": ["string (e.g. 'MRR forecast depends on DAU trend holding')"],
  "assumptions_used": ["string (explicit assumptions baked into the forecast)"],
  "data_quality_notes": ["string (e.g. 'Only 3 months of data - forecast confidence is low')"],
  "recommended_targets": [
    {
      "metric": "string",
      "target_value": "string",
      "target_period": "string",
      "rationale": "string"
    }
  ]
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: ForecastingRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Forecast - {len(body.metrics)} metrics · {body.forecast_periods} {body.period_type}s"
    doc = firebase_service.create_pillar1_doc(project_id, "forecast", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "forecasting",
                "label": f"Forecasting {body.forecast_periods} {body.period_type}s ahead…", "status": "running"})

    metrics_json = json.dumps(
        [m.model_dump(exclude_none=True) for m in body.metrics], indent=2
    )

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"FORECASTING REQUEST:\n"
        f"- Forecast periods: {body.forecast_periods} {body.period_type}s\n"
        f"- Generate scenarios: {body.scenarios}\n"
        + (f"- Growth assumptions: {body.growth_assumptions}\n" if body.growth_assumptions else "")
        + f"\nHISTORICAL DATA:\n{metrics_json}\n\n"
        "Analyse trends, project forward with base/optimistic/pessimistic scenarios. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=6000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI forecasting failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "forecasting", "label": "Forecast complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["forecast_periods"] = body.forecast_periods
    payload["period_type"] = body.period_type

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
