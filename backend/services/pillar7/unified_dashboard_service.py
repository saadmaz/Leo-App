"""
Unified Dashboard - aggregate GA4 + Meta Ads + Ayrshare analytics into one view.

Flow:
1. Pull GA4 channel data (if configured)
2. Pull Meta Ads Insights (if META_ACCESS_TOKEN + meta_ad_account_id provided)
3. Combine with any manual channel data
4. Claude synthesises cross-channel executive narrative + performance matrix
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar7 import UnifiedDashboardRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context
from backend.services.pillar7 import ga4_client

logger = logging.getLogger(__name__)
_MAX_BRAND = 800

SYSTEM = """\
You are a senior growth analyst. You interpret cross-channel marketing data and \
produce a unified executive narrative that a non-technical CMO can act on immediately.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "period": "string",
  "data_sources": ["string (which data sources were used)"],
  "executive_summary": "string (3-4 sentences: top insight, biggest win, biggest concern)",
  "overall_health_score": number (0-100),
  "health_rationale": "string (1-2 sentences)",
  "channel_matrix": [
    {
      "channel": "string",
      "sessions_or_reach": number,
      "conversions": number,
      "revenue": number,
      "spend": number,
      "roas": number,
      "cpa": number,
      "trend": "up | flat | down",
      "performance_rating": "excellent | good | average | poor",
      "key_insight": "string (1 sentence)"
    }
  ],
  "top_performing_channel": "string",
  "underperforming_channel": "string",
  "budget_shift_recommendation": "string (concrete reallocation advice)",
  "content_performance_note": "string (what content themes drive results)",
  "quick_wins": ["string (actionable this week)"],
  "strategic_priorities": ["string (90-day focus areas)"],
  "risks_to_watch": ["string"]
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _fetch_meta_insights(
    access_token: str,
    ad_account_id: str,
    date_range_days: int,
) -> list[dict]:
    """Pull Meta Ads campaign-level insights."""
    since = (
        __import__("datetime").date.today()
        - __import__("datetime").timedelta(days=date_range_days)
    ).isoformat()
    until = __import__("datetime").date.today().isoformat()
    url = f"https://graph.facebook.com/v19.0/{ad_account_id}/insights"
    params = {
        "access_token": access_token,
        "level": "account",
        "fields": "impressions,clicks,spend,actions,action_values",
        "time_range": json.dumps({"since": since, "until": until}),
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", [])
    except Exception as exc:
        logger.warning("Meta Ads Insights failed: %s", exc)
        return []


async def generate(
    project: dict,
    body: UnifiedDashboardRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Unified Dashboard - last {body.date_range_days} days"
    doc = firebase_service.create_pillar1_doc(project_id, "unified_dashboard", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    data_parts: list[str] = []
    data_sources: list[str] = []

    # GA4
    if settings.GA4_PROPERTY_ID and settings.GA4_SERVICE_ACCOUNT_KEY:
        yield _sse({"type": "research_step", "step": "ga4", "label": "Pulling GA4 data…", "status": "running"})
        rows = await ga4_client.run_report(
            dimensions=["sessionDefaultChannelGroup"],
            metrics=["sessions", "conversions", "totalRevenue", "bounceRate"],
            date_range_days=body.date_range_days,
        )
        if rows:
            data_parts.append("GA4 CHANNEL DATA:\n" + json.dumps(rows, indent=2))
            data_sources.append("GA4 Data API")
        yield _sse({"type": "research_step", "step": "ga4",
                    "label": f"GA4: {len(rows)} channels", "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "ga4", "label": "GA4 not configured - skipped", "status": "done"})

    # Meta Ads
    if body.include_meta and settings.META_ACCESS_TOKEN and body.meta_ad_account_id:
        yield _sse({"type": "research_step", "step": "meta", "label": "Pulling Meta Ads data…", "status": "running"})
        meta_rows = await _fetch_meta_insights(
            settings.META_ACCESS_TOKEN, body.meta_ad_account_id, body.date_range_days
        )
        if meta_rows:
            data_parts.append("META ADS INSIGHTS:\n" + json.dumps(meta_rows, indent=2))
            data_sources.append("Meta Ads API")
        yield _sse({"type": "research_step", "step": "meta",
                    "label": f"Meta: {len(meta_rows)} records", "status": "done"})

    # Manual data
    if body.manual_channel_data:
        data_parts.append(
            "MANUAL CHANNEL DATA:\n"
            + json.dumps([c.model_dump(exclude_none=True) for c in body.manual_channel_data], indent=2)
        )
        data_sources.append("Manual Input")

    if not data_parts:
        yield _sse({"type": "error", "message": "No data available. Configure GA4/Meta or provide manual_channel_data."})
        return

    yield _sse({"type": "research_step", "step": "synthesis", "label": "Synthesising cross-channel view…", "status": "running"})

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"ANALYSIS PERIOD: Last {body.date_range_days} days\n"
        f"GOALS: {', '.join(body.goals)}\n\n"
        + "\n\n".join(data_parts)
        + "\n\nSynthesise a unified cross-channel dashboard. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=5000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI synthesis failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "synthesis", "label": "Synthesis complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload.setdefault("data_sources", data_sources)
    payload["period"] = f"Last {body.date_range_days} days"

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
