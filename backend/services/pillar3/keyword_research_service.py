"""
Keyword Research Engine - DataForSEO keyword_ideas/live + Claude interpretation.

Degrades gracefully to Claude-only if DataForSEO is not configured.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar3 import KeywordResearchRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _dfs_auth() -> str:
    creds = f"{settings.DATAFORSEO_LOGIN}:{settings.DATAFORSEO_PASSWORD}"
    return "Basic " + base64.b64encode(creds.encode()).decode()


async def _get_keyword_ideas(seeds: list[str], location_code: int, language_code: str, limit: int) -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live",
            headers={"Authorization": _dfs_auth(), "Content-Type": "application/json"},
            json=[{
                "keywords": seeds,
                "location_code": location_code,
                "language_code": language_code,
                "limit": limit,
                "order_by": ["keyword_data.keyword_info.search_volume,desc"],
            }],
        )
        resp.raise_for_status()
        result = resp.json()
        return result.get("tasks", [{}])[0].get("result", [{}])[0].get("items", [])


async def generate(
    project: dict,
    body: KeywordResearchRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        messaging = brand_core.get("messaging") or {}

        seed_str = ", ".join(body.seed_keywords)
        title = f"Keyword Research - {seed_str[:60]}"
        doc = firebase_service.create_pillar1_doc(project_id, "keyword_research", owner_uid, title)
        doc_id = doc["id"]

        use_dfs = bool(settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD)
        raw_keywords: list[dict] = []

        # ── Step 1: DataForSEO keyword ideas ─────────────────────────────────
        if use_dfs:
            yield _sse({"type": "research_step", "step": "dfs_keywords",
                        "label": f"Fetching keyword ideas for: {seed_str[:40]}...", "status": "running"})
            try:
                raw_keywords = await _get_keyword_ideas(
                    body.seed_keywords, body.location_code, body.language_code, body.limit)
                yield _sse({"type": "research_step", "step": "dfs_keywords",
                            "label": f"Found {len(raw_keywords)} keyword ideas", "status": "done"})
            except Exception as exc:
                logger.warning("DataForSEO keyword ideas failed: %s", exc)
                yield _sse({"type": "research_step", "step": "dfs_keywords",
                            "label": "DataForSEO unavailable - Claude-only analysis", "status": "skipped"})
                use_dfs = False
        else:
            yield _sse({"type": "research_step", "step": "dfs_keywords",
                        "label": "DataForSEO not configured - Claude-only research", "status": "skipped"})

        # ── Step 2: Claude interpretation ────────────────────────────────────
        yield _sse({"type": "research_step", "step": "claude_analysis",
                    "label": "Interpreting and prioritising keywords...", "status": "running"})

        kw_data_str = ""
        if raw_keywords:
            top = raw_keywords[:40]
            kw_data_str = "KEYWORD DATA FROM DATAFORSEO:\n" + "\n".join(
                f"- {k.get('keyword', '')} | vol: {k.get('keyword_data', {}).get('keyword_info', {}).get('search_volume', 'N/A')}"
                f" | difficulty: {k.get('keyword_data', {}).get('keyword_properties', {}).get('keyword_difficulty', 'N/A')}"
                f" | cpc: ${k.get('keyword_data', {}).get('keyword_info', {}).get('cpc', 'N/A')}"
                for k in top
            )

        system_prompt = """\
You are LEO, an expert SEO strategist. Analyse the provided keyword data and produce a strategic keyword research report.

OUTPUT FORMAT - respond with ONLY a valid JSON object (no markdown fences):
{
  "seed_keywords": ["keyword1"],
  "location": "United States",
  "language": "English",
  "total_found": 0,
  "keywords": [
    {
      "keyword": "exact keyword phrase",
      "search_volume": 5400,
      "difficulty": 42,
      "cpc": 1.50,
      "competition": "Medium",
      "intent": "Informational | Navigational | Transactional | Commercial",
      "content_idea": "Specific article/page title that targets this keyword"
    }
  ],
  "priority_picks": ["top 5 keywords to target first with reasoning"],
  "cluster_suggestions": [
    { "cluster": "cluster name", "keywords": ["kw1", "kw2", "kw3"] }
  ],
  "strategy_note": "2-3 sentences on the overall keyword strategy for this brand"
}

RULES:
1. Include max 20 keywords in the keywords array, ordered by priority (best opportunity first).
2. Intent must be one of: Informational, Navigational, Transactional, Commercial.
3. content_idea must be a specific, usable title - not generic advice.
4. difficulty: 0-100 scale (0=easy, 100=impossible).
5. Return ONLY valid JSON - no prose, no markdown.
"""

        brand_ctx = f"Brand: {brand_name}\n"
        brand_ctx += f"Seed keywords: {seed_str}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value prop: {messaging['valueProp']}\n"
        if messaging.get("targetAudience"):
            brand_ctx += f"Target audience: {messaging['targetAudience']}\n"

        user_prompt = f"""\
{brand_ctx}

{kw_data_str if kw_data_str else "No DataForSEO data available - generate keyword ideas based on brand context, seed keywords, and SEO best practices."}

Produce a comprehensive keyword strategy report.
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

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        payload["dataforseo_used"] = use_dfs
        payload["total_found"] = payload.get("total_found") or len(raw_keywords)

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "credits_spent": 10,
        })

        yield _sse({"type": "research_step", "step": "claude_analysis",
                    "label": "Keyword research complete", "status": "done"})
        yield _sse({"type": "keyword_research_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
