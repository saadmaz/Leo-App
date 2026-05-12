"""
Unit tests for backend.services.ingestion.brand_extractor

These tests cover the pure Python functions (_parse_json, _build_combined_content)
without making any network calls. The Claude API call in extract_brand_core() is
tested via a mock.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.services.ingestion.brand_extractor import (
    _build_combined_content,
    _parse_json,
    extract_brand_core,
    _MAX_CONTENT_CHARS,
)


# ---------------------------------------------------------------------------
# _parse_json
# ---------------------------------------------------------------------------

class TestParseJson:
    def test_valid_json(self):
        raw = '{"tone": {"style": "playful"}, "themes": ["sustainability"]}'
        result = _parse_json(raw)
        assert result["tone"]["style"] == "playful"
        assert result["themes"] == ["sustainability"]

    def test_strips_json_fence(self):
        raw = '```json\n{"tagline": "Just do it"}\n```'
        result = _parse_json(raw)
        assert result["tagline"] == "Just do it"

    def test_strips_plain_fence(self):
        raw = '```\n{"tagline": "Think different"}\n```'
        result = _parse_json(raw)
        assert result["tagline"] == "Think different"

    def test_returns_skeleton_on_invalid_json(self):
        result = _parse_json("this is not json at all")
        # Must return the minimal skeleton rather than raising.
        assert isinstance(result, dict)
        assert "tone" in result
        assert "themes" in result
        assert result["themes"] == []

    def test_skeleton_has_all_required_keys(self):
        result = _parse_json("{bad json")
        for key in ("tone", "visual", "themes", "tagline", "messaging", "audience", "competitors"):
            assert key in result, f"Key {key!r} missing from fallback skeleton"

    def test_whitespace_around_json(self):
        raw = '   \n  {"tagline": "hello"}  \n  '
        result = _parse_json(raw)
        assert result["tagline"] == "hello"


# ---------------------------------------------------------------------------
# _build_combined_content
# ---------------------------------------------------------------------------

class TestBuildCombinedContent:
    def test_website_source(self):
        sources = [{
            "source_type": "website",
            "source_url": "https://example.com",
            "metadata": {"title": "Example Co", "description": "We do things"},
            "extract": {"brand_name": "Example"},
            "markdown": "# Welcome\nWe make great stuff.",
        }]
        result = _build_combined_content(sources)
        assert "WEBSITE: https://example.com" in result
        assert "Title: Example Co" in result
        assert "We make great stuff." in result

    def test_instagram_source(self):
        sources = [{
            "source_type": "instagram",
            "handle": "testbrand",
            "profile": {"biography": "We love coffee ☕", "full_name": "Test Brand"},
            "raw_captions": "Morning vibes\n\n---\n\nFriday feeling",
        }]
        result = _build_combined_content(sources)
        assert "INSTAGRAM: @testbrand" in result
        assert "We love coffee" in result
        assert "Morning vibes" in result

    def test_multiple_sources_joined(self):
        sources = [
            {"source_type": "website", "source_url": "https://a.com",
             "metadata": {}, "extract": {}, "markdown": "website content"},
            {"source_type": "instagram", "handle": "a_brand",
             "profile": {}, "raw_captions": "caption text"},
        ]
        result = _build_combined_content(sources)
        assert "WEBSITE" in result
        assert "INSTAGRAM" in result
        # Two sections joined by double newlines
        assert "\n\n" in result

    def test_unknown_source_type_skipped(self):
        sources = [{"source_type": "tiktok", "data": "something"}]
        result = _build_combined_content(sources)
        # Unknown source types produce no output sections.
        assert result == ""

    def test_empty_list(self):
        assert _build_combined_content([]) == ""

    def test_markdown_capped_per_source(self):
        long_markdown = "x" * 10_000
        sources = [{
            "source_type": "website",
            "source_url": "https://big.com",
            "metadata": {},
            "extract": {},
            "markdown": long_markdown,
        }]
        result = _build_combined_content(sources)
        # Per-source cap is 4000 chars of markdown.
        assert long_markdown[4001:] not in result


# ---------------------------------------------------------------------------
# extract_brand_core (integration - mocked Anthropic client)
# ---------------------------------------------------------------------------

VALID_BRAND_CORE_JSON = json.dumps({
    "tone": {"style": "friendly", "formality": "informal", "keyPhrases": [], "avoidedLanguage": []},
    "visual": {"primaryColour": "#FF0000", "secondaryColours": [], "fonts": [], "imageStyle": "bold"},
    "themes": ["sustainability", "innovation"],
    "tagline": "Better every day",
    "messaging": {"valueProp": "We simplify your life.", "keyClaims": []},
    "audience": {"demographics": "25-40 adults", "interests": ["tech"]},
    "competitors": [],
})


@pytest.mark.asyncio
async def test_extract_brand_core_success():
    """extract_brand_core should call the LLM and return a parsed dict."""
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text=VALID_BRAND_CORE_JSON)]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_message)

    with patch("backend.services.ingestion.brand_extractor.get_client", return_value=mock_client):
        result = await extract_brand_core(
            scraped_data=[{
                "source_type": "website",
                "source_url": "https://example.com",
                "metadata": {"title": "Example"},
                "extract": {},
                "markdown": "Some page content",
            }],
            api_key="test-key",
        )

    assert result["tagline"] == "Better every day"
    assert result["tone"]["style"] == "friendly"
    mock_client.messages.create.assert_called_once()


@pytest.mark.asyncio
async def test_extract_brand_core_bad_json_returns_skeleton():
    """If Claude returns invalid JSON, extract_brand_core must return a skeleton (not raise)."""
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text="Sorry, I cannot help with that.")]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_message)

    with patch("backend.services.ingestion.brand_extractor.get_client", return_value=mock_client):
        result = await extract_brand_core(scraped_data=[], api_key="test-key")

    # Must not raise; must return the minimal skeleton.
    assert isinstance(result, dict)
    assert result["themes"] == []


@pytest.mark.asyncio
async def test_extract_brand_core_truncates_content():
    """Content exceeding _MAX_CONTENT_CHARS should be truncated before sending."""
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text=VALID_BRAND_CORE_JSON)]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_message)

    huge_markdown = "a" * (_MAX_CONTENT_CHARS * 3)
    scraped = [{
        "source_type": "website",
        "source_url": "https://huge.com",
        "metadata": {},
        "extract": {},
        "markdown": huge_markdown,
    }]

    with patch("backend.services.ingestion.brand_extractor.get_client", return_value=mock_client):
        await extract_brand_core(scraped_data=scraped, api_key="test-key")

    # Verify the content sent to the LLM was capped.
    call_args = mock_client.messages.create.call_args
    user_content = call_args.kwargs["messages"][0]["content"]
    assert len(user_content) <= _MAX_CONTENT_CHARS + 100  # small slack for the prefix string
