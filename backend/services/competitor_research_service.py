"""
Competitor Deep Research Service - 7-Layer Intelligence Engine.

Runs all 7 layers in parallel per competitor, yields SSE-style events,
stores raw + parsed data in Firestore, and returns a structured report.

Layer 1  - Website & Messaging (Firecrawl)
Layer 2  - Paid Ad Intelligence (Apify facebook-ads-scraper)
Layer 3  - Organic Social Content Audit (Apify - all platforms)
Layer 4  - SEO & Keyword Intelligence (SerpAPI)
Layer 5  - Audience Sentiment Analysis (comments + reviews + Reddit)
Layer 6  - Content Strategy & Topic Gap Map
Layer 7  - Strategic Positioning & SWOT (Claude synthesis)
"""

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Optional

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _domain_from_url(url: str) -> str:
    """Extract clean domain from any URL."""
    url = url.strip().lower()
    url = re.sub(r"^https?://", "", url)
    url = re.sub(r"^www\.", "", url)
    return url.split("/")[0]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


async def _claude_json(prompt: str, system: str = "", max_tokens: int = 800) -> dict:
    """Call Claude and parse the first JSON object in the response."""
    from backend.services.llm_service import call_claude_raw
    text = await call_claude_raw(prompt, system=system, max_tokens=max_tokens)
    # Extract JSON block
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


# ---------------------------------------------------------------------------
# Layer 1 - Website & Messaging (Firecrawl)
# ---------------------------------------------------------------------------

async def _layer1_website(competitor: dict) -> dict:
    """Scrape competitor website across 5 key pages, analyse with Claude."""
    domain = competitor.get("domain") or _domain_from_url(competitor.get("website", ""))
    if not domain:
        return {}

    api_key = settings.FIRECRAWL_API_KEY
    if not api_key:
        logger.warning("FIRECRAWL_API_KEY not set - skipping Layer 1")
        return {}

    pages = ["", "/about", "/pricing", "/blog", "/features"]
    scraped_texts: list[str] = []

    async def _scrape_page(path: str) -> str:
        url = f"https://{domain}{path}"
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.firecrawl.dev/v1/scrape",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={"url": url, "formats": ["markdown"]},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("data", {}).get("markdown", "")[:3000]
        except Exception as exc:
            logger.debug("Firecrawl scrape failed for %s: %s", url, exc)
        return ""

    results = await asyncio.gather(*[_scrape_page(p) for p in pages])
    scraped_texts = [r for r in results if r]

    if not scraped_texts:
        return {}

    combined = "\n\n---PAGE---\n\n".join(scraped_texts)[:8000]

    parsed = await _claude_json(
        f"""Analyse this competitor website content for {competitor.get('name', domain)}.
Return a JSON object with EXACTLY these keys:
{{
  "headline": "their primary positioning statement",
  "value_prop": "their claimed core benefit",
  "target_customer": "who they are targeting",
  "tone": "e.g. bold, clinical, friendly, professional",
  "pricing_model": "subscription|usage|freemium|custom|unknown",
  "price_anchor": "lowest published price or empty string",
  "top_claims": ["claim 1", "claim 2", "claim 3"],
  "trust_signals": ["signal 1", "signal 2"],
  "blog_topics": ["topic 1", "topic 2", "topic 3"],
  "weaknesses_visible": ["gap 1", "gap 2"]
}}

Website content:
{combined}"""
    )

    return {"raw_pages_scraped": len(scraped_texts), **parsed}


# ---------------------------------------------------------------------------
# Layer 2 - Paid Ad Intelligence (Apify facebook-ads-scraper)
# ---------------------------------------------------------------------------

async def _layer2_paid_ads(competitor: dict) -> dict:
    """Scrape Meta Ad Library for active ads."""
    api_key = settings.APIFY_API_KEY
    if not api_key:
        logger.warning("APIFY_API_KEY not set - skipping Layer 2")
        return {}

    name = competitor.get("name", "")
    fb_url = competitor.get("facebook") or competitor.get("facebook_page_url") or ""

    # Build actor input
    actor_input: dict[str, Any] = {
        "maxItems": 50,
        "activeStatus": "ACTIVE",
        "adType": "ALL",
        "country": "ALL",
    }
    if fb_url:
        actor_input["startUrls"] = [{"url": fb_url}]
    else:
        actor_input["searchQuery"] = name

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            # Start Apify run
            start = await client.post(
                f"https://api.apify.com/v2/acts/apify~facebook-ads-scraper/runs",
                params={"token": api_key},
                json={"runInput": actor_input},
            )
            if start.status_code not in (200, 201):
                logger.warning("Apify ads actor start failed: %s", start.text[:200])
                return {}

            run_id = start.json().get("data", {}).get("id", "")
            if not run_id:
                return {}

            # Poll for completion (max 90s)
            for _ in range(18):
                await asyncio.sleep(5)
                status_resp = await client.get(
                    f"https://api.apify.com/v2/acts/apify~facebook-ads-scraper/runs/{run_id}",
                    params={"token": api_key},
                )
                run_status = status_resp.json().get("data", {}).get("status", "")
                if run_status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
                    break

            # Fetch items
            items_resp = await client.get(
                f"https://api.apify.com/v2/acts/apify~facebook-ads-scraper/runs/{run_id}/dataset/items",
                params={"token": api_key, "limit": 50},
            )
            ads = items_resp.json() if items_resp.status_code == 200 else []
    except Exception as exc:
        logger.warning("Apify ads scrape failed: %s", exc)
        return {}

    if not ads:
        return {"ads_found": 0}

    # Normalise ads
    normalised = []
    for ad in ads[:50]:
        normalised.append({
            "headline": ad.get("title") or ad.get("headline", ""),
            "body": ad.get("body") or ad.get("description", ""),
            "cta": ad.get("callToAction", ""),
            "format": ad.get("adType") or ad.get("type", ""),
            "landing_url": ad.get("link", ""),
            "days_active": ad.get("impressionDaysActive") or ad.get("daysActive", 0),
            "platforms": ad.get("publisherPlatforms", []),
        })

    # Find longest-running ad
    longest = max(normalised, key=lambda a: a.get("days_active") or 0)

    ads_text = json.dumps(normalised[:20], indent=2)[:4000]
    parsed = await _claude_json(
        f"""Analyse these {len(normalised)} active Meta ads from {name}.
Return a JSON object:
{{
  "most_used_hook": "opening line pattern they repeat",
  "dominant_cta": "most used CTA",
  "primary_offer": "what they offer in ads",
  "ad_formats": {{"image": 0, "video": 0, "carousel": 0}},
  "messaging_themes": ["theme 1", "theme 2", "theme 3"],
  "longest_running_ad": {{"copy": "...", "days_active": 0}},
  "target_audience_signals": "inferred audience",
  "estimated_ad_budget_signal": "low|medium|high",
  "winning_angle": "angle that appears most in best ads"
}}

Ads data:
{ads_text}"""
    )

    return {
        "ads_found": len(normalised),
        "longest_running_ad": longest,
        **parsed,
    }


# ---------------------------------------------------------------------------
# Layer 3 - Organic Social Content Audit (Apify)
# ---------------------------------------------------------------------------

async def _layer3_social(competitor: dict) -> dict:
    """Scrape social platforms and analyse content patterns."""
    api_key = settings.APIFY_API_KEY
    if not api_key:
        logger.warning("APIFY_API_KEY not set - skipping Layer 3")
        return {}

    from backend.services.ingestion.apify_client import (
        scrape_instagram, scrape_tiktok, scrape_youtube,
    )

    tasks: dict[str, Any] = {}

    ig = competitor.get("instagram") or competitor.get("instagram_handle") or ""
    tt = competitor.get("tiktok") or competitor.get("tiktok_handle") or ""
    yt = competitor.get("youtube") or competitor.get("youtube_url") or ""

    async def _safe(coro, key):
        try:
            return key, await coro
        except Exception as exc:
            logger.debug("Layer 3 %s failed: %s", key, exc)
            return key, {}

    coros = []
    if ig:
        coros.append(_safe(scrape_instagram(ig.lstrip("@"), api_key, max_posts=30), "instagram"))
    if tt:
        coros.append(_safe(scrape_tiktok(tt, api_key, max_videos=20), "tiktok"))
    if yt:
        coros.append(_safe(scrape_youtube(yt, api_key, max_videos=20), "youtube"))

    if not coros:
        return {}

    results_list = await asyncio.gather(*coros)
    platform_data = {k: v for k, v in results_list if v}

    if not platform_data:
        return {}

    # Build summary for Claude
    summary_parts = []
    for platform, data in platform_data.items():
        raw = data.get("raw_captions") or data.get("raw_text") or ""
        posts = data.get("posts") or data.get("videos") or []
        followers = data.get("followers") or data.get("profile", {}).get("followers_count", 0)
        summary_parts.append(
            f"=== {platform.upper()} ===\nFollowers: {followers}\nPosts: {len(posts)}\nSample content:\n{raw[:1500]}"
        )

    combined = "\n\n".join(summary_parts)[:5000]
    parsed = await _claude_json(
        f"""Analyse this competitor's social content.
Return a JSON object:
{{
  "posting_frequency": {{"instagram": "X/week", "tiktok": "X/week", "youtube": "X/month"}},
  "best_performing_format": "reels|carousels|images|videos|shorts",
  "top_content_themes": ["theme1", "theme2", "theme3"],
  "best_posting_times": ["Tue 7pm", "Fri 12pm"],
  "avg_engagement_rate": "X%",
  "caption_style": "long-form|short punchy|CTA-heavy|storytelling",
  "top_hashtags": ["#tag1", "#tag2", "#tag3"],
  "content_they_avoid": ["topic 1", "topic 2"],
  "viral_content_pattern": "what their best posts have in common",
  "weaknesses": ["weakness 1", "weakness 2"]
}}

Social data:
{combined}"""
    )

    return {
        "platforms_scraped": list(platform_data.keys()),
        "platform_raw": {
            k: {
                "followers": v.get("followers") or v.get("profile", {}).get("followers_count", 0),
                "post_count": len(v.get("posts") or v.get("videos") or []),
                "top_hashtags": v.get("top_hashtags", []),
            }
            for k, v in platform_data.items()
        },
        **parsed,
    }


# ---------------------------------------------------------------------------
# Layer 4 - SEO & Keyword Intelligence (SerpAPI)
# ---------------------------------------------------------------------------

async def _layer4_seo(competitor: dict) -> dict:
    """Run SerpAPI queries to map competitor's search footprint."""
    api_key = settings.SERPAPI_API_KEY
    if not api_key:
        logger.warning("SERPAPI_API_KEY not set - skipping Layer 4")
        return {}

    name = competitor.get("name", "")
    domain = competitor.get("domain") or _domain_from_url(competitor.get("website", ""))

    async def _serp(params: dict) -> dict:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://serpapi.com/search",
                    params={"api_key": api_key, "hl": "en", "gl": "us", **params},
                )
                if resp.status_code == 200:
                    return resp.json()
        except Exception as exc:
            logger.debug("SerpAPI failed for %s: %s", params.get("q", ""), exc)
        return {}

    queries = []
    if domain:
        queries.append({"q": f"site:{domain}", "num": 1})
        queries.append({"q": f'"{name}" best features review', "num": 5})
    if name:
        queries.append({"engine": "google_autocomplete", "q": f"{name} "})
        queries.append({"q": f'"{name}" pricing alternatives', "num": 5})

    results = await asyncio.gather(*[_serp(q) for q in queries])

    # Parse indexed pages from site: query
    indexed_pages = 0
    if results and domain:
        si = results[0].get("search_information", {})
        indexed_pages = si.get("total_results", 0)

    # Parse autocomplete signals
    autocomplete_signals: list[str] = []
    for r in results:
        suggestions = r.get("suggestions", [])
        autocomplete_signals += [s.get("value", "") for s in suggestions[:8] if s.get("value")]

    # Check for Google Ads
    google_ads_running = False
    google_ad_message = ""
    for r in results:
        ads = r.get("ads", [])
        if ads:
            google_ads_running = True
            google_ad_message = ads[0].get("title", "") or ads[0].get("description", "")
            break

    # Top organic results for brand queries
    ranking_keywords: list[str] = []
    for r in results:
        for organic in r.get("organic_results", [])[:5]:
            title = organic.get("title", "")
            if title and name.lower() in title.lower():
                ranking_keywords.append(title[:80])

    parsed = await _claude_json(
        f"""Analyse this SEO data for {name}.
Return a JSON object:
{{
  "seo_strength": "low|medium|high",
  "indexed_pages": {indexed_pages},
  "ranking_keywords": ["kw1", "kw2", "kw3"],
  "google_ads_running": {"true" if google_ads_running else "false"},
  "google_ad_message": "{google_ad_message[:100]}",
  "autocomplete_signals": ["signal 1", "signal 2", "signal 3"],
  "trending_vs_us": "growing|declining|stable",
  "seo_gap_for_us": "keywords they rank for that we could target"
}}

Raw signals:
- Indexed pages: {indexed_pages}
- Google Ads running: {google_ads_running}
- Ad message: {google_ad_message}
- Autocomplete suggestions: {autocomplete_signals[:8]}
- Ranking results: {ranking_keywords[:10]}"""
    )

    return {
        "indexed_pages": indexed_pages,
        "google_ads_running": google_ads_running,
        "autocomplete_signals": autocomplete_signals,
        **parsed,
    }


# ---------------------------------------------------------------------------
# Layer 5 - Audience Sentiment Analysis
# ---------------------------------------------------------------------------

async def _layer5_sentiment(competitor: dict, layer3: dict) -> dict:
    """Analyse what customers say about the competitor."""
    api_key = settings.SERPAPI_API_KEY
    firecrawl_key = settings.FIRECRAWL_API_KEY
    name = competitor.get("name", "")

    review_texts: list[str] = []

    # Fetch review pages via SerpAPI + Firecrawl
    if api_key and firecrawl_key and name:
        review_queries = [f'"{name}" review', f'"{name}" complaints problems']
        for q in review_queries:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        "https://serpapi.com/search",
                        params={"api_key": api_key, "q": q, "num": 3, "hl": "en", "gl": "us"},
                    )
                    if resp.status_code == 200:
                        organic = resp.json().get("organic_results", [])[:2]
                        for r in organic:
                            url = r.get("link", "")
                            if url and any(site in url for site in ["trustpilot", "g2", "capterra", "reddit", "review"]):
                                try:
                                    async with httpx.AsyncClient(timeout=15) as fc:
                                        fc_resp = await fc.post(
                                            "https://api.firecrawl.dev/v1/scrape",
                                            headers={"Authorization": f"Bearer {firecrawl_key}"},
                                            json={"url": url, "formats": ["markdown"]},
                                        )
                                        if fc_resp.status_code == 200:
                                            md = fc_resp.json().get("data", {}).get("markdown", "")[:2000]
                                            if md:
                                                review_texts.append(f"Source: {url}\n{md}")
                                except Exception:
                                    pass
            except Exception as exc:
                logger.debug("Sentiment search failed: %s", exc)

    # Include captions from Layer 3 as proxy for comment sentiment
    social_captions = layer3.get("viral_content_pattern", "") or ""
    caption_context = f"\nSocial content patterns: {social_captions}"

    all_text = "\n\n---\n\n".join(review_texts)[:5000] + caption_context

    if not all_text.strip():
        return {
            "overall_sentiment": "unknown",
            "top_praise": [],
            "top_complaints": [],
            "feature_requests": [],
            "churn_signals": [],
            "brand_loyalty_signals": [],
            "unmet_needs": [],
        }

    parsed = await _claude_json(
        f"""Analyse audience sentiment for {name} based on reviews and social data.
Return a JSON object:
{{
  "overall_sentiment": "positive|mixed|negative|unknown",
  "top_praise": ["what customers love 1", "love 2", "love 3"],
  "top_complaints": ["complaint 1", "complaint 2", "complaint 3"],
  "feature_requests": ["request 1", "request 2"],
  "churn_signals": ["reason to leave 1", "reason 2"],
  "brand_loyalty_signals": ["loyalty reason 1", "reason 2"],
  "unmet_needs": ["gap 1", "gap 2"]
}}

Review and sentiment data:
{all_text}"""
    )

    return parsed


# ---------------------------------------------------------------------------
# Layer 6 - Content Strategy & Topic Gap Map
# ---------------------------------------------------------------------------

async def _layer6_content_map(competitor: dict, layer1: dict, layer3: dict, layer4: dict) -> dict:
    """Map competitor's content territory and find gaps."""
    name = competitor.get("name", "")

    # Combine signals from prior layers
    blog_topics = layer1.get("blog_topics", [])
    social_themes = layer3.get("top_content_themes", [])
    seo_gap = layer4.get("seo_gap_for_us", "")
    content_avoid = layer3.get("content_they_avoid", [])
    posting_freq = layer3.get("posting_frequency", {})

    context = f"""
Blog topics: {blog_topics}
Social themes: {social_themes}
SEO gap signal: {seo_gap}
Content they avoid: {content_avoid}
Posting frequency: {posting_freq}
"""

    parsed = await _claude_json(
        f"""Map the content territory for {name}.
Return a JSON object:
{{
  "owned_topics": ["topic 1", "topic 2", "topic 3", "topic 4"],
  "publishing_frequency": "X posts/week across all channels",
  "content_format_preference": "video|written|visual|mixed",
  "topics_they_avoid": ["gap 1", "gap 2", "gap 3"],
  "seo_content_pillars": ["pillar 1", "pillar 2", "pillar 3"],
  "our_opportunity_topics": ["opportunity 1", "opportunity 2", "opportunity 3"]
}}

Content data:
{context}"""
    )

    return parsed


# ---------------------------------------------------------------------------
# Layer 7 - Strategic SWOT Synthesis (Claude)
# ---------------------------------------------------------------------------

async def _layer7_swot(
    competitor: dict,
    layer1: dict,
    layer2: dict,
    layer3: dict,
    layer4: dict,
    layer5: dict,
    layer6: dict,
    brand_core: dict,
) -> dict:
    """CMO-level SWOT synthesis cross-referencing all layers + brand core."""
    name = competitor.get("name", "")
    brand_name = brand_core.get("name", "our brand")

    synthesis_prompt = f"""You are a senior competitive strategist analysing {name} on behalf of {brand_name}.

You have complete intelligence data across 7 research layers. Produce a strategic SWOT and positioning analysis.
Be opinionated, direct, and specific. No vague generalities.

COMPETITOR DATA:
Website messaging: {json.dumps(layer1, indent=2)[:1500]}
Paid ads strategy: {json.dumps(layer2, indent=2)[:1000]}
Social content: {json.dumps(layer3, indent=2)[:1000]}
SEO footprint: {json.dumps(layer4, indent=2)[:800]}
Audience sentiment: {json.dumps(layer5, indent=2)[:800]}
Content territory: {json.dumps(layer6, indent=2)[:800]}

OUR BRAND:
{json.dumps(brand_core, indent=2)[:800]}

Return a JSON object:
{{
  "strengths": ["what they genuinely do well 1", "strength 2", "strength 3"],
  "weaknesses": ["real gap 1", "gap 2", "gap 3"],
  "opportunities_for_us": ["specific action 1", "action 2", "action 3"],
  "threats_to_us": ["where they are stronger 1", "threat 2"],
  "positioning_summary": "one paragraph where they sit in the market",
  "how_they_win_customers": "their primary acquisition angle",
  "how_we_beat_them": "our clearest path - be specific not generic",
  "threat_level": "high|medium|low",
  "steal_this": {{
    "tactic": "one specific thing they do that works",
    "why_it_works": "psychological reason",
    "our_version": "how our brand does it better in our voice"
  }}
}}"""

    return await _claude_json(synthesis_prompt, max_tokens=1500)  # SWOT synthesis - larger schema


# ---------------------------------------------------------------------------
# Auto-Discovery
# ---------------------------------------------------------------------------

async def discover_competitors(project_id: str) -> list[dict]:
    """
    DEPRECATED - no longer called by any route.
    The POST /competitors/discover route now calls intelligence_service.discover_competitors
    (Tavily + Exa + Claude synthesis). This SerpAPI-only version is retained only as a
    fallback reference and will be removed in a future cleanup.
    """
    from backend.services import firebase_service

    project = firebase_service.get_project(project_id)
    if not project:
        return []

    brand_core = project.get("brandCore") or {}
    brand_name = project.get("name", "")
    website = project.get("websiteUrl") or ""
    domain = _domain_from_url(website) if website else ""

    # Build discovery queries
    audience = brand_core.get("audience", {}).get("demographics", "") or ""
    themes = brand_core.get("themes", [])
    tagline = brand_core.get("tagline", "")
    category_hint = themes[0] if themes else ""

    queries = []
    if category_hint:
        queries.append(f"{category_hint} top brands alternatives {datetime.now().year}")
    if tagline:
        queries.append(f"{tagline} competitors brands")
    if domain:
        queries.append(f"similar to {domain} alternatives")

    api_key = settings.SERPAPI_API_KEY
    if not api_key or not queries:
        return []

    discovered: dict[str, dict] = {}

    for q in queries[:3]:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://serpapi.com/search",
                    params={"api_key": api_key, "q": q, "num": 10, "hl": "en", "gl": "us"},
                )
                if resp.status_code != 200:
                    continue
                for result in resp.json().get("organic_results", [])[:10]:
                    url = result.get("link", "")
                    title = result.get("title", "")
                    d = _domain_from_url(url)
                    if d and d != domain and d not in ("google.com", "wikipedia.org", "youtube.com"):
                        if d not in discovered:
                            discovered[d] = {
                                "name": title.split(" - ")[0].split(" | ")[0][:60],
                                "domain": d,
                                "website": f"https://{d}",
                                "reason": f"Found in search: '{q}'",
                                "confidence": "medium",
                            }
        except Exception as exc:
            logger.debug("Discovery query failed: %s", exc)

    # Use Claude to pick the best 8 and assess relevance
    if not discovered:
        return []

    candidates = list(discovered.values())[:15]
    parsed = await _claude_json(
        f"""You are selecting the most relevant competitors for {brand_name}.

Brand description: {tagline}
Target audience: {audience}
Key themes: {themes}

Candidate competitors found in search:
{json.dumps(candidates, indent=2)}

Return a JSON object:
{{
  "competitors": [
    {{
      "name": "...",
      "domain": "...",
      "website": "https://...",
      "reason": "why they compete with {brand_name}",
      "confidence": "high|medium|low"
    }}
  ]
}}

Select the 8 most relevant competitors. Remove irrelevant listings (review sites, news articles, directories).
Only return actual brand/product competitors."""
    )

    return parsed.get("competitors", candidates[:8])


# ---------------------------------------------------------------------------
# Main Research Pipeline
# ---------------------------------------------------------------------------

async def stream_deep_research(
    project_id: str,
    competitors: list[dict],
) -> AsyncGenerator[dict, None]:
    """
    Run 7-layer intelligence on each competitor.
    Yields SSE-style dicts for live progress streaming.
    Stores full reports in Firestore.
    """
    from backend.services import firebase_service

    project = firebase_service.get_project(project_id)
    brand_core = (project or {}).get("brandCore") or {}
    run_id = str(uuid.uuid4())

    yield {"type": "run_started", "run_id": run_id, "competitor_count": len(competitors)}

    all_reports = []

    for competitor in competitors:
        name = competitor.get("name", "Unknown")
        yield {"type": "competitor_started", "name": name}

        # --- Layer 1 ---
        yield {"type": "layer_started", "layer": 1, "name": name, "message": f"Reading {name}'s website & messaging..."}
        layer1 = await _layer1_website(competitor)
        yield {"type": "layer_done", "layer": 1, "name": name}

        # --- Layer 2 ---
        yield {"type": "layer_started", "layer": 2, "name": name, "message": f"Scanning Meta Ad Library for {name}'s active ads..."}
        layer2 = await _layer2_paid_ads(competitor)
        yield {"type": "layer_done", "layer": 2, "name": name}

        # --- Layers 3 & 4 in parallel ---
        yield {"type": "layer_started", "layer": 3, "name": name, "message": f"Pulling {name}'s social content (Instagram, TikTok, YouTube)..."}
        yield {"type": "layer_started", "layer": 4, "name": name, "message": f"Checking {name}'s Google keyword rankings & SEO footprint..."}

        layer3, layer4 = await asyncio.gather(
            _layer3_social(competitor),
            _layer4_seo(competitor),
        )
        yield {"type": "layer_done", "layer": 3, "name": name}
        yield {"type": "layer_done", "layer": 4, "name": name}

        # --- Layer 5 ---
        yield {"type": "layer_started", "layer": 5, "name": name, "message": f"Detecting audience sentiment around {name}..."}
        layer5 = await _layer5_sentiment(competitor, layer3)
        yield {"type": "layer_done", "layer": 5, "name": name}

        # --- Layer 6 ---
        yield {"type": "layer_started", "layer": 6, "name": name, "message": f"Mapping {name}'s content territory & topic gaps..."}
        layer6 = await _layer6_content_map(competitor, layer1, layer3, layer4)
        yield {"type": "layer_done", "layer": 6, "name": name}

        # --- Layer 7 ---
        yield {"type": "layer_started", "layer": 7, "name": name, "message": f"Cross-referencing with your Brand Core - building strategic SWOT..."}
        layer7 = await _layer7_swot(competitor, layer1, layer2, layer3, layer4, layer5, layer6, brand_core)
        yield {"type": "layer_done", "layer": 7, "name": name}

        # --- Assemble report ---
        logo_url = ""
        domain = competitor.get("domain") or _domain_from_url(competitor.get("website", ""))
        if domain and settings.LOGO_DEV_API_KEY:
            logo_url = f"https://img.logo.dev/{domain}?token={settings.LOGO_DEV_API_KEY}&size=128"

        report = {
            "id": str(uuid.uuid4()),
            "run_id": run_id,
            "project_id": project_id,
            "competitor": {
                "name": name,
                "domain": domain,
                "website": competitor.get("website", ""),
                "instagram": competitor.get("instagram", ""),
                "tiktok": competitor.get("tiktok", ""),
                "facebook": competitor.get("facebook", ""),
                "linkedin": competitor.get("linkedin", ""),
                "youtube": competitor.get("youtube", ""),
                "logo_url": logo_url,
            },
            "overview": {
                "headline": layer1.get("headline", ""),
                "value_prop": layer1.get("value_prop", ""),
                "target_customer": layer1.get("target_customer", ""),
                "tone": layer1.get("tone", ""),
                "pricing_model": layer1.get("pricing_model", ""),
                "price_anchor": layer1.get("price_anchor", ""),
                "top_claims": layer1.get("top_claims", []),
                "trust_signals": layer1.get("trust_signals", []),
                "threat_level": layer7.get("threat_level", "medium"),
                "strengths_vs_us": layer7.get("strengths", [])[:3],
                "weaknesses_vs_us": layer7.get("weaknesses", [])[:3],
            },
            "paid_ads": layer2,
            "social_content": layer3,
            "seo": layer4,
            "sentiment": layer5,
            "content_map": layer6,
            "strategic_swot": layer7,
            "created_at": _utcnow(),
        }

        # Persist to Firestore
        try:
            firebase_service.save_competitor_report(project_id, report)
        except Exception as exc:
            logger.warning("Failed to save competitor report: %s", exc)

        all_reports.append(report)
        yield {"type": "competitor_done", "name": name, "report_id": report["id"]}

    yield {
        "type": "research_complete",
        "run_id": run_id,
        "reports": [{"id": r["id"], "name": r["competitor"]["name"]} for r in all_reports],
    }


# ---------------------------------------------------------------------------
# Weekly Monitor Diff
# ---------------------------------------------------------------------------

async def run_monitor_diff(project_id: str, monitor: dict) -> dict:
    """
    Re-run Layers 2 (ads) + 3 (social) for a monitored competitor.
    Diffs against previous snapshot and returns detected changes.
    """
    from backend.services import firebase_service

    competitor = monitor.get("competitor", {})
    name = competitor.get("name", "")

    layer2, layer3 = await asyncio.gather(
        _layer2_paid_ads(competitor),
        _layer3_social(competitor),
    )

    prev = monitor.get("last_snapshot") or {}
    prev_ads = prev.get("ads_found", 0)
    prev_freq = prev.get("posting_frequency", {})

    changes: list[dict] = []
    is_significant = False

    # Detect ad count changes
    curr_ads = layer2.get("ads_found", 0)
    if prev_ads and curr_ads > prev_ads + 2:
        changes.append({
            "type": "new_ads_launched",
            "description": f"{name} launched {curr_ads - prev_ads} new ads. Latest angle: {layer2.get('winning_angle', 'unknown')}",
            "is_significant": True,
        })
        is_significant = True
    elif prev_ads and curr_ads < prev_ads - 2:
        changes.append({
            "type": "ads_pulled",
            "description": f"{name} stopped running {prev_ads - curr_ads} ads.",
            "is_significant": True,
        })
        is_significant = True

    # Detect posting frequency changes
    for platform in ("instagram", "tiktok"):
        prev_f = prev_freq.get(platform, "")
        curr_f = (layer3.get("posting_frequency") or {}).get(platform, "")
        if prev_f and curr_f and prev_f != curr_f:
            changes.append({
                "type": "frequency_change",
                "description": f"{name} changed {platform} frequency from {prev_f} to {curr_f}",
                "is_significant": False,
            })

    # Detect new content themes
    prev_themes = set(prev.get("top_content_themes", []))
    curr_themes = set(layer3.get("top_content_themes", []))
    new_themes = curr_themes - prev_themes
    if new_themes:
        changes.append({
            "type": "new_content_theme",
            "description": f"{name} started posting about: {', '.join(new_themes)}",
            "is_significant": len(new_themes) >= 2,
        })
        if len(new_themes) >= 2:
            is_significant = True

    snapshot = {
        "ads_found": curr_ads,
        "posting_frequency": layer3.get("posting_frequency", {}),
        "top_content_themes": layer3.get("top_content_themes", []),
        "winning_angle": layer2.get("winning_angle", ""),
    }

    # Persist monitor update
    try:
        firebase_service.update_competitor_monitor(
            project_id,
            monitor["id"],
            {
                "last_run_at": _utcnow(),
                "last_snapshot": snapshot,
                "has_significant_changes": is_significant,
            },
        )
        for change in changes:
            firebase_service.save_competitor_monitor_alert(project_id, monitor["id"], change)
    except Exception as exc:
        logger.warning("Failed to persist monitor update: %s", exc)

    return {
        "changes": changes,
        "has_significant_changes": is_significant,
        "snapshot": snapshot,
    }
