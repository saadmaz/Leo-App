"""
Content Freshness Management - DataForSEO rank check + Claude recommendations.

Checks current ranking position for a URL+keyword pair, then Claude assesses
freshness signals and recommends whether/how to refresh the content.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar3 import ContentFreshnessRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _dfs_auth() -> str:
    creds = f"{settings.DATAFORSEO_LOGIN}:{settings.DATAFORSEO_PASSWORD}"
    return "Basic " + base64.b64encode(creds.encode()).decode()


async def _check_rank(keyword: str, domain: str, location_code: int, language_code: str) -> dict:
    """Fetch SERP and find the position of the target domain."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.dataforseo.com/v3/serp/google/organic/live/regular",
            headers={"Authorization": _dfs_auth(), "Content-Type": "application/json"},
            json=[{
                "keyword": keyword,
                "location_code": location_code,
                "language_code": language_code,
                "depth": 30,
            }],
        )
        resp.raise_for_status()
        result = resp.json()
        items = result.get("tasks", [{}])[0].get("result", [{}])[0].get("items", [])

        # Strip protocol + www from domain for matching
        clean = domain.lower().replace("https://", "").replace("http://", "").replace("www.", "").rstrip("/")
        for item in items:
            item_domain = (item.get("domain") or "").lower().replace("www.", "")
            item_url = (item.get("url") or "").lower()
            if clean in item_domain or clean in item_url:
                return {"position": item.get("rank_absolute"), "url": item.get("url"), "title": item.get("title")}

        return {"position": None, "url": None, "title": None}


def _extract_domain(url: str) -> str:
    url = url.lower().replace("https://", "").replace("http://", "")
    return url.split("/")[0]


async def generate(
    project: dict,
    body: ContentFreshnessRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        messaging = brand_core.get("messaging") or {}

        title = f"Freshness Check - {body.url[:60]}"
        doc = firebase_service.create_pillar1_doc(project_id, "content_freshness", owner_uid, title)
        doc_id = doc["id"]

        use_dfs = bool(settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD)
        rank_data: dict = {"position": None, "url": None, "title": None}
        domain = _extract_domain(body.url)

        # ── Step 1: Check current rank ────────────────────────────────────────
        if use_dfs:
            yield _sse({"type": "research_step", "step": "rank_check",
                        "label": f"Checking rank for \"{body.keyword}\"...", "status": "running"})
            try:
                rank_data = await _check_rank(body.keyword, domain, body.location_code, body.language_code)
                pos = rank_data.get("position")
                label = f"Current position: #{pos}" if pos else "Not ranking in top 30"
                yield _sse({"type": "research_step", "step": "rank_check",
                            "label": label, "status": "done"})
            except Exception as exc:
                logger.warning("DataForSEO rank check failed: %s", exc)
                yield _sse({"type": "research_step", "step": "rank_check",
                            "label": "Rank check unavailable - heuristic analysis", "status": "skipped"})
                use_dfs = False
        else:
            yield _sse({"type": "research_step", "step": "rank_check",
                        "label": "DataForSEO not configured - heuristic freshness analysis", "status": "skipped"})

        # ── Step 2: Claude freshness analysis ─────────────────────────────────
        yield _sse({"type": "research_step", "step": "freshness_analysis",
                    "label": "Analysing content freshness signals...", "status": "running"})

        rank_ctx = ""
        if use_dfs:
            pos = rank_data.get("position")
            rank_ctx = f"Current rank for \"{body.keyword}\": {'#' + str(pos) if pos else 'Not in top 30'}\n"

        system_prompt = """\
You are LEO, a content freshness and SEO maintenance expert. Assess the content's freshness signals and produce a refresh action plan.

OUTPUT FORMAT - respond with ONLY a valid JSON object (no markdown fences):
{
  "url": "https://...",
  "keyword": "target keyword",
  "current_position": 12,
  "position_trend": "Rising | Stable | Declining | Not ranking",
  "freshness_score": 55,
  "signals": [
    {
      "signal": "Signal name (e.g. 'Ranking position', 'Content age estimate', 'Competitor activity')",
      "status": "good | warning | critical",
      "note": "What this signal means for this piece of content"
    }
  ],
  "last_modified": "Unknown or estimated date",
  "recommended_updates": [
    "Specific update 1 - e.g. 'Add 2024 statistics from [source type]'",
    "Specific update 2"
  ],
  "update_priority": "low | medium | high",
  "estimated_effort": "1 hour | Half day | Full day | 2+ days",
  "estimated_traffic_recovery": "What refreshing this content could recover in organic traffic",
  "refresh_checklist": ["Item 1", "Item 2", "Item 3"],
  "competitive_threat": "Are competitors outranking with fresher content? Brief assessment."
}

Rules:
- freshness_score: 0-100 (100 = perfectly fresh, 0 = severely stale).
- update_priority: critical/high if ranking is declining or competitors outrank; low if stable.
- recommended_updates must be specific and actionable - not generic advice.
- Return ONLY valid JSON - no prose, no markdown.
"""

        brand_ctx = f"Brand: {brand_name}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value prop: {messaging['valueProp']}\n"

        user_prompt = f"""\
{brand_ctx}
URL to assess: {body.url}
Target keyword: "{body.keyword}"
{rank_ctx}

{"No live ranking data available - infer freshness signals from URL structure, keyword competition, and industry patterns." if not use_dfs else ""}

Assess content freshness and produce a refresh action plan.
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
        if use_dfs and rank_data.get("position"):
            payload["current_position"] = rank_data["position"]

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "credits_spent": 10,
        })

        yield _sse({"type": "research_step", "step": "freshness_analysis",
                    "label": "Freshness analysis complete", "status": "done"})
        yield _sse({"type": "content_freshness_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
