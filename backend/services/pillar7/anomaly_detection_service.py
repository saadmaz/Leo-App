"""
Anomaly Detection - Statistical threshold checking + Claude interpretation.

Input: time-series metric data (daily/weekly values).
Output: anomalies flagged, root cause hypotheses, severity ratings, recommended actions.
"""
from __future__ import annotations

import json
import logging
import re
import statistics
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar7 import AnomalyDetectionRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 600

SENSITIVITY_MULTIPLIERS = {"low": 3.0, "medium": 2.0, "high": 1.5}

SYSTEM = """\
You are a data analyst specialised in anomaly detection and metric forensics. \
You explain statistical anomalies in business terms and prescribe clear responses.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "detection_summary": "string (2-3 sentences: what anomalies were found and severity)",
  "anomalies": [
    {
      "metric": "string",
      "date": "string",
      "value": number,
      "expected_range": {"low": number, "high": number},
      "deviation_pct": number,
      "severity": "critical | high | medium | low",
      "direction": "spike | drop",
      "root_cause_hypotheses": ["string (ordered by likelihood)"],
      "investigation_steps": ["string (what to check first)"],
      "recommended_action": "string",
      "urgency": "immediate | this_week | monitor"
    }
  ],
  "metrics_summary": [
    {
      "metric": "string",
      "period_avg": number,
      "period_trend": "up | flat | down",
      "volatility": "high | medium | low",
      "health_status": "healthy | watch | alert | critical"
    }
  ],
  "correlations": ["string (e.g. 'DAU drop correlates with email open rate drop on March 5')"],
  "false_positive_flags": ["string (anomalies that are likely expected, e.g. holiday weekend)"],
  "monitoring_recommendations": ["string (what alerts to set up to catch this earlier)"]
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _detect_anomalies_statistically(
    series: list[dict],
    metric_name: str,
    unit: str,
    multiplier: float,
) -> list[dict]:
    """
    Simple IQR + Z-score anomaly detection.
    Returns list of anomaly dicts with basic fields for Claude to interpret.
    """
    values = [float(p.get("value", 0)) for p in series if p.get("value") is not None]
    if len(values) < 4:
        return []

    mean = statistics.mean(values)
    try:
        stdev = statistics.stdev(values)
    except statistics.StatisticsError:
        stdev = 0.0

    threshold = multiplier * (stdev or mean * 0.1)
    anomalies = []
    for point in series:
        val = float(point.get("value", 0))
        if stdev > 0 and abs(val - mean) > threshold:
            dev_pct = ((val - mean) / mean * 100) if mean != 0 else 0
            anomalies.append({
                "metric": metric_name,
                "date": point.get("date", ""),
                "value": val,
                "expected_mean": round(mean, 2),
                "expected_low": round(mean - threshold, 2),
                "expected_high": round(mean + threshold, 2),
                "deviation_pct": round(dev_pct, 1),
                "direction": "spike" if val > mean else "drop",
                "unit": unit,
            })
    return anomalies


async def generate(
    project: dict,
    body: AnomalyDetectionRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Anomaly Detection - {len(body.metrics)} metrics"
    doc = firebase_service.create_pillar1_doc(project_id, "anomaly_detection", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "statistical",
                "label": "Running statistical anomaly detection…", "status": "running"})

    multiplier = SENSITIVITY_MULTIPLIERS.get(body.sensitivity, 2.0)
    all_anomalies: list[dict] = []
    metrics_summary_input: list[dict] = []

    for metric in body.metrics:
        anomalies = _detect_anomalies_statistically(
            metric.data_points, metric.metric_name, metric.unit, multiplier
        )
        all_anomalies.extend(anomalies)
        metrics_summary_input.append({
            "metric_name": metric.metric_name,
            "unit": metric.unit,
            "data_points": metric.data_points,
            "detected_anomaly_count": len(anomalies),
            "detected_anomalies": anomalies,
        })

    yield _sse({"type": "research_step", "step": "statistical",
                "label": f"Found {len(all_anomalies)} statistical anomalies", "status": "done"})

    yield _sse({"type": "research_step", "step": "interpreting",
                "label": "Claude interpreting anomalies…", "status": "running"})

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"ANOMALY DETECTION:\n"
        f"- Sensitivity: {body.sensitivity}\n"
        f"- Std-dev multiplier used: {multiplier}\n"
        + (f"- Business context: {body.business_context}\n" if body.business_context else "")
        + f"\nMETRICS WITH PRE-COMPUTED ANOMALIES:\n{json.dumps(metrics_summary_input, indent=2)}\n\n"
        "Interpret each anomaly, hypothesise root causes, rate severity, prescribe actions. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=5000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI interpretation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "interpreting", "label": "Interpretation complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["sensitivity"] = body.sensitivity
    payload["total_anomalies_detected"] = len(all_anomalies)

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 10})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
