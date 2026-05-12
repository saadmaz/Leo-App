"""
Go-To-Market (GTM) Strategy service - SerpAPI + Firecrawl + Claude, SSE streaming.

Researches the market for the product, scrapes competitor/industry benchmarks,
then synthesises a full GTM strategy document.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar1 import GTMGenerateRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _serp_search(query: str) -> list[dict]:
    """Search via SerpAPI and return top organic results."""
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
        logger.warning("SerpAPI search failed for '%s': %s", query, exc)
        return []


async def _firecrawl_url(url: str) -> str:
    """Scrape a URL with Firecrawl and return markdown content."""
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
            data = resp.json()
            content = data.get("data", {}).get("markdown", "") or ""
            return content[:3000]
    except Exception as exc:
        logger.warning("Firecrawl scrape failed for %s: %s", url, exc)
        return ""


_SYSTEM_PROMPT = """\
You are LEO, a CMO-level strategist. You have just completed live market research.
Produce a comprehensive Go-To-Market strategy for the given product.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "product_name": "...",
  "executive_summary": "3-sentence overview of the GTM approach",
  "target_segments": [
    {"segment": "...", "rationale": "...", "channel_fit": "..."}
  ],
  "channel_mix": [
    {
      "channel": "Instagram",
      "role": "Primary awareness channel",
      "tactics": ["Reels 3x/week", "Story polls for feedback"],
      "budget_pct": 35,
      "kpis": ["Reach", "Follower growth", "Link clicks"]
    }
  ],
  "messaging_framework": {
    "headline": "Core value proposition headline",
    "sub_headline": "Supporting benefit",
    "proof_points": ["Proof 1", "Proof 2", "Proof 3"],
    "objection_handling": {"Common objection": "Response"}
  },
  "launch_sequence": [
    {"week": "Week 1", "theme": "Awareness", "actions": ["..."], "channels": ["..."]}
  ],
  "success_metrics": {"30_days": [...], "60_days": [...], "90_days": [...]},
  "competitive_gaps": ["Gap 1 - how we exploit it", "Gap 2 - how we exploit it"],
  "budget_guidance": "Recommended spend split with rationale"
}

RULES:
1. Every channel recommendation must cite a specific research finding.
2. Messaging must match the brand's tone from Brand Core - never generic.
3. Competitive gaps must name actual gaps found in the research (not generic).
4. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: GTMGenerateRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for GTM strategy generation."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_core = project.get("brandCore") or {}
        brand_name = project.get("name", "the brand")

        # Create doc
        title = f"GTM Strategy - {body.product_name}"
        doc = firebase_service.create_pillar1_doc(project_id, "gtm", owner_uid, title)
        doc_id = doc["id"]

        # ── Step 1: SerpAPI research ─────────────────────────────────────────
        yield _sse({"type": "research_step", "step": "serp_research", "label": "Researching market landscape...", "status": "running"})
        query = f"{body.product_name} go-to-market strategy competitors 2025"
        serp_results = await _serp_search(query)
        snippets = [r.get("snippet", "") for r in serp_results[:6] if r.get("snippet")]
        top_urls = [r.get("link", "") for r in serp_results[:3] if r.get("link")]
        yield _sse({"type": "research_step", "step": "serp_research", "label": f"Found {len(serp_results)} market insights", "status": "done"})

        # ── Step 2: Firecrawl top result ─────────────────────────────────────
        scraped_content = ""
        if top_urls:
            yield _sse({"type": "research_step", "step": "firecrawl_extract", "label": "Extracting competitor benchmarks...", "status": "running"})
            scraped_content = await _firecrawl_url(top_urls[0])
            yield _sse({"type": "research_step", "step": "firecrawl_extract", "label": "Benchmark data extracted", "status": "done"})

        # ── Step 3: Claude GTM synthesis ─────────────────────────────────────
        yield _sse({"type": "research_step", "step": "claude_generation", "label": "Synthesising your GTM strategy...", "status": "running"})

        tone = brand_core.get("tone") or {}
        brand_ctx = ""
        if tone:
            brand_ctx += f"Brand tone: {tone.get('style', '')} / {tone.get('formality', '')}\n"
            if tone.get("keyPhrases"):
                brand_ctx += f"Key phrases: {', '.join(tone['keyPhrases'][:5])}\n"
        audience = brand_core.get("audience") or {}
        if audience.get("demographics"):
            brand_ctx += f"Target audience: {audience['demographics']}\n"
        messaging = brand_core.get("messaging") or {}
        if messaging.get("valueProp"):
            brand_ctx += f"Value proposition: {messaging['valueProp']}\n"

        research_ctx = ""
        if snippets:
            research_ctx += "MARKET RESEARCH SNIPPETS:\n" + "\n".join(f"- {s}" for s in snippets) + "\n\n"
        if scraped_content:
            research_ctx += f"COMPETITOR BENCHMARK (scraped):\n{scraped_content[:1500]}\n\n"

        user_prompt = f"""\
Brand: {brand_name}
{brand_ctx}
Product/Service: {body.product_name}
{f"Target launch date: {body.launch_date}" if body.launch_date else ""}
{f"Budget: {body.budget}" if body.budget else ""}
{f"Primary channel: {body.primary_channel}" if body.primary_channel else ""}
Geography: {body.target_geography}

{research_ctx}

Generate a comprehensive GTM strategy using the research above.
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
            "research_cache": {"serp_snippets": snippets, "scraped_urls": top_urls},
            "credits_spent": 35,
        })

        yield _sse({"type": "research_step", "step": "claude_generation", "label": "GTM strategy ready", "status": "done"})
        yield _sse({"type": "gtm_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
