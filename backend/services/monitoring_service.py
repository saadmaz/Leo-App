"""
Brand monitoring service - real-time brand mention and competitor news tracking.

Searches for brand name + competitor mentions across the web using
Tavily (news) and Exa (semantic news index) in parallel.

Deduplicates by URL, classifies sentiment with a fast keyword heuristic
(no LLM call per alert - keeps costs near zero), and persists new alerts
to Firestore under projects/{id}/monitor_alerts.

Usage:
  - On-demand: POST /projects/{id}/monitor/run
  - Future: scheduled job (cron/Cloud Scheduler) calling run_brand_monitor()
"""

import asyncio
import logging
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)

# Simple keyword-based sentiment heuristic - cheap and fast
_POSITIVE_WORDS = frozenset([
    "launch", "award", "win", "growth", "record", "partnership", "expand",
    "funding", "raised", "success", "innovation", "leader", "milestone",
    "celebrate", "best", "top", "excellent", "great",
])
_NEGATIVE_WORDS = frozenset([
    "recall", "lawsuit", "layoff", "loss", "decline", "fail", "scandal",
    "breach", "fine", "penalty", "crisis", "controversy", "problem",
    "issue", "concern", "drop", "cut", "fired", "bankruptcy",
])


def _classify_sentiment(title: str, snippet: str) -> str:
    text = (title + " " + snippet).lower()
    pos = sum(1 for w in _POSITIVE_WORDS if w in text)
    neg = sum(1 for w in _NEGATIVE_WORDS if w in text)
    if pos > neg:
        return "positive"
    if neg > pos:
        return "negative"
    return "neutral"


async def run_brand_monitor(
    project_id: str,
    brand_core: dict,
    brand_name: str,
) -> dict:
    """
    Run a full brand monitoring scan.
    Searches brand name + top 3 competitors. Stores new alerts in Firestore.
    Returns: { new_alerts: int, alerts: list[dict] }
    """
    from backend.services import firebase_service
    from backend.services.integrations import tavily_client, exa_client

    competitors = brand_core.get("competitors") or []
    search_targets = [brand_name] + [c for c in competitors[:3] if c]

    all_results: list[dict] = []

    async def _search_target(target: str, is_brand: bool):
        local_results = []
        alert_type = "brand_mention" if is_brand else "competitor_news"

        # Tavily news (1 credit)
        try:
            resp = await tavily_client.search_news(
                query=f'"{target}" news',
                days=7,
                max_results=5,
                project_id=project_id,
            )
            for r in resp.get("results", []):
                local_results.append({
                    "alert_type": alert_type,
                    "keyword": target,
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("content", "")[:400],
                    "published_date": r.get("published_date", ""),
                    "source": "tavily",
                })
        except Exception as exc:
            logger.warning("Tavily monitor search failed for %s: %s", target, exc)

        # Exa news (1 request)
        try:
            exa_results = await exa_client.search_news(
                query=f"{target} news announcement",
                num_results=5,
                days_back=7,
                project_id=project_id,
            )
            for r in exa_results:
                local_results.append({
                    "alert_type": alert_type,
                    "keyword": target,
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": (r.get("highlights", [""])[0] if r.get("highlights") else r.get("text", ""))[:400],
                    "published_date": r.get("published_date", ""),
                    "source": "exa",
                })
        except Exception as exc:
            logger.warning("Exa monitor search failed for %s: %s", target, exc)

        return local_results

    # Run all targets in parallel
    tasks = [_search_target(t, i == 0) for i, t in enumerate(search_targets)]
    results_per_target = await asyncio.gather(*tasks, return_exceptions=True)

    for batch in results_per_target:
        if isinstance(batch, list):
            all_results.extend(batch)

    # Deduplicate by URL
    seen_urls: set = set()
    unique_results: list[dict] = []
    for r in all_results:
        url = r.get("url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique_results.append(r)

    # Persist only new alerts (not already in Firestore)
    new_count = 0
    saved_alerts = []
    for r in unique_results:
        url = r.get("url", "")
        if not url:
            continue
        try:
            if firebase_service.alert_url_exists(project_id, url):
                continue
            sentiment = _classify_sentiment(r.get("title", ""), r.get("snippet", ""))
            alert_data = {**r, "sentiment": sentiment}
            saved = firebase_service.save_monitor_alert(project_id, alert_data)
            saved_alerts.append(saved)
            new_count += 1
        except Exception as exc:
            logger.warning("Failed to save monitor alert: %s", exc)

    return {
        "new_alerts": new_count,
        "alerts": saved_alerts,
        "targets_searched": search_targets,
    }
