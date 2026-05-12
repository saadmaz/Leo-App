"""
Coverage Monitoring - SerpAPI searches news, Apify scrapes Reddit,
Claude synthesises sentiment and key themes.

Reuses patterns from the existing Reputation Monitoring pillar.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar8 import CoverageMonitoringRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw

logger = logging.getLogger(__name__)

SYSTEM_SYNTHESIS = """\
You are a PR analyst reviewing media coverage and social mentions for a brand.
Synthesise the raw mentions into a structured coverage report.

Return ONLY valid JSON - no markdown fences.

Schema:
{
  "coverage_summary": "string (3-4 sentence narrative - overall sentiment, volume, key themes)",
  "sentiment_breakdown": {
    "positive": number (percentage),
    "neutral": number (percentage),
    "negative": number (percentage)
  },
  "key_themes": [
    {"theme": "string", "mention_count": number, "sentiment": "positive|neutral|negative"}
  ],
  "top_mentions": [
    {
      "source": "string",
      "title": "string",
      "url": "string or null",
      "snippet": "string",
      "sentiment": "positive|neutral|negative",
      "significance": "high|medium|low",
      "date": "string or null"
    }
  ],
  "alerts": [
    {"type": "string", "message": "string", "severity": "high|medium|low"}
  ],
  "recommended_actions": ["string"],
  "share_of_voice_notes": "string or null"
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _serp_news_search(query: str, days_back: int) -> list[dict]:
    """Search news via SerpAPI."""
    if not settings.SERPAPI_API_KEY:
        return []
    after_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                "https://serpapi.com/search",
                params={
                    "engine": "google_news",
                    "q": query,
                    "api_key": settings.SERPAPI_API_KEY,
                    "after": after_date,
                    "num": 10,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for item in data.get("news_results", [])[:10]:
                    results.append({
                        "source": item.get("source", {}).get("name", "Unknown"),
                        "title": item.get("title", ""),
                        "url": item.get("link"),
                        "snippet": item.get("snippet", ""),
                        "date": item.get("date"),
                    })
                return results
    except Exception as exc:
        logger.warning("SerpAPI news search failed: %s", exc)
    return []


async def _apify_reddit_search(query: str, days_back: int) -> list[dict]:
    """Search Reddit via Apify Reddit Scraper."""
    if not settings.APIFY_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            # Start Apify Reddit search actor
            run_resp = await client.post(
                "https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/runs",
                headers={"Authorization": f"Bearer {settings.APIFY_API_KEY}"},
                json={
                    "searches": [query],
                    "maxItems": 15,
                    "time": "week" if days_back <= 7 else "month",
                    "sort": "relevance",
                },
                timeout=30,
            )
            if run_resp.status_code not in (200, 201):
                return []
            run_id = run_resp.json().get("data", {}).get("id")
            if not run_id:
                return []

            # Poll for completion
            for _ in range(12):  # max 60s
                await asyncio.sleep(5)
                status_resp = await client.get(
                    f"https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/runs/{run_id}",
                    headers={"Authorization": f"Bearer {settings.APIFY_API_KEY}"},
                )
                if status_resp.status_code == 200:
                    status = status_resp.json().get("data", {}).get("status")
                    if status == "SUCCEEDED":
                        break
                    if status in ("FAILED", "ABORTED"):
                        return []

            items_resp = await client.get(
                f"https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/runs/{run_id}/dataset/items",
                headers={"Authorization": f"Bearer {settings.APIFY_API_KEY}"},
                params={"limit": 15},
            )
            if items_resp.status_code == 200:
                results = []
                for item in items_resp.json()[:15]:
                    results.append({
                        "source": f"Reddit r/{item.get('subreddit', 'unknown')}",
                        "title": item.get("title", ""),
                        "url": item.get("url"),
                        "snippet": (item.get("body") or item.get("selftext") or "")[:300],
                        "date": item.get("createdAt"),
                    })
                return results
    except Exception as exc:
        logger.warning("Apify Reddit search failed: %s", exc)
    return []


async def generate(
    project: dict,
    body: CoverageMonitoringRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Coverage Monitor - {body.brand_name} · {body.days_back}d"
    doc = firebase_service.create_pillar1_doc(project_id, "coverage_monitoring", owner_uid, title)
    doc_id = doc["id"]

    all_mentions: list[dict] = []
    search_terms = [body.brand_name] + body.keywords[:3]

    # News search
    if body.include_news:
        yield _sse({"type": "research_step", "step": "news", "label": "Searching news coverage…", "status": "running"})
        news_tasks = [_serp_news_search(term, body.days_back) for term in search_terms]
        news_results = await asyncio.gather(*news_tasks)
        for batch in news_results:
            all_mentions.extend(batch)
        yield _sse({"type": "research_step", "step": "news", "label": f"Found {sum(len(b) for b in news_results)} news mentions", "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "news", "label": "News search skipped", "status": "done"})

    # Reddit search
    if body.include_reddit:
        yield _sse({"type": "research_step", "step": "reddit", "label": "Scanning Reddit…", "status": "running"})
        reddit_results = await _apify_reddit_search(body.brand_name, body.days_back)
        all_mentions.extend(reddit_results)
        yield _sse({"type": "research_step", "step": "reddit", "label": f"Found {len(reddit_results)} Reddit mentions", "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "reddit", "label": "Reddit scan skipped", "status": "done"})

    # Claude synthesis
    yield _sse({"type": "research_step", "step": "analysis", "label": "Analysing coverage…", "status": "running"})

    mentions_text = json.dumps(all_mentions[:40], indent=2)  # cap to avoid token overflow
    prompt = (
        f"Brand being monitored: {body.brand_name}\n"
        f"Keywords tracked: {', '.join(body.keywords) if body.keywords else 'none'}\n"
        f"Period: last {body.days_back} days\n"
        f"Sentiment filter: {body.sentiment_filter or 'all'}\n\n"
        f"RAW MENTIONS ({len(all_mentions)} total, showing up to 40):\n{mentions_text}\n\n"
        "Synthesise into a structured coverage report. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM_SYNTHESIS, max_tokens=4000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"Analysis failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "analysis", "label": "Analysis complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["brand_name"] = body.brand_name
    payload["total_raw_mentions"] = len(all_mentions)
    payload["days_back"] = body.days_back

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
