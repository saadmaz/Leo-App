"""
Personal Brand Strategy Engine.

Generates a structured personal brand strategy (platform plan + content pillars +
growth roadmap) using Claude, and runs niche competitor research via SerpAPI.

SSE event format:
  { "type": "step",     "label": "...", "status": "running|done|error" }
  { "type": "progress", "pct": 0-100 }
  { "type": "done",     "strategy": { ... } }
  { "type": "error",    "message": "..." }
"""

import json
import logging
from datetime import datetime, timezone
from typing import AsyncIterator

logger = logging.getLogger(__name__)


def _sse(event_type: str, data: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **data})}\n\n"


# ---------------------------------------------------------------------------
# Strategy generation
# ---------------------------------------------------------------------------

_STRATEGY_SYSTEM = """
You are a personal branding strategist who creates precise, actionable brand strategies.
Return ONLY a valid JSON object - no markdown, no code fences, no commentary.
""".strip()

_STRATEGY_PROMPT = """
Build a complete personal brand strategy for {full_name} based on their Personal Core:

POSITIONING: {positioning}
UNIQUE ANGLE: {unique_angle}
TARGET AUDIENCE: {audience}
CONTENT PILLARS: {pillars}
PLATFORM PREFERENCES: {platform_strategy}
90-DAY GOAL: {goal_90}
12-MONTH GOAL: {goal_12}
ADMIRED VOICES: {admired}
ANTI-VOICES (avoid these styles): {anti}

Return a JSON object with this exact structure:
{{
  "platformAllocation": {{
    "linkedin": {{"percentage": 0-100, "focusLevel": "primary|secondary|passive", "postsPerWeek": 1-7, "contentMix": ["text post", "carousel", "article"]}},
    "instagram": {{"percentage": 0-100, "focusLevel": "primary|secondary|passive", "postsPerWeek": 1-7, "contentMix": ["carousel", "reels", "story"]}},
    "twitter": {{"percentage": 0-100, "focusLevel": "primary|secondary|passive", "postsPerWeek": 1-7, "contentMix": ["thread", "reply", "quote"]}}
  }},
  "contentStrategy": [
    {{
      "pillar": "string",
      "angle": "string - specific differentiating angle",
      "formats": ["string"],
      "frequency": "string",
      "sampleTopics": ["string - 3 specific post ideas"]
    }}
  ],
  "roadmap": {{
    "month1to3": {{
      "focus": "string",
      "metrics": ["string - specific, measurable"],
      "experiments": ["string - content experiments to run"],
      "milestones": ["string"]
    }},
    "month4to6": {{
      "focus": "string",
      "metrics": ["string"],
      "experiments": ["string"],
      "milestones": ["string"]
    }},
    "month7to12": {{
      "focus": "string",
      "metrics": ["string"],
      "experiments": ["string"],
      "milestones": ["string"]
    }}
  }},
  "quickWins": ["string - 3 actions to take in the first 2 weeks"],
  "differentiationStatement": "string - how this person stands out from others in their niche"
}}
"""


async def generate_strategy(project_id: str, personal_core: dict) -> AsyncIterator[str]:
    """Generate a full personal brand strategy. Yields SSE-formatted strings."""
    try:
        yield _sse("step", {"label": "Analysing your Personal Core…", "status": "running"})
        yield _sse("progress", {"pct": 10})

        from backend.config import settings
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        audience = personal_core.get("targetAudience") or {}
        pillars = personal_core.get("contentPillars") or []
        platform_strategy = personal_core.get("platformStrategy") or {}

        prompt = _STRATEGY_PROMPT.format(
            full_name=personal_core.get("fullName", ""),
            positioning=personal_core.get("positioningStatement", ""),
            unique_angle=personal_core.get("uniqueAngle", ""),
            audience=json.dumps(audience),
            pillars=json.dumps(pillars),
            platform_strategy=json.dumps(platform_strategy),
            goal_90=personal_core.get("goal90Day", ""),
            goal_12=personal_core.get("goal12Month", ""),
            admired=", ".join(personal_core.get("admiredVoices") or []),
            anti=", ".join(personal_core.get("antiVoices") or []),
        )

        yield _sse("step", {"label": "Analysing your Personal Core…", "status": "done"})
        yield _sse("step", {"label": "Building your platform strategy…", "status": "running"})
        yield _sse("progress", {"pct": 35})

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=_STRATEGY_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text.strip()

        yield _sse("step", {"label": "Building your platform strategy…", "status": "done"})
        yield _sse("step", {"label": "Crafting your growth roadmap…", "status": "running"})
        yield _sse("progress", {"pct": 70})

        try:
            strategy = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("Strategy JSON parse error: %s\nRaw: %s", e, raw[:500])
            yield _sse("error", {"message": "Failed to parse strategy. Please try again."})
            return

        yield _sse("step", {"label": "Crafting your growth roadmap…", "status": "done"})
        yield _sse("step", {"label": "Saving your strategy…", "status": "running"})
        yield _sse("progress", {"pct": 90})

        # Persist to Firestore
        from backend.services import firebase_service
        db = firebase_service.get_db()
        now = datetime.now(timezone.utc).isoformat()
        strategy_doc = {
            "projectId": project_id,
            "generatedAt": now,
            "updatedAt": now,
            **strategy,
        }
        db.collection("personal_strategies").document(project_id).set(strategy_doc)

        yield _sse("step", {"label": "Saving your strategy…", "status": "done"})
        yield _sse("progress", {"pct": 100})
        yield _sse("done", {"strategy": strategy_doc})

    except Exception as exc:
        logger.exception("Strategy generation failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})


# ---------------------------------------------------------------------------
# Niche research
# ---------------------------------------------------------------------------

_NICHE_SYSTEM = """
You are a competitive intelligence analyst specialising in personal brand niches.
Return ONLY a valid JSON object - no markdown, no code fences, no commentary.
""".strip()

_NICHE_ANALYSIS_PROMPT = """
Based on these search results about competitors and voices in {full_name}'s niche,
produce a structured competitor + content gap analysis.

NICHE KEYWORDS: {niche_keywords}
ADMIRED VOICES: {admired}
SEARCH RESULTS:
{search_results}

Return this JSON:
{{
  "topVoices": [
    {{
      "name": "string",
      "platform": "string",
      "followers": "string - estimate e.g. '120K'",
      "topicFocus": "string",
      "postingFrequency": "string",
      "whatTheyDoWell": "string",
      "contentGapTheyLeave": "string"
    }}
  ],
  "saturatedTopics": ["string - topics everyone covers"],
  "contentGaps": [
    {{
      "gap": "string - underserved angle",
      "opportunity": "string - how this person can own it",
      "urgency": "high|medium|low"
    }}
  ],
  "differentiationOpportunities": ["string - 3 specific ways to stand out"],
  "recommendedNicheAngle": "string - the single best positioning angle based on gaps"
}}
"""


async def research_niche(project_id: str, personal_core: dict) -> AsyncIterator[str]:
    """Research niche competitors and content gaps. Yields SSE-formatted strings."""
    try:
        yield _sse("step", {"label": "Identifying your niche keywords…", "status": "running"})
        yield _sse("progress", {"pct": 5})

        full_name = personal_core.get("fullName", "")
        admired_voices = personal_core.get("admiredVoices") or []
        expertise_topics = personal_core.get("expertiseTopics") or []

        niche_keywords = [t.get("topic", "") for t in expertise_topics if isinstance(t, dict)]
        if not niche_keywords and personal_core.get("uniqueAngle"):
            niche_keywords = [personal_core["uniqueAngle"]]

        yield _sse("step", {"label": "Identifying your niche keywords…", "status": "done"})
        yield _sse("step", {"label": "Searching for top voices in your niche…", "status": "running"})
        yield _sse("progress", {"pct": 20})

        search_results = await _serpapi_search(niche_keywords, admired_voices)

        yield _sse("step", {"label": "Searching for top voices in your niche…", "status": "done"})
        yield _sse("step", {"label": "Analysing content gaps…", "status": "running"})
        yield _sse("progress", {"pct": 55})

        from backend.config import settings
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        prompt = _NICHE_ANALYSIS_PROMPT.format(
            full_name=full_name,
            niche_keywords=", ".join(niche_keywords[:5]),
            admired=", ".join(admired_voices[:5]),
            search_results=search_results[:6000],
        )

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=3000,
            system=_NICHE_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text.strip()

        yield _sse("step", {"label": "Analysing content gaps…", "status": "done"})
        yield _sse("step", {"label": "Saving niche research…", "status": "running"})
        yield _sse("progress", {"pct": 85})

        try:
            niche_data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("Niche research JSON parse error: %s\nRaw: %s", e, raw[:500])
            yield _sse("error", {"message": "Failed to parse niche research. Please try again."})
            return

        # Save as sub-document of strategy
        from backend.services import firebase_service
        db = firebase_service.get_db()
        now = datetime.now(timezone.utc).isoformat()
        niche_doc = {
            "projectId": project_id,
            "generatedAt": now,
            "nicheKeywords": niche_keywords,
            **niche_data,
        }
        db.collection("personal_niche_research").document(project_id).set(niche_doc)

        yield _sse("step", {"label": "Saving niche research…", "status": "done"})
        yield _sse("progress", {"pct": 100})
        yield _sse("done", {"nicheResearch": niche_doc})

    except Exception as exc:
        logger.exception("Niche research failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})


async def _serpapi_search(keywords: list[str], admired_voices: list[str]) -> str:
    """Run SerpAPI searches and return concatenated result text."""
    from backend.config import settings
    import asyncio

    if not settings.SERPAPI_API_KEY:
        return _mock_search_results(keywords)

    try:
        import httpx

        queries = [f'"{kw}" personal brand LinkedIn site:linkedin.com' for kw in keywords[:2]]
        if admired_voices:
            queries.append(f'"{admired_voices[0]}" content strategy')

        all_results = []
        async with httpx.AsyncClient(timeout=15) as client:
            for query in queries:
                resp = await client.get(
                    "https://serpapi.com/search",
                    params={
                        "q": query,
                        "api_key": settings.SERPAPI_API_KEY,
                        "num": 5,
                        "engine": "google",
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    for r in data.get("organic_results", []):
                        all_results.append(
                            f"Title: {r.get('title', '')}\n"
                            f"URL: {r.get('link', '')}\n"
                            f"Snippet: {r.get('snippet', '')}\n"
                        )

        return "\n---\n".join(all_results) if all_results else _mock_search_results(keywords)

    except Exception as e:
        logger.warning("SerpAPI search failed: %s - using fallback", e)
        return _mock_search_results(keywords)


def _mock_search_results(keywords: list[str]) -> str:
    """Fallback placeholder when SerpAPI is unavailable."""
    kw = ", ".join(keywords[:3]) if keywords else "this niche"
    return (
        f"Note: Live search unavailable. Analysing based on known patterns for: {kw}.\n"
        "The AI will provide general competitive intelligence based on the niche keywords provided."
    )
