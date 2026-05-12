"""
Phase 1 Intelligence Services.

Provides:
  - Brand Voice Scorer: score any text against Brand Core
  - Content Performance Predictor: predict engagement before posting
  - Competitive Intelligence: scrape + analyse competitor social profiles
  - Brand Drift Detector: detect when your content drifts off-brand
  - Brand Memory: build context from user feedback for LLM injection
"""

import json
import logging
import re
from typing import Optional
from urllib.parse import urlparse

from backend.config import settings
from backend.services.llm_service import get_client, build_brand_core_context


def _logo_url(website: str) -> Optional[str]:
    """Return a Logo.dev image URL for a given website, or None if key missing."""
    if not settings.LOGO_DEV_API_KEY or not website:
        return None
    parsed = urlparse(website if "://" in website else f"https://{website}")
    domain = parsed.netloc.lstrip("www.") or parsed.path.lstrip("www.").split("/")[0]
    if not domain:
        return None
    return f"https://img.logo.dev/{domain}?token={settings.LOGO_DEV_API_KEY}&retina=true"

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _parse_json_response(raw: str) -> dict:
    """
    Robustly extract and parse JSON from a Claude response.

    Handles:
    - Bare JSON (no fences)
    - ```json ... ``` fences
    - ``` ... ``` fences
    - JSON embedded anywhere in prose (finds first { or [ block)
    """
    raw = raw.strip()

    # 1. Strip markdown code fences if present
    if "```" in raw:
        # Extract content between first and last fence pair
        fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
        if fence_match:
            raw = fence_match.group(1).strip()

    # 2. Try direct parse first (fastest path)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 3. Find the first { ... } or [ ... ] block (handles leading/trailing prose)
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = raw.find(start_char)
        if start == -1:
            continue
        # Walk backwards from end to find matching close bracket
        end = raw.rfind(end_char)
        if end != -1 and end > start:
            candidate = raw[start:end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass

    # 4. Nothing worked - log and raise so callers can handle gracefully
    logger.error("_parse_json_response failed. Raw (first 500 chars): %s", raw[:500])
    raise ValueError(f"Could not parse JSON from Claude response (length={len(raw)})")


# ---------------------------------------------------------------------------
# Brand Voice Scorer
# ---------------------------------------------------------------------------

async def score_brand_voice(text: str, brand_core: dict) -> dict:
    """
    Score a piece of text against the Brand Core.

    Returns a dict with:
      score (0-100), grade (A-F), strengths, issues, suggestions,
      on_brand_words, off_brand_words
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    prompt = f"""You are a brand voice auditor. Score this text against the Brand Core.

BRAND CORE:
{brand_context}

TEXT TO SCORE:
{text}

Return ONLY valid JSON with this exact structure:
{{
  "score": <integer 0-100>,
  "grade": <"A"|"B"|"C"|"D"|"F">,
  "summary": <one sentence verdict>,
  "strengths": [<up to 3 specific strengths, referencing actual words/phrases>],
  "issues": [<up to 5 specific issues found, quoting the problematic text>],
  "suggestions": [<up to 3 actionable, specific improvements>],
  "on_brand_words": [<words or phrases that match the brand voice>],
  "off_brand_words": [<words or phrases that conflict with the brand voice>]
}}

Be specific. Reference actual phrases from the text. Score honestly - 50 is average."""

    response = await client.messages.create(
        model=settings.LLM_CLASSIFICATION_MODEL,
        max_tokens=400,  # small JSON scorecard
        messages=[{"role": "user", "content": prompt}],
    )

    return _parse_json_response(response.content[0].text)


# ---------------------------------------------------------------------------
# Content Performance Predictor
# ---------------------------------------------------------------------------

async def predict_performance(content: str, platform: str, brand_core: dict) -> dict:
    """
    Predict how well content will perform on a given platform.

    Returns: score, prediction, sub-scores, reasons, improvements, best_posting_time
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    prompt = f"""You are a social media performance analyst. Predict how this content will perform.

PLATFORM: {platform}

BRAND CORE:
{brand_context}

CONTENT:
{content}

Return ONLY valid JSON:
{{
  "score": <integer 0-100>,
  "prediction": <"excellent"|"above average"|"average"|"below average"|"poor">,
  "hook_strength": <integer 0-10>,
  "clarity": <integer 0-10>,
  "cta_strength": <integer 0-10>,
  "brand_alignment": <integer 0-10>,
  "estimated_engagement": <"low"|"medium"|"high">,
  "best_posting_time": <e.g. "Tue–Thu, 6–9 PM local time">,
  "reasons": [<up to 4 specific reasons for this prediction>],
  "improvements": [<up to 3 concrete changes that would raise the score>]
}}

Base predictions on real {platform} algorithm behaviour and audience psychology."""

    response = await client.messages.create(
        model=settings.LLM_CLASSIFICATION_MODEL,
        max_tokens=400,  # small JSON scorecard
        messages=[{"role": "user", "content": prompt}],
    )

    return _parse_json_response(response.content[0].text)


# ---------------------------------------------------------------------------
# Competitive Intelligence
# ---------------------------------------------------------------------------

async def refresh_competitor_intelligence(
    project_id: str,
    competitors: list[dict],
) -> dict:
    """
    Scrape competitor social profiles via Apify, analyse with Claude,
    and store snapshots in Firestore.

    Each competitor dict: { name, website?, instagram?, facebook?, tiktok?, linkedin?, youtube? }
    Returns a summary of what was refreshed.
    """
    from backend.services import firebase_service
    from backend.services.ingestion.apify_client import (
        scrape_instagram,
        scrape_facebook,
        scrape_tiktok,
        scrape_linkedin,
        scrape_youtube,
        scrape_threads,
    )

    if not settings.APIFY_API_KEY:
        raise ValueError("APIFY_API_KEY is not configured.")

    results = []

    for competitor in competitors[:5]:  # cap at 5 to control cost
        name = competitor.get("name", "Unknown")
        website = competitor.get("website", "")
        scraped: dict = {
            "name": name,
            "platforms": {},
            "website": website,
            "logo_url": _logo_url(website),
        }

        if competitor.get("instagram"):
            try:
                data = await scrape_instagram(
                    competitor["instagram"], settings.APIFY_API_KEY, max_posts=15
                )
                scraped["platforms"]["instagram"] = {
                    "posts": data.get("posts", [])[:10],
                    "profile": data.get("profile", {}),
                    "followers": data.get("profile", {}).get("followers", 0),
                    "raw_captions": (data.get("raw_captions") or "")[:3000],
                }
            except Exception as exc:
                logger.warning("Instagram scrape failed for %s: %s", name, exc)

        if competitor.get("facebook"):
            try:
                data = await scrape_facebook(competitor["facebook"], settings.APIFY_API_KEY)
                scraped["platforms"]["facebook"] = {
                    "posts": data.get("posts", [])[:10],
                    "name": data.get("name", ""),
                    "followers": data.get("likes", 0),
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
            except Exception as exc:
                logger.warning("Facebook scrape failed for %s: %s", name, exc)

        if competitor.get("tiktok"):
            try:
                data = await scrape_tiktok(
                    competitor["tiktok"], settings.APIFY_API_KEY, max_videos=10
                )
                scraped["platforms"]["tiktok"] = {
                    "videos": data.get("videos", [])[:10],
                    "followers": data.get("followers", 0),
                    "top_hashtags": data.get("top_hashtags", []),
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
            except Exception as exc:
                logger.warning("TikTok scrape failed for %s: %s", name, exc)

        if competitor.get("linkedin"):
            try:
                data = await scrape_linkedin(competitor["linkedin"], settings.APIFY_API_KEY)
                scraped["platforms"]["linkedin"] = {
                    "posts": data.get("posts", [])[:10],
                    "followers": data.get("followers", 0),
                    "tagline": data.get("tagline", ""),
                    "industry": data.get("industry", ""),
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
            except Exception as exc:
                logger.warning("LinkedIn scrape failed for %s: %s", name, exc)

        if competitor.get("youtube"):
            try:
                data = await scrape_youtube(competitor["youtube"], settings.APIFY_API_KEY, max_videos=10)
                scraped["platforms"]["youtube"] = {
                    "videos": data.get("videos", [])[:10],
                    "channel_name": data.get("channel_name", ""),
                    "subscribers": data.get("subscribers", 0),
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
            except Exception as exc:
                logger.warning("YouTube scrape failed for %s: %s", name, exc)

        if competitor.get("threads"):
            try:
                data = await scrape_threads(competitor["threads"], settings.APIFY_API_KEY)
                scraped["platforms"]["threads"] = {
                    "posts": data.get("posts", [])[:10],
                    "followers": data.get("followers", 0),
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
            except Exception as exc:
                logger.warning("Threads scrape failed for %s: %s", name, exc)

        if scraped["platforms"]:
            results.append({
                "name": name,
                "logo_url": scraped.get("logo_url"),
                "platforms_scraped": list(scraped["platforms"].keys()),
                "_scraped": scraped,  # carry for batch analysis below
            })
        else:
            results.append({
                "name": name,
                "logo_url": scraped.get("logo_url"),
                "platforms_scraped": [],
            })

    # Batch-analyse all scraped competitors in a SINGLE Claude call instead of N calls.
    scraped_list = [r.pop("_scraped") for r in results if "_scraped" in r]
    if scraped_list:
        analyses = await _analyse_competitors_batch(scraped_list)
        for scraped in scraped_list:
            scraped["analysis"] = analyses.get(scraped["name"], {"tone": "Unknown", "key_themes": [], "content_gaps": []})
            firebase_service.save_competitor_snapshot(project_id, scraped)

    return {"refreshed": results}


async def _analyse_competitors_batch(scraped_list: list[dict]) -> dict:
    """
    Analyse up to 5 competitors in a SINGLE Claude call.
    Returns dict keyed by competitor name → analysis dict.
    Previously this was N separate calls; batching saves 4 API round-trips.
    """
    client = get_client()

    blocks = []
    for scraped in scraped_list:
        name = scraped["name"]
        content_sections = []
        for platform, data in scraped.get("platforms", {}).items():
            raw = data.get("raw_captions") or data.get("raw_text", "")
            if raw:
                content_sections.append(f"  {platform.upper()}:\n{raw[:800]}")
        if content_sections:
            blocks.append(f"COMPETITOR: {name}\n" + "\n".join(content_sections))

    if not blocks:
        return {}

    competitors_text = "\n\n===\n\n".join(blocks)

    prompt = f"""Analyse each competitor's social media content below. Return ONLY a valid JSON object where each key is the competitor name and the value is their analysis.

{competitors_text}

Return format:
{{
  "<competitor name>": {{
    "tone": "<voice/tone in 1 sentence>",
    "key_themes": ["<up to 5 recurring topics>"],
    "posting_style": "<brief description>",
    "strengths": ["<up to 3>"],
    "weaknesses": ["<up to 3>"],
    "content_gaps": ["<up to 3 opportunities>"],
    "top_hashtags": ["<most used>"],
    "engagement_patterns": "<what gets most engagement>"
  }}
}}"""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        return _parse_json_response(response.content[0].text)
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Competitive Strategy Plan
# ---------------------------------------------------------------------------

async def generate_competitive_strategy(
    brand_core: dict,
    brand_name: str,
    competitor_snapshots: list[dict],
) -> dict:
    """
    Generate a comprehensive, evidence-backed competitive strategy plan.

    Uses ALL available scraped data (follower counts, engagement, themes,
    momentum, recent news) plus optional web research.

    Output shape matches the CompetitiveStrategy TypeScript interface exactly.
    """
    import asyncio as _a
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    # ── 1. Extract rich competitor data blocks ────────────────────────────────
    all_sources: list[str] = []
    competitors_text = ""
    # Capture per-competitor platform followers for data_snapshot
    comp_followers: dict[str, dict] = {}

    for snap in competitor_snapshots[:5]:  # cap at 5 to keep prompt manageable
        name_c    = snap.get("name", "Unknown")
        analysis  = snap.get("analysis") or {}
        web       = snap.get("web_analysis") or {}
        platforms = snap.get("platforms") or {}

        platform_lines: list[str] = []
        all_followers = 0
        plat_followers: dict[str, int] = {}
        for plat, pdata in platforms.items():
            profile   = pdata.get("profile") or {}
            followers = (
                profile.get("followers") or
                pdata.get("followers") or
                pdata.get("likes") or 0
            )
            posts = pdata.get("posts") or pdata.get("videos") or []
            num_posts    = len(posts) or 1
            avg_likes    = round(sum(p.get("likes", 0) for p in posts) / num_posts)
            avg_comments = round(sum(p.get("comments", 0) for p in posts) / num_posts)
            eng_rate     = round((avg_likes + avg_comments) / max(followers, 1) * 100, 2)
            all_followers += followers
            plat_followers[plat] = followers
            platform_lines.append(
                f"  {plat}: {followers:,} followers | avg {avg_likes} likes, {avg_comments} comments | ~{eng_rate}% engagement"
            )

        comp_followers[name_c] = plat_followers
        top_themes = (analysis.get("key_themes") or [])[:6]
        top_tags   = (analysis.get("top_hashtags") or [])[:8]

        competitors_text += (
            f"\n[{name_c}] website={snap.get('website','?')} | total_followers={all_followers:,}\n"
            + "\n".join(platform_lines) + "\n"
            + f"  themes: {', '.join(top_themes) or 'unknown'}\n"
            + f"  top hashtags: {', '.join(top_tags) or 'none'}\n"
            + f"  strengths: {'; '.join((analysis.get('strengths') or [])[:3]) or 'unknown'}\n"
            + f"  weaknesses: {'; '.join((analysis.get('weaknesses') or [])[:3]) or 'unknown'}\n"
            + f"  momentum: {web.get('momentum','unknown')} | position: {web.get('market_position','unknown')}\n"
        )

    # ── 2. Optional fast web research (30s timeout) ───────────────────────────
    additional_intel = ""
    try:
        from backend.services.integrations import tavily_client
        if settings.TAVILY_API_KEY:
            comp_names = [s.get("name", "") for s in competitor_snapshots[:3]]
            result_raw = await _a.wait_for(
                tavily_client.search_advanced(
                    f"{brand_name} vs {', '.join(comp_names)} competitive landscape 2025",
                    max_results=3, include_answer=True, project_id=None,
                ),
                timeout=30,
            )
            parts: list[str] = []
            if result_raw.get("answer"):
                parts.append(result_raw["answer"])
            for r in (result_raw.get("results") or [])[:3]:
                snip = (r.get("content") or r.get("snippet") or "")[:250]
                url  = r.get("url", "")
                if snip:
                    parts.append(f"• {snip} ({url})")
                    if url:
                        all_sources.append(url)
            if parts:
                additional_intel = "\nLIVE MARKET CONTEXT:\n" + "\n".join(parts)
    except Exception as exc:
        logger.info("Strategy web research skipped: %s", exc)

    # ── 3. Build prompt with schema matching TypeScript types exactly ─────────
    sources_json = json.dumps(all_sources[:10])
    num_competitors = len(competitor_snapshots)

    prompt = f"""You are a senior competitive intelligence strategist. Analyse the real competitor data below and produce a detailed strategy document for {brand_name}.

OUR BRAND:
{brand_context}

COMPETITOR DATA (real scraped metrics):
{competitors_text}
{additional_intel}

Return ONLY a valid JSON object with NO markdown fences, NO explanation text. Match this schema exactly:

{{
  "executive_summary": "3-5 sentences citing specific competitor names and real data points - who dominates, where our opportunity is, #1 priority",

  "market_snapshot": {{
    "total_competitors": {num_competitors},
    "market_maturity": "emerging|growing|mature|saturated",
    "top_channels": ["<platform1>", "<platform2>"],
    "key_trends": ["<trend 1>", "<trend 2>", "<trend 3>"],
    "data_points": ["<stat with competitor name e.g. Competitor X has 50K Instagram followers>", "<another data point>"]
  }},

  "brand_position": {{
    "strengths": ["<strength as plain string>", "<strength>"],
    "vulnerabilities": ["<vulnerability as plain string>", "<vulnerability>"],
    "differentiation": "<what genuinely separates us from all listed competitors>",
    "evidence": ["<data point supporting brand position>", "<another data point>"]
  }},

  "competitor_breakdown": [
    {{
      "name": "<must match a competitor name from data above>",
      "threat_level": "high|medium|low",
      "what_they_do_better": "<specific things with numbers from data>",
      "their_weakness": "<exploitable gap backed by data>",
      "how_to_beat_them": "<concrete tactic naming platform and content type>",
      "key_evidence": ["<data point>", "<data point>"],
      "data_snapshot": {{
        "followers": {{}},
        "top_themes": []
      }}
    }}
  ],

  "channel_strategy": {{
    "instagram": {{
      "priority": "primary|secondary|deprioritize",
      "rationale": "<why - cite competitor presence>",
      "recommended_formats": ["Reels", "Stories"],
      "posting_frequency": "<e.g. 5x/week>",
      "content_angles": ["<angle 1>", "<angle 2>"]
    }},
    "tiktok": {{
      "priority": "primary|secondary|deprioritize",
      "rationale": "<cite competitor data>",
      "recommended_formats": ["Short-form video"],
      "posting_frequency": "<e.g. daily>",
      "content_angles": ["<angle>"]
    }},
    "linkedin": {{
      "priority": "primary|secondary|deprioritize",
      "rationale": "<cite competitor data>",
      "recommended_formats": ["Articles", "Posts"],
      "posting_frequency": "<e.g. 3x/week>",
      "content_angles": ["<angle>"]
    }}
  }},

  "content_strategy": {{
    "themes_to_own": ["<theme where competitors are weak>", "<theme>"],
    "themes_to_attack": ["<competitor theme to create superior content on>", "<theme>"],
    "formats": [
      {{"format": "Reels", "platform": "Instagram", "rationale": "<why - competitor gap>"}},
      {{"format": "Short video", "platform": "TikTok", "rationale": "<why>"}}
    ]
  }},

  "battlegrounds": [
    {{
      "area": "<e.g. Short-form educational video>",
      "our_position": "winning|competitive|losing|untapped",
      "recommendation": "<specific action with expected outcome>"
    }}
  ],

  "action_plan": [
    {{
      "priority": "immediate|short_term|long_term",
      "timeframe": "<e.g. This week|Next 30 days|60-90 days>",
      "action": "<specific what-to-do>",
      "rationale": "<which competitor weakness this exploits>",
      "expected_impact": "<measurable outcome>",
      "effort": "low|medium|high"
    }}
  ],

  "quick_wins": [
    {{
      "action": "<action doable THIS WEEK>",
      "why_now": "<competitor urgency reason>",
      "expected_result": "<outcome in 7 days>"
    }}
  ],

  "data_sources": {sources_json}
}}

Rules:
- competitor_breakdown must have one entry per competitor in the data
- action_plan must have at least 5 items (immediate/short_term/long_term)
- quick_wins must have 3-5 items
- battlegrounds must have 4-6 items
- channel_strategy keys must be lowercase platform names (instagram, tiktok, linkedin, youtube, facebook)
- All strings must be specific - no generic advice like "create better content"
- brand_position.strengths and vulnerabilities must be plain strings (not objects)"""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=3500,  # strategy JSON with 5 competitors can hit 3000+ tokens
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = response.content[0].text
    try:
        result = _parse_json_response(raw_text)
    except Exception as exc:
        logger.error(
            "generate_competitive_strategy parse failed (%s). stop=%s raw[:800]=%s",
            exc, response.stop_reason, raw_text[:800],
        )
        raise ValueError(
            f"Strategy JSON parse failed (stop_reason={response.stop_reason}). Detail: {exc}"
        )

    # ── 4. Normalize output to match TypeScript types exactly ─────────────────
    # Fix brand_position.strengths/vulnerabilities - if objects, extract point strings
    bp = result.get("brand_position") or {}
    for field in ("strengths", "vulnerabilities"):
        items = bp.get(field) or []
        bp[field] = [
            (x.get("point") or x.get("text") or str(x)) if isinstance(x, dict) else str(x)
            for x in items
        ]
    result["brand_position"] = bp

    # Fix competitor_breakdown - inject real follower data from scraped snapshots
    for cb in (result.get("competitor_breakdown") or []):
        cb_name = cb.get("name", "")
        real_followers = comp_followers.get(cb_name, {})
        if real_followers:
            cb.setdefault("data_snapshot", {})["followers"] = real_followers
        # Find real themes from snapshot
        for snap in competitor_snapshots:
            if snap.get("name", "").lower() == cb_name.lower():
                themes = (snap.get("analysis") or {}).get("key_themes") or []
                cb.setdefault("data_snapshot", {})["top_themes"] = themes[:5]
                break

    # Fix quick_wins - normalize to {action, why_now, expected_result}
    raw_qw = result.get("quick_wins") or []
    fixed_qw = []
    for qw in raw_qw:
        if isinstance(qw, str):
            fixed_qw.append({"action": qw, "why_now": "", "expected_result": ""})
        elif isinstance(qw, dict):
            fixed_qw.append({
                "action": qw.get("action") or qw.get("win") or qw.get("text") or str(qw),
                "why_now": qw.get("why_now") or qw.get("urgency") or "",
                "expected_result": qw.get("expected_result") or qw.get("outcome") or "",
            })
    result["quick_wins"] = fixed_qw

    # Fix channel_strategy - if it's a list, convert to dict keyed by platform
    cs = result.get("channel_strategy")
    if isinstance(cs, list):
        cs_dict: dict = {}
        for item in cs:
            if isinstance(item, dict):
                key = (item.get("channel") or item.get("platform") or "other").lower()
                cs_dict[key] = {
                    "priority": item.get("priority") or "secondary",
                    "rationale": item.get("rationale") or item.get("specific_tactic") or "",
                    "recommended_formats": item.get("recommended_formats") or [],
                    "posting_frequency": item.get("posting_frequency") or "",
                    "content_angles": item.get("content_angles") or [],
                }
        result["channel_strategy"] = cs_dict

    # Fix market_snapshot - normalize field names
    ms = result.get("market_snapshot") or {}
    if ms and "total_competitors" not in ms:
        ms["total_competitors"] = num_competitors
    result["market_snapshot"] = ms

    # Ensure data_sources is always a list
    if not isinstance(result.get("data_sources"), list):
        result["data_sources"] = all_sources[:10]

    return result


# ---------------------------------------------------------------------------
# Competitor Deep-Dive Report
# ---------------------------------------------------------------------------

async def generate_competitor_report(
    competitor_snapshot: dict,
    brand_core: dict,
    brand_name: str,
) -> dict:
    """
    Generate a comprehensive deep-dive report on a single competitor.

    Performs FRESH web research (firmographics, funding, reviews, pricing,
    recent news) on top of the stored snapshot data so every claim is
    backed by a real source URL.
    """
    import asyncio as _a
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    name        = competitor_snapshot.get("name", "Unknown")
    website     = competitor_snapshot.get("website", "")
    analysis    = competitor_snapshot.get("analysis") or {}
    web         = competitor_snapshot.get("web_analysis") or {}
    web_raw     = competitor_snapshot.get("web") or {}
    platforms_data = competitor_snapshot.get("platforms") or {}

    # ── A. Extract real metrics from stored platform data ─────────────────────
    real_metrics: list[dict] = []
    detailed_posts_block = ""
    for platform, pdata in platforms_data.items():
        profile   = pdata.get("profile") or {}
        followers = (
            profile.get("followers") or
            pdata.get("followers") or
            pdata.get("likes") or 0
        )
        posts = pdata.get("posts") or pdata.get("videos") or []
        num_posts   = len(posts) or 1
        total_likes = sum(p.get("likes", 0) for p in posts)
        total_comments = sum(p.get("comments", 0) for p in posts)
        avg_likes    = round(total_likes / num_posts)
        avg_comments = round(total_comments / num_posts)
        eng_rate     = round((avg_likes + avg_comments) / max(followers, 1) * 100, 3)

        real_metrics.append({
            "platform": platform,
            "followers": followers,
            "avg_likes": avg_likes,
            "avg_comments": avg_comments,
            "engagement_rate": eng_rate,
            "num_posts": len(posts),
        })

        # Sample top posts for the prompt
        top_posts = sorted(posts, key=lambda p: p.get("likes", 0), reverse=True)[:3]
        if top_posts:
            post_lines = []
            for p in top_posts:
                caption = (p.get("caption") or p.get("text") or p.get("title") or "")[:120]
                likes   = p.get("likes", 0)
                post_lines.append(f"      [{likes:,} likes] {caption}")
            detailed_posts_block += f"\n  {platform.upper()} TOP POSTS:\n" + "\n".join(post_lines)

    platform_summary = "\n".join(
        f"  {m['platform'].capitalize()}: {m['followers']:,} followers | "
        f"avg {m['avg_likes']} likes, {m['avg_comments']} comments | "
        f"{m['engagement_rate']}% engagement | {m['num_posts']} posts analyzed"
        for m in real_metrics
    ) or "  No platform data"

    # ── B. Fresh research - 2 parallel searches with timeout ─────────────────
    sources: list[str] = []
    research_blocks: list[str] = []

    try:
        from backend.services.integrations import tavily_client

        if settings.TAVILY_API_KEY:
            tasks = [
                tavily_client.search_advanced(
                    f'"{name}" company size employees revenue funding 2024 2025',
                    max_results=3, include_answer=False, project_id=None,
                ),
                tavily_client.search_advanced(
                    f'"{name}" reviews pricing news 2024 2025',
                    max_results=3, include_answer=False, project_id=None,
                ),
            ]
            search_results = await _a.wait_for(
                _a.gather(*tasks, return_exceptions=True),
                timeout=30,
            )
            labels = ["COMPANY INFO (size/revenue/funding)", "REVIEWS & PRICING & NEWS"]
            for label, sr in zip(labels, search_results):
                if isinstance(sr, Exception):
                    continue
                results_list = sr.get("results", []) if isinstance(sr, dict) else []
                if not results_list:
                    continue
                lines = [f"\n=== {label} ==="]
                for r in results_list[:3]:
                    url  = r.get("url", "")
                    snip = (r.get("content") or r.get("snippet") or "")[:350]
                    lines.append(f"Source: {url}\n{snip}")
                    if url:
                        sources.append(url)
                research_blocks.append("\n".join(lines))
    except Exception as exc:
        logger.info("Report research skipped for %s: %s", name, exc)

    fresh_research = "\n".join(research_blocks) or "Web research unavailable."

    # ── C. Also pull from existing web_raw data (news saved during refresh) ───
    existing_news = web_raw.get("recent_news") or []
    existing_news_block = ""
    if existing_news:
        lines = ["=== PREVIOUSLY CAPTURED NEWS ==="]
        for n in existing_news[:5]:
            lines.append(f"• [{n.get('date', '')[:10]}] {n.get('title', '')} - {n.get('url', '')}")
            if n.get("url"):
                sources.append(n["url"])
        existing_news_block = "\n".join(lines)

    # ── D. Build the full report prompt ──────────────────────────────────────
    sources_json = json.dumps(list(dict.fromkeys(sources))[:15])
    prompt = f"""You are a competitive intelligence analyst. Generate a deep-dive report on "{name}" for the brand "{brand_name}".

Rules: cite only facts from data below; mark estimates explicitly; use exact numbers from platform metrics.

OUR BRAND: {brand_name}
{brand_context}

COMPETITOR: {name} | website: {website or "unknown"}

SCRAPED PLATFORM METRICS:
{platform_summary}
{detailed_posts_block}

CONTENT ANALYSIS:
- Tone: {analysis.get("tone", "unknown")}
- Themes: {", ".join((analysis.get("key_themes") or [])[:6])}
- Strengths: {"; ".join((analysis.get("strengths") or [])[:3])}
- Weaknesses: {"; ".join((analysis.get("weaknesses") or [])[:3])}
- Top hashtags: {", ".join((analysis.get("top_hashtags") or [])[:10])}
- Engagement patterns: {analysis.get("engagement_patterns", "")}
- Market position: {web.get("market_position", "unknown")} | Momentum: {web.get("momentum", "unknown")}
{existing_news_block}

WEB RESEARCH:
{fresh_research}

Return ONLY a valid JSON object, no markdown. Schema:

{{
  "company_profile": {{
    "description": "<2-3 sentences from research data>",
    "industry": "<sector>",
    "estimated_size": "<headcount from research or Estimated>",
    "size_source": "<LinkedIn/Crunchbase/Estimated>",
    "founded_estimate": "<year or Estimated>",
    "hq_location": "<city, country>",
    "funding_stage": "bootstrapped|seed|series-a|series-b|public|unknown",
    "revenue_range": "<from research or Estimated with reasoning>",
    "revenue_source": "<URL or Estimated>",
    "business_model": "<SaaS|ecommerce|services|etc>"
  }},

  "platform_metrics": [
    {{
      "platform": "<name>",
      "followers": <integer - use exact scraped number>,
      "is_estimated": false,
      "engagement_rate": <float>,
      "posts_per_week": <number or 0>,
      "avg_likes": <integer>,
      "avg_comments": <integer>,
      "top_content_type": "<type>"
    }}
  ],

  "growth_trajectory": [
    {{"month": "Jan 2025", "followers_total": <integer>, "engagement_index": <float 1-10>}},
    {{"month": "Feb 2025", "followers_total": <integer>, "engagement_index": <float 1-10>}},
    {{"month": "Mar 2025", "followers_total": <integer>, "engagement_index": <float 1-10>}},
    {{"month": "Apr 2025", "followers_total": <integer>, "engagement_index": <float 1-10>}}
  ],

  "revenue_trajectory": [
    {{"period": "Q3 2024", "value": <integer USD monthly or null>, "basis": "<reasoning>"}},
    {{"period": "Q4 2024", "value": <integer or null>, "basis": "<reasoning>"}},
    {{"period": "Q1 2025", "value": <integer or null>, "basis": "<reasoning>"}}
  ],

  "content_mix": [
    {{"type": "<type>", "percentage": <integer 0-100>}}
  ],

  "vs_brand_scorecard": [
    {{"dimension": "Content Quality",     "competitor": <1-10>, "brand": <1-10>, "evidence": "<reason>"}},
    {{"dimension": "Posting Frequency",   "competitor": <1-10>, "brand": <1-10>, "evidence": "<reason>"}},
    {{"dimension": "Audience Engagement", "competitor": <1-10>, "brand": <1-10>, "evidence": "<cite engagement rate>"}},
    {{"dimension": "Brand Consistency",   "competitor": <1-10>, "brand": <1-10>, "evidence": "<reason>"}},
    {{"dimension": "SEO & Web Presence",  "competitor": <1-10>, "brand": <1-10>, "evidence": "<reason>"}},
    {{"dimension": "Community Building",  "competitor": <1-10>, "brand": <1-10>, "evidence": "<reason>"}}
  ],

  "what_they_do_better": [
    {{
      "area": "<area>",
      "detail": "<specific with numbers/examples>",
      "impact": "<business impact>",
      "evidence": "<stat or source proving it>",
      "how_to_respond": "<specific tactic: platform + format + topic>"
    }}
  ],

  "their_strategy": {{
    "core_message": "<central brand positioning>",
    "content_pillars": ["<pillar>", "<pillar>", "<pillar>"],
    "posting_cadence": "<from post data>",
    "cta_strategy": "<how they drive action>",
    "audience_focus": "<who they target>",
    "notable_tactics": ["<specific tactic>", "<specific tactic>"]
  }},

  "opportunities": [
    {{
      "opportunity": "<specific gap with evidence>",
      "rationale": "<why this gap exists>",
      "action": "<exact action: platform + format + topic>",
      "difficulty": "easy|medium|hard",
      "time_to_impact": "<timeframe>"
    }}
  ],

  "threat_assessment": {{
    "overall_threat": "high|medium|low",
    "threat_rationale": "<evidence-backed explanation>",
    "areas_of_direct_competition": ["<area>"],
    "areas_of_no_overlap": ["<area>"]
  }},

  "recent_news_highlights": [
    {{"date": "<date>", "headline": "<headline>", "url": "<url>", "implication": "<what this means>"}}
  ],

  "data_sources": {sources_json}
}}"""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=3000,  # competitor report has 9 major sections including scorecard, trajectory
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        result = _parse_json_response(response.content[0].text)

        # ── Inject verified real metrics (override any AI estimates with ground truth)
        matched_platforms = set()
        for pm in result.get("platform_metrics", []):
            plat_key = pm.get("platform", "").lower()
            for rm in real_metrics:
                if rm["platform"].lower() == plat_key:
                    pm["followers"]       = rm["followers"]
                    pm["avg_likes"]       = rm["avg_likes"]
                    pm["avg_comments"]    = rm["avg_comments"]
                    pm["engagement_rate"] = rm["engagement_rate"]
                    pm["is_estimated"]    = False
                    matched_platforms.add(plat_key)
                    break

        # Add any scraped platforms not in AI response
        for rm in real_metrics:
            if rm["platform"].lower() not in matched_platforms and rm["followers"] > 0:
                result.setdefault("platform_metrics", []).append({
                    "platform":        rm["platform"],
                    "followers":       rm["followers"],
                    "avg_likes":       rm["avg_likes"],
                    "avg_comments":    rm["avg_comments"],
                    "engagement_rate": rm["engagement_rate"],
                    "is_estimated":    False,
                    "posts_per_week":  0,
                    "top_content_type": "",
                })

        # ── Normalize recent_news_highlights: ensure 'url' field (AI may use 'source')
        for item in (result.get("recent_news_highlights") or []):
            if "url" not in item and "source" in item:
                item["url"] = item.pop("source")

        # ── Ensure data_sources is a list
        if not isinstance(result.get("data_sources"), list):
            result["data_sources"] = sources[:10]

        return result
    except Exception as exc:
        logger.error("generate_competitor_report parse failed for %s: %s", name, exc)
        # Return a minimal but truthful structure using only real scraped data
        return {
            "company_profile": {
                "description": f"{name} - full analysis could not be generated. Raw data is available below.",
                "industry": "", "estimated_size": "Unknown", "size_source": "N/A",
                "founded_estimate": "Unknown", "hq_location": "Unknown",
                "funding_stage": "unknown", "funding_amount": "Unverified",
                "funding_source": "N/A", "revenue_range": "Unverified",
                "revenue_source": "N/A", "business_model": "Unknown",
                "pricing_insight": "Not available",
            },
            "platform_metrics": [
                {
                    "platform":        rm["platform"],
                    "followers":       rm["followers"],
                    "is_estimated":    False,
                    "engagement_rate": rm["engagement_rate"],
                    "avg_likes":       rm["avg_likes"],
                    "avg_comments":    rm["avg_comments"],
                    "posts_per_week":  None,
                    "top_content_type": "",
                    "top_performing_post": "",
                }
                for rm in real_metrics
            ],
            "growth_trajectory": [],
            "revenue_trajectory": [],
            "content_mix": [],
            "vs_brand_scorecard": [],
            "what_they_do_better": [],
            "their_strategy": {
                "core_message": "", "content_pillars": [], "posting_cadence": "",
                "cta_strategy": "", "audience_focus": "", "notable_tactics": [],
            },
            "opportunities": [],
            "threat_assessment": {
                "overall_threat": "medium", "threat_rationale": "Analysis unavailable",
                "areas_of_direct_competition": [], "areas_of_no_overlap": [],
                "watch_signals": [],
            },
            "recent_news_highlights": [],
            "data_sources": sources[:10],
        }


# ---------------------------------------------------------------------------
# Brand Drift Detector
# ---------------------------------------------------------------------------

async def check_brand_drift(own_content: list[str], brand_core: dict) -> dict:
    """
    Compare recent own content against Brand Core to detect voice drift.

    own_content: list of recent post text strings (most recent first)
    Returns: drift_score, status, issues, recommendations
    """
    if not own_content:
        return {
            "drift_score": 0,
            "status": "no_data",
            "issues": [],
            "recommendations": [],
            "positive_observations": [],
        }

    client = get_client()
    brand_context = build_brand_core_context(brand_core)
    recent_sample = "\n\n---\n\n".join(own_content[:10])

    prompt = f"""You are a brand compliance auditor. Analyse whether this recent content has drifted from the Brand Core.

BRAND CORE:
{brand_context}

RECENT CONTENT (last {min(len(own_content), 10)} posts):
{recent_sample}

Return ONLY valid JSON:
{{
  "drift_score": <integer 0-100, where 0 = perfectly on-brand, 100 = completely off-brand>,
  "status": <"on_track"|"minor_drift"|"significant_drift"|"off_brand">,
  "tone_drift": <true|false>,
  "theme_drift": <true|false>,
  "voice_drift": <true|false>,
  "issues": [<up to 5 specific drift issues, quoting examples>],
  "recommendations": [<up to 4 actions to get back on brand>],
  "positive_observations": [<up to 3 things that are still on-brand>]
}}"""

    response = await client.messages.create(
        model=settings.LLM_CLASSIFICATION_MODEL,
        max_tokens=400,  # compact drift scorecard
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        return _parse_json_response(response.content[0].text)
    except Exception:
        return {
            "drift_score": 0,
            "status": "error",
            "issues": ["Analysis failed"],
            "recommendations": [],
            "positive_observations": [],
        }


# ---------------------------------------------------------------------------
# Brand Memory - context builder for LLM injection
# ---------------------------------------------------------------------------

def build_memory_context(memory_items: list[dict]) -> str:
    """
    Convert brand memory feedback items into a system-prompt section.
    Called by llm_service.stream_chat() when building the system prompt.

    Returns an empty string if there are no useful memory items.
    """
    if not memory_items:
        return ""

    lines: list[str] = ["BRAND MEMORY - What LEO has learned from your past corrections:"]

    for item in memory_items[:15]:  # cap to control token usage
        ftype = item.get("type", "")
        original = (item.get("original") or "")[:100]
        edited = (item.get("edited") or "")[:100]
        reason = item.get("reason", "")
        instruction = item.get("instruction", "")

        if ftype == "edit" and original and edited:
            lines.append(f'- CORRECTED: "{original}" → "{edited}"')
        elif ftype == "reject" and original:
            suffix = f" - {reason}" if reason else ""
            lines.append(f'- REJECTED: "{original}"{suffix}')
        elif ftype == "approve" and original:
            lines.append(f'- APPROVED (keep doing this): "{original}"')
        elif ftype == "instruction" and instruction:
            lines.append(f'- ALWAYS: {instruction}')

    if len(lines) == 1:
        return ""

    lines.append(
        "Apply these learnings. Never repeat rejected patterns. "
        "Reinforce approved ones."
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Hashtag Research (Phase 4)
# ---------------------------------------------------------------------------

async def research_hashtags(
    topic: str,
    platform: str,
    content: str,
    brand_core: dict,
) -> dict:
    """
    Generate a tiered hashtag strategy for a given topic and platform.

    Returns:
    {
      "tiers": {
        "mega":   [{"tag": "#...", "approx_posts": "50M+"}],
        "large":  [...],
        "medium": [...],
        "niche":  [...]
      },
      "strategy": "<brief posting strategy note>",
      "recommended_mix": "<e.g. 2 mega + 5 large + 8 medium + 5 niche>"
    }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    content_section = f"\nCONTENT TO HASHTAG:\n{content[:500]}" if content else ""

    prompt = f"""You are a social media hashtag strategist.

BRAND:
{brand_context}

PLATFORM: {platform}
TOPIC: {topic}{content_section}

Generate a comprehensive hashtag strategy with 4 tiers:
- mega: 5-10M+ posts (broad, high visibility, very competitive)
- large: 500k-5M posts (strong reach, moderate competition)
- medium: 50k-500k posts (good engagement, relevant audience)
- niche: <50k posts (highly targeted, your core audience)

For {platform}, recommend the ideal total number and mix.

Return ONLY valid JSON:
{{
  "tiers": {{
    "mega":   [{{"tag": "#tag", "approx_posts": "10M+"}}],
    "large":  [{{"tag": "#tag", "approx_posts": "800k"}}],
    "medium": [{{"tag": "#tag", "approx_posts": "120k"}}],
    "niche":  [{{"tag": "#tag", "approx_posts": "8k"}}]
  }},
  "strategy": "<one sentence on why this mix works for this topic on {platform}>",
  "recommended_mix": "<e.g. 3 mega + 6 large + 8 medium + 5 niche = 22 total>"
}}

Aim for: 5+ per tier. Make tags specific and relevant to the topic."""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        return _parse_json_response(response.content[0].text)
    except Exception:
        return {"tiers": {"mega": [], "large": [], "medium": [], "niche": []}, "strategy": "", "recommended_mix": ""}


# ---------------------------------------------------------------------------
# AI Proactive Insights (Phase 4)
# ---------------------------------------------------------------------------

async def generate_insights(
    project_name: str,
    brand_core: dict,
    memory_items: list,
    competitor_snapshots: list,
    analytics: dict,
) -> dict:
    """
    Analyse all available project data and generate 3-5 proactive insights.

    Each insight has:
      type: "warning" | "opportunity" | "tip" | "achievement"
      title: short headline
      body: 1-2 sentence explanation
      action: suggested next step
      priority: "high" | "medium" | "low"
    """
    client = get_client()

    # Build data summary for Claude
    lib = analytics.get("library", {})
    cal = analytics.get("calendar", {})
    mem = analytics.get("memory", {})
    comp = analytics.get("competitors", {})
    top_performers = analytics.get("top_performers", [])

    memory_summary = ""
    if memory_items:
        approvals = sum(1 for m in memory_items if m.get("type") == "approve")
        rejections = sum(1 for m in memory_items if m.get("type") == "reject")
        memory_summary = f"{len(memory_items)} memory signals ({approvals} approvals, {rejections} rejections)"

    competitor_summary = ""
    if competitor_snapshots:
        names = [s.get("name", "?") for s in competitor_snapshots[:3]]
        competitor_summary = f"Tracking: {', '.join(names)}"
        # Include any content gaps as opportunities
        all_gaps = []
        for snap in competitor_snapshots[:3]:
            gaps = (snap.get("analysis") or {}).get("content_gaps", [])
            all_gaps.extend(gaps[:2])
        if all_gaps:
            competitor_summary += f"\nTop content gaps they're missing: {'; '.join(all_gaps[:4])}"

    top_perf_summary = ""
    if top_performers:
        best = top_performers[0]
        top_perf_summary = f"Best performer: {best['platform']} content with {best['engagement_rate']:.1f}% engagement"

    prompt = f"""You are LEO, an AI brand marketing co-pilot. Analyse this brand's data and generate proactive insights.

BRAND: {project_name}

DATA SUMMARY:
- Content Library: {lib.get('total', 0)} items total | {lib.get('by_status', {}).get('draft', 0)} draft, {lib.get('by_status', {}).get('approved', 0)} approved, {lib.get('by_status', {}).get('posted', 0)} posted
- Calendar: {cal.get('upcoming_count', 0)} posts scheduled in next 30 days
- Brand Memory: {memory_summary or "No signals yet"}
- Competitors: {comp.get('count', 0)} tracked | Last analysis: {comp.get('last_analysis', 'Never')}
- {competitor_summary}
- Performance: {top_perf_summary or "No performance data logged yet"}

Platform breakdown: {lib.get('by_platform', {})}

Generate 3-5 sharp, actionable insights that would genuinely help this brand. Be specific - reference actual numbers from the data.

Types:
- "warning": something that needs attention (brand drift, low posting cadence, stale competitor data)
- "opportunity": something they should capitalise on (competitor gaps, top-performing content patterns)
- "tip": a tactical improvement (posting timing, content mix, platform balance)
- "achievement": something going well worth acknowledging

Return ONLY valid JSON:
{{
  "insights": [
    {{
      "type": "warning",
      "title": "<short punchy headline, max 8 words>",
      "body": "<1-2 sentences with specific data references>",
      "action": "<one concrete next step>",
      "priority": "high"
    }}
  ]
}}

Be honest and data-driven. Don't be generic. If data is sparse, focus on what they should do first."""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        return _parse_json_response(response.content[0].text)
    except Exception:
        return {"insights": []}
"""
Web-enriched intelligence functions - appended to intelligence_service.py
"""

# ---------------------------------------------------------------------------
# Web-enriched Competitor Intelligence (Exa + Tavily)
# ---------------------------------------------------------------------------

async def refresh_competitor_intelligence_web(
    project_id: str,
    competitors: list[dict],
) -> dict:
    """
    Augments competitor snapshots with live web data via Exa + Tavily.
    Merges with existing Apify social snapshots in Firestore.
    """
    from backend.services import firebase_service
    from backend.services.integrations import exa_client, tavily_client

    results = []

    for competitor in competitors[:5]:
        name = competitor.get("name", "Unknown")
        domain = competitor.get("website") or competitor.get("url") or ""

        web_data: dict = {"name": name, "web": {}}

        try:
            company_results = await exa_client.search_companies(
                f"{name} brand website official",
                num_results=3,
                project_id=project_id,
            )
            if company_results:
                top = company_results[0]
                web_data["web"]["company_url"] = top.get("url", "")
                web_data["web"]["company_summary"] = (
                    top.get("summary") or
                    (top.get("highlights", [""])[0] if top.get("highlights") else "")
                )
                if not domain and top.get("url"):
                    domain = top["url"]
        except Exception as exc:
            logger.warning("Exa company search failed for %s: %s", name, exc)

        try:
            news_resp = await tavily_client.search_news(
                query=f"{name} brand news announcement",
                days=30,
                max_results=5,
                project_id=project_id,
            )
            news_items = news_resp.get("results", [])
            web_data["web"]["recent_news"] = [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("content", "")[:300],
                    "date": r.get("published_date", ""),
                }
                for r in news_items[:5]
            ]
            web_data["web"]["news_summary"] = news_resp.get("answer", "")
        except Exception as exc:
            logger.warning("Tavily news search failed for %s: %s", name, exc)

        if domain:
            try:
                url_for_similar = domain if domain.startswith("http") else f"https://{domain}"
                similar = await exa_client.find_similar(
                    url=url_for_similar,
                    num_results=5,
                    project_id=project_id,
                )
                web_data["web"]["similar_companies"] = [
                    {"title": r.get("title", ""), "url": r.get("url", "")}
                    for r in similar[:5]
                ]
            except Exception as exc:
                logger.warning("Exa findSimilar failed for %s: %s", name, exc)

        if web_data["web"]:
            analysis = await _analyse_competitor_web(name, web_data["web"])
            web_data["web_analysis"] = analysis
            try:
                existing = firebase_service.get_competitor_snapshot(project_id, name)
                if existing:
                    merged = {**existing, "web": web_data["web"], "web_analysis": analysis}
                    firebase_service.save_competitor_snapshot(project_id, merged)
                else:
                    firebase_service.save_competitor_snapshot(project_id, web_data)
            except Exception:
                pass

        results.append({"name": name, "web_enriched": bool(web_data["web"])})

    return {"web_refreshed": results}


async def _background_classify(project_id: str, name: str, website: str) -> None:
    """
    Background coroutine: classify a newly-added competitor into the
    competitor_profiles collection (5-dimension engine).

    Called via asyncio.create_task() after a snapshot is saved so the
    Profiles tab shows the competitor immediately (status=analyzing)
    and then updates to 'complete' when classification finishes.

    Skips silently if the competitor is already profiled.
    """
    try:
        from backend.services import firebase_service as _fs
        import asyncio as _asyncio

        # Skip if already profiled to avoid duplicate entries
        existing = _fs.get_competitor_profiles(project_id)
        names_lower = {p.get("competitor_name", "").lower() for p in existing}
        if name.lower() in names_lower:
            logger.debug("_background_classify: %s already in profiles, skipping", name)
            return

        # Load project to get brand context
        project = await _asyncio.to_thread(_fs.get_project, project_id)
        if not project:
            logger.warning("_background_classify: project %s not found", project_id)
            return

        brand_core  = project.get("brandCore") or {}
        brand_name  = project.get("name", "")

        from backend.services.competitor_classifier_service import classify_competitor as _classify
        async for event in _classify(
            name=name,
            website=website or None,
            brand_core=brand_core,
            brand_name=brand_name,
            project_id=project_id,
        ):
            if event.get("type") == "error":
                logger.warning("_background_classify error for %s: %s", name, event.get("message"))
    except Exception as exc:
        logger.warning("_background_classify failed for %s: %s", name, exc)


async def stream_refresh_competitor_intelligence(
    project_id: str,
    competitors: list[dict],
):
    """
    Streaming version of competitor intelligence refresh.
    Yields SSE-style event dicts with live progress updates.
    Uses Apify (Instagram, Facebook, TikTok, LinkedIn, YouTube),
    Firecrawl (website), Exa+Tavily (web intelligence), then Claude analysis.
    """
    import asyncio as _asyncio
    from backend.services import firebase_service
    from backend.services.ingestion.apify_client import (
        scrape_instagram, scrape_facebook, scrape_tiktok,
        scrape_linkedin, scrape_youtube, scrape_threads,
    )
    from backend.config import settings as _settings

    def _evt(message: str, icon: str = "activity", detail: str = "", competitor: str = "") -> dict:
        return {"type": "step", "message": message, "icon": icon, "detail": detail, "competitor": competitor}

    if not _settings.APIFY_API_KEY:
        yield _evt("Apify API key not configured - skipping social scraping", "warn")

    results = []
    all_scraped_for_batch: list[dict] = []
    total = min(len(competitors), 5)

    for idx, competitor in enumerate(competitors[:5]):
        name = competitor.get("name", "Unknown")
        website = competitor.get("website", "")
        scraped: dict = {
            "name": name,
            "platforms": {},
            "website": website,
            "logo_url": _logo_url(website),
        }

        yield _evt(f"[{idx+1}/{total}] Starting analysis of {name}", "zap", competitor=name)

        # Instagram
        if competitor.get("instagram") and _settings.APIFY_API_KEY:
            handle = competitor["instagram"].lstrip("@")
            yield _evt(f"Scraping @{handle} on Instagram…", "instagram", f"Fetching last 15 posts", name)
            try:
                data = await scrape_instagram(competitor["instagram"], _settings.APIFY_API_KEY, max_posts=15)
                profile = data.get("profile", {})
                followers = profile.get("followers", 0)
                post_count = len(data.get("posts", []))
                scraped["platforms"]["instagram"] = {
                    "posts": data.get("posts", [])[:10],
                    "profile": profile,
                    "followers": followers,
                    "raw_captions": (data.get("raw_captions") or "")[:3000],
                }
                yield _evt(
                    f"Instagram: {followers:,} followers · {post_count} posts scraped",
                    "check", f"@{handle}", name,
                )
            except Exception as exc:
                yield _evt(f"Instagram scrape failed for {name}", "warn", str(exc)[:80], name)

        # Facebook
        if competitor.get("facebook") and _settings.APIFY_API_KEY:
            yield _evt(f"Reading {name}'s Facebook page…", "facebook", competitor["facebook"][:60], name)
            try:
                data = await scrape_facebook(competitor["facebook"], _settings.APIFY_API_KEY)
                page_likes = data.get("likes", 0)
                scraped["platforms"]["facebook"] = {
                    "posts": data.get("posts", [])[:10],
                    "name": data.get("name", ""),
                    "followers": page_likes,
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
                yield _evt(f"Facebook: {page_likes:,} page likes", "check", data.get("name",""), name)
            except Exception as exc:
                yield _evt(f"Facebook scrape failed for {name}", "warn", str(exc)[:80], name)

        # TikTok
        if competitor.get("tiktok") and _settings.APIFY_API_KEY:
            yield _evt(f"Scanning {name}'s TikTok…", "video", competitor["tiktok"][:60], name)
            try:
                data = await scrape_tiktok(competitor["tiktok"], _settings.APIFY_API_KEY, max_videos=10)
                followers = data.get("followers", 0)
                scraped["platforms"]["tiktok"] = {
                    "videos": data.get("videos", [])[:10],
                    "followers": followers,
                    "top_hashtags": data.get("top_hashtags", []),
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
                yield _evt(f"TikTok: {followers:,} followers · {len(data.get('videos',[]))} videos", "check", "", name)
            except Exception as exc:
                yield _evt(f"TikTok scrape failed for {name}", "warn", str(exc)[:80], name)

        # LinkedIn
        if competitor.get("linkedin") and _settings.APIFY_API_KEY:
            yield _evt(f"Reading {name}'s LinkedIn company page…", "linkedin", "", name)
            try:
                data = await scrape_linkedin(competitor["linkedin"], _settings.APIFY_API_KEY)
                followers = data.get("followers", 0)
                employees = data.get("employees", 0)
                scraped["platforms"]["linkedin"] = {
                    "posts": data.get("posts", [])[:10],
                    "followers": followers,
                    "tagline": data.get("tagline", ""),
                    "industry": data.get("industry", ""),
                    "employees": employees,
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
                yield _evt(
                    f"LinkedIn: {followers:,} followers · {employees:,} employees",
                    "check", data.get("tagline","")[:60], name,
                )
            except Exception as exc:
                yield _evt(f"LinkedIn scrape failed for {name}", "warn", str(exc)[:80], name)

        # YouTube
        if competitor.get("youtube") and _settings.APIFY_API_KEY:
            yield _evt(f"Scanning {name}'s YouTube channel…", "youtube", "", name)
            try:
                data = await scrape_youtube(competitor["youtube"], _settings.APIFY_API_KEY, max_videos=10)
                subs = data.get("subscribers", 0)
                scraped["platforms"]["youtube"] = {
                    "videos": data.get("videos", [])[:10],
                    "channel_name": data.get("channel_name", ""),
                    "subscribers": subs,
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
                yield _evt(f"YouTube: {subs:,} subscribers · {len(data.get('videos',[]))} videos", "check", data.get("channel_name",""), name)
            except Exception as exc:
                yield _evt(f"YouTube scrape failed for {name}", "warn", str(exc)[:80], name)

        # Threads
        if competitor.get("threads") and _settings.APIFY_API_KEY:
            yield _evt(f"Scanning {name}'s Threads…", "activity", competitor["threads"][:60], name)
            try:
                data = await scrape_threads(competitor["threads"], _settings.APIFY_API_KEY)
                followers = data.get("followers", 0)
                scraped["platforms"]["threads"] = {
                    "posts": data.get("posts", [])[:10],
                    "followers": followers,
                    "raw_text": (data.get("raw_text") or "")[:3000],
                }
                yield _evt(f"Threads: {followers:,} followers · {len(data.get('posts',[]))} posts", "check", "", name)
            except Exception as exc:
                yield _evt(f"Threads scrape failed for {name}", "warn", str(exc)[:80], name)

        # Website - Firecrawl
        if competitor.get("website") and _settings.FIRECRAWL_API_KEY:
            url = competitor["website"]
            if not url.startswith("http"):
                url = f"https://{url}"
            yield _evt(f"Reading {url}…", "read", "Extracting website content", name)
            try:
                from backend.services.ingestion.firecrawl_client import scrape_url
                scraped_web = await scrape_url(url, _settings.FIRECRAWL_API_KEY)
                content = scraped_web.get("markdown") or scraped_web.get("content") or ""
                if content:
                    scraped["platforms"]["website"] = {
                        "raw_text": content[:3000],
                        "url": url,
                    }
                    yield _evt(f"Website content extracted", "check", f"{len(content)} chars from {url}", name)
            except Exception as exc:
                yield _evt(f"Could not read {url}", "warn", str(exc)[:60], name)

        # Web enrichment - Exa + Tavily
        from backend.config import settings as _s
        if _s.EXA_API_KEY or _s.TAVILY_API_KEY:
            from backend.services.integrations import exa_client, tavily_client
            yield _evt(f"Web intelligence search for {name}…", "globe", "Exa + Tavily", name)
            try:
                web_tasks = []
                if _s.TAVILY_API_KEY:
                    web_tasks.append(tavily_client.search_news(
                        query=f"{name} brand news announcement product launch",
                        days=60, max_results=4, project_id=project_id,
                    ))
                if _s.EXA_API_KEY:
                    web_tasks.append(exa_client.search_companies(
                        f"{name} company brand", num_results=3, project_id=project_id,
                    ))
                web_results = await _asyncio.gather(*web_tasks, return_exceptions=True)
                news_count = 0
                for wr in web_results:
                    if isinstance(wr, Exception):
                        continue
                    if isinstance(wr, dict):  # Tavily news result
                        news = wr.get("results", [])
                        news_count += len(news)
                        if news:
                            scraped["web"] = scraped.get("web", {})
                            scraped["web"]["recent_news"] = [
                                {"title": r.get("title",""), "snippet": r.get("content","")[:200]}
                                for r in news[:4]
                            ]
                yield _evt(f"Found {news_count} recent news items for {name}", "check", "", name)
            except Exception as exc:
                yield _evt(f"Web enrichment skipped for {name}", "warn", str(exc)[:60], name)

        # Collect for batch analysis - don't call Claude yet
        if scraped["platforms"]:
            all_scraped_for_batch.append(scraped)

        results.append({
            "name": name,
            "platforms_scraped": list(scraped["platforms"].keys()),
        })

    # Batch Claude analysis - ONE call for all competitors instead of N calls
    if all_scraped_for_batch:
        yield _evt(f"Analysing {len(all_scraped_for_batch)} competitor(s) with Claude AI…", "brain", "Single batch call")
        try:
            analyses = await _analyse_competitors_batch(all_scraped_for_batch)
            for scraped in all_scraped_for_batch:
                name = scraped["name"]
                scraped["analysis"] = analyses.get(name, {"tone": "Unknown", "key_themes": [], "content_gaps": []})
                themes_found = scraped["analysis"].get("key_themes", [])
                yield _evt(
                    f"Analysis complete for {name}",
                    "check",
                    f"Themes: {', '.join(themes_found[:3])}" if themes_found else "Strategy extracted",
                    name,
                )
                try:
                    firebase_service.save_competitor_snapshot(project_id, scraped)
                except Exception as exc:
                    yield _evt(f"Save failed for {name}", "warn", str(exc)[:60], name)
        except Exception as exc:
            yield _evt("Batch analysis failed", "warn", str(exc)[:80])

    # Web analysis in background for all competitors
    if (_settings.EXA_API_KEY or _settings.TAVILY_API_KEY) and results:
        yield _evt("Running deep web analysis in background…", "globe", "Exa + Tavily enrichment")
        try:
            import asyncio as _a
            _a.create_task(refresh_competitor_intelligence_web(project_id, competitors))
        except Exception:
            pass

    yield _evt(f"All done - {len(results)} competitor(s) analysed", "done")
    yield {"type": "result", "refreshed": results}


async def _analyse_competitor_web(name: str, web_data: dict) -> dict:
    client = get_client()

    news_section = ""
    if web_data.get("recent_news"):
        headlines = "\n".join(
            f"- {n['title']} ({n['date'][:10]})" for n in web_data["recent_news"][:5]
        )
        news_section = f"\nRECENT NEWS:\n{headlines}"

    summary = web_data.get("company_summary") or web_data.get("news_summary") or ""

    prompt = f"""Analyse this competitor based on web intelligence.

COMPETITOR: {name}
WEB SUMMARY: {summary[:500]}
{news_section}

Return ONLY valid JSON:
{{
  "recent_news_summary": "<1-2 sentence summary>",
  "market_position": "<current positioning>",
  "momentum": "growing",
  "recent_moves": [],
  "opportunity": "<key opportunity for our brand>"
}}"""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        return _parse_json_response(response.content[0].text)
    except Exception:
        return {"recent_news_summary": "", "market_position": "", "momentum": "stable", "recent_moves": [], "opportunity": ""}


# ---------------------------------------------------------------------------
# Live-enriched Hashtag Research
# ---------------------------------------------------------------------------

async def research_hashtags_enriched(
    topic: str,
    platform: str,
    content: str,
    brand_core: dict,
    project_id: Optional[str] = None,
) -> dict:
    """research_hashtags() with live Tavily + Exa trend data injected."""
    import asyncio as _asyncio
    from backend.services.integrations import tavily_client as _tavily, exa_client as _exa
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    live_context = ""
    try:
        async def _tv():
            r = await _tavily.search_basic(
                query=f"trending {topic} hashtags {platform} 2025",
                max_results=3, include_answer=True, project_id=project_id,
            )
            return r.get("answer", "")

        async def _ex():
            rs = await _exa.search(
                query=f"best hashtags {topic} {platform} strategy",
                num_results=3, include_highlights=True, project_id=project_id,
            )
            return " ".join(r.get("highlights", [""])[0] for r in rs[:3] if r.get("highlights"))

        tv_ans, ex_ans = await _asyncio.gather(_tv(), _ex(), return_exceptions=True)
        parts = [x for x in [tv_ans, ex_ans] if isinstance(x, str) and x]
        if parts:
            live_context = "\nLIVE TREND DATA:\n" + "\n".join(parts[:2])
    except Exception:
        pass

    content_section = f"\nCONTENT:\n{content[:500]}" if content else ""

    prompt = f"""You are a social media hashtag strategist.
BRAND: {brand_context}
PLATFORM: {platform}
TOPIC: {topic}{content_section}{live_context}

Return ONLY valid JSON:
{{
  "tiers": {{
    "mega":   [{{"tag": "#tag", "approx_posts": "10M+"}}],
    "large":  [{{"tag": "#tag", "approx_posts": "800k"}}],
    "medium": [{{"tag": "#tag", "approx_posts": "120k"}}],
    "niche":  [{{"tag": "#tag", "approx_posts": "8k"}}]
  }},
  "strategy": "<one sentence>",
  "recommended_mix": "<e.g. 3 mega + 6 large + 8 medium + 5 niche>",
  "trending_now": ["<currently trending tag>"]
}}"""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        return _parse_json_response(response.content[0].text)
    except Exception:
        return {"tiers": {"mega": [], "large": [], "medium": [], "niche": []}, "strategy": "", "recommended_mix": "", "trending_now": []}


# ---------------------------------------------------------------------------
# Influencer Discovery
# ---------------------------------------------------------------------------

async def discover_influencers(
    topic: str,
    platform: str,
    audience_size: str,
    brand_core: dict,
    location: Optional[str] = None,
    project_id: Optional[str] = None,
) -> dict:
    """Discover relevant influencers using Exa's 1B+ people index."""
    from backend.services.integrations import exa_client

    size_hint = {
        "micro": "micro-influencer 10k to 100k followers",
        "macro": "macro-influencer 100k to 1M followers",
        "mega": "mega influencer celebrity 1M+ followers",
    }.get(audience_size, "influencer")

    query = f"{topic} {platform} {size_hint} content creator"
    if location:
        query += f" {location}"

    try:
        raw_results = await exa_client.search_people(query=query, num_results=20, project_id=project_id)
    except Exception as exc:
        logger.error("Exa people search failed: %s", exc)
        return {"influencers": [], "total_found": 0, "error": str(exc)}

    if not raw_results:
        return {"influencers": [], "total_found": 0}

    top_urls = [r["url"] for r in raw_results[:10] if r.get("url")]
    bio_contents: dict[str, str] = {}
    if top_urls:
        try:
            contents = await exa_client.get_contents(top_urls, max_chars=400, project_id=project_id)
            for c in contents:
                if c.get("url") and c.get("text"):
                    bio_contents[c["url"]] = c["text"][:400]
        except Exception:
            pass

    enriched = []
    for r in raw_results[:10]:
        bio = bio_contents.get(r.get("url", ""), "")
        if not bio:
            bio = r.get("summary") or (r.get("highlights", [""])[0] if r.get("highlights") else "")
        enriched.append({
            "name": r.get("title", "")[:80],
            "url": r.get("url", ""),
            "bio": bio[:300],
            "score": r.get("score", 0.5),
        })

    scored = await _score_influencer_alignment(enriched, topic, brand_core)
    return {"influencers": scored, "total_found": len(raw_results), "query_used": query}


async def _score_influencer_alignment(candidates: list[dict], topic: str, brand_core: dict) -> list[dict]:
    client = get_client()
    brand_context = build_brand_core_context(brand_core)
    candidate_list = "\n".join(
        f"{i+1}. {c['name']} ({c['url']})\nBio: {c['bio']}"
        for i, c in enumerate(candidates)
    )

    prompt = f"""Score these influencer candidates for brand alignment.
BRAND CORE: {brand_context}
TOPIC: {topic}
CANDIDATES:
{candidate_list}

Return ONLY valid JSON:
{{"scored": [{{"index": 1, "relevance_score": 0.85, "brand_alignment": "<1 sentence>"}}]}}"""

    score_map: dict = {}
    try:
        response = await client.messages.create(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        data = _parse_json_response(response.content[0].text)
        score_map = {s["index"]: s for s in data.get("scored", [])}
    except Exception:
        pass

    result = []
    for i, c in enumerate(candidates, 1):
        s = score_map.get(i, {})
        result.append({
            "name": c["name"], "url": c["url"], "bio": c["bio"],
            "relevance_score": s.get("relevance_score", round(c.get("score", 0.5), 2)),
            "brand_alignment": s.get("brand_alignment", ""),
        })
    result.sort(key=lambda x: x["relevance_score"], reverse=True)
    return result[:8]


# ---------------------------------------------------------------------------
# Competitor Auto-Discovery
# ---------------------------------------------------------------------------

async def discover_competitors(
    project_id: str,
    brand_core: dict,
    website_url: Optional[str] = None,
) -> dict:
    """
    Discover competitors by:
    1. Web-searching "{brand} competitors" via Tavily (mimics Google AI Overview)
    2. Exa findSimilar on the brand website
    3. Exa company search on brand themes
    4. Synthesising all sources with Claude into rich competitor profiles
    """
    import asyncio as _asyncio
    from backend.services.integrations import exa_client, tavily_client

    brand_name = brand_core.get("brandName") or brand_core.get("name") or "this brand"
    industry   = brand_core.get("industry") or ""
    themes     = brand_core.get("themes") or []
    existing   = set(brand_core.get("competitors") or [])

    raw_web_results: list[str] = []
    candidates: list[dict] = []

    # ── 1. Tavily: "{brand} competitors" direct web search ──────────────────
    async def _tavily_competitor_search():
        try:
            query = f"{brand_name} {industry} top competitors alternatives"
            resp = await tavily_client.search_advanced(
                query=query,
                max_results=8,
                include_answer=True,
                project_id=project_id,
            )
            answer = resp.get("answer", "")
            snippets = [
                f"{r.get('title', '')}: {r.get('content', '')[:400]}"
                for r in (resp.get("results") or [])[:6]
            ]
            return answer, snippets
        except Exception as exc:
            logger.warning("Tavily competitor search failed: %s", exc)
            return "", []

    # ── 2. Exa findSimilar on brand website ─────────────────────────────────
    async def _exa_similar():
        if not website_url:
            return []
        try:
            from urllib.parse import urlparse
            domain = urlparse(website_url).netloc
            similar = await exa_client.find_similar(
                url=website_url, num_results=8,
                exclude_domains=[domain], project_id=project_id,
            )
            return [
                {
                    "name": r.get("title", "").split("|")[0].strip()[:60],
                    "url": r.get("url", ""),
                    "snippet": r.get("summary") or (r.get("highlights") or [""])[0],
                }
                for r in similar
                if r.get("title")
            ]
        except Exception as exc:
            logger.warning("Exa findSimilar failed: %s", exc)
            return []

    # ── 3. Exa company search on brand themes ────────────────────────────────
    async def _exa_company_search():
        if not themes:
            return []
        try:
            query = f"{' '.join(themes[:2])} {industry} company startup"
            results = await exa_client.search_companies(query, num_results=8, project_id=project_id)
            return [
                {
                    "name": r.get("title", "").split("|")[0].strip()[:60],
                    "url": r.get("url", ""),
                    "snippet": r.get("summary") or "",
                }
                for r in results
                if r.get("title")
            ]
        except Exception as exc:
            logger.warning("Exa company search failed: %s", exc)
            return []

    # Run all three in parallel
    (tavily_answer, tavily_snippets), exa_similar_results, exa_company_results = (
        await _asyncio.gather(
            _tavily_competitor_search(),
            _exa_similar(),
            _exa_company_search(),
        )
    )

    raw_web_results = [tavily_answer] + tavily_snippets if tavily_answer else tavily_snippets
    raw_candidates = exa_similar_results + exa_company_results

    # Deduplicate candidates by domain and name
    _seen_domains: set[str] = set()
    _seen_names: set[str] = set()
    candidates: list[dict] = []
    for _c in raw_candidates:
        _cname = (_c.get("name") or "").strip().lower()
        _curl = _c.get("url") or ""
        try:
            from urllib.parse import urlparse as _urlparse
            _cdomain = _urlparse(_curl).netloc.lstrip("www.").lower()
        except Exception:
            _cdomain = ""
        if not _cname:
            continue
        if (_cdomain and _cdomain in _seen_domains) or _cname in _seen_names:
            continue
        if _cdomain:
            _seen_domains.add(_cdomain)
        _seen_names.add(_cname)
        candidates.append(_c)

    # ── 4. Claude: synthesise everything into rich profiles ──────────────────
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    web_context = "\n\n".join(filter(None, raw_web_results[:8]))
    candidate_list = "\n".join(
        f"- {c['name']} ({c['url']}): {c['snippet'][:200]}"
        for c in candidates[:10]
        if c.get("name") and c["name"] not in existing
    )

    prompt = f"""You are a competitive intelligence analyst. Identify the top 6 genuine competitors for this brand.

OUR BRAND: {brand_name}
BRAND CORE: {brand_context}

WEB SEARCH RESULTS (from "{brand_name} competitors" search):
{web_context[:3000] or "No web results available"}

ADDITIONAL COMPANY CANDIDATES:
{candidate_list[:2000] or "None found"}

Extract the 6 most relevant competitors. For each, extract or infer as much information as possible from the available data.

Return ONLY valid JSON:
{{
  "competitors": [
    {{
      "name": "<company name>",
      "url": "<website URL>",
      "description": "<1-2 sentence description of what they do>",
      "what_they_do": "<their core product/service in plain language>",
      "key_advantage": "<their main competitive advantage>",
      "location": "<city, country>",
      "founded": "<year or range e.g. 2018-2020>",
      "employee_count": "<e.g. 11-50 or 200+>",
      "funding_stage": "<bootstrapped|pre-seed|seed|series-a|series-b|public|unknown>",
      "funding_amount": "<e.g. $300K or $2.5M or unknown>",
      "industry": "<industry/sector>",
      "why_competitor": "<1 sentence: why they directly compete with us>",
      "relevance_score": <float 0.0-1.0>,
      "social_hints": {{
        "instagram": "<handle if known, else null>",
        "linkedin": "<company URL if known, else null>",
        "twitter": "<handle if known, else null>"
      }}
    }}
  ]
}}

IMPORTANT:
- Only include genuine competitors (same market, similar customers)
- Relevance score: 0.9+ means direct/primary competitor, 0.6-0.8 means significant, 0.4-0.6 means adjacent
- Extract real data from the web results - don't fabricate funding amounts you don't see in the sources
- Use "unknown" for fields you cannot determine
- Order by relevance_score descending"""

    try:
        response = await client.messages.create(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        result = _parse_json_response(response.content[0].text)
        competitors = result.get("competitors", [])
        # Filter already-tracked
        competitors = [c for c in competitors if c.get("name") and c["name"] not in existing]
        return {"competitors": competitors[:6]}
    except Exception as exc:
        logger.warning("Competitor discovery synthesis failed: %s", exc)
        # Fallback: return raw candidates
        return {
            "competitors": [
                {
                    "name": c["name"],
                    "url": c["url"],
                    "description": c.get("snippet", ""),
                    "why_competitor": "Similar company in the same space",
                    "relevance_score": 0.6,
                }
                for c in candidates[:6]
                if c.get("name") and c["name"] not in existing
            ]
        }


# ---------------------------------------------------------------------------
# Streaming Competitor Auto-Discovery
# ---------------------------------------------------------------------------

async def stream_discover_competitors(
    project_id: str,
    brand_core: dict,
    website_url: Optional[str] = None,
):
    """
    Streaming version of competitor discovery. Yields SSE-style event dicts.
    Uses Tavily, Exa findSimilar, Exa company search, Exa answer,
    and Firecrawl to scrape competitor websites for rich profiles.
    """
    import asyncio as _asyncio
    from backend.services.integrations import exa_client, tavily_client
    from backend.config import settings as _settings

    brand_name = brand_core.get("brandName") or brand_core.get("name") or "this brand"
    industry   = brand_core.get("industry") or ""
    themes     = brand_core.get("themes") or []
    existing   = set(brand_core.get("competitors") or [])

    # ── 0. Cache check (24h TTL) ─────────────────────────────────────────────
    _cache_key = "competitor_discovery"
    try:
        from backend.services import firebase_service as _fs
        _cached = _fs.get_cached_search(project_id, _cache_key)
        if _cached is not None:
            yield {"type": "step", "message": "Returning cached competitor intelligence (refreshes every 24h)", "icon": "check", "detail": ""}
            yield {"type": "result", "competitors": _cached}
            return
    except Exception:
        pass

    def _evt(message: str, icon: str = "search", detail: str = "") -> dict:
        return {"type": "step", "message": message, "icon": icon, "detail": detail}

    raw_web_results: list[str] = []
    candidates: list[dict] = []

    # ── 1. Tavily: "{brand} competitors" ────────────────────────────────────
    yield _evt(f'Searching the web for "{brand_name} competitors"…', "search")
    try:
        resp = await tavily_client.search_advanced(
            query=f"{brand_name} {industry} top competitors alternatives similar companies",
            max_results=8,
            include_answer=True,
            project_id=project_id,
        )
        answer = resp.get("answer", "")
        results = resp.get("results") or []
        snippets = [f"{r.get('title','')}: {r.get('content','')[:400]}" for r in results[:6]]
        if answer:
            raw_web_results.append(answer)
        raw_web_results.extend(snippets)
        yield _evt(
            f"Found {len(results)} web sources",
            "check",
            answer[:120] if answer else f"{len(results)} articles indexed",
        )
    except Exception as exc:
        yield _evt("Web search unavailable - trying other sources", "warn", str(exc)[:80])

    # ── 2. Tavily: industry competitor landscape ─────────────────────────────
    if industry or themes:
        industry_q = industry or (themes[0] if themes else brand_name)
        yield _evt(f'Analysing "{industry_q}" competitive landscape…', "map")
        try:
            resp2 = await tavily_client.search_basic(
                query=f"best {industry_q} companies startups competitive analysis 2024 2025",
                max_results=6,
                include_answer=True,
                project_id=project_id,
            )
            answer2 = resp2.get("answer", "")
            results2 = resp2.get("results") or []
            snippets2 = [f"{r.get('title','')}: {r.get('content','')[:300]}" for r in results2[:5]]
            if answer2:
                raw_web_results.append(answer2)
            raw_web_results.extend(snippets2)
            yield _evt(f"Indexed {len(results2)} industry sources", "check", answer2[:100] if answer2 else "")
        except Exception as exc:
            yield _evt("Industry search skipped", "warn", str(exc)[:80])

    # ── 3. Exa: answer "{brand} top competitors" directly ───────────────────
    yield _evt(f'Deep-diving "{brand_name}" competitive position via Exa…', "brain")
    try:
        exa_answer = await exa_client.answer_question(
            query=f"Who are the top 6 competitors of {brand_name}? List their names, websites, locations, and what they do.",
            project_id=project_id,
        )
        answer_text = exa_answer.get("answer", "")
        if answer_text:
            raw_web_results.append(answer_text)
            yield _evt("Exa intelligence retrieved", "check", answer_text[:120])
    except Exception as exc:
        yield _evt("Exa answer unavailable", "warn", str(exc)[:80])

    # ── 4. Exa findSimilar on brand website ──────────────────────────────────
    if website_url:
        yield _evt(f"Finding similar companies to {website_url}…", "globe")
        try:
            from urllib.parse import urlparse
            domain = urlparse(website_url).netloc
            similar = await exa_client.find_similar(
                url=website_url, num_results=8,
                exclude_domains=[domain], project_id=project_id,
            )
            found = [
                {
                    "name": r.get("title","").split("|")[0].strip()[:60],
                    "url": r.get("url",""),
                    "snippet": r.get("summary") or (r.get("highlights") or [""])[0],
                }
                for r in similar if r.get("title")
            ]
            candidates.extend(found)
            yield _evt(f"Found {len(found)} similar companies", "check", ", ".join(c["name"] for c in found[:4]))
        except Exception as exc:
            yield _evt("findSimilar skipped", "warn", str(exc)[:80])

    # ── 5. Exa company search by themes ──────────────────────────────────────
    if themes or industry:
        q = f"{' '.join(themes[:2])} {industry} company startup brand".strip()
        yield _evt(f'Searching Exa company database for "{q[:50]}"…', "database")
        try:
            results = await exa_client.search_companies(q, num_results=8, project_id=project_id)
            found = [
                {
                    "name": r.get("title","").split("|")[0].strip()[:60],
                    "url": r.get("url",""),
                    "snippet": r.get("summary") or "",
                }
                for r in results if r.get("title")
            ]
            candidates.extend(found)
            yield _evt(f"Found {len(found)} companies in Exa database", "check", ", ".join(c["name"] for c in found[:4]))
        except Exception as exc:
            yield _evt("Exa company search skipped", "warn", str(exc)[:80])

    # ── 6. Firecrawl: scrape up to 8 candidate websites for deeper info ───────
    if _settings.FIRECRAWL_API_KEY and candidates:
        from backend.services.ingestion.firecrawl_client import scrape_url
        scraped_domains: set[str] = set()
        scrape_targets = []
        for c in candidates[:15]:
            if c.get("url"):
                try:
                    from urllib.parse import urlparse as _up
                    d = _up(c["url"]).netloc
                    if d and d not in scraped_domains:
                        scraped_domains.add(d)
                        scrape_targets.append(c)
                        if len(scrape_targets) >= 8:
                            break
                except Exception:
                    pass

        for target in scrape_targets:
            tgt_url = target["url"]
            tgt_name = target["name"]
            yield _evt(f"Reading {tgt_name}'s website…", "read", tgt_url)
            try:
                scraped = await scrape_url(tgt_url, _settings.FIRECRAWL_API_KEY)
                content = scraped.get("markdown") or scraped.get("content") or ""
                if content:
                    # Extract social links directly from the scraped page
                    site_socials = extract_social_links(content)
                    social_note = ""
                    if site_socials:
                        social_note = " | Socials: " + ", ".join(f"{p}: {u}" for p, u in site_socials.items())
                        # Enrich the candidate with discovered socials for Claude context
                        target["socials"] = site_socials
                    raw_web_results.append(
                        f"WEBSITE CONTENT for {tgt_name} ({tgt_url}):\n{content[:2000]}{social_note}"
                    )
                    yield _evt(f"Scraped {tgt_name}", "check", f"{len(content)} chars · {len(site_socials)} social links found")
            except Exception as exc:
                yield _evt(f"Could not read {tgt_name}'s website", "warn", str(exc)[:60])

    # ── 7. Claude synthesises everything into up to 12 competitors ───────────
    yield _evt("Synthesising all intelligence with Claude AI…", "brain")

    # Deduplicate candidates by domain before synthesis and fallback
    _seen_domains: set[str] = set()
    _seen_names: set[str] = set()
    deduped_candidates: list[dict] = []
    for _c in candidates:
        _cname = (_c.get("name") or "").strip().lower()
        _curl = _c.get("url") or ""
        try:
            from urllib.parse import urlparse as _urlparse
            _cdomain = _urlparse(_curl).netloc.lstrip("www.").lower()
        except Exception:
            _cdomain = ""
        if not _cname:
            continue
        if (_cdomain and _cdomain in _seen_domains) or _cname in _seen_names:
            continue
        if _cdomain:
            _seen_domains.add(_cdomain)
        _seen_names.add(_cname)
        deduped_candidates.append(_c)

    client = get_client()
    brand_context = build_brand_core_context(brand_core)
    web_context = "\n\n".join(filter(None, raw_web_results[:15]))
    candidate_list = "\n".join(
        f"- {c['name']} ({c['url']}): {c.get('snippet','')[:200]}"
        + (f" | Socials: {c['socials']}" if c.get('socials') else "")
        for c in deduped_candidates[:15]
        if c.get("name") and c["name"] not in existing
    )

    prompt = f"""You are a competitive intelligence analyst. Identify the top 12 genuine competitors for this brand from the research below.

OUR BRAND: {brand_name}
BRAND CORE: {brand_context}

WEB RESEARCH:
{web_context[:6000] or "No web results"}

ADDITIONAL CANDIDATES (with any social links found on their websites):
{candidate_list[:3000] or "None"}

Extract the 12 most relevant competitors. For each:
- Use ONLY real data from the research - do not fabricate URLs, handles, or stats
- If a social link was found on their website, include it in social_hints
- Include as many social platforms as you can find evidence for

Return ONLY valid JSON:
{{
  "competitors": [
    {{
      "name": "<company name>",
      "url": "<website URL - from research>",
      "description": "<1-2 sentence description>",
      "what_they_do": "<their core product/service>",
      "key_advantage": "<their main competitive advantage>",
      "location": "<city, country - from research or unknown>",
      "founded": "<year - from research or unknown>",
      "employee_count": "<e.g. 11-50 - from research or unknown>",
      "funding_stage": "<bootstrapped|pre-seed|seed|series-a|series-b|public|unknown>",
      "funding_amount": "<e.g. $300K - from research only, else unknown>",
      "industry": "<industry>",
      "why_competitor": "<1 sentence: why they directly compete>",
      "relevance_score": <0.0-1.0>,
      "type": "<company|influencer|creator|media>",
      "segments": ["<B2B and/or B2C>"],
      "geography": "<Local|Regional|National|Global>",
      "estimated_revenue_range": "<<$1M | $1M-$10M | $10M-$50M | $50M+ | unknown - pick one>",
      "social_hints": {{
        "instagram": "<full URL or @handle if found, else null>",
        "facebook": "<full URL if found, else null>",
        "tiktok": "<full URL or @handle if found, else null>",
        "linkedin": "<full LinkedIn company URL if found, else null>",
        "youtube": "<full YouTube URL if found, else null>",
        "twitter": "<@handle if found, else null>"
      }}
    }}
  ]
}}

Order by relevance_score descending. Only include genuine competitors - no investors, partners, or suppliers."""

    try:
        response = await client.messages.create(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=1800,  # competitor discovery JSON (up to 10 competitors), rarely > 1500 tokens
            messages=[{"role": "user", "content": prompt}],
        )
        result = _parse_json_response(response.content[0].text)
        competitors = [c for c in result.get("competitors", []) if c.get("name") and c["name"] not in existing]
        # Enrich with logo URLs
        for _comp in competitors:
            _comp["logo_url"] = _logo_url(_comp.get("url", ""))
        # Persist to 24h cache
        try:
            from backend.services import firebase_service as _fs
            _fs.save_search_cache(project_id, _cache_key, competitors, "discovery", ttl_hours=24)
        except Exception:
            pass
        yield _evt(f"Analysis complete - {len(competitors)} competitors identified", "done")
        yield {"type": "result", "competitors": competitors}
    except Exception as exc:
        yield _evt("Synthesis failed - returning raw candidates", "warn", str(exc)[:80])
        fallback = [
            {
                "name": c["name"], "url": c["url"],
                "description": c.get("snippet", ""),
                "why_competitor": "Similar company in the same space",
                "relevance_score": 0.6,
                "logo_url": _logo_url(c.get("url", "")),
            }
            for c in deduped_candidates[:12] if c.get("name") and c["name"] not in existing
        ]
        yield _evt(f"Returning {len(fallback)} candidates", "done")
        yield {"type": "result", "competitors": fallback}


# ---------------------------------------------------------------------------
# Social link extraction helpers
# ---------------------------------------------------------------------------

_SOCIAL_LINK_PATTERNS = {
    "instagram": re.compile(r'(?:https?://)?(?:www\.)?instagram\.com/([A-Za-z0-9._]+)/?', re.IGNORECASE),
    "facebook":  re.compile(r'(?:https?://)?(?:www\.)?facebook\.com/((?!share|sharer|login|signup|home|intent|p/|photo|video|hashtag|status|compose|settings)[A-Za-z0-9._/-]+)/?', re.IGNORECASE),
    "tiktok":    re.compile(r'(?:https?://)?(?:www\.)?tiktok\.com/@([A-Za-z0-9._]+)/?', re.IGNORECASE),
    "linkedin":  re.compile(r'(?:https?://)?(?:www\.)?linkedin\.com/company/([A-Za-z0-9._-]+)/?', re.IGNORECASE),
    "youtube":   re.compile(r'(?:https?://)?(?:www\.)?youtube\.com/(@[A-Za-z0-9._-]+|channel/[A-Za-z0-9_-]+|c/[A-Za-z0-9._-]+)/?', re.IGNORECASE),
    "twitter":   re.compile(r'(?:https?://)?(?:www\.)?(?:twitter|x)\.com/([A-Za-z0-9_]{1,15})(?:[/?]|$)', re.IGNORECASE),
}

_SOCIAL_FALSE_POSITIVES = {
    "web", "search", "explore", "hashtag", "status", "intent", "share", "sharer",
    "login", "signup", "home", "about", "help", "compose", "settings", "i",
    "in", "jobs", "pulse", "feed", "me", "groups", "events", "pages",
}


def extract_social_links(content: str) -> dict:
    """
    Extract social media profile URLs from scraped website content.
    Returns a dict with platform -> full URL for each found platform.
    """
    links: dict[str, str] = {}
    for platform, pattern in _SOCIAL_LINK_PATTERNS.items():
        match = pattern.search(content)
        if not match:
            continue
        handle_or_path = match.group(1).lstrip("@").strip("/").split("/")[0].lower()
        if handle_or_path in _SOCIAL_FALSE_POSITIVES or len(handle_or_path) < 2:
            continue
        full = match.group(0).strip()
        if not full.startswith("http"):
            full = "https://" + full
        links[platform] = full
    return links


def _instagram_hint_to_url(hint: Optional[str]) -> Optional[str]:
    """Convert an @handle or bare handle from discovery to a full URL."""
    if not hint:
        return None
    hint = hint.strip()
    if "instagram.com" in hint:
        return hint
    handle = hint.lstrip("@")
    return f"https://instagram.com/{handle}" if handle else None


# ---------------------------------------------------------------------------
# Auto-add a discovered competitor (scrape social links + full refresh)
# ---------------------------------------------------------------------------

async def stream_add_discovered_competitor(
    project_id: str,
    competitor: dict,
    brand_core: dict,
    brand_name: str = "",
):
    """
    Add a single discovered competitor automatically:
    1. Scrape their website for social media links (Firecrawl + regex extraction)
    2. Merge with social_hints from discovery
    3. Run the full intelligence refresh (saves to competitor_snapshots)
    4. Run the 5-dimension classifier (saves to competitor_profiles)

    Yields SSE-style event dicts for live frontend progress.
    """
    from backend.config import settings as _settings

    name  = competitor.get("name") or "Unknown"
    url   = competitor.get("url") or ""
    hints = competitor.get("social_hints") or {}

    def _evt(message: str, icon: str = "activity", detail: str = "") -> dict:
        return {"type": "step", "message": message, "icon": icon, "detail": detail, "competitor": name}

    # ── Step 1: Deep website scrape for social links ──────────────────────────
    # Strategy: try Firecrawl first (full markdown), fallback to Tavily site search.
    scraped_social: dict = {}
    website_text: str = ""

    if url:
        yield _evt(f"Scanning {name}'s website for social media profiles…", "globe", url)
        # Attempt 1: Firecrawl (gets full rendered markdown of the page)
        if _settings.FIRECRAWL_API_KEY:
            try:
                from backend.services.ingestion.firecrawl_client import scrape_url
                scraped = await scrape_url(url, _settings.FIRECRAWL_API_KEY)
                content = scraped.get("markdown") or scraped.get("content") or ""
                if content:
                    website_text = content
                    scraped_social = extract_social_links(content)
            except Exception as exc:
                logger.warning("Firecrawl scrape failed for %s: %s", name, exc)

        # Attempt 2: Tavily site: search as fallback
        if not scraped_social and (_settings.TAVILY_API_KEY or _settings.EXA_API_KEY):
            try:
                from backend.services.integrations import tavily_client
                resp = await tavily_client.search_advanced(
                    query=f"site:{url} instagram facebook linkedin tiktok youtube twitter",
                    max_results=5, include_raw_content=True, project_id=project_id,
                )
                combined = " ".join(
                    (r.get("raw_content") or r.get("content") or "") for r in resp.get("results", [])
                )
                if combined:
                    website_text = combined
                    scraped_social = extract_social_links(combined)
            except Exception as exc:
                logger.warning("Tavily site search failed for %s: %s", name, exc)

        found_platforms = list(scraped_social.keys())
        if found_platforms:
            yield _evt(
                f"Found {len(found_platforms)} social profiles: {', '.join(found_platforms)}",
                "check", url,
            )
        else:
            yield _evt("No social links found on website - will rely on search hints", "warn", url)

    # ── Step 2: Merge scraped links + discovery hints ────────────────────────
    def _clean_hint(hint: str | None, base_url: str) -> str | None:
        if not hint:
            return None
        hint = hint.strip()
        if hint.startswith("http"):
            return hint
        # Bare handle → construct full URL
        handle = hint.lstrip("@").strip("/")
        if handle:
            return f"{base_url}/{handle}"
        return None

    merged_competitor = {
        "name":      name,
        "website":   url or None,
        "instagram": (
            scraped_social.get("instagram")
            or _instagram_hint_to_url(hints.get("instagram"))
            or _clean_hint(hints.get("instagram"), "https://instagram.com")
        ),
        "facebook":  (
            scraped_social.get("facebook")
            or hints.get("facebook")
            or _clean_hint(hints.get("facebook"), "https://facebook.com")
        ),
        "tiktok":    (
            scraped_social.get("tiktok")
            or hints.get("tiktok")
            or _clean_hint(hints.get("tiktok"), "https://tiktok.com/@")
        ),
        "linkedin":  (
            scraped_social.get("linkedin")
            or hints.get("linkedin")
            or _clean_hint(hints.get("linkedin"), "https://linkedin.com/company")
        ),
        "youtube":   (
            scraped_social.get("youtube")
            or hints.get("youtube")
            or _clean_hint(hints.get("youtube"), "https://youtube.com")
        ),
        "twitter":   scraped_social.get("twitter") or hints.get("twitter"),
    }

    active_platforms = [p for p in ["instagram", "facebook", "tiktok", "linkedin", "youtube"] if merged_competitor.get(p)]
    yield _evt(
        f"Starting social analysis - {len(active_platforms)} platform(s)" if active_platforms else "Starting analysis (website only)",
        "zap",
        ", ".join(active_platforms) if active_platforms else "website",
    )

    # ── Step 3: Intelligence refresh (saves to competitor_snapshots) ──────────
    yield _evt("Running full social media intelligence refresh…", "activity")
    async for event in stream_refresh_competitor_intelligence(project_id, [merged_competitor]):
        yield event

    # ── Step 4: 5-Dimension classification (saves to competitor_profiles) ─────
    # This is what populates the Profiles tab. Run synchronously in the same
    # SSE stream so the user sees live progress and the profile is guaranteed
    # to be saved before the stream ends.
    yield _evt(f"Classifying {name} into Competitor Profiles…", "crosshair", "5-dimension classification")
    try:
        from backend.services.competitor_classifier_service import classify_competitor as _classify
        from backend.services import firebase_service as _fs

        # Skip if already profiled
        existing_profiles = _fs.get_competitor_profiles(project_id)
        already_exists = any(
            p.get("competitor_name", "").lower() == name.lower()
            for p in existing_profiles
        )
        if already_exists:
            yield _evt(f"{name} already in Profiles - skipping re-classification", "check")
        else:
            effective_brand_name = brand_name or brand_core.get("brandName") or brand_core.get("name") or ""
            async for evt in _classify(
                name=name,
                website=url or None,
                brand_core=brand_core,
                brand_name=effective_brand_name,
                project_id=project_id,
            ):
                yield evt
    except Exception as exc:
        logger.error("Competitor classification failed for %s: %s", name, exc)
        yield _evt(f"Profile classification failed - {exc}", "warn", str(exc)[:120])
