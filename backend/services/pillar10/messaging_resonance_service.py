"""
Messaging Resonance Testing - Meta Ads API (optional live fetch) + Claude.

User runs small paid tests on Meta, then LEO reads results and identifies
which message angle resonated most with the audience.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar10 import MessagingResonanceRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500

SYSTEM = """\
You are a paid media strategist and messaging expert. You analyse A/B test results
from Meta Ads (and similar platforms) to identify which message angles resonate most
with the target audience - and explain WHY in terms of psychology and audience fit.

Return ONLY a valid JSON object - no markdown fences.

Schema:
{
  "winner": {
    "variant_name": "string",
    "winning_metric": "string (e.g. 'lowest CPA', 'highest CTR')",
    "winning_value": "string",
    "confidence": "high | medium | low",
    "confidence_rationale": "string"
  },
  "variant_analysis": [
    {
      "variant_name": "string",
      "performance_summary": "string",
      "calculated_metrics": {
        "ctr": "string or null",
        "cpc": "string or null",
        "cpa": "string or null",
        "conversion_rate": "string or null"
      },
      "message_angle_assessment": "string (why this angle did/didn't work)",
      "audience_fit_score": number (1-10)
    }
  ],
  "key_insight": "string (the single most important learning from this test)",
  "message_learnings": [
    {"learning": "string", "applies_to": "string (which channels/contexts this learning transfers to)"}
  ],
  "next_test_recommendation": {
    "hypothesis": "string",
    "what_to_test": "string",
    "variants_to_try": ["string"],
    "rationale": "string"
  },
  "propagation_suggestions": ["string (how to apply the winning message across other channels)"],
  "budget_recommendation": "string (how to reallocate budget based on results)"
}

Rules:
- Calculate derived metrics (CTR, CPC, CPA) if not provided.
- Confidence is HIGH only if one variant is clearly dominant across multiple metrics.
- Confidence is LOW if results are inconclusive or sample sizes are small.
- Message learnings must be transferable - not just 'this ad was better'.
- Always recommend a follow-up test to deepen the learning.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _fetch_meta_campaign_insights(account_id: str, campaign_id: str) -> list[dict]:
    """Attempt to fetch Meta Ads campaign-level insights via the Marketing API."""
    if not settings.META_ACCESS_TOKEN or not account_id or not campaign_id:
        return []
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"https://graph.facebook.com/v20.0/{campaign_id}/insights",
                params={
                    "access_token": settings.META_ACCESS_TOKEN,
                    "fields": "ad_name,impressions,clicks,spend,actions,ctr,cpc",
                    "level": "ad",
                },
            )
            if resp.status_code == 200:
                return resp.json().get("data", [])
    except Exception as exc:
        logger.warning("Meta Ads insights fetch failed: %s", exc)
    return []


async def generate(
    project: dict,
    body: MessagingResonanceRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Messaging Resonance - {body.test_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "messaging_resonance", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    # Optional live Meta fetch
    live_data: list[dict] = []
    if body.fetch_live_data and body.meta_campaign_id:
        yield _sse({"type": "research_step", "step": "meta", "label": "Fetching Meta Ads insights…", "status": "running"})
        live_data = await _fetch_meta_campaign_insights(
            body.meta_ad_account_id or "", body.meta_campaign_id
        )
        label = f"Fetched {len(live_data)} ad-level results" if live_data else "Meta API returned no data - using provided results"
        yield _sse({"type": "research_step", "step": "meta", "label": label, "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "meta", "label": "Using provided results", "status": "done"})

    yield _sse({"type": "research_step", "step": "analysing", "label": "Analysing messaging resonance…", "status": "running"})

    results_data = [r.model_dump(exclude_none=True) for r in body.ad_results]
    if live_data:
        results_data = live_data  # prefer live data

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"MESSAGING RESONANCE TEST:\n"
        f"- Test name: {body.test_name}\n"
        f"- Objective: {body.test_objective}\n"
        + (f"- Audience: {body.audience_description}\n" if body.audience_description else "")
        + (f"- Budget spent: ${body.budget_spent:,.2f}\n" if body.budget_spent else "")
        + (f"- Test duration: {body.test_duration_days} days\n" if body.test_duration_days else "")
        + f"\nAD RESULTS:\n{json.dumps(results_data, indent=2)}\n\n"
        "Analyse messaging resonance and identify the winning angle. Return valid JSON only."
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
    payload["test_objective"] = body.test_objective

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
