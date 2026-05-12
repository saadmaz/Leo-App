"""
Funnel Strategy Engine - core service.

Responsibilities:
  - Intent detection: is this message asking for a marketing strategy?
  - Session management: create / read / update strategy sessions in Firestore.
  - Intake question routing: return the right question based on funnel type.
  - Research orchestration: Google Trends (SerpAPI) + competitor scraping
    (Apify) + industry benchmarks (SerpAPI Search + Firecrawl).
  - Strategy generation: build a structured Claude prompt and stream the result.
  - Strategy refinement: follow-up Claude calls with full strategy context.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncGenerator, Optional

import anthropic

from backend.config import settings
from backend.services import firebase_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Intent detection - does this message want a marketing strategy?
# ---------------------------------------------------------------------------

_STRATEGY_PATTERNS = [
    r"\b(build|create|make|give me|develop|design|write|craft|put together|generate)\b.{0,30}\b(marketing\s+strategy|funnel|campaign\s+plan|growth\s+plan|content\s+strategy)\b",
    r"\b(plan\s+my\s+funnel|plan\s+a\s+funnel|plan\s+the\s+funnel)\b",
    r"\bmarketing\s+strategy\b",
    r"\b(i\s+want\s+to|help\s+me)\s+(run\s+a\s+campaign|get\s+more\s+customers|grow\s+my\s+(brand|audience|business))\b",
    r"\b(launch\s+(a|my)\s+campaign|run\s+ads|paid\s+strategy|organic\s+strategy)\b",
    r"\b(tofu|mofu|bofu|full[\s-]funnel)\s+strategy\b",
    r"\bgrowth\s+(strategy|plan|roadmap)\b",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in _STRATEGY_PATTERNS]


def detect_strategy_intent(message: str) -> bool:
    """Return True if the message is requesting a marketing / funnel strategy."""
    return any(pat.search(message) for pat in _COMPILED)


# ---------------------------------------------------------------------------
# Funnel type metadata
# ---------------------------------------------------------------------------

FUNNEL_TYPES = {
    "tofu": {
        "label": "Top of Funnel",
        "emoji": "🔺",
        "description": "Build Awareness",
        "questions": [0, 1, 2, 4, 5],   # indices into QUESTIONS list
    },
    "mofu": {
        "label": "Mid Funnel",
        "emoji": "🔶",
        "description": "Nurture & Convert",
        "questions": [0, 1, 2, 3, 4, 5],
    },
    "bofu": {
        "label": "Bottom of Funnel",
        "emoji": "🔻",
        "description": "Close Sales",
        "questions": [0, 1, 2, 3, 4, 5],
    },
    "full": {
        "label": "Full Funnel",
        "emoji": "⚡",
        "description": "End-to-End Strategy",
        "questions": [0, 1, 2, 3, 4, 5],
    },
    "retention": {
        "label": "Retention",
        "emoji": "🔁",
        "description": "Post-Purchase - Loyalty & LTV",
        "questions": [0, 1, 2, 3, 5],
    },
}

# Q0 is the funnel selector - handled separately by the UI widget.
# Q1–Q6 are the intake questions (0-indexed here as indices 0–5).
QUESTIONS = [
    {
        "index": 0,
        "text": "What is the main goal for this strategy?",
        "placeholder": "e.g. Generate leads for my SaaS product",
        "options": [
            "Get more followers",
            "Sell more products",
            "Generate leads",
            "Launch a new product",
            "Build brand awareness",
        ],
    },
    {
        "index": 1,
        "text": "Who is your target customer? Describe them - age, location, what they care about, and what problem they have.",
        "placeholder": "e.g. 25–40 year old small business owners in the UAE who struggle with social media",
    },
    {
        "index": 2,
        "text": "What's your budget for this campaign?",
        "placeholder": "e.g. $500/month, or no budget - organic only",
        "options": [
            "No budget - organic only",
            "Under $500/month",
            "$500–2,000/month",
            "$2,000–5,000/month",
            "$5,000+/month",
        ],
    },
    {
        "index": 3,
        "text": "How long do you want this campaign to run?",
        "placeholder": "e.g. 2 weeks for a launch, 3 months ongoing",
        "options": [
            "1–2 weeks (launch sprint)",
            "1 month",
            "3 months",
            "6 months",
            "Ongoing",
        ],
    },
    {
        "index": 4,
        "text": "Which platforms do you want to focus on?",
        "placeholder": "e.g. Instagram + TikTok, or 'you decide'",
        "options": [
            "Instagram",
            "TikTok",
            "LinkedIn",
            "Instagram + TikTok",
            "All platforms",
            "LEO recommends",
        ],
    },
    {
        "index": 5,
        "text": "Are there any competitors or brands you admire? I'll research how they do it and build on the best parts for you.",
        "placeholder": "e.g. Nike, Glossier, or a local competitor",
    },
]


def get_question_for_session(session: dict, answer_count: int) -> Optional[dict]:
    """
    Return the next unanswered intake question for this session,
    or None if all relevant questions have been answered.
    """
    funnel_type = session.get("funnel_type", "full")
    meta = FUNNEL_TYPES.get(funnel_type, FUNNEL_TYPES["full"])
    relevant_q_indices = meta["questions"]

    if answer_count >= len(relevant_q_indices):
        return None

    q_index = relevant_q_indices[answer_count]
    return QUESTIONS[q_index]


# ---------------------------------------------------------------------------
# Research helpers
# ---------------------------------------------------------------------------

def _extract_industry_keyword(brand_core: Optional[dict], intake_answers: dict) -> str:
    """Derive a short industry keyword from brand core + intake answers."""
    # Try brand themes first
    themes = (brand_core or {}).get("themes", [])
    if themes:
        return themes[0]

    # Fall back to goal answer
    goal = intake_answers.get("q0", "")
    words = goal.lower().split()
    # Remove common stop words
    stops = {"to", "more", "my", "a", "an", "the", "i", "want", "help", "me", "get", "for"}
    keywords = [w for w in words if w not in stops]
    return " ".join(keywords[:3]) if keywords else "marketing"


async def _fetch_google_trends(keyword: str, region: str = "US") -> dict:
    """
    Fetch Google Trends data via SerpAPI.
    Returns parsed insight dict, or empty dict on failure.
    """
    if not settings.SERPAPI_API_KEY:
        logger.warning("SERPAPI_API_KEY not set - skipping Google Trends fetch")
        return {}

    import httpx

    url = "https://serpapi.com/search"
    params = {
        "engine": "google_trends",
        "q": keyword,
        "date": "today 3-m",
        "geo": region,
        "api_key": settings.SERPAPI_API_KEY,
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        interest_over_time = data.get("interest_over_time", {}).get("timeline_data", [])
        related_queries = data.get("related_queries", {})
        rising = related_queries.get("rising", [])
        top = related_queries.get("top", [])

        return {
            "keyword": keyword,
            "region": region,
            "interest_over_time": interest_over_time[-12:] if interest_over_time else [],
            "rising_queries": [q.get("query") for q in rising[:10] if q.get("query")],
            "top_queries": [q.get("query") for q in top[:10] if q.get("query")],
            "peak_month": _find_peak(interest_over_time),
        }
    except Exception as exc:
        logger.warning("Google Trends fetch failed: %s", exc)
        return {}


def _find_peak(timeline: list[dict]) -> str:
    """Return the date string of the highest-interest data point."""
    if not timeline:
        return ""
    try:
        peak = max(timeline, key=lambda x: int(x.get("values", [{}])[0].get("value", 0) or 0))
        return peak.get("date", "")
    except Exception:
        return ""


async def _fetch_serp_benchmarks(industry: str) -> str:
    """
    Search for '{industry} marketing strategy 2025' and return top snippet text.
    Uses SerpAPI Google Search engine.
    """
    if not settings.SERPAPI_API_KEY:
        return ""

    import httpx

    url = "https://serpapi.com/search"
    params = {
        "engine": "google",
        "q": f"{industry} marketing strategy 2025",
        "num": 5,
        "api_key": settings.SERPAPI_API_KEY,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        results = data.get("organic_results", [])
        snippets = [r.get("snippet", "") for r in results[:5] if r.get("snippet")]
        urls = [r.get("link", "") for r in results[:3] if r.get("link")]
        return {
            "snippets": snippets,
            "top_urls": urls,
        }
    except Exception as exc:
        logger.warning("SerpAPI benchmark search failed: %s", exc)
        return {}


async def _scrape_competitor_social(competitor_name: str) -> dict:
    """
    Trigger Apify Instagram scraper for the competitor.
    Returns a lightweight insight dict.
    """
    if not settings.APIFY_API_KEY:
        logger.warning("APIFY_API_KEY not set - skipping competitor scrape")
        return {}

    import httpx

    # Use Instagram scraper as primary - it's fastest and most signal-rich
    actor_id = "apify~instagram-profile-scraper"
    run_url = f"https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items"
    params = {"token": settings.APIFY_API_KEY, "timeout": 45}
    payload = {
        "usernames": [competitor_name.lower().replace(" ", "")],
        "resultsLimit": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(run_url, params=params, json=payload)
            resp.raise_for_status()
            items = resp.json()

        if not items:
            return {"name": competitor_name, "platform": "instagram", "found": False}

        profile = items[0]
        return {
            "name": competitor_name,
            "platform": "instagram",
            "found": True,
            "followers": profile.get("followersCount"),
            "posts_count": profile.get("postsCount"),
            "bio": profile.get("biography", "")[:300],
            "avg_likes": profile.get("avgLikes"),
            "avg_comments": profile.get("avgComments"),
            "engagement_rate": profile.get("engagementRate"),
        }
    except Exception as exc:
        logger.warning("Apify competitor scrape failed for %s: %s", competitor_name, exc)
        return {"name": competitor_name, "found": False, "error": str(exc)}


async def _firecrawl_benchmark_urls(urls: list[str]) -> str:
    """
    Use Firecrawl to extract text from top benchmark URLs.
    Returns concatenated markdown (first 2000 chars total).
    """
    if not settings.FIRECRAWL_API_KEY or not urls:
        return ""

    import httpx

    headers = {"Authorization": f"Bearer {settings.FIRECRAWL_API_KEY}"}
    combined = []
    async with httpx.AsyncClient(timeout=30) as client:
        for url in urls[:2]:
            try:
                resp = await client.post(
                    "https://api.firecrawl.dev/v1/scrape",
                    headers=headers,
                    json={"url": url, "formats": ["markdown"], "onlyMainContent": True},
                )
                resp.raise_for_status()
                data = resp.json()
                md = (data.get("data") or {}).get("markdown", "")
                if md:
                    combined.append(md[:800])
            except Exception as exc:
                logger.debug("Firecrawl failed for %s: %s", url, exc)

    return "\n\n---\n\n".join(combined)


# ---------------------------------------------------------------------------
# Main research orchestrator - yields SSE progress events
# ---------------------------------------------------------------------------

async def run_research(
    session: dict,
    project: dict,
    project_id: str,
) -> AsyncGenerator[str, None]:
    """
    Runs live research for the strategy session.

    Yields SSE events:
        {"type": "research_step", "step": "...", "status": "running"|"done"|"skipped"}
        {"type": "research_complete"}
        {"type": "error", "message": "..."}

    All research results are saved to Firestore for use by generate_strategy().
    """

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    brand_core = project.get("brandCore") or {}
    intake = session.get("intake_answers") or {}

    industry_kw = _extract_industry_keyword(brand_core, intake)
    competitors_raw = intake.get("q5", "")
    competitor_names = [
        c.strip() for c in re.split(r"[,;\n]+", competitors_raw)
        if c.strip() and len(c.strip()) < 60
    ][:3]

    region = "US"  # TODO: derive from brand core or audience answer

    # ── Step 1: Google Trends ────────────────────────────────────────────────
    trends_query = f"{industry_kw} trends {region}"
    yield _sse({"type": "research_step", "step": "google_trends", "label": "Pulling Google Trends data for your industry...", "status": "running"})
    yield _sse({"type": "research_search", "query": trends_query, "source": "google_trends", "engine": "Google Trends", "results": [], "result_count": 0, "status": "searching"})
    trends_data = await _fetch_google_trends(industry_kw, region)
    rising = trends_data.get("rising_queries", [])
    yield _sse({"type": "research_search", "query": trends_query, "source": "google_trends", "engine": "Google Trends", "results": rising[:8], "result_count": len(rising), "status": "done"})
    firebase_service.save_strategy_research_cache(
        project_id, session["id"],
        source="google_trends",
        query_used=industry_kw,
        raw_response=trends_data,
        parsed_insights={
            "rising_queries": rising,
            "top_queries": trends_data.get("top_queries", []),
            "peak_month": trends_data.get("peak_month", ""),
        },
    )
    yield _sse({"type": "research_step", "step": "google_trends", "label": "Google Trends data pulled", "status": "done"})

    # ── Step 2: Industry benchmarks via SerpAPI ──────────────────────────────
    benchmark_query = f"{industry_kw} marketing strategy 2025"
    yield _sse({"type": "research_step", "step": "serp_benchmarks", "label": "Searching for industry benchmarks...", "status": "running"})
    yield _sse({"type": "research_search", "query": benchmark_query, "source": "serp_benchmarks", "engine": "Google Search", "results": [], "result_count": 0, "status": "searching"})
    benchmark_data = await _fetch_serp_benchmarks(industry_kw)
    benchmark_text = ""
    top_urls: list[str] = []
    if benchmark_data:
        top_urls = benchmark_data.get("top_urls", [])
        benchmark_text = await _firecrawl_benchmark_urls(top_urls)
        if not benchmark_text:
            benchmark_text = " ".join(benchmark_data.get("snippets", []))
    yield _sse({"type": "research_search", "query": benchmark_query, "source": "serp_benchmarks", "engine": "Google Search", "results": top_urls, "result_count": len(top_urls), "status": "done"})
    firebase_service.save_strategy_research_cache(
        project_id, session["id"],
        source="serp_benchmarks",
        query_used=benchmark_query,
        raw_response=benchmark_data,
        parsed_insights={"benchmark_text": benchmark_text[:2000]},
    )
    yield _sse({"type": "research_step", "step": "serp_benchmarks", "label": "Industry benchmarks researched", "status": "done"})

    # ── Step 3: Competitor social scraping ───────────────────────────────────
    competitor_insights = []
    if competitor_names:
        yield _sse({"type": "research_step", "step": "competitor_scrape", "label": "Analysing competitor profiles via Apify...", "status": "running"})
        for name in competitor_names:
            apify_query = f"instagram.com/{name.lower().replace(' ', '')}"
            yield _sse({"type": "research_search", "query": apify_query, "source": "apify", "engine": "Apify / Instagram", "results": [], "result_count": 0, "status": "searching"})
            insight = await _scrape_competitor_social(name)
            competitor_insights.append(insight)
            found_count = 1 if insight.get("found") else 0
            yield _sse({"type": "research_search", "query": apify_query, "source": "apify", "engine": "Apify / Instagram", "results": [apify_query] if found_count else [], "result_count": found_count, "status": "done"})
        firebase_service.save_strategy_research_cache(
            project_id, session["id"],
            source="apify_competitors",
            query_used=", ".join(competitor_names),
            raw_response={"competitors": competitor_insights},
            parsed_insights={"competitors": competitor_insights},
        )
        yield _sse({"type": "research_step", "step": "competitor_scrape", "label": "Competitor profiles analysed", "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "competitor_scrape", "label": "No competitors named - skipping scrape", "status": "skipped"})

    # ── Step 4: Brand Core cross-reference ───────────────────────────────────
    yield _sse({"type": "research_step", "step": "brand_core", "label": "Cross-referencing with your Brand Core...", "status": "running"})
    # Brand core is already in memory - just confirm it's loaded
    has_brand_core = bool(brand_core)
    yield _sse({"type": "research_step", "step": "brand_core", "label": "Brand Core loaded" if has_brand_core else "No Brand Core - strategy will be generalised", "status": "done"})

    # ── Mark session as ready to generate ────────────────────────────────────
    firebase_service.update_strategy_session(project_id, session["id"], {"status": "generating"})
    yield _sse({"type": "research_complete"})


# ---------------------------------------------------------------------------
# Strategy generation - yields SSE token stream
# ---------------------------------------------------------------------------

_STRATEGY_SYSTEM_PROMPT = """\
You are LEO, a CMO-level marketing strategist. You have just completed live market research.
Your task is to produce a detailed, actionable marketing strategy tailored to this specific brand.

OUTPUT FORMAT:
Structure your response as a markdown document with exactly these sections in order:

## 🔍 Situation Summary
What the research revealed about the industry, competitor behaviour, and trending opportunities.

## 🧭 Recommended Funnel Approach
Which funnel model and why. Stage-by-stage objectives. Suggested content mix percentages.
Platform allocation with reasoning.

## 📝 Content Strategy
Broken down by funnel stage (TOFU / MOFU / BOFU as relevant).
For each stage: content types, topics from trending queries, posting frequency, hook formulas,
and 2–3 example captions in the brand's voice.

## 📅 Campaign Timeline
Week-by-week execution plan. What to create each week. When to run paid vs organic.
Key dates and seasonal peaks from the trends data.

## 💰 Budget Breakdown
Spend split per platform. Organic vs paid ratio.
Estimated reach at the given budget. Organic-only alternative if budget is zero.

## 📊 KPIs to Track
Platform-specific metrics per funnel stage. What success looks like at 30 / 60 / 90 days.
Leading indicators that show it's working early.

## 🏆 What the Competition Is Missing
Specific content gaps competitors have. Topics trending that no one in the niche covers.
The tone or angle that differentiates this brand.

## ⚡ LEO's Recommendation
"If I were your CMO, here's exactly what I'd do first..."
Give 3 prioritised, opinionated action steps to start THIS WEEK.
Be direct. Name platforms, content types, and tactics explicitly.

RULES:
1. Every recommendation must reference a specific research finding (trends data, competitor gap, or benchmark).
2. All content suggestions must match the brand's tone and voice from the Brand Core - never generic.
3. Call out competitor gaps explicitly with competitor names where available.
4. Give budget breakdowns in actual amounts or percentages - no vague guidance.
5. The LEO's Recommendation section must be opinionated: say what to do first, second, third.
6. Add a SEASONALITY WARNING section if the trends data shows a peak within 8 weeks.
7. Add a PLATFORM MISMATCH ALERT if the user's chosen platform conflicts with their audience age/demographics.
"""


def _build_strategy_prompt(
    session: dict,
    project: dict,
    research_cache: list[dict],
) -> str:
    """Build the full user prompt for Claude strategy generation."""
    brand_core = project.get("brandCore") or {}
    intake = session.get("intake_answers") or {}
    funnel_type = session.get("funnel_type", "full")

    # Flatten research cache by source
    trends_data: dict = {}
    competitor_insights: list = []
    benchmark_text: str = ""

    for item in research_cache:
        source = item.get("source", "")
        parsed = item.get("parsed_insights") or {}
        if source == "google_trends":
            trends_data = parsed
        elif source == "apify_competitors":
            competitor_insights = parsed.get("competitors", [])
        elif source == "serp_benchmarks":
            benchmark_text = parsed.get("benchmark_text", "")

    # Brand core summary
    brand_summary_parts = []
    tone = brand_core.get("tone") or {}
    if tone:
        brand_summary_parts.append(f"Tone: {tone.get('style', '')} / {tone.get('formality', '')}")
    audience = brand_core.get("audience") or {}
    if audience.get("demographics"):
        brand_summary_parts.append(f"Audience: {audience['demographics']}")
    if brand_core.get("themes"):
        brand_summary_parts.append(f"Themes: {', '.join(brand_core['themes'])}")
    if brand_core.get("competitors"):
        brand_summary_parts.append(f"Known competitors: {', '.join(brand_core['competitors'])}")
    messaging = brand_core.get("messaging") or {}
    if messaging.get("valueProp"):
        brand_summary_parts.append(f"Value prop: {messaging['valueProp']}")
    brand_summary = "\n".join(brand_summary_parts) or "No Brand Core available."

    # Intake answers
    intake_text = "\n".join([
        f"Goal: {intake.get('q0', 'Not specified')}",
        f"Target customer: {intake.get('q1', 'Not specified')}",
        f"Budget: {intake.get('q2', 'Not specified')}",
        f"Campaign duration: {intake.get('q3', 'Not specified')}",
        f"Platforms: {intake.get('q4', 'Not specified')}",
        f"Competitors / admired brands: {intake.get('q5', 'None named')}",
    ])

    # Trends summary
    trends_text = ""
    if trends_data:
        rising = trends_data.get("rising_queries", [])
        top = trends_data.get("top_queries", [])
        peak = trends_data.get("peak_month", "")
        trends_text = (
            f"Rising queries: {', '.join(rising[:8])}\n"
            f"Top queries: {', '.join(top[:8])}\n"
            f"Seasonal peak: {peak or 'no clear peak detected'}"
        )
    else:
        trends_text = "No Trends data available (SerpAPI key may not be set)."

    # Competitor summary
    competitor_text = ""
    if competitor_insights:
        lines = []
        for c in competitor_insights:
            if c.get("found"):
                lines.append(
                    f"- {c['name']} (Instagram): "
                    f"{c.get('followers', 'N/A')} followers, "
                    f"engagement rate {c.get('engagement_rate', 'N/A')}, "
                    f"bio: {c.get('bio', '')[:100]}"
                )
            else:
                lines.append(f"- {c.get('name', 'Unknown')}: could not be scraped")
        competitor_text = "\n".join(lines)
    else:
        competitor_text = "No competitors named or scraped."

    return f"""
BRAND: {project.get('name', 'Unknown Brand')}

BRAND CORE:
{brand_summary}

USER'S GOAL AND INTAKE:
{intake_text}

FUNNEL FOCUS: {FUNNEL_TYPES.get(funnel_type, {}).get('label', funnel_type)}

GOOGLE TRENDS RESEARCH:
{trends_text}

COMPETITOR ANALYSIS:
{competitor_text}

INDUSTRY BENCHMARKS:
{benchmark_text[:1500] if benchmark_text else 'No benchmark data available.'}

Now produce the full strategy following the system prompt format exactly.
"""


async def generate_strategy(
    session: dict,
    project: dict,
    project_id: str,
) -> AsyncGenerator[str, None]:
    """
    Stream a full marketing strategy as SSE token deltas.

    Yields:
        {"type": "delta", "content": "..."}  - streamed text chunks
        {"type": "strategy_saved", "strategy_id": "..."}  - after saving
        {"type": "error", "message": "..."}  - on failure
        data: [DONE]
    """

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    # Load research cache
    research_cache = firebase_service.list_strategy_research_cache(project_id, session["id"])

    # Build prompt
    user_prompt = _build_strategy_prompt(session, project, research_cache)

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    from backend.services.llm_service import get_client
    client = get_client()

    assembled: list[str] = []
    try:
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=6000,
            system=_STRATEGY_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

    except anthropic.APIError as exc:
        logger.error("Strategy generation Anthropic error: %s", exc)
        yield _sse({"type": "error", "message": str(exc)})
        return

    full_markdown = "".join(assembled)

    # Parse sections from the markdown
    sections = _parse_strategy_sections(full_markdown)

    # Determine next version number for this project
    existing = firebase_service.list_marketing_strategies(project_id)
    version = len(existing) + 1
    funnel_type = session.get("funnel_type", "full")
    from datetime import datetime
    month_label = datetime.utcnow().strftime("%B %Y")
    title = f"{FUNNEL_TYPES.get(funnel_type, {}).get('label', 'Full Funnel')} Strategy - {month_label}"

    # Save strategy to Firestore
    strategy = firebase_service.save_marketing_strategy(project_id, {
        "session_id": session["id"],
        "version": version,
        "title": title,
        "funnel_type": funnel_type,
        "full_markdown": full_markdown,
        "sections": sections,
        "is_active": True,
        "intake_answers": session.get("intake_answers") or {},
    })

    # Mark session complete
    firebase_service.update_strategy_session(project_id, session["id"], {"status": "complete"})

    yield _sse({"type": "strategy_saved", "strategy_id": strategy["id"], "title": title, "version": version})
    yield "data: [DONE]\n\n"


def _parse_strategy_sections(markdown: str) -> list[dict]:
    """Split the strategy markdown into named sections."""
    sections = []
    current_heading = None
    current_lines: list[str] = []

    for line in markdown.splitlines():
        if line.startswith("## "):
            if current_heading is not None:
                sections.append({
                    "heading": current_heading,
                    "content": "\n".join(current_lines).strip(),
                })
            current_heading = line[3:].strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_heading:
        sections.append({
            "heading": current_heading,
            "content": "\n".join(current_lines).strip(),
        })

    return sections


# ---------------------------------------------------------------------------
# Strategy refinement
# ---------------------------------------------------------------------------

async def refine_strategy(
    strategy: dict,
    follow_up: str,
) -> AsyncGenerator[str, None]:
    """
    Stream a refined / follow-up response based on an existing strategy.

    Yields standard SSE delta events ending with data: [DONE].
    """

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    from backend.services.llm_service import get_client
    client = get_client()

    system = (
        "You are LEO, a CMO-level marketing strategist. "
        "You previously generated the strategy below for this brand. "
        "The user has a follow-up request - answer it concisely, referencing the existing strategy. "
        "If they want a specific section revised, output just that revised section in full."
    )

    existing_md = strategy.get("full_markdown", "")[:6000]
    messages = [
        {"role": "assistant", "content": f"Here is the strategy I previously created:\n\n{existing_md}"},
        {"role": "user", "content": follow_up},
    ]

    try:
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=4000,
            system=system,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield _sse({"type": "delta", "content": text})

        yield "data: [DONE]\n\n"

    except anthropic.APIError as exc:
        logger.error("Strategy refinement Anthropic error: %s", exc)
        yield _sse({"type": "error", "message": str(exc)})
