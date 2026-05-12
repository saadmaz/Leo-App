"""
Brand Core extractor - sends scraped content to Gemini and parses back a
structured BrandCore JSON object.

Uses the shared Gemini client from llm_service so we maintain a single
google-genai Client instance per process (avoids connection pool fragmentation).
The extraction model is configured separately from the chat model because
extraction is a one-shot, non-streamed call that can use a smaller/cheaper
model without sacrificing quality.
"""

import json
import logging
import re
from typing import Any

from backend.config import settings
from backend.services.llm_service import get_gemini_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt for the extraction call
# ---------------------------------------------------------------------------

EXTRACTION_SYSTEM = """\
You are a brand intelligence analyst. You will receive raw content scraped from a brand's
digital presence (website, Instagram captions, bio, etc.) and must extract a structured
Brand Core profile.

Return ONLY a valid JSON object - no markdown fences, no explanation, nothing else.
The JSON must match this exact schema:

{
  "tone": {
    "style": "string - e.g. 'playful', 'authoritative', 'conversational'",
    "formality": "string - 'informal' | 'semi-formal' | 'formal'",
    "keyPhrases": ["up to 6 recurring phrases or slogans"],
    "avoidedLanguage": ["up to 4 words/phrases the brand avoids or dislikes"]
  },
  "visual": {
    "primaryColour": "HEX code e.g. #1A73E8 - best guess from content or null",
    "secondaryColours": ["up to 4 HEX codes or empty array"],
    "fonts": ["font names detected or empty array"],
    "imageStyle": "string - e.g. 'clean product photography', 'bold lifestyle', 'minimalist'"
  },
  "themes": ["up to 8 recurring content themes or topics"],
  "tagline": "string - the brand's primary tagline or null",
  "messaging": {
    "valueProp": "string - core value proposition in one sentence",
    "keyClaims": ["up to 5 key brand claims or benefits"]
  },
  "audience": {
    "demographics": "string - age range, gender, income, location if detectable",
    "interests": ["up to 6 interest or lifestyle categories"]
  },
  "competitors": ["up to 5 competitor brand names if mentioned or inferable"]
}

Rules:
- If a field cannot be determined from the content, use null for strings and [] for arrays.
- Infer colours from hex codes mentioned, CSS colour names, or explicit mentions.
- Extract real phrases verbatim from captions/copy - do not invent.
- Be concise: value propositions should be 1 sentence, themes should be 2-4 words each.
"""

# Maximum characters of combined scraped content sent to the LLM.
# Keeps the prompt within a safe token budget while preserving most signal.
_MAX_CONTENT_CHARS = 12_000


async def extract_brand_core(scraped_data: list[dict], api_key: str) -> dict:
    """
    Analyse scraped brand content and return a structured BrandCore dict.

    Args:
        scraped_data: List of dicts produced by firecrawl_client and/or
                      apify_client. Each dict must have a 'source_type' key.
        api_key:      Accepted for backwards-compatibility but ignored.
                      The function always uses the shared Gemini client which
                      reads GEMINI_API_KEY from settings.

    Returns:
        A BrandCore dict matching the schema in EXTRACTION_SYSTEM.
        On JSON parse failure, returns a minimal valid skeleton so callers
        always receive a usable dict (logged as an error).
    """
    combined = _build_combined_content(scraped_data)
    logger.info("Brand extractor: sending %d chars to Gemini (%s)", len(combined), settings.LLM_EXTRACTION_MODEL)

    from google.genai import types as genai_types

    # Re-use the shared singleton rather than spawning a new connection pool.
    client = get_gemini_client()

    response = await client.aio.models.generate_content(
        model=settings.LLM_EXTRACTION_MODEL,
        contents=(
            "Here is the brand content to analyse:\n\n"
            f"{combined[:_MAX_CONTENT_CHARS]}"
        ),
        config=genai_types.GenerateContentConfig(
            system_instruction=EXTRACTION_SYSTEM,
            max_output_tokens=2048,
        ),
    )

    raw = response.text.strip()
    brand_core = _parse_json(raw)
    logger.info("Brand extractor: extraction complete")
    return brand_core


# ---------------------------------------------------------------------------
# Content assembly
# ---------------------------------------------------------------------------

def _build_combined_content(scraped_data: list[dict]) -> str:
    """
    Assemble a single readable text block from all scraped sources.
    Each source is wrapped in a clearly labelled section so Claude can
    distinguish website copy from Instagram captions.
    """
    sections: list[str] = []

    for source in scraped_data:
        src_type = source.get("source_type", "unknown")

        if src_type == "website":
            meta = source.get("metadata", {})
            extract = source.get("extract", {})
            markdown = source.get("markdown", "")

            header = f"=== WEBSITE: {source.get('source_url', '')} ===\n"
            if meta.get("title"):
                header += f"Title: {meta['title']}\n"
            if meta.get("description"):
                header += f"Meta description: {meta['description']}\n"
            if extract:
                # Firecrawl's structured extract (brand name, tone, colours, etc.)
                header += f"Extracted insights: {json.dumps(extract, ensure_ascii=False)}\n"
            # Cap per-source markdown to keep total within _MAX_CONTENT_CHARS.
            header += f"\nContent:\n{markdown[:4000]}\n"
            sections.append(header)

        elif src_type == "instagram":
            profile = source.get("profile", {})
            captions = source.get("raw_captions", "")

            header = f"=== INSTAGRAM: @{source.get('handle', '')} ===\n"
            if profile.get("biography"):
                header += f"Bio: {profile['biography']}\n"
            if profile.get("full_name"):
                header += f"Full name: {profile['full_name']}\n"
            if profile.get("category"):
                header += f"Category: {profile['category']}\n"
            if captions:
                header += f"\nRecent captions:\n{captions[:4000]}\n"
            sections.append(header)

        elif src_type == "facebook":
            header = f"=== FACEBOOK: {source.get('url', '')} ===\n"
            if source.get("name"):
                header += f"Page name: {source['name']}\n"
            if source.get("about"):
                header += f"About: {source['about']}\n"
            if source.get("category"):
                header += f"Category: {source['category']}\n"
            raw = source.get("raw_text", "")
            if raw:
                header += f"\nRecent posts:\n{raw[:3000]}\n"
            sections.append(header)

        elif src_type == "tiktok":
            header = f"=== TIKTOK: {source.get('url', '')} ===\n"
            if source.get("author"):
                header += f"Creator: {source['author']}\n"
            if source.get("bio"):
                header += f"Bio: {source['bio']}\n"
            if source.get("top_hashtags"):
                header += f"Top hashtags: {', '.join(source['top_hashtags'][:15])}\n"
            raw = source.get("raw_text", "")
            if raw:
                header += f"\nVideo descriptions:\n{raw[:3000]}\n"
            sections.append(header)

        elif src_type == "linkedin":
            header = f"=== LINKEDIN: {source.get('url', '')} ===\n"
            if source.get("name"):
                header += f"Company: {source['name']}\n"
            if source.get("tagline"):
                header += f"Tagline: {source['tagline']}\n"
            if source.get("description"):
                header += f"Description: {source['description'][:800]}\n"
            if source.get("industry"):
                header += f"Industry: {source['industry']}\n"
            raw = source.get("raw_text", "")
            if raw:
                header += f"\nRecent posts:\n{raw[:2500]}\n"
            sections.append(header)

        elif src_type == "x":
            header = f"=== X/TWITTER: {source.get('url', '')} ===\n"
            if source.get("display_name"):
                header += f"Name: {source['display_name']}\n"
            if source.get("bio"):
                header += f"Bio: {source['bio']}\n"
            raw = source.get("raw_text", "")
            if raw:
                header += f"\nRecent tweets:\n{raw[:3000]}\n"
            sections.append(header)

        elif src_type == "youtube":
            header = f"=== YOUTUBE: {source.get('url', '')} ===\n"
            if source.get("channel_name"):
                header += f"Channel: {source['channel_name']}\n"
            if source.get("description"):
                header += f"Description: {source['description'][:600]}\n"
            raw = source.get("raw_text", "")
            if raw:
                header += f"\nVideo titles & descriptions:\n{raw[:3000]}\n"
            sections.append(header)

        elif src_type == "web_enrichment":
            # Content from Exa findSimilar + get_contents - competitor/similar brand data
            header = f"=== WEB ENRICHMENT (Similar Brand): {source.get('url', '')} ===\n"
            if source.get("title"):
                header += f"Title: {source['title']}\n"
            content = source.get("content", "")
            if content:
                header += f"Content:\n{content[:2000]}\n"
            sections.append(header)

        else:
            logger.debug("Brand extractor: unknown source type %r - skipping", src_type)

    return "\n\n".join(sections)


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------

def _parse_json(raw: str) -> dict:
    """
    Parse Claude's response into a dict, stripping any accidental markdown fences.

    Claude occasionally wraps the JSON in ```json ... ``` even when instructed
    not to. This handles that gracefully. On parse failure, a minimal valid
    Brand Core skeleton is returned so the ingestion pipeline doesn't crash -
    the calling pipeline logs this as an error and the UI shows whatever
    partial data was extracted.
    """
    # Strip ```json ... ``` or ``` ... ``` wrappers.
    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)

    try:
        return json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        logger.error(
            "Brand extractor: JSON parse failed - %s\nRaw response (first 500 chars): %s",
            exc, raw[:500]
        )
        # Return a minimal skeleton so the pipeline can continue and save
        # whatever partial data exists rather than failing completely.
        return {
            "tone": None,
            "visual": None,
            "themes": [],
            "tagline": None,
            "messaging": None,
            "audience": None,
            "competitors": [],
        }
