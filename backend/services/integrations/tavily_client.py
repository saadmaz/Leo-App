"""
Tavily client - AI-powered search built specifically for AI agents.

Handles: search + scrape + filter + extract in a single call.
One-call search returns LLM-ready, relevance-scored content.

Endpoints exposed:
  search   - general/news search (basic/advanced depth)
  extract  - clean content from specific URLs
  crawl    - graph-based website traversal
  research - multi-step async research with structured output

All functions are async. tavily-python SDK is synchronous,
wrapped in asyncio.to_thread().

Official integrations: Anthropic, LangChain, CrewAI, LlamaIndex, etc.
"""

import asyncio
import hashlib
import json
import logging
from typing import Any, Optional

from backend.config import settings
from backend.services.exceptions import QuotaExceededError, SearchServiceError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_client = None


def get_tavily_client():
    """Return the shared TavilyClient, creating it on first call."""
    global _client
    if _client is None:
        if not settings.TAVILY_API_KEY:
            raise SearchServiceError(
                "TAVILY_API_KEY is not set.",
                source="tavily",
                is_retryable=False,
            )
        from tavily import TavilyClient
        _client = TavilyClient(api_key=settings.TAVILY_API_KEY)
    return _client


# ---------------------------------------------------------------------------
# Quota helpers
# ---------------------------------------------------------------------------

def _check_quota(project_id: Optional[str]) -> None:
    if not project_id:
        return
    try:
        from backend.services import firebase_service
        usage = firebase_service.get_search_usage(project_id, "tavily")
        if usage.get("tavily_searches", 0) >= settings.TAVILY_DAILY_SEARCH_LIMIT:
            raise QuotaExceededError("tavily", "search")
    except QuotaExceededError:
        raise
    except Exception:
        pass


def _track_usage(project_id: Optional[str], count: int = 1) -> None:
    if not project_id:
        return
    try:
        from backend.services import firebase_service
        firebase_service.increment_search_usage(project_id, "tavily", "search", count)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cache_key(query: str, params: dict) -> str:
    payload = json.dumps({"q": query, "p": params, "src": "tavily"}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def _get_cache(project_id: Optional[str], key: str) -> Optional[list]:
    if not project_id:
        return None
    try:
        from backend.services import firebase_service
        return firebase_service.get_cached_search(project_id, key)
    except Exception:
        return None


def _set_cache(project_id: Optional[str], key: str, results: list) -> None:
    if not project_id:
        return
    try:
        from backend.services import firebase_service
        firebase_service.save_search_cache(
            project_id, key, results, "tavily", settings.SEARCH_CACHE_TTL_HOURS
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Result normaliser
# ---------------------------------------------------------------------------

def _normalise_results(response: dict) -> list[dict]:
    normalised = []
    for r in response.get("results", []):
        normalised.append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "content": r.get("content", ""),
            "raw_content": r.get("raw_content", ""),
            "score": r.get("score", 0.0),
            "published_date": r.get("published_date", ""),
        })
    return normalised


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def search_basic(
    query: str,
    max_results: int = 5,
    include_domains: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    include_answer: bool = True,
    project_id: Optional[str] = None,
) -> dict:
    """
    Fast general-purpose search. 1 credit.
    Returns { results, answer }
    """
    cache_key = _cache_key(query, {
        "d": "basic", "n": max_results,
        "inc": include_domains, "exc": exclude_domains,
    })
    cached = _get_cache(project_id, cache_key)
    if cached is not None:
        logger.debug("Tavily cache hit: %s", query[:60])
        return {"results": cached, "answer": ""}

    _check_quota(project_id)

    def _run():
        client = get_tavily_client()
        kwargs: dict[str, Any] = {
            "search_depth": "basic",
            "max_results": max_results,
            "include_answer": include_answer,
        }
        if include_domains:
            kwargs["include_domains"] = include_domains
        if exclude_domains:
            kwargs["exclude_domains"] = exclude_domains
        return client.search(query, **kwargs)

    try:
        response = await asyncio.to_thread(_run)
        results = _normalise_results(response)
        _track_usage(project_id)
        _set_cache(project_id, cache_key, results)
        return {"results": results, "answer": response.get("answer", "")}
    except QuotaExceededError:
        raise
    except Exception as exc:
        logger.error("Tavily basic search error: %s", exc)
        raise SearchServiceError(str(exc), source="tavily", is_retryable=True) from exc


async def search_advanced(
    query: str,
    max_results: int = 10,
    topic: str = "general",
    time_range: Optional[str] = None,
    include_domains: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    include_answer: bool = True,
    include_raw_content: bool = False,
    project_id: Optional[str] = None,
) -> dict:
    """
    Deep search with AI-powered relevance scoring. 2 credits.
    topic: "general" | "news"
    time_range: "day" | "week" | "month" | "year"
    Returns { results, answer }
    """
    cache_key = _cache_key(query, {
        "d": "advanced", "n": max_results, "t": topic,
        "tr": time_range, "inc": include_domains,
    })
    cached = _get_cache(project_id, cache_key)
    if cached is not None:
        return {"results": cached, "answer": ""}

    _check_quota(project_id)

    def _run():
        client = get_tavily_client()
        kwargs: dict[str, Any] = {
            "search_depth": "advanced",
            "max_results": max_results,
            "topic": topic,
            "include_answer": include_answer,
            "include_raw_content": include_raw_content,
        }
        if time_range:
            kwargs["time_range"] = time_range
        if include_domains:
            kwargs["include_domains"] = include_domains
        if exclude_domains:
            kwargs["exclude_domains"] = exclude_domains
        return client.search(query, **kwargs)

    try:
        response = await asyncio.to_thread(_run)
        results = _normalise_results(response)
        _track_usage(project_id, count=2)
        _set_cache(project_id, cache_key, results)
        return {"results": results, "answer": response.get("answer", "")}
    except QuotaExceededError:
        raise
    except Exception as exc:
        logger.error("Tavily advanced search error: %s", exc)
        raise SearchServiceError(str(exc), source="tavily", is_retryable=True) from exc


async def search_news(
    query: str,
    days: int = 7,
    max_results: int = 10,
    include_domains: Optional[list[str]] = None,
    project_id: Optional[str] = None,
) -> dict:
    """
    Real-time news search. Maps days to Tavily's time_range param.
    Returns { results, answer }
    """
    if days <= 1:
        time_range = "day"
    elif days <= 7:
        time_range = "week"
    elif days <= 30:
        time_range = "month"
    else:
        time_range = "year"

    return await search_advanced(
        query=query,
        max_results=max_results,
        topic="news",
        time_range=time_range,
        include_domains=include_domains,
        include_answer=True,
        project_id=project_id,
    )


async def extract_content(
    urls: list[str],
    project_id: Optional[str] = None,
) -> list[dict]:
    """
    Extract clean content from specific URLs.
    ~1 credit per URL.
    Returns list of { url, raw_content, failed_results }
    """
    if not urls:
        return []

    def _run():
        client = get_tavily_client()
        return client.extract(urls=urls)

    try:
        response = await asyncio.to_thread(_run)
        _track_usage(project_id, count=len(urls))
        results = []
        for r in response.get("results", []):
            results.append({
                "url": r.get("url", ""),
                "raw_content": r.get("raw_content", ""),
                "failed": False,
            })
        for r in response.get("failed_results", []):
            results.append({"url": r.get("url", ""), "raw_content": "", "failed": True})
        return results
    except Exception as exc:
        logger.error("Tavily extract error: %s", exc)
        raise SearchServiceError(str(exc), source="tavily", is_retryable=True) from exc


async def crawl_site(
    url: str,
    max_depth: int = 2,
    max_breadth: int = 20,
    project_id: Optional[str] = None,
) -> list[dict]:
    """
    Graph-based website crawl - discovers and returns all pages up to max_depth.
    Ideal for comprehensive competitor site ingestion.
    Returns list of { url, raw_content }
    """
    def _run():
        client = get_tavily_client()
        return client.crawl(
            url=url,
            max_depth=max_depth,
            max_breadth=max_breadth,
        )

    try:
        response = await asyncio.to_thread(_run)
        _track_usage(project_id, count=5)  # conservative estimate
        results = []
        for r in response.get("results", []):
            results.append({
                "url": r.get("url", ""),
                "raw_content": r.get("raw_content", ""),
            })
        return results
    except Exception as exc:
        logger.error("Tavily crawl error: %s", exc)
        raise SearchServiceError(str(exc), source="tavily", is_retryable=True) from exc
