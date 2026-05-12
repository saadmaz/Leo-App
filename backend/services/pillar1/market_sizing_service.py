"""
Market Sizing service - SerpAPI (×3 queries) + Firecrawl + Claude TAM/SAM/SOM.

Runs three targeted searches (total addressable market, serviceable market,
obtainable market), scrapes a key source, then synthesises a structured
TAM/SAM/SOM analysis with methodology and source citations.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar1 import MarketSizingRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _serp_search(query: str) -> list[dict]:
    if not settings.SERPAPI_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://serpapi.com/search",
                params={"engine": "google", "q": query, "num": 8, "api_key": settings.SERPAPI_API_KEY},
            )
            resp.raise_for_status()
            return resp.json().get("organic_results", [])
    except Exception as exc:
        logger.warning("SerpAPI search failed: %s", exc)
        return []


async def _firecrawl_url(url: str) -> str:
    if not settings.FIRECRAWL_API_KEY:
        return ""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.firecrawl.dev/v1/scrape",
                headers={"Authorization": f"Bearer {settings.FIRECRAWL_API_KEY}"},
                json={"url": url, "formats": ["markdown"], "onlyMainContent": True},
            )
            resp.raise_for_status()
            return (resp.json().get("data", {}).get("markdown", "") or "")[:2500]
    except Exception as exc:
        logger.warning("Firecrawl scrape failed for %s: %s", url, exc)
        return ""


_SYSTEM_PROMPT = """\
You are LEO, a market intelligence analyst. You have just gathered live market research.
Produce a structured TAM/SAM/SOM analysis for the given market.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "market_description": "...",
  "geography": "...",
  "tam": {
    "value": "$X billion",
    "methodology": "Top-down - total global spend on X category per industry report Y",
    "sources": ["Source 1", "Source 2"],
    "cagr": "X% annually through 2030",
    "key_drivers": ["Driver 1", "Driver 2"]
  },
  "sam": {
    "value": "$X million",
    "methodology": "Narrowed by geography + customer segment filters",
    "assumptions": ["Assumption 1", "Assumption 2"],
    "sources": ["Source 1"]
  },
  "som": {
    "value": "$X million",
    "year_1_target": "$X million",
    "methodology": "Bottom-up - based on sales capacity, current brand reach, and conversion benchmarks",
    "market_share_pct": "X%",
    "assumptions": ["Assumption 1"]
  },
  "key_trends": ["Trend 1 - implication for brand", "Trend 2 - implication for brand"],
  "competitive_density": "Low / Medium / High - explanation",
  "go_to_market_implications": ["Implication 1", "Implication 2"],
  "confidence": "High / Medium / Low - explanation of data quality"
}

RULES:
1. All values must be grounded in the research data provided - no fabrication.
2. Where data is incomplete, state assumptions clearly in the assumptions field.
3. Sources must reference actual snippets from the research, not made-up reports.
4. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: MarketSizingRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for market sizing analysis."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_core = project.get("brandCore") or {}
        brand_name = project.get("name", "the brand")

        title = f"Market Sizing - {body.market_description[:50]}"
        doc = firebase_service.create_pillar1_doc(project_id, "market_sizing", owner_uid, title)
        doc_id = doc["id"]

        all_snippets: list[str] = []
        all_urls: list[str] = []

        # ── Step 1–3: Three SerpAPI searches ────────────────────────────────
        queries = [
            f"{body.market_description} total addressable market size {body.geography} 2025",
            f"{body.market_description} market size revenue forecast industry report",
            f"{body.market_description} serviceable market segment competitors",
        ]
        for i, query in enumerate(queries, 1):
            yield _sse({"type": "research_step", "step": "serp_research", "label": f"Market research query {i}/3...", "status": "running"})
            results = await _serp_search(query)
            snippets = [r.get("snippet", "") for r in results[:5] if r.get("snippet")]
            urls = [r.get("link", "") for r in results[:2] if r.get("link")]
            all_snippets.extend(snippets)
            all_urls.extend(urls)
            yield _sse({"type": "research_step", "step": "serp_research", "label": f"Query {i} - {len(results)} results found", "status": "done"})

        # ── Step 4: Firecrawl top URL ────────────────────────────────────────
        scraped = ""
        if all_urls:
            yield _sse({"type": "research_step", "step": "firecrawl_extract", "label": "Extracting market report data...", "status": "running"})
            scraped = await _firecrawl_url(all_urls[0])
            yield _sse({"type": "research_step", "step": "firecrawl_extract", "label": "Market data extracted", "status": "done"})

        # ── Step 5: Claude TAM/SAM/SOM synthesis ────────────────────────────
        yield _sse({"type": "research_step", "step": "claude_tam_sam_som", "label": "Calculating TAM / SAM / SOM...", "status": "running"})

        audience = brand_core.get("audience") or {}
        brand_ctx = f"Brand: {brand_name}\n"
        if audience.get("demographics"):
            brand_ctx += f"Target audience: {audience['demographics']}\n"

        research_ctx = "MARKET RESEARCH DATA:\n"
        for s in all_snippets[:12]:
            if s:
                research_ctx += f"- {s}\n"
        if scraped:
            research_ctx += f"\nSCRAPED MARKET REPORT:\n{scraped}\n"

        user_prompt = f"""\
{brand_ctx}
Market: {body.market_description}
Geography: {body.geography}
Methodology requested: {body.methodology}

{research_ctx}

Analyse the research and produce a TAM/SAM/SOM breakdown.
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
            "research_cache": {"snippets": all_snippets, "urls": all_urls},
            "credits_spent": 40,
        })

        yield _sse({"type": "research_step", "step": "claude_tam_sam_som", "label": "Market sizing complete", "status": "done"})
        yield _sse({"type": "market_sizing_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
