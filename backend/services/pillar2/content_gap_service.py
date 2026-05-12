"""
Content Gap Analysis - DataForSEO (keyword data) + Claude (interpretation), SSE streaming.

Finds keywords your competitors rank for that you don't, then uses Claude to
prioritise opportunities and suggest content angles.
Degrades gracefully to Claude-only analysis if DataForSEO is not configured.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar2 import ContentGapRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _dfs_auth() -> str:
    credentials = f"{settings.DATAFORSEO_LOGIN}:{settings.DATAFORSEO_PASSWORD}"
    return "Basic " + base64.b64encode(credentials.encode()).decode()


async def _get_keywords_for_domain(domain: str, location_code: int, language_code: str, limit: int) -> list[dict]:
    """Fetch top organic keywords for a domain via DataForSEO."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.dataforseo.com/v3/dataforseo_labs/google/keywords_for_site/live",
            headers={"Authorization": _dfs_auth(), "Content-Type": "application/json"},
            json=[{
                "target": domain,
                "location_code": location_code,
                "language_code": language_code,
                "limit": limit,
                "order_by": ["keyword_data.keyword_info.search_volume,desc"],
            }],
        )
        resp.raise_for_status()
        result = resp.json()
        items = result.get("tasks", [{}])[0].get("result", [{}])[0].get("items", [])
        return items


async def generate(
    project: dict,
    body: ContentGapRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        messaging = brand_core.get("messaging") or {}

        title = f"Content Gap - {body.domain}"
        doc = firebase_service.create_pillar1_doc(project_id, "content_gap", owner_uid, title)
        doc_id = doc["id"]

        use_dfs = bool(settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD)
        your_keywords: list[dict] = []
        competitor_keywords: list[dict] = []

        # ── Step 1: Your domain keywords ─────────────────────────────────────
        if use_dfs:
            yield _sse({"type": "research_step", "step": "your_keywords",
                        "label": f"Fetching keywords for {body.domain}...", "status": "running"})
            try:
                your_keywords = await _get_keywords_for_domain(
                    body.domain, body.location_code, body.language_code, body.limit)
                yield _sse({"type": "research_step", "step": "your_keywords",
                            "label": f"Found {len(your_keywords)} keywords for your domain",
                            "status": "done"})
            except Exception as exc:
                logger.warning("DataForSEO failed for %s: %s", body.domain, exc)
                yield _sse({"type": "research_step", "step": "your_keywords",
                            "label": "DataForSEO unavailable - using Claude analysis only",
                            "status": "skipped"})
                use_dfs = False
        else:
            yield _sse({"type": "research_step", "step": "your_keywords",
                        "label": "DataForSEO not configured - Claude-only analysis", "status": "skipped"})

        # ── Step 2: Competitor keywords ───────────────────────────────────────
        for comp_domain in body.competitor_domains[:3]:
            if not use_dfs:
                break
            yield _sse({"type": "research_step", "step": f"comp_{comp_domain}",
                        "label": f"Fetching keywords for {comp_domain}...", "status": "running"})
            try:
                comp_kws = await _get_keywords_for_domain(
                    comp_domain, body.location_code, body.language_code, body.limit)
                competitor_keywords.extend(comp_kws)
                yield _sse({"type": "research_step", "step": f"comp_{comp_domain}",
                            "label": f"{comp_domain}: {len(comp_kws)} keywords", "status": "done"})
            except Exception as exc:
                logger.warning("DataForSEO failed for competitor %s: %s", comp_domain, exc)
                yield _sse({"type": "research_step", "step": f"comp_{comp_domain}",
                            "label": f"Failed for {comp_domain}", "status": "skipped"})

        # ── Step 3: Claude gap analysis ───────────────────────────────────────
        yield _sse({"type": "research_step", "step": "claude_analysis",
                    "label": "Analysing content gaps...", "status": "running"})

        your_kw_str = ""
        if your_keywords:
            top = your_keywords[:20]
            your_kw_str = "\nYOUR CURRENT KEYWORDS:\n" + "\n".join(
                f"- {k.get('keyword', '')} (vol: {k.get('keyword_data', {}).get('keyword_info', {}).get('search_volume', 'N/A')}, "
                f"diff: {k.get('keyword_data', {}).get('keyword_properties', {}).get('keyword_difficulty', 'N/A')})"
                for k in top
            )

        comp_kw_str = ""
        if competitor_keywords:
            seen = set()
            unique_comp = []
            for k in competitor_keywords:
                kw = k.get("keyword", "")
                if kw not in seen:
                    seen.add(kw)
                    unique_comp.append(k)
            top_comp = unique_comp[:30]
            comp_kw_str = "\nCOMPETITOR KEYWORDS (not in your top rankings):\n" + "\n".join(
                f"- {k.get('keyword', '')} (vol: {k.get('keyword_data', {}).get('keyword_info', {}).get('search_volume', 'N/A')})"
                for k in top_comp
            )

        system_prompt = """\
You are LEO, an SEO strategist and content planner.
Analyse keyword data to identify content gaps and opportunities.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "domain": "your-site.com",
  "summary": "2-3 sentence executive summary of the content gap landscape",
  "gaps": [
    {
      "keyword": "the target keyword",
      "search_volume": "monthly search volume or 'Unknown'",
      "difficulty": "Easy | Medium | Hard | Unknown",
      "opportunity_score": 8,
      "content_angle": "Specific content idea to capture this keyword",
      "content_type": "Blog post | Landing page | How-to guide | Comparison | etc.",
      "estimated_traffic_potential": "Low | Medium | High"
    }
  ],
  "quick_wins": ["3-5 keywords you could rank for quickly with minimal effort"],
  "long_term_plays": ["3-5 high-value keywords worth a long content investment"],
  "content_calendar_suggestion": "A brief suggestion for how to tackle these gaps over 90 days"
}

RULES:
1. Rank gaps by opportunity_score (10 = highest priority).
2. Content angle must be specific - a real title idea, not generic advice.
3. Return ONLY valid JSON - no prose, no markdown fences.
"""

        brand_ctx = f"Brand: {brand_name}\n"
        brand_ctx += f"Domain: {body.domain}\n"
        brand_ctx += f"Competitors: {', '.join(body.competitor_domains) or 'Not specified'}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value proposition: {messaging['valueProp']}\n"

        user_prompt = f"""\
{brand_ctx}
{your_kw_str}
{comp_kw_str}

{"No keyword data was available - analyse based on domain, brand context, and industry best practices." if not your_keywords and not competitor_keywords else "Identify the top content gaps and opportunities."}
"""

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=settings.LLM_MAX_TOKENS,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        payload["dataforseo_used"] = use_dfs
        payload["keywords_analysed"] = len(your_keywords) + len(competitor_keywords)

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "credits_spent": 40,
        })

        yield _sse({"type": "research_step", "step": "claude_analysis",
                    "label": "Gap analysis ready", "status": "done"})
        yield _sse({"type": "content_gap_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
