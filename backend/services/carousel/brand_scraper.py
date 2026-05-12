"""
Carousel Studio - Brand Scraping Pipeline

Runs silently in the background before intake questions are shown.
Yields SSE-compatible event dicts that the carousel route streams to the client.

Event shapes:
  { "type": "step",  "message": "...", "done": false }
  { "type": "step",  "message": "...", "done": true  }
  { "type": "done",  "brand_profile": { ... } }
  { "type": "error", "message": "..." }

Steps:
  1. Brandfetch - logos, colours
  2. Brand.dev  - typography roles, full palette
  3. Firecrawl  - homepage + about text
  4. Claude     - tone analysis
  5. Apify      - Instagram last 12 posts (content type + aesthetic)
"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator, Optional
from urllib.parse import urlparse

import httpx

from backend.config import settings
from backend.services.ingestion import firecrawl_client, apify_client
from backend.services import llm_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _step(message: str, done: bool = False) -> dict:
    return {"type": "step", "message": message, "done": done}


def _domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path
    return host.lstrip("www.").split("/")[0]


def _hex_from_brandfetch(colors: list[dict]) -> tuple[str, str, str]:
    """Extract primary, secondary, background hex from Brandfetch colour list."""
    primary = secondary = bg = "#6366f1"
    for c in colors:
        c_type = c.get("type", "")
        hexes = [f.get("hex", "") for f in c.get("colors", []) if f.get("hex")]
        if not hexes:
            continue
        if c_type == "brand" and primary == "#6366f1":
            primary = hexes[0]
        elif c_type == "accent" and secondary == "#6366f1":
            secondary = hexes[0]
        elif c_type == "background" and bg == "#6366f1":
            bg = hexes[0]
    if secondary == "#6366f1":
        secondary = primary
    if bg == "#6366f1":
        # derive a light background from primary
        bg = "#FFFFFF"
    return primary, secondary, bg


def _parse_instagram_content_type(posts: list[dict]) -> str:
    """Heuristic: classify dominant content type from caption keywords."""
    buckets = {
        "educational": ["tip", "how to", "learn", "guide", "step", "tutorial", "101"],
        "product": ["launch", "new", "available", "shop", "buy", "get yours", "order"],
        "lifestyle": ["life", "vibe", "mood", "feel", "love", "moment", "day"],
        "quote": ['"', "said", "quote", "words", "inspire", "motivation"],
        "behind-scenes": ["team", "behind", "making of", "bts", "office", "meet"],
    }
    counts: dict[str, int] = {k: 0 for k in buckets}
    for post in posts[:12]:
        caption = (post.get("caption") or "").lower()
        for bucket, keywords in buckets.items():
            if any(kw in caption for kw in keywords):
                counts[bucket] += 1
    return max(counts, key=lambda k: counts[k]) if any(counts.values()) else "educational"


# ---------------------------------------------------------------------------
# Step 1: Brandfetch
# ---------------------------------------------------------------------------

async def _fetch_brandfetch(domain: str) -> dict:
    if not settings.BRANDFETCH_API_KEY:
        return {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.brandfetch.io/v2/brands/{domain}",
                headers={"Authorization": f"Bearer {settings.BRANDFETCH_API_KEY}"},
            )
            if resp.status_code != 200:
                logger.warning("Brandfetch returned %d for %s", resp.status_code, domain)
                return {}
            return resp.json()
    except Exception as exc:
        logger.warning("Brandfetch error for %s: %s", domain, exc)
        return {}


# ---------------------------------------------------------------------------
# Step 2: Brand.dev
# ---------------------------------------------------------------------------

async def _fetch_brand_dev(domain: str) -> dict:
    if not settings.BRAND_DEV_API_KEY:
        return {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.brand.dev/v1/brand",
                params={"domain": domain},
                headers={"Authorization": f"Bearer {settings.BRAND_DEV_API_KEY}"},
            )
            if resp.status_code != 200:
                logger.warning("Brand.dev returned %d for %s", resp.status_code, domain)
                return {}
            return resp.json()
    except Exception as exc:
        logger.warning("Brand.dev error for %s: %s", domain, exc)
        return {}


# ---------------------------------------------------------------------------
# Step 4: Claude tone analysis
# ---------------------------------------------------------------------------

async def _analyse_tone(text: str) -> dict:
    """Ask Claude to return a brand tone profile as JSON."""
    if not text.strip():
        return {"tone": "professional", "formality": "semi-formal", "personality": ["modern"], "avoid_words": []}
    prompt = (
        "Analyse the brand voice from this website text and return ONLY valid JSON "
        "(no markdown, no explanation):\n"
        "{\n"
        '  "tone": "<3 words describing brand tone>",\n'
        '  "formality": "casual|semi-formal|formal",\n'
        '  "personality": ["<trait1>", "<trait2>", "<trait3>"],\n'
        '  "avoid_words": ["<word1>", "<word2>"]\n'
        "}\n\n"
        f"WEBSITE TEXT:\n{text[:4000]}"
    )
    try:
        client = llm_service.get_client()
        msg = await client.messages.create(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        # Strip possible markdown fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Tone analysis failed: %s", exc)
        return {"tone": "professional", "formality": "semi-formal", "personality": ["modern"], "avoid_words": []}


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

async def run(
    project_id: str,
    website_url: str,
    instagram_url: Optional[str] = None,
) -> AsyncIterator[dict]:
    """
    Async generator - yields step events then a final done event with brand_profile.
    """
    domain = _domain_from_url(website_url)
    brand_profile: dict = {
        "domain": domain,
        "primary_color": "#6366f1",
        "secondary_color": "#8b5cf6",
        "background_color": "#FFFFFF",
        "heading_font": "Plus Jakarta Sans",
        "body_font": "Plus Jakarta Sans",
        "tone": "professional and approachable",
        "formality": "semi-formal",
        "personality": ["modern", "trustworthy"],
        "avoid_words": [],
        "dominant_content_type": "educational",
        "instagram_aesthetic": "clean and minimal",
        "audience_signal": "professionals",
        "suggested_carousel_type": "educational",
    }

    # ── Step 1: Brandfetch ──────────────────────────────────────────────────
    yield _step("Reading your website...")
    bf_data = await _fetch_brandfetch(domain)
    if bf_data:
        colors = bf_data.get("colors", [])
        if colors:
            primary, secondary, bg = _hex_from_brandfetch(colors)
            brand_profile["primary_color"] = primary
            brand_profile["secondary_color"] = secondary
            brand_profile["background_color"] = bg

        fonts = bf_data.get("fonts", [])
        if fonts:
            brand_profile["heading_font"] = fonts[0].get("name", brand_profile["heading_font"])
            if len(fonts) > 1:
                brand_profile["body_font"] = fonts[1].get("name", brand_profile["body_font"])

        logos = bf_data.get("logos", [])
        for logo in logos:
            for fmt in logo.get("formats", []):
                if fmt.get("format") == "svg":
                    brand_profile["logo_url"] = fmt.get("src", "")
                    break
            if brand_profile.get("logo_url"):
                break
        if not brand_profile.get("logo_url") and logos:
            fmts = logos[0].get("formats", [])
            if fmts:
                brand_profile["logo_url"] = fmts[0].get("src", "")

    # ── Logo.dev fallback - if Brandfetch returned nothing ──────────────────
    if not brand_profile.get("logo_url") and settings.LOGO_DEV_API_KEY:
        brand_profile["logo_url"] = (
            f"https://img.logo.dev/{domain}"
            f"?token={settings.LOGO_DEV_API_KEY}&retina=true"
        )

    yield _step("Reading your website...", done=True)

    # ── Step 2: Brand.dev typography ────────────────────────────────────────
    yield _step("Extracting brand colours and fonts...")
    bd_data = await _fetch_brand_dev(domain)
    if bd_data:
        sg = bd_data.get("styleguide", bd_data.get("brand", {}).get("styleguide", {}))
        typo = sg.get("typography", {})
        h1_font = typo.get("h1", {}).get("fontFamily", "")
        p_font = typo.get("p", {}).get("fontFamily", "")
        if h1_font:
            brand_profile["heading_font"] = h1_font
        if p_font:
            brand_profile["body_font"] = p_font

        bd_colors = sg.get("colors", [])
        for c in bd_colors:
            role = c.get("role", "").lower()
            hex_val = c.get("hex", "")
            if hex_val:
                if role in ("primary", "brand") and brand_profile["primary_color"] == "#6366f1":
                    brand_profile["primary_color"] = hex_val
                elif role in ("secondary", "accent") and brand_profile["secondary_color"] == "#8b5cf6":
                    brand_profile["secondary_color"] = hex_val
                elif role in ("background", "bg") and brand_profile["background_color"] == "#FFFFFF":
                    brand_profile["background_color"] = hex_val

    yield _step("Extracting brand colours and fonts...", done=True)

    # ── Step 3: Firecrawl website text ──────────────────────────────────────
    website_text = ""
    try:
        about_url = website_url.rstrip("/") + "/about"
        pages = []
        if settings.FIRECRAWL_API_KEY:
            pages = await firecrawl_client.scrape_multiple(
                [website_url, about_url], settings.FIRECRAWL_API_KEY
            )
        for page in pages:
            website_text += page.get("markdown", "") + "\n"
            extract = page.get("extract", {})
            if extract.get("tagline"):
                brand_profile["tagline"] = extract["tagline"]
            if extract.get("target_audience"):
                brand_profile["audience_signal"] = extract["target_audience"]
    except Exception as exc:
        logger.warning("Firecrawl scrape failed: %s", exc)

    # ── Step 4: Tone analysis ────────────────────────────────────────────────
    yield _step("Understanding your brand voice...")
    tone_result = await _analyse_tone(website_text)
    brand_profile["tone"] = tone_result.get("tone", brand_profile["tone"])
    brand_profile["formality"] = tone_result.get("formality", brand_profile["formality"])
    brand_profile["personality"] = tone_result.get("personality", brand_profile["personality"])
    brand_profile["avoid_words"] = tone_result.get("avoid_words", brand_profile["avoid_words"])
    yield _step("Understanding your brand voice...", done=True)

    # ── Step 5: Instagram analysis ───────────────────────────────────────────
    yield _step("Analysing your Instagram content style...")
    if instagram_url and settings.APIFY_API_KEY:
        try:
            handle = instagram_url.rstrip("/").split("/")[-1].lstrip("@")
            ig_data = await apify_client.scrape_instagram(
                handle, settings.APIFY_API_KEY, max_posts=12
            )
            posts = ig_data.get("posts", [])
            if posts:
                brand_profile["dominant_content_type"] = _parse_instagram_content_type(posts)
                dominant = brand_profile["dominant_content_type"]
                aesthetic_map = {
                    "educational": "clean educational with text overlays",
                    "product": "product-focused with bright visuals",
                    "lifestyle": "warm lifestyle aesthetic",
                    "quote": "minimal with bold typography",
                    "behind-scenes": "candid and authentic",
                }
                brand_profile["instagram_aesthetic"] = aesthetic_map.get(
                    dominant, "clean and minimal"
                )
        except Exception as exc:
            logger.warning("Instagram scrape failed: %s", exc)
    yield _step("Analysing your Instagram content style...", done=True)

    # ── Suggest carousel type based on dominant content ─────────────────────
    content_to_carousel = {
        "educational": "educational",
        "product": "product",
        "lifestyle": "story",
        "quote": "viral_hook",
        "behind-scenes": "story",
    }
    brand_profile["suggested_carousel_type"] = content_to_carousel.get(
        brand_profile["dominant_content_type"], "educational"
    )

    yield {"type": "done", "brand_profile": brand_profile}
