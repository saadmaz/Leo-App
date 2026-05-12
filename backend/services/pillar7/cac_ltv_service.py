"""
CAC + LTV Tracking - Claude calculates and interprets customer economics.

Data sources (in priority order):
1. Stripe API (if STRIPE_SECRET_KEY configured + pull_from_stripe=True)
2. HubSpot deals (if HUBSPOT_ACCESS_TOKEN configured + pull_from_hubspot=True)
3. Manual inputs in request body

Claude produces:
  - CAC by channel
  - LTV calculation (cohort-based + simple)
  - LTV:CAC ratio and payback period
  - Unit economics health score
  - Actionable recommendations
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar7 import CacLtvRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 600

SYSTEM = """\
You are a SaaS unit economics expert. You calculate CAC, LTV, payback period, \
and Net Revenue Retention - then explain exactly what the numbers mean for the business.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "period": "string",
  "product_name": "string",
  "data_sources": ["string"],
  "unit_economics_summary": "string (3-4 sentences: overall health, biggest strength, biggest concern)",
  "blended_cac": number,
  "blended_cac_note": "string",
  "channel_cac": [
    {
      "channel": "string",
      "new_customers": number,
      "spend": number,
      "cac": number,
      "cac_vs_blended": "above | below | at",
      "efficiency_rating": "excellent | good | average | poor"
    }
  ],
  "ltv_calculation": {
    "avg_revenue_per_customer": number,
    "gross_margin_pct": number,
    "churn_rate_monthly_pct": number,
    "avg_customer_lifetime_months": number,
    "simple_ltv": number,
    "discounted_ltv": number,
    "ltv_methodology_note": "string"
  },
  "ltv_cac_ratio": number,
  "ltv_cac_assessment": "excellent (>3x) | good (2-3x) | fair (1-2x) | poor (<1x)",
  "payback_period_months": number,
  "payback_assessment": "string",
  "nrr_estimate": "string (if data available)",
  "health_score": number (0-100),
  "benchmarks": {
    "ltv_cac_benchmark": "SaaS benchmark: 3:1 is healthy, 5:1+ is excellent",
    "payback_benchmark": "SaaS benchmark: <12 months is good, <18 months is acceptable",
    "churn_benchmark": "string (appropriate churn rate for the segment)"
  },
  "improvement_levers": [
    {
      "lever": "string (e.g. 'Reduce CAC via SEO', 'Increase LTV via expansion revenue')",
      "current_impact_est": "string",
      "target_impact": "string",
      "difficulty": "low | medium | high",
      "recommended_action": "string"
    }
  ],
  "red_flags": ["string (urgent issues to address)"],
  "six_month_targets": [
    {"metric": "string", "current": "string", "target": "string", "how": "string"}
  ]
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _pull_stripe_revenue(secret_key: str) -> dict:
    """Pull basic revenue + subscription data from Stripe."""
    try:
        import stripe as stripe_lib
        stripe_lib.api_key = secret_key
        import asyncio

        # Get recent invoices (paid, last 90 days)
        invoices = await asyncio.to_thread(
            stripe_lib.Invoice.list,
            status="paid",
            limit=100,
        )
        total_revenue = sum(inv.get("amount_paid", 0) for inv in invoices.get("data", [])) / 100

        # Get active subscriptions count
        subs = await asyncio.to_thread(stripe_lib.Subscription.list, status="active", limit=1)
        active_count = subs.get("total_count", 0)

        # Canceled subscriptions (churn proxy)
        canceled = await asyncio.to_thread(
            stripe_lib.Subscription.list, status="canceled", limit=100
        )
        churned = len(canceled.get("data", []))

        return {
            "total_revenue": round(total_revenue, 2),
            "active_subscriptions": active_count,
            "churned_count": churned,
            "source": "Stripe API",
        }
    except ImportError:
        logger.warning("stripe package not installed")
        return {}
    except Exception as exc:
        logger.warning("Stripe pull failed: %s", exc)
        return {}


async def _pull_hubspot_deals(access_token: str) -> dict:
    """Pull new + closed-won deal data from HubSpot."""
    try:
        from backend.services.pillar5 import hubspot_client
        contacts = await hubspot_client.list_contacts(limit=100)
        return {
            "total_contacts": len(contacts),
            "source": "HubSpot API",
        }
    except Exception as exc:
        logger.warning("HubSpot pull failed: %s", exc)
        return {}


async def generate(
    project: dict,
    body: CacLtvRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"CAC + LTV - {body.product_name} · {body.time_period}"
    doc = firebase_service.create_pillar1_doc(project_id, "cac_ltv", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    data_parts: list[str] = []
    data_sources: list[str] = []

    # Stripe
    if body.pull_from_stripe and settings.STRIPE_SECRET_KEY:
        yield _sse({"type": "research_step", "step": "stripe", "label": "Pulling Stripe revenue data…", "status": "running"})
        stripe_data = await _pull_stripe_revenue(settings.STRIPE_SECRET_KEY)
        if stripe_data:
            data_parts.append("STRIPE DATA:\n" + json.dumps(stripe_data, indent=2))
            data_sources.append("Stripe API")
        yield _sse({"type": "research_step", "step": "stripe",
                    "label": f"Stripe: ${stripe_data.get('total_revenue', 0):,.0f} revenue pulled" if stripe_data else "Stripe: no data",
                    "status": "done"})

    # HubSpot
    if body.pull_from_hubspot and settings.HUBSPOT_ACCESS_TOKEN:
        yield _sse({"type": "research_step", "step": "hubspot", "label": "Pulling HubSpot deal data…", "status": "running"})
        hs_data = await _pull_hubspot_deals(settings.HUBSPOT_ACCESS_TOKEN)
        if hs_data:
            data_parts.append("HUBSPOT DATA:\n" + json.dumps(hs_data, indent=2))
            data_sources.append("HubSpot API")
        yield _sse({"type": "research_step", "step": "hubspot",
                    "label": f"HubSpot: {hs_data.get('total_contacts', 0)} contacts" if hs_data else "HubSpot: no data",
                    "status": "done"})

    # Build manual data section
    manual_data: dict = {}
    if body.total_revenue is not None: manual_data["total_revenue"] = body.total_revenue
    if body.new_customers is not None: manual_data["new_customers"] = body.new_customers
    if body.churned_customers is not None: manual_data["churned_customers"] = body.churned_customers
    if body.avg_subscription_value is not None: manual_data["avg_subscription_value"] = body.avg_subscription_value
    if body.avg_support_cost_per_customer is not None: manual_data["avg_support_cost"] = body.avg_support_cost_per_customer
    if body.avg_onboarding_cost_per_customer is not None: manual_data["avg_onboarding_cost"] = body.avg_onboarding_cost_per_customer
    if body.gross_margin_pct is not None: manual_data["gross_margin_pct"] = body.gross_margin_pct
    if body.acquisition_channels:
        manual_data["acquisition_channels"] = [c.model_dump(exclude_none=True) for c in body.acquisition_channels]
    if manual_data:
        data_parts.append("MANUAL INPUT:\n" + json.dumps(manual_data, indent=2))
        data_sources.append("Manual Input")

    if not data_parts:
        yield _sse({"type": "error", "message": "No data provided. Enable Stripe/HubSpot pull or enter data manually."})
        return

    yield _sse({"type": "research_step", "step": "calculating", "label": "Calculating unit economics…", "status": "running"})

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"CAC + LTV ANALYSIS:\n"
        f"- Product: {body.product_name}\n"
        f"- Period: {body.time_period}\n\n"
        + "\n\n".join(data_parts)
        + "\n\nCalculate CAC, LTV, LTV:CAC ratio, payback period. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=5000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI calculation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "calculating", "label": "Calculation complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["product_name"] = body.product_name
    payload["period"] = body.time_period
    payload.setdefault("data_sources", data_sources)

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 20})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
