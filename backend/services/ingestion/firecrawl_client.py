"""Firecrawl client - scrapes a URL and returns clean markdown + metadata."""

import logging
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

FIRECRAWL_BASE = "https://api.firecrawl.dev/v1"


async def scrape_url(url: str, api_key: str) -> dict:
    """
    Scrape a URL with Firecrawl.

    Returns a dict with:
        markdown   - full page content as markdown
        metadata   - title, description, og fields, etc.
        raw_html   - (omitted to keep payload small)
    """
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{FIRECRAWL_BASE}/scrape",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "url": url,
                "formats": ["markdown", "extract"],
                "extract": {
                    "prompt": (
                        "Extract: brand name, tagline, tone of voice description, "
                        "colour palette mentions (hex codes if visible), font names if mentioned, "
                        "key value propositions, target audience, and any competitor mentions."
                    )
                },
                "onlyMainContent": True,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    result = data.get("data", {})
    return {
        "markdown": result.get("markdown", ""),
        "metadata": result.get("metadata", {}),
        "extract": result.get("extract", {}),
        "source_url": url,
        "source_type": "website",
    }


async def scrape_multiple(urls: list[str], api_key: str) -> list[dict]:
    """Scrape several pages (e.g. homepage + about + contact)."""
    results = []
    for url in urls[:5]:  # cap at 5 pages to avoid excessive cost
        try:
            results.append(await scrape_url(url, api_key))
        except Exception as exc:
            logger.warning("Firecrawl failed for %s: %s", url, exc)
    return results
