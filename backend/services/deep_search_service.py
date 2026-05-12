"""
Deep Search - multi-source web intelligence.

Sources:
  • SerpAPI  - Google SERP results, PAA boxes, related queries
  • Firecrawl - Full-page structured content extraction

Designed to be streamed (generator pattern) so results arrive
incrementally in the frontend.
"""
from __future__ import annotations

import logging
from typing import Generator

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# SerpAPI
# ---------------------------------------------------------------------------

def search_serpapi(query: str, num_results: int = 10) -> dict:
    """
    Run a Google search via SerpAPI and return structured results.
    Returns empty dict if SERPAPI_API_KEY is not configured.
    """
    api_key = settings.SERPAPI_API_KEY
    if not api_key:
        logger.warning("SERPAPI_API_KEY not configured - skipping SerpAPI search")
        return {}

    params = {
        "q": query,
        "api_key": api_key,
        "num": num_results,
        "hl": "en",
        "gl": "us",
    }

    try:
        resp = httpx.get("https://serpapi.com/search", params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        results = []
        for r in data.get("organic_results", [])[:num_results]:
            results.append({
                "source": "serp",
                "title": r.get("title", ""),
                "url": r.get("link", ""),
                "snippet": r.get("snippet", ""),
                "position": r.get("position", 0),
            })

        related = [q.get("query", "") for q in data.get("related_searches", [])[:5]]
        paa = [q.get("question", "") for q in data.get("related_questions", [])[:5]]

        return {
            "results": results,
            "relatedSearches": related,
            "peopleAlsoAsk": paa,
            "searchMetadata": {
                "query": query,
                "totalResults": data.get("search_information", {}).get("total_results", 0),
            },
        }

    except httpx.HTTPError as exc:
        logger.error("SerpAPI request failed: %s", exc)
        return {}
    except Exception as exc:
        logger.error("SerpAPI unexpected error: %s", exc)
        return {}


# ---------------------------------------------------------------------------
# Firecrawl
# ---------------------------------------------------------------------------

def scrape_firecrawl(url: str) -> dict:
    """
    Scrape a single URL using Firecrawl and return structured content.
    Returns empty dict if FIRECRAWL_API_KEY is not configured or on error.
    """
    api_key = settings.FIRECRAWL_API_KEY
    if not api_key:
        logger.warning("FIRECRAWL_API_KEY not configured - skipping Firecrawl scrape")
        return {}

    try:
        resp = httpx.post(
            "https://api.firecrawl.dev/v1/scrape",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"url": url, "formats": ["markdown", "extract"], "extract": {
                "schema": {
                    "type": "object",
                    "properties": {
                        "title":       {"type": "string"},
                        "description": {"type": "string"},
                        "mainContent": {"type": "string"},
                        "keyPoints":   {"type": "array", "items": {"type": "string"}},
                        "pricing":     {"type": "string"},
                        "cta":         {"type": "string"},
                    },
                }
            }},
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()

        return {
            "source": "firecrawl",
            "url": url,
            "markdown": data.get("data", {}).get("markdown", "")[:3000],
            "extract": data.get("data", {}).get("extract", {}),
            "metadata": data.get("data", {}).get("metadata", {}),
        }

    except httpx.HTTPError as exc:
        logger.error("Firecrawl scrape failed for %s: %s", url, exc)
        return {}
    except Exception as exc:
        logger.error("Firecrawl unexpected error for %s: %s", url, exc)
        return {}


# ---------------------------------------------------------------------------
# Combined deep search (generator - yields SSE-style dicts)
# ---------------------------------------------------------------------------

def deep_search(
    query: str,
    scrape_top_n: int = 3,
) -> Generator[dict, None, None]:
    """
    Run SerpAPI search then scrape the top N results with Firecrawl.
    Yields progress dicts that map to SSE events in the route handler.
    """
    yield {"type": "step", "message": f"Searching Google for: {query}"}

    serp_data = search_serpapi(query, num_results=10)
    if not serp_data:
        yield {"type": "error", "message": "SerpAPI unavailable or not configured."}
        return

    yield {
        "type": "serp_results",
        "data": {
            "results": serp_data.get("results", []),
            "relatedSearches": serp_data.get("relatedSearches", []),
            "peopleAlsoAsk": serp_data.get("peopleAlsoAsk", []),
            "searchMetadata": serp_data.get("searchMetadata", {}),
        },
    }

    # Scrape top N results
    top_urls = [r["url"] for r in serp_data.get("results", [])[:scrape_top_n] if r.get("url")]

    for i, url in enumerate(top_urls):
        yield {"type": "step", "message": f"Scraping page {i + 1} of {len(top_urls)}: {url}"}
        scraped = scrape_firecrawl(url)
        if scraped:
            yield {"type": "scraped_page", "data": scraped}

    yield {"type": "done", "message": "Deep search complete."}
