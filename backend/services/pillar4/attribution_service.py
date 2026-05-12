"""
Cross-Channel Attribution - GA4 Data API + Claude interpretation.

Two modes:
  1. GA4-connected:  Pull channel metrics automatically from GA4 Data API
                     Requires GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT_KEY in config.
  2. Manual:         User provides channel_data in the request body.
                     Claude interprets and provides attribution insights.

Claude produces:
  - Attribution breakdown by channel (data-driven weighting)
  - Under/over-performing channels
  - Budget reallocation recommendations
  - Model comparison (last-click vs linear vs data-driven)
  - Actionable next steps
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar4 import AttributionRequest, ChannelMetrics
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND_CHARS = 1500

SYSTEM_PROMPT = """\
You are a data-driven performance marketing analyst. You interpret cross-channel \
attribution data and turn numbers into clear, prioritised recommendations.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "analysis_period": "string",
  "conversion_goal": "string",
  "data_source": "GA4" | "Manual",
  "total_conversions": number,
  "total_revenue": number,
  "total_cost": number,
  "overall_roas": number,
  "channel_breakdown": [
    {
      "channel": "string",
      "sessions": number,
      "conversions": number,
      "revenue": number,
      "cost": number,
      "roas": number,
      "cpa": number,
      "conversion_rate_pct": number,
      "attributed_share_pct": number,
      "performance_label": "top_performer" | "average" | "underperformer" | "brand_awareness",
      "insight": "string (1-2 sentences)"
    }
  ],
  "model_comparison": {
    "last_click": "string (brief interpretation)",
    "first_click": "string",
    "linear": "string",
    "data_driven_estimate": "string"
  },
  "budget_recommendations": [
    {
      "action": "increase" | "decrease" | "maintain" | "pause" | "test",
      "channel": "string",
      "current_share_pct": number,
      "recommended_share_pct": number,
      "rationale": "string"
    }
  ],
  "top_opportunities": ["string (up to 5 specific, actionable opportunities)"],
  "risks": ["string (up to 3 risks to watch)"],
  "next_steps": ["string (up to 5 prioritised next steps with channel and timeline)"]
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _fetch_ga4_data(
    property_id: str,
    service_account_key: str,
    date_range_days: int,
    conversion_goal: str,
) -> list[ChannelMetrics]:
    """
    Pull channel group performance from GA4 Data API.
    Returns list of ChannelMetrics. Raises on failure.
    """
    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import (
            RunReportRequest,
            DateRange,
            Dimension,
            Metric,
        )
        from google.oauth2 import service_account
        import json as _json

        key_data = _json.loads(service_account_key)
        credentials = service_account.Credentials.from_service_account_info(
            key_data,
            scopes=["https://www.googleapis.com/auth/analytics.readonly"],
        )
        client = BetaAnalyticsDataClient(credentials=credentials)

        request = RunReportRequest(
            property=f"properties/{property_id}",
            dimensions=[Dimension(name="sessionDefaultChannelGroup")],
            metrics=[
                Metric(name="sessions"),
                Metric(name="conversions"),
                Metric(name="totalRevenue"),
            ],
            date_ranges=[DateRange(start_date=f"{date_range_days}daysAgo", end_date="today")],
        )

        response = client.run_report(request)

        results: list[ChannelMetrics] = []
        for row in response.rows:
            channel = row.dimension_values[0].value
            sessions = int(row.metric_values[0].value or 0)
            conversions = int(row.metric_values[1].value or 0)
            revenue = float(row.metric_values[2].value or 0.0)
            results.append(ChannelMetrics(
                channel=channel,
                sessions=sessions,
                conversions=conversions,
                revenue=revenue,
                cost=0.0,  # GA4 doesn't have cost natively; user must add manually
            ))
        return results

    except ImportError:
        raise RuntimeError(
            "google-analytics-data package is not installed. "
            "Add 'google-analytics-data' to requirements.txt."
        )


async def generate(
    project: dict,
    body: AttributionRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """SSE generator for cross-channel attribution analysis."""

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Attribution Report - {body.date_range_days}d · {body.conversion_goal}"
    doc = firebase_service.create_pillar1_doc(project_id, "attribution", owner_uid, title)
    doc_id = doc["id"]

    # ── Step 1: Gather data ───────────────────────────────────────────────────
    data_source = "Manual"
    channel_metrics = list(body.channel_data)

    ga4_property = getattr(settings, "GA4_PROPERTY_ID", None)
    ga4_key = getattr(settings, "GA4_SERVICE_ACCOUNT_KEY", None)

    if ga4_property and ga4_key and not channel_metrics:
        yield _sse({"type": "research_step", "step": "ga4_pull",
                    "label": f"Pulling {body.date_range_days}-day GA4 data…", "status": "running"})
        try:
            channel_metrics = await _fetch_ga4_data(
                ga4_property, ga4_key, body.date_range_days, body.conversion_goal,
            )
            data_source = "GA4"
            yield _sse({"type": "research_step", "step": "ga4_pull",
                        "label": f"GA4 data fetched - {len(channel_metrics)} channels", "status": "done"})
        except Exception as exc:
            logger.warning("GA4 pull failed, falling back to manual: %s", exc)
            yield _sse({"type": "research_step", "step": "ga4_pull",
                        "label": f"GA4 pull failed - using manual data ({exc})", "status": "done"})

    if not channel_metrics:
        yield _sse({
            "type": "error",
            "message": (
                "No channel data provided. Either configure GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT_KEY "
                "or supply channel_data in the request body."
            ),
        })
        return

    # ── Step 2: Build prompt ──────────────────────────────────────────────────
    yield _sse({"type": "research_step", "step": "brand_context",
                "label": "Loading brand context…", "status": "running"})

    brand_core = project.get("brandCore") or {}
    brand_context = build_brand_core_context(brand_core)

    channels_json = json.dumps(
        [c.model_dump() for c in channel_metrics], indent=2
    )

    user_prompt = (
        f"BRAND CORE:\n{brand_context[:_MAX_BRAND_CHARS]}\n\n"
        f"ATTRIBUTION ANALYSIS REQUEST:\n"
        f"- Analysis Period: Last {body.date_range_days} days\n"
        f"- Conversion Goal: {body.conversion_goal}\n"
        f"- Data Source: {data_source}\n"
        f"- Currency: {body.currency}\n\n"
        f"CHANNEL DATA:\n{channels_json}\n\n"
        "Produce a comprehensive cross-channel attribution analysis. "
        "Calculate ROAS (revenue/cost), CPA (cost/conversions), and conversion rate for each channel. "
        "If cost is 0 for a channel, mark it as 'brand_awareness' and exclude from ROAS/CPA. "
        "Return valid JSON only."
    )

    yield _sse({"type": "research_step", "step": "brand_context",
                "label": "Context ready", "status": "done"})
    yield _sse({"type": "research_step", "step": "analysing",
                "label": "Analysing attribution with Claude…", "status": "running"})

    try:
        raw = await call_claude_raw(user_prompt, system=SYSTEM_PROMPT, max_tokens=3500)
    except Exception as exc:
        logger.error("Claude call failed for attribution: %s", exc)
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"})
        return

    yield _sse({"type": "research_step", "step": "analysing",
                "label": "Analysis complete", "status": "done"})
    yield _sse({"type": "research_step", "step": "saving",
                "label": "Saving to workspace…", "status": "running"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        logger.error("Attribution JSON parse failed: %s\nRaw (first 500): %s", exc, raw[:500])
        yield _sse({"type": "error", "message": f"Could not parse response JSON: {exc}"})
        return

    payload["data_source"] = data_source
    payload["analysis_period"] = f"Last {body.date_range_days} days"
    payload["conversion_goal"] = body.conversion_goal

    firebase_service.update_pillar1_doc(project_id, doc_id, {
        "status": "ready",
        "payload": payload,
        "credits_spent": 20,
    })

    yield _sse({"type": "research_step", "step": "saving",
                "label": "Saved to workspace", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
