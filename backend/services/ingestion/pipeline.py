"""
Brand ingestion pipeline - orchestrates scraping → extraction → Firestore save.

Yields SSE-compatible event dicts that the ingestion route can stream directly
to the client. The frontend's animated progress overlay reads these events to
show live step status and a progress bar.

Event shapes:
  { "type": "step",     "label": "...", "status": "running|done|error|skipped", "detail": "..." }
  { "type": "progress", "pct": 0-100 }
  { "type": "done",     "brandCore": { ... } }
  { "type": "error",    "message": "..." }
"""

import logging
from typing import AsyncIterator, Optional
from urllib.parse import urlparse

from backend.config import settings
from backend.services.ingestion import firecrawl_client, apify_client, brand_extractor
from backend.services import firebase_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event constructors - keep consistent shape across all yield sites
# ---------------------------------------------------------------------------

def _step(label: str, status: str = "running", detail: str = "") -> dict:
    return {"type": "step", "label": label, "status": status, "detail": detail}


def _progress(pct: int) -> dict:
    return {"type": "progress", "pct": max(0, min(100, pct))}


def _done(brand_core: dict) -> dict:
    return {"type": "done", "brandCore": brand_core}


def _error(message: str) -> dict:
    return {"type": "error", "message": message}


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

def _validate_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Invalid URL scheme {parsed.scheme!r} in {url!r}.")
    if not parsed.netloc:
        raise ValueError(f"URL has no host: {url!r}")
    return url


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

async def run(
    project_id: str,
    website_url: Optional[str] = None,
    instagram_handle: Optional[str] = None,
    facebook_url: Optional[str] = None,
    tiktok_url: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    x_url: Optional[str] = None,
    youtube_url: Optional[str] = None,
    threads_url: Optional[str] = None,
) -> AsyncIterator[dict]:
    """
    Async generator that drives the multi-platform brand ingestion pipeline:
      1. Website scraping via Firecrawl
      2. Instagram scraping via Apify
      3. Facebook, TikTok, LinkedIn, X, YouTube, Threads scraping via Apify (optional)
      4. Brand Core extraction via Claude
      5. Persist to Firestore

    At least one source must be provided.
    """
    has_any = any([
        website_url, instagram_handle, facebook_url,
        tiktok_url, linkedin_url, x_url, youtube_url, threads_url,
    ])
    if not has_any:
        yield _error("Provide at least a website URL or one social media link.")
        return

    # Validate website URL if provided
    if website_url:
        try:
            website_url = _validate_url(website_url)
        except ValueError as exc:
            yield _error(str(exc))
            return

    # Normalise Instagram handle
    if instagram_handle:
        instagram_handle = instagram_handle.lstrip("@").strip()
        if not instagram_handle:
            yield _error("Instagram handle cannot be empty after normalisation.")
            return

    firebase_service.update_project(project_id, {"ingestionStatus": "processing"})

    scraped_data: list[dict] = []

    # Count total sources to weight progress bar
    sources = [
        s for s in [website_url, instagram_handle, facebook_url, tiktok_url, linkedin_url, x_url, youtube_url, threads_url]
        if s
    ]
    n = max(len(sources), 1)
    # Progress: 0-60 for scraping, 60-95 for extraction, 95-100 for save
    progress_per_source = 60 // n
    current_progress = 0

    # -----------------------------------------------------------------------
    # Step 1 - Website
    # -----------------------------------------------------------------------
    if website_url:
        yield _step("Scraping website…", "running")
        yield _progress(current_progress + 5)

        if not settings.FIRECRAWL_API_KEY:
            yield _step("Website scraping skipped", "skipped", "FIRECRAWL_API_KEY not configured")
        else:
            try:
                result = await firecrawl_client.scrape_url(website_url, settings.FIRECRAWL_API_KEY)
                scraped_data.append(result)
                yield _step("Website content extracted", "done")
            except Exception as exc:
                logger.warning("Website scrape failed: %s", exc)
                yield _step("Website scraping failed", "error", str(exc)[:120])

        current_progress += progress_per_source
        yield _progress(current_progress)

    # -----------------------------------------------------------------------
    # Step 2 - Instagram
    # -----------------------------------------------------------------------
    if instagram_handle:
        yield _step(f"Scraping Instagram @{instagram_handle}…", "running")

        if not settings.APIFY_API_KEY:
            yield _step("Instagram skipped", "skipped", "APIFY_API_KEY not configured")
        else:
            try:
                result = await apify_client.scrape_instagram(
                    instagram_handle, settings.APIFY_API_KEY, max_posts=30
                )
                scraped_data.append(result)
                yield _step("Instagram content extracted", "done")
            except Exception as exc:
                logger.warning("Instagram scrape failed: %s", exc)
                yield _step("Instagram scraping failed", "error", str(exc)[:120])

        current_progress += progress_per_source
        yield _progress(current_progress)

    # -----------------------------------------------------------------------
    # Step 3 - Facebook
    # -----------------------------------------------------------------------
    if facebook_url:
        yield _step("Scraping Facebook page…", "running")

        if not settings.APIFY_API_KEY:
            yield _step("Facebook skipped", "skipped", "APIFY_API_KEY not configured")
        else:
            try:
                result = await apify_client.scrape_facebook(facebook_url, settings.APIFY_API_KEY)
                if result.get("raw_text") or result.get("about"):
                    scraped_data.append(result)
                yield _step("Facebook content extracted", "done")
            except Exception as exc:
                logger.warning("Facebook scrape failed: %s", exc)
                yield _step("Facebook scraping failed", "error", str(exc)[:120])

        current_progress += progress_per_source
        yield _progress(current_progress)

    # -----------------------------------------------------------------------
    # Step 4 - TikTok
    # -----------------------------------------------------------------------
    if tiktok_url:
        yield _step("Scraping TikTok profile…", "running")

        if not settings.APIFY_API_KEY:
            yield _step("TikTok skipped", "skipped", "APIFY_API_KEY not configured")
        else:
            try:
                result = await apify_client.scrape_tiktok(tiktok_url, settings.APIFY_API_KEY)
                if result.get("raw_text") or result.get("bio"):
                    scraped_data.append(result)
                yield _step("TikTok content extracted", "done")
            except Exception as exc:
                logger.warning("TikTok scrape failed: %s", exc)
                yield _step("TikTok scraping failed", "error", str(exc)[:120])

        current_progress += progress_per_source
        yield _progress(current_progress)

    # -----------------------------------------------------------------------
    # Step 5 - LinkedIn
    # -----------------------------------------------------------------------
    if linkedin_url:
        yield _step("Scraping LinkedIn company…", "running")

        if not settings.APIFY_API_KEY:
            yield _step("LinkedIn skipped", "skipped", "APIFY_API_KEY not configured")
        else:
            try:
                result = await apify_client.scrape_linkedin(linkedin_url, settings.APIFY_API_KEY)
                if result.get("raw_text") or result.get("description"):
                    scraped_data.append(result)
                yield _step("LinkedIn content extracted", "done")
            except Exception as exc:
                logger.warning("LinkedIn scrape failed: %s", exc)
                yield _step("LinkedIn scraping failed", "error", str(exc)[:120])

        current_progress += progress_per_source
        yield _progress(current_progress)

    # -----------------------------------------------------------------------
    # Step 6 - X / Twitter
    # -----------------------------------------------------------------------
    if x_url:
        yield _step("Scraping X/Twitter profile…", "running")

        if not settings.APIFY_API_KEY:
            yield _step("X/Twitter skipped", "skipped", "APIFY_API_KEY not configured")
        else:
            try:
                result = await apify_client.scrape_x(x_url, settings.APIFY_API_KEY)
                if result.get("raw_text") or result.get("bio"):
                    scraped_data.append(result)
                yield _step("X/Twitter content extracted", "done")
            except Exception as exc:
                logger.warning("X/Twitter scrape failed: %s", exc)
                yield _step("X/Twitter scraping failed", "error", str(exc)[:120])

        current_progress += progress_per_source
        yield _progress(current_progress)

    # -----------------------------------------------------------------------
    # Step 7 - YouTube
    # -----------------------------------------------------------------------
    if youtube_url:
        yield _step("Scraping YouTube channel…", "running")

        if not settings.APIFY_API_KEY:
            yield _step("YouTube skipped", "skipped", "APIFY_API_KEY not configured")
        else:
            try:
                result = await apify_client.scrape_youtube(youtube_url, settings.APIFY_API_KEY)
                if result.get("raw_text") or result.get("description"):
                    scraped_data.append(result)
                yield _step("YouTube content extracted", "done")
            except Exception as exc:
                logger.warning("YouTube scrape failed: %s", exc)
                yield _step("YouTube scraping failed", "error", str(exc)[:120])

        current_progress += progress_per_source
        yield _progress(current_progress)

    # -----------------------------------------------------------------------
    # Step 8 - Threads
    # -----------------------------------------------------------------------
    if threads_url:
        yield _step("Scraping Threads profile…", "running")

        if not settings.APIFY_API_KEY:
            yield _step("Threads skipped", "skipped", "APIFY_API_KEY not configured")
        else:
            try:
                result = await apify_client.scrape_threads(threads_url, settings.APIFY_API_KEY)
                if result.get("raw_text") or result.get("bio"):
                    scraped_data.append(result)
                yield _step("Threads content extracted", "done")
            except Exception as exc:
                logger.warning("Threads scrape failed: %s", exc)
                yield _step("Threads scraping failed", "error", str(exc)[:120])

        current_progress += progress_per_source
        yield _progress(current_progress)

    # -----------------------------------------------------------------------
    # Step 9 - Web enrichment via Exa (competitor discovery + similar brands)
    # Runs only when website_url is available and EXA_API_KEY is configured.
    # Non-blocking: failures are logged and skipped, never fatal.
    # -----------------------------------------------------------------------
    if website_url and settings.EXA_API_KEY:
        yield _step("Discovering similar brands & competitors…", "running")
        try:
            from backend.services.integrations import exa_client
            from urllib.parse import urlparse
            brand_domain = urlparse(website_url).netloc

            similar = await exa_client.find_similar(
                url=website_url,
                num_results=8,
                exclude_domains=[brand_domain],
            )

            if similar:
                enriched_urls = [r["url"] for r in similar[:3] if r.get("url")]
                if enriched_urls:
                    try:
                        contents = await exa_client.get_contents(enriched_urls, max_chars=2000)
                        for item in contents:
                            if item.get("text"):
                                scraped_data.append({
                                    "source_type": "web_enrichment",
                                    "url": item.get("url", ""),
                                    "title": item.get("title", ""),
                                    "content": item.get("text", ""),
                                })
                    except Exception as exc:
                        logger.debug("Exa get_contents failed (non-fatal): %s", exc)

                yield _step(f"Web enrichment complete ({len(similar)} similar brands found)", "done")
            else:
                yield _step("Web enrichment complete", "done")

        except Exception as exc:
            logger.warning("Web enrichment step failed (non-fatal): %s", exc)
            yield _step("Web enrichment skipped", "skipped", str(exc)[:80])

    # -----------------------------------------------------------------------
    # Guard - bail if no data was collected
    # -----------------------------------------------------------------------
    if not scraped_data:
        firebase_service.update_project(project_id, {"ingestionStatus": "error"})
        yield _error(
            "No content could be scraped. "
            "Check your URLs and ensure FIRECRAWL_API_KEY / APIFY_API_KEY are set."
        )
        return

    # -----------------------------------------------------------------------
    # Step N+1 - Brand Core extraction via Claude
    # -----------------------------------------------------------------------
    if not settings.ANTHROPIC_API_KEY:
        firebase_service.update_project(project_id, {"ingestionStatus": "error"})
        yield _error("ANTHROPIC_API_KEY is not set - cannot extract Brand Core.")
        return

    yield _step("Analysing brand tone & voice…", "running")
    yield _progress(65)

    try:
        yield _step("Detecting colour palette & visual identity…", "running")
        yield _progress(75)

        brand_core = await brand_extractor.extract_brand_core(scraped_data, settings.ANTHROPIC_API_KEY)

        yield _step("Identifying content themes…", "running")
        yield _progress(85)

        yield _step("Building Brand Core…", "running")
        yield _progress(92)

    except Exception as exc:
        logger.error("Brand extraction failed for project %s: %s", project_id, exc)
        firebase_service.update_project(project_id, {"ingestionStatus": "error"})
        yield _error(f"Brand Core extraction failed: {exc}")
        return

    # -----------------------------------------------------------------------
    # Final - Persist to Firestore
    # -----------------------------------------------------------------------
    try:
        firebase_service.update_project(project_id, {
            "brandCore": brand_core,
            "ingestionStatus": "complete",
        })
        yield _step("Brand Core saved", "done")
        yield _progress(100)
    except Exception as exc:
        logger.error("Firestore save failed for project %s: %s", project_id, exc)
        yield _error(f"Failed to save Brand Core: {exc}")
        return

    yield _done(brand_core)
