"""
Budget Modelling service - Claude + optional Meta Ads API benchmarks, SSE streaming.

Generates a channel budget allocation model with ROAS projections,
incorporating live Meta Ads benchmark data when available.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar1 import BudgetModelRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _fetch_meta_ads_benchmarks(access_token: str) -> dict:
    """
    Fetch Meta Ads cost benchmarks via the Marketing API.
    Returns CPM, CPC, CTR industry averages if available.
    Falls back to empty dict on any error.
    """
    if not access_token:
        return {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Ad Insights on the ad account - fetching aggregated benchmarks
            resp = await client.get(
                "https://graph.facebook.com/v20.0/me/adaccounts",
                params={"access_token": access_token, "fields": "name,currency,spend_cap"},
            )
            resp.raise_for_status()
            data = resp.json()
            accounts = data.get("data", [])
            if accounts:
                return {"meta_connected": True, "accounts": len(accounts), "currency": accounts[0].get("currency", "USD")}
    except Exception as exc:
        logger.warning("Meta Ads API fetch failed: %s", exc)
    return {}


_SYSTEM_PROMPT = """\
You are LEO, a performance marketing strategist and budget modelling expert.
Your task is to produce a data-driven budget allocation model.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "total_budget": 10000,
  "currency": "USD",
  "duration_months": 3,
  "allocations": [
    {
      "channel": "Meta Ads (Facebook/Instagram)",
      "amount": 4000,
      "percentage": 40,
      "rationale": "Highest ROAS for B2C brands with visual products",
      "expected_roas": "3.2x",
      "expected_reach": "~180,000 unique users",
      "kpis": ["CPM target: $8-12", "CPC target: $0.80-1.20", "ROAS target: 3x+"]
    }
  ],
  "monthly_breakdown": [
    {"month": 1, "theme": "Testing & Learning", "spend": 3000, "focus": "A/B test creative, optimise CPM"},
    {"month": 2, "theme": "Scaling Winners", "spend": 3500, "focus": "Scale best-performing ad sets"},
    {"month": 3, "theme": "Optimise & Retain", "spend": 3500, "focus": "Retargeting + lookalike audiences"}
  ],
  "organic_complement": "Pair with 3x/week organic posts on Instagram to reduce paid CPC by ~15%",
  "risk_scenarios": {
    "underperform": "If ROAS < 2x by week 4, reallocate 20% from awareness to retargeting",
    "overperform": "If ROAS > 4x, increase budget by 30% and expand to lookalike audiences"
  },
  "benchmark_notes": "Industry average CPM: $9.50 / CPC: $1.10 for this category",
  "summary": "2-3 sentence budget strategy overview"
}

RULES:
1. All ROAS and CPM benchmarks must be realistic for the channels and industry.
2. Allocations must sum to exactly the total_budget.
3. Smaller budgets (< $5,000) should lean toward fewer channels with higher concentration.
4. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: BudgetModelRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for budget model generation."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_core = project.get("brandCore") or {}
        brand_name = project.get("name", "the brand")

        title = f"Budget Model - {body.currency} {body.total_budget:,.0f} / {body.duration_months}mo"
        doc = firebase_service.create_pillar1_doc(project_id, "budget", owner_uid, title)
        doc_id = doc["id"]

        # ── Step 1: Meta Ads benchmark fetch ────────────────────────────────
        meta_data: dict = {}
        if body.fetch_live_benchmarks and settings.META_ACCESS_TOKEN:
            yield _sse({"type": "research_step", "step": "meta_ads_fetch", "label": "Fetching Meta Ads benchmarks...", "status": "running"})
            meta_data = await _fetch_meta_ads_benchmarks(settings.META_ACCESS_TOKEN)
            status = "done" if meta_data.get("meta_connected") else "skipped"
            yield _sse({"type": "research_step", "step": "meta_ads_fetch", "label": "Meta Ads data retrieved" if meta_data.get("meta_connected") else "Meta Ads not connected - using industry benchmarks", "status": status})
        else:
            yield _sse({"type": "research_step", "step": "meta_ads_fetch", "label": "Using industry benchmark data", "status": "skipped"})

        # ── Step 2: Claude synthesis ─────────────────────────────────────────
        yield _sse({"type": "research_step", "step": "claude_synthesis", "label": "Building your budget model...", "status": "running"})

        tone = brand_core.get("tone") or {}
        audience = brand_core.get("audience") or {}
        brand_ctx = f"Brand: {brand_name}\n"
        if tone:
            brand_ctx += f"Brand style: {tone.get('style', '')}\n"
        if audience.get("demographics"):
            brand_ctx += f"Target audience: {audience['demographics']}\n"

        meta_ctx = ""
        if meta_data.get("meta_connected"):
            meta_ctx = f"\nMeta Ads account connected: {meta_data.get('accounts', 1)} account(s), currency: {meta_data.get('currency', 'USD')}\n"

        user_prompt = f"""\
{brand_ctx}
Total budget: {body.currency} {body.total_budget:,.0f}
Duration: {body.duration_months} months
Channels selected: {', '.join(body.channels)}
{meta_ctx}

Generate a detailed budget allocation model for these channels over {body.duration_months} months.
Include realistic ROAS targets, CPM/CPC benchmarks, and a monthly spend breakdown.
"""

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=settings.LLM_MAX_TOKENS,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "research_cache": {"meta_data": meta_data},
            "credits_spent": 30,
        })

        yield _sse({"type": "research_step", "step": "claude_synthesis", "label": "Budget model ready", "status": "done"})
        yield _sse({"type": "budget_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
