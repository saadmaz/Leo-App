"""
SERP Intent Mapping - DataForSEO SERP API + Claude intent classification.

Fetches the top-10 organic SERP for a keyword, then uses Claude to classify
the dominant search intent and recommend the ideal content format.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar3 import SerpIntentRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _dfs_auth() -> str:
    creds = f"{settings.DATAFORSEO_LOGIN}:{settings.DATAFORSEO_PASSWORD}"
    return "Basic " + base64.b64encode(creds.encode()).decode()


async def _fetch_serp(keyword: str, location_code: int, language_code: str, depth: int) -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.dataforseo.com/v3/serp/google/organic/live/regular",
            headers={"Authorization": _dfs_auth(), "Content-Type": "application/json"},
            json=[{
                "keyword": keyword,
                "location_code": location_code,
                "language_code": language_code,
                "depth": depth,
                "se_type": "organic",
            }],
        )
        resp.raise_for_status()
        result = resp.json()
        items = result.get("tasks", [{}])[0].get("result", [{}])[0].get("items", [])
        return [i for i in items if i.get("type") in ("organic", "featured_snippet", "people_also_ask")]


async def generate(
    project: dict,
    body: SerpIntentRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        messaging = brand_core.get("messaging") or {}

        title = f"SERP Intent - {body.keyword}"
        doc = firebase_service.create_pillar1_doc(project_id, "serp_intent", owner_uid, title)
        doc_id = doc["id"]

        use_dfs = bool(settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD)
        serp_items: list[dict] = []

        # ── Step 1: DataForSEO SERP ───────────────────────────────────────────
        if use_dfs:
            yield _sse({"type": "research_step", "step": "serp_fetch",
                        "label": f"Fetching SERP for \"{body.keyword}\"...", "status": "running"})
            try:
                serp_items = await _fetch_serp(
                    body.keyword, body.location_code, body.language_code, body.depth)
                yield _sse({"type": "research_step", "step": "serp_fetch",
                            "label": f"Retrieved {len(serp_items)} SERP results", "status": "done"})
            except Exception as exc:
                logger.warning("DataForSEO SERP failed: %s", exc)
                yield _sse({"type": "research_step", "step": "serp_fetch",
                            "label": "DataForSEO unavailable - Claude-only analysis", "status": "skipped"})
                use_dfs = False
        else:
            yield _sse({"type": "research_step", "step": "serp_fetch",
                        "label": "DataForSEO not configured - Claude-only analysis", "status": "skipped"})

        # ── Step 2: Claude intent classification ──────────────────────────────
        yield _sse({"type": "research_step", "step": "intent_analysis",
                    "label": "Classifying search intent...", "status": "running"})

        serp_str = ""
        if serp_items:
            organic = [i for i in serp_items if i.get("type") == "organic"][:10]
            serp_str = "SERP RESULTS:\n" + "\n".join(
                f"#{i.get('rank_absolute', idx+1)} [{i.get('type', 'organic')}] {i.get('title', '')} - {i.get('url', '')}"
                f"\n   Desc: {(i.get('description') or '')[:120]}"
                for idx, i in enumerate(organic)
            )

        system_prompt = """\
You are LEO, an SEO strategist specialising in search intent analysis.

OUTPUT FORMAT - respond with ONLY a valid JSON object (no markdown fences):
{
  "keyword": "the analysed keyword",
  "overall_intent": "Informational | Navigational | Transactional | Commercial",
  "intent_confidence": 85,
  "intent_breakdown": {
    "informational": 60,
    "navigational": 5,
    "transactional": 15,
    "commercial": 20
  },
  "serp_results": [
    {
      "position": 1,
      "title": "Page title",
      "url": "https://...",
      "description": "Snippet text",
      "intent": "Informational"
    }
  ],
  "has_featured_snippet": false,
  "has_people_also_ask": false,
  "content_recommendation": "What type of content to create to rank for this keyword",
  "content_type_to_create": "How-to guide | Listicle | Comparison | Landing page | etc.",
  "ideal_word_count": 1500,
  "angle": "The unique angle your brand should take to stand out",
  "competing_domains": ["domain1.com", "domain2.com"],
  "difficulty_assessment": "Low | Medium | High | Very High",
  "ranking_timeline": "2-4 weeks | 2-3 months | 6-12 months"
}

Rules:
- intent_breakdown values must sum to 100.
- serp_results: include up to 10 organic results.
- angle must be specific to the brand context provided.
- Return ONLY valid JSON.
"""

        brand_ctx = f"Brand: {brand_name}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value prop: {messaging['valueProp']}\n"

        user_prompt = f"""\
{brand_ctx}
Keyword to analyse: "{body.keyword}"

{serp_str if serp_str else "No live SERP data available - infer intent from keyword semantics and industry knowledge."}

Classify search intent and provide content strategy recommendations.
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

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "credits_spent": 10,
        })

        yield _sse({"type": "research_step", "step": "intent_analysis",
                    "label": "Intent mapping complete", "status": "done"})
        yield _sse({"type": "serp_intent_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
