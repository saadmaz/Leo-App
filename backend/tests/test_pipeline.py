"""
Unit tests for backend.services.ingestion.pipeline

Tests validate the orchestration logic (step sequencing, error handling,
URL validation) without hitting any external APIs. All I/O is mocked.
"""

import pytest
from unittest.mock import AsyncMock, patch

from backend.services.ingestion.pipeline import _validate_url, run


# ---------------------------------------------------------------------------
# _validate_url
# ---------------------------------------------------------------------------

class TestValidateUrl:
    def test_valid_https(self):
        assert _validate_url("https://example.com") == "https://example.com"

    def test_valid_http(self):
        assert _validate_url("http://example.com/path") == "http://example.com/path"

    def test_rejects_ftp(self):
        with pytest.raises(ValueError, match="Invalid URL scheme"):
            _validate_url("ftp://example.com")

    def test_rejects_no_scheme(self):
        with pytest.raises(ValueError):
            _validate_url("example.com")

    def test_rejects_empty_host(self):
        with pytest.raises(ValueError, match="no host"):
            _validate_url("https://")

    def test_preserves_path_and_query(self):
        url = "https://example.com/about?ref=leo"
        assert _validate_url(url) == url


# ---------------------------------------------------------------------------
# Helpers - shared mock builders
# ---------------------------------------------------------------------------

FAKE_WEBSITE_DATA = {
    "source_type": "website",
    "source_url": "https://example.com",
    "metadata": {"title": "Example"},
    "extract": {},
    "markdown": "Some content",
}

FAKE_INSTAGRAM_DATA = {
    "source_type": "instagram",
    "handle": "examplebrand",
    "profile": {"biography": "We make things"},
    "raw_captions": "Great product\n\n---\n\nBuy now",
}

FAKE_BRAND_CORE = {
    "tone": {"style": "playful"},
    "themes": ["innovation"],
    "tagline": "Think big",
}


def _patch_all(
    firecrawl_result=None,
    apify_result=None,
    brand_core_result=None,
    firecrawl_raises=None,
    apify_raises=None,
    brand_raises=None,
):
    """Return a dict of patch context managers for all external pipeline dependencies."""
    fc = AsyncMock(return_value=firecrawl_result or FAKE_WEBSITE_DATA)
    if firecrawl_raises:
        fc.side_effect = firecrawl_raises

    ap = AsyncMock(return_value=apify_result or FAKE_INSTAGRAM_DATA)
    if apify_raises:
        ap.side_effect = apify_raises

    bc = AsyncMock(return_value=brand_core_result or FAKE_BRAND_CORE)
    if brand_raises:
        bc.side_effect = brand_raises

    fs = AsyncMock()  # firebase_service.update_project

    return {
        "firecrawl": patch("backend.services.ingestion.pipeline.firecrawl_client.scrape_url", fc),
        "apify": patch("backend.services.ingestion.pipeline.apify_client.scrape_instagram", ap),
        "extractor": patch("backend.services.ingestion.pipeline.brand_extractor.extract_brand_core", bc),
        "firebase": patch("backend.services.ingestion.pipeline.firebase_service.update_project", fs),
        "settings_fc": patch("backend.services.ingestion.pipeline.settings.FIRECRAWL_API_KEY", "key"),
        "settings_ap": patch("backend.services.ingestion.pipeline.settings.APIFY_API_KEY", "key"),
        "settings_llm": patch("backend.services.ingestion.pipeline.settings.ANTHROPIC_API_KEY", "key"),
    }


async def _collect(gen):
    """Drain an async generator into a list."""
    return [item async for item in gen]


# ---------------------------------------------------------------------------
# Happy paths
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_website_only_success():
    patches = _patch_all()
    with patches["firecrawl"], patches["extractor"], patches["firebase"], \
         patches["settings_fc"], patches["settings_llm"]:
        events = await _collect(run("proj1", "https://example.com", None))

    types = [e["type"] for e in events]
    assert "done" in types
    assert "error" not in types
    done_event = next(e for e in events if e["type"] == "done")
    assert done_event["brandCore"] == FAKE_BRAND_CORE


@pytest.mark.asyncio
async def test_instagram_only_success():
    patches = _patch_all()
    with patches["apify"], patches["extractor"], patches["firebase"], \
         patches["settings_ap"], patches["settings_llm"]:
        events = await _collect(run("proj1", None, "examplebrand"))

    types = [e["type"] for e in events]
    assert "done" in types
    assert "error" not in types


@pytest.mark.asyncio
async def test_both_sources_success():
    patches = _patch_all()
    with patches["firecrawl"], patches["apify"], patches["extractor"], \
         patches["firebase"], patches["settings_fc"], patches["settings_ap"], \
         patches["settings_llm"]:
        events = await _collect(run("proj1", "https://example.com", "examplebrand"))

    types = [e["type"] for e in events]
    assert "done" in types


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_no_sources_yields_error():
    events = await _collect(run("proj1", None, None))
    assert events[0]["type"] == "error"
    assert "URL" in events[0]["message"] or "handle" in events[0]["message"]


@pytest.mark.asyncio
async def test_invalid_url_yields_error():
    events = await _collect(run("proj1", "ftp://bad.com", None))
    assert events[0]["type"] == "error"
    assert "scheme" in events[0]["message"].lower() or "invalid" in events[0]["message"].lower()


# ---------------------------------------------------------------------------
# Graceful degradation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_firecrawl_failure_continues_to_extraction_if_instagram_provided():
    """If website scraping fails but Instagram is provided, extraction should still run."""
    patches = _patch_all(firecrawl_raises=RuntimeError("timeout"))
    with patches["firecrawl"], patches["apify"], patches["extractor"], \
         patches["firebase"], patches["settings_fc"], patches["settings_ap"], \
         patches["settings_llm"]:
        events = await _collect(run("proj1", "https://example.com", "examplebrand"))

    types = [e["type"] for e in events]
    # Website step fails but the pipeline should recover and produce a done event.
    step_errors = [e for e in events if e["type"] == "step" and e["status"] == "error"]
    assert any("website" in s["label"].lower() or "scraping" in s["label"].lower() for s in step_errors)
    assert "done" in types


@pytest.mark.asyncio
async def test_both_sources_fail_yields_terminal_error():
    """If both scrapers fail, no data → terminal error event."""
    patches = _patch_all(
        firecrawl_raises=RuntimeError("fc down"),
        apify_raises=RuntimeError("ap down"),
    )
    with patches["firecrawl"], patches["apify"], patches["extractor"], \
         patches["firebase"], patches["settings_fc"], patches["settings_ap"], \
         patches["settings_llm"]:
        events = await _collect(run("proj1", "https://example.com", "examplebrand"))

    types = [e["type"] for e in events]
    assert "error" in types
    assert "done" not in types


@pytest.mark.asyncio
async def test_missing_firecrawl_key_skips_website():
    """If FIRECRAWL_API_KEY is not set, the website step should be skipped (not error)."""
    patches = _patch_all()
    with patches["apify"], patches["extractor"], patches["firebase"], \
         patch("backend.services.ingestion.pipeline.settings.FIRECRAWL_API_KEY", None), \
         patches["settings_ap"], patches["settings_llm"]:
        events = await _collect(run("proj1", "https://example.com", "examplebrand"))

    skipped = [e for e in events if e.get("status") == "skipped"]
    assert skipped, "Expected a 'skipped' step when FIRECRAWL_API_KEY is missing"


@pytest.mark.asyncio
async def test_brand_extraction_failure_yields_error():
    """If Claude extraction fails, the pipeline should yield an error (not crash)."""
    patches = _patch_all(brand_raises=RuntimeError("anthropic 500"))
    with patches["firecrawl"], patches["extractor"], patches["firebase"], \
         patches["settings_fc"], patches["settings_llm"]:
        events = await _collect(run("proj1", "https://example.com", None))

    types = [e["type"] for e in events]
    assert "error" in types
    assert "done" not in types


# ---------------------------------------------------------------------------
# Progress events
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_progress_events_are_emitted():
    patches = _patch_all()
    with patches["firecrawl"], patches["extractor"], patches["firebase"], \
         patches["settings_fc"], patches["settings_llm"]:
        events = await _collect(run("proj1", "https://example.com", None))

    progress = [e for e in events if e["type"] == "progress"]
    assert progress, "Expected at least one progress event"
    pcts = [e["pct"] for e in progress]
    assert pcts[-1] == 100, "Final progress should be 100"
    # Progress should be non-decreasing.
    assert pcts == sorted(pcts), "Progress percentages should be non-decreasing"
