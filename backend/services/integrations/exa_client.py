"""
Exa.ai client - neural/semantic search engine built for AI.

All public functions are async. The underlying exa-py SDK is synchronous,
so every call is wrapped in asyncio.to_thread() to avoid blocking the event loop.

Endpoints exposed:
  /search        - semantic search (neural, instant, auto, deep)
  /contents      - clean page text from specific URLs
  /findSimilar   - pages semantically similar to a given URL
  /answer        - RAG-style answer with citations
  /research      - async deep research tasks (start + poll)

Cost controls:
  - Every billable call increments the project's daily usage counter.
  - check_quota() is called before each request; QuotaExceededError raised
    if the project is over its daily limit.
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


def get_exa_client():
    """Return the shared Exa client, creating it on first call."""
    global _client
    if _client is None:
        if not settings.EXA_API_KEY:
            raise SearchServiceError(
                "EXA_API_KEY is not set.",
                source="exa",
                is_retryable=False,
            )
        from exa_py import Exa
        _client = Exa(api_key=settings.EXA_API_KEY)
    return _client


# ---------------------------------------------------------------------------
# Quota helpers
# ---------------------------------------------------------------------------

def _check_quota(project_id: Optional[str], operation: str) -> None:
    """Raise QuotaExceededError if the project is over its daily limit."""
    if not project_id:
        return
    try:
        from backend.services import firebase_service
        usage = firebase_service.get_search_usage(project_id, "exa")
        if operation == "research":
            if usage.get("exa_research_ops", 0) >= settings.EXA_RESEARCH_DAILY_LIMIT:
                raise QuotaExceededError("exa", operation)
        else:
            if usage.get("exa_searches", 0) >= settings.EXA_DAILY_SEARCH_LIMIT:
                raise QuotaExceededError("exa", operation)
    except QuotaExceededError:
        raise
    except Exception:
        pass  # quota check failure is non-fatal


def _track_usage(project_id: Optional[str], operation: str, count: int = 1) -> None:
    if not project_id:
        return
    try:
        from backend.services import firebase_service
        firebase_service.increment_search_usage(project_id, "exa", operation, count)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cache_key(query: str, params: dict) -> str:
    payload = json.dumps({"q": query, "p": params}, sort_keys=True)
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
            project_id, key, results, "exa", settings.SEARCH_CACHE_TTL_HOURS
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Result normaliser - consistent shape for all callers
# ---------------------------------------------------------------------------

def _normalise_result(r) -> dict:
    return {
        "title": getattr(r, "title", "") or "",
        "url": getattr(r, "url", "") or "",
        "published_date": getattr(r, "published_date", "") or "",
        "author": getattr(r, "author", "") or "",
        "text": getattr(r, "text", "") or "",
        "summary": getattr(r, "summary", "") or "",
        "highlights": getattr(r, "highlights", []) or [],
        "score": getattr(r, "score", 0.0) or 0.0,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def search(
    query: str,
    num_results: int = 10,
    category: Optional[str] = None,
    search_type: str = "auto",
    include_domains: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    start_published_date: Optional[str] = None,
    include_text: bool = False,
    include_highlights: bool = True,
    project_id: Optional[str] = None,
) -> list[dict]:
    """
    General semantic search.

    search_type: "instant" (200ms) | "fast" (450ms) | "auto" (1s, default) |
                 "deep" (5-60s) | "deep-reasoning" (5-60s)
    category: "company" | "research paper" | "news" | "tweet" |
              "personal site" | "financial report" | "people"
    """
    cache_key = _cache_key(query, {
        "n": num_results, "cat": category, "type": search_type,
        "inc": include_domains, "exc": exclude_domains,
    })
    cached = _get_cache(project_id, cache_key)
    if cached is not None:
        logger.debug("Exa cache hit: %s", query[:60])
        return cached

    _check_quota(project_id, "search")

    def _run():
        exa = get_exa_client()
        kwargs: dict[str, Any] = {
            "num_results": num_results,
            "type": search_type,
        }
        if category:
            kwargs["category"] = category
        if include_domains:
            kwargs["include_domains"] = include_domains
        if exclude_domains:
            kwargs["exclude_domains"] = exclude_domains
        if start_published_date:
            kwargs["start_published_date"] = start_published_date
        if include_text or include_highlights:
            contents: dict[str, Any] = {}
            if include_text:
                contents["text"] = {"max_characters": 3000}
            if include_highlights:
                contents["highlights"] = {"num_sentences": 3}
            kwargs["contents"] = contents
        return exa.search(query, **kwargs)

    try:
        response = await asyncio.to_thread(_run)
        results = [_normalise_result(r) for r in response.results]
        _track_usage(project_id, "search")
        _set_cache(project_id, cache_key, results)
        return results
    except QuotaExceededError:
        raise
    except Exception as exc:
        logger.error("Exa search error: %s", exc)
        raise SearchServiceError(str(exc), source="exa", is_retryable=True) from exc


async def search_news(
    query: str,
    num_results: int = 10,
    days_back: int = 7,
    project_id: Optional[str] = None,
) -> list[dict]:
    """Search for recent news articles."""
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return await search(
        query=query,
        num_results=num_results,
        category="news",
        search_type="auto",
        start_published_date=cutoff,
        include_highlights=True,
        project_id=project_id,
    )


async def search_companies(
    query: str,
    num_results: int = 10,
    project_id: Optional[str] = None,
) -> list[dict]:
    """Search Exa's company index (50M+ companies)."""
    return await search(
        query=query,
        num_results=num_results,
        category="company",
        search_type="auto",
        include_highlights=True,
        project_id=project_id,
    )


async def search_people(
    query: str,
    num_results: int = 10,
    project_id: Optional[str] = None,
) -> list[dict]:
    """Search Exa's people index (1B+ profiles) for influencer/contact discovery."""
    return await search(
        query=query,
        num_results=num_results,
        category="personal site",
        search_type="auto",
        include_highlights=True,
        project_id=project_id,
    )


async def find_similar(
    url: str,
    num_results: int = 10,
    exclude_domains: Optional[list[str]] = None,
    project_id: Optional[str] = None,
) -> list[dict]:
    """
    Find pages semantically similar to a given URL.
    Ideal for competitor discovery - give it the brand's website and get
    a list of similar companies/brands.
    """
    cache_key = _cache_key(url, {"n": num_results, "exc": exclude_domains, "op": "similar"})
    cached = _get_cache(project_id, cache_key)
    if cached is not None:
        return cached

    _check_quota(project_id, "search")

    def _run():
        exa = get_exa_client()
        kwargs: dict[str, Any] = {
            "num_results": num_results,
            "contents": {"highlights": {"num_sentences": 2}},
        }
        if exclude_domains:
            kwargs["exclude_domains"] = exclude_domains
        return exa.find_similar_and_contents(url, **kwargs)

    try:
        response = await asyncio.to_thread(_run)
        results = [_normalise_result(r) for r in response.results]
        _track_usage(project_id, "search")
        _set_cache(project_id, cache_key, results)
        return results
    except QuotaExceededError:
        raise
    except Exception as exc:
        logger.error("Exa findSimilar error: %s", exc)
        raise SearchServiceError(str(exc), source="exa", is_retryable=True) from exc


async def get_contents(
    urls: list[str],
    max_chars: int = 3000,
    project_id: Optional[str] = None,
) -> list[dict]:
    """
    Fetch clean, parsed text from specific URLs.
    Token-efficient (relevant tokens only). $1/1k pages.
    """
    if not urls:
        return []

    _check_quota(project_id, "contents")

    def _run():
        exa = get_exa_client()
        return exa.get_contents(
            ids=urls,
            text={"max_characters": max_chars},
        )

    try:
        response = await asyncio.to_thread(_run)
        results = [_normalise_result(r) for r in response.results]
        _track_usage(project_id, "contents", len(urls))
        return results
    except QuotaExceededError:
        raise
    except Exception as exc:
        logger.error("Exa contents error: %s", exc)
        raise SearchServiceError(str(exc), source="exa", is_retryable=True) from exc


async def answer_question(
    query: str,
    output_schema: Optional[dict] = None,
    project_id: Optional[str] = None,
) -> dict:
    """
    RAG-style direct answer with citations.
    Returns { "answer": str, "citations": [{ url, title, text }] }
    $5/1k answers.
    """
    _check_quota(project_id, "answer")

    def _run():
        exa = get_exa_client()
        kwargs: dict[str, Any] = {}
        if output_schema:
            kwargs["output_schema"] = output_schema
        return exa.answer(query, **kwargs)

    try:
        response = await asyncio.to_thread(_run)
        citations = []
        for src in getattr(response, "citations", []) or []:
            citations.append({
                "url": getattr(src, "url", ""),
                "title": getattr(src, "title", ""),
                "text": getattr(src, "text", "") or "",
                "published_date": getattr(src, "published_date", "") or "",
            })
        _track_usage(project_id, "answer")
        return {
            "answer": getattr(response, "answer", "") or "",
            "citations": citations,
        }
    except QuotaExceededError:
        raise
    except Exception as exc:
        logger.error("Exa answer error: %s", exc)
        raise SearchServiceError(str(exc), source="exa", is_retryable=True) from exc


async def start_research(
    instructions: str,
    model: str = "exa-research",
    output_schema: Optional[dict] = None,
    project_id: Optional[str] = None,
) -> str:
    """
    Start an async deep research task. Returns the task ID for polling.

    model: "exa-research-fast" | "exa-research" | "exa-research-pro"
    Returns: task_id (string)
    """
    _check_quota(project_id, "research")

    def _run():
        exa = get_exa_client()
        kwargs: dict[str, Any] = {"model": model}
        if output_schema:
            kwargs["output_schema"] = output_schema
        return exa.create_research_task(instructions, **kwargs)

    try:
        response = await asyncio.to_thread(_run)
        _track_usage(project_id, "research")
        return response.id
    except QuotaExceededError:
        raise
    except Exception as exc:
        logger.error("Exa research start error: %s", exc)
        raise SearchServiceError(str(exc), source="exa", is_retryable=False) from exc


async def get_research_status(task_id: str) -> dict:
    """
    Poll the status of an async research task.
    Returns: { status, content, citations, cost_dollars }
    status: "pending" | "running" | "completed" | "failed"
    """
    def _run():
        exa = get_exa_client()
        return exa.get_research_task(task_id)

    try:
        response = await asyncio.to_thread(_run)
        status = getattr(response, "status", "unknown")
        result: dict = {"status": status, "task_id": task_id}

        if status == "completed":
            result["content"] = getattr(response, "data", None) or getattr(response, "content", "") or ""
            result["cost_dollars"] = getattr(response, "cost_dollars", 0)

        return result
    except Exception as exc:
        logger.error("Exa research poll error for %s: %s", task_id, exc)
        raise SearchServiceError(str(exc), source="exa", is_retryable=True) from exc
