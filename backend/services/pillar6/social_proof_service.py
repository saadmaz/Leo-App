"""
Social Proof Harvesting - Scrape mentions + surface best UGC for marketing.

Flow:
1. Search for brand mentions via Tavily (web search) across target platforms
2. Combine with any raw mentions pasted by the user
3. Claude analyses all content, surfaces top testimonials, identifies themes,
   categorises by harvest_goal (testimonials | ugc | sentiment | case_study_leads)
4. Returns structured social proof kit ready to use in marketing
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar6 import SocialProofRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND = 600
_MAX_SEARCH_RESULTS = 8


SYSTEM = """\
You are a social proof strategist and UGC (user-generated content) analyst. \
You mine social mentions for the highest-converting customer proof points.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "harvest_summary": "string (2-3 sentences: what you found, quality of social proof)",
  "sentiment_overview": {
    "positive_pct": number,
    "neutral_pct": number,
    "negative_pct": number,
    "dominant_theme": "string"
  },
  "top_testimonials": [
    {
      "rank": number,
      "author": "string or 'Anonymous'",
      "platform": "string",
      "quote": "string (the best extractable quote - verbatim or cleaned up)",
      "why_it_works": "string (1 sentence: what makes this compelling for marketing)",
      "best_use": "string (e.g. 'Hero section quote', 'Pricing page', 'Email footer', 'Case study intro')",
      "permission_needed": boolean
    }
  ],
  "ugc_highlights": [
    {
      "type": "string (photo_tag | video_mention | story_share | review | thread)",
      "description": "string (what the UGC is)",
      "platform": "string",
      "suggested_action": "string (e.g. 'Repost with credit', 'DM for permission to use in ads')"
    }
  ],
  "case_study_leads": [
    {
      "author": "string or 'Anonymous'",
      "company_hint": "string or null",
      "outcome_mentioned": "string (the specific result they described)",
      "outreach_angle": "string (how to approach them for a full case study)"
    }
  ],
  "negative_patterns": [
    {
      "issue": "string",
      "frequency": "string",
      "response_recommendation": "string"
    }
  ],
  "social_proof_gaps": ["string (types of proof you're missing - e.g. 'No video testimonials found', 'No enterprise customer mentions')"],
  "quick_wins": ["string (immediate action to capture more or better social proof)"]
}

Rules:
- Only surface genuine, specific quotes - avoid generic praise ('great product!').
- Mark permission_needed=true for anything that would be repurposed in paid ads.
- Identify case_study_leads from mentions that include specific outcomes/numbers.
- If content is thin, note it honestly in harvest_summary and focus on gaps + quick wins.
- Negative patterns are valuable - surface them constructively.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: SocialProofRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Social Proof Harvest - {body.brand_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "social_proof", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    # ------------------------------------------------------------------
    # Search for social mentions via Tavily
    # ------------------------------------------------------------------
    search_snippets: list[str] = []

    if settings.TAVILY_API_KEY:
        yield _sse({"type": "research_step", "step": "search", "label": "Searching for brand mentions…", "status": "running"})
        try:
            from backend.services.integrations.tavily_client import search as tavily_search
            platforms_str = " OR ".join(
                f"site:{p}.com" for p in body.platforms[:3]
            ) if body.platforms else ""
            keyword_str = " OR ".join(f'"{kw}"' for kw in body.keywords[:5])
            query = f"{body.brand_name} ({keyword_str}) {platforms_str}"
            results = await tavily_search(query, max_results=_MAX_SEARCH_RESULTS)
            for r in results:
                snippet = r.get("content") or r.get("snippet") or r.get("raw_content") or ""
                if snippet:
                    search_snippets.append(f"[{r.get('url', '')}]\n{snippet[:600]}")
        except Exception as exc:
            logger.warning("Tavily search failed: %s", exc)
        yield _sse({"type": "research_step", "step": "search",
                    "label": f"Found {len(search_snippets)} mention snippets", "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "search",
                    "label": "No Tavily key - using manual mentions only", "status": "done"})

    # Combine search snippets + raw mentions
    all_content_parts: list[str] = []
    if search_snippets:
        all_content_parts.append("--- WEB SEARCH MENTIONS ---\n" + "\n\n".join(search_snippets))
    if body.raw_mentions:
        all_content_parts.append(
            "--- MANUALLY PROVIDED MENTIONS ---\n"
            + "\n".join(f"• {m}" for m in body.raw_mentions[:100])
        )

    if not all_content_parts:
        yield _sse({"type": "error", "message": "No mention content found. Add raw_mentions or configure TAVILY_API_KEY."})
        return

    yield _sse({"type": "research_step", "step": "analysing", "label": "Surfacing best social proof…", "status": "running"})

    prompt = (
        f"BRAND / PRODUCT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"BRAND NAME: {body.brand_name}\n"
        f"HARVEST GOAL: {body.harvest_goal}\n"
        f"TARGET PLATFORMS: {', '.join(body.platforms)}\n\n"
        + "\n\n".join(all_content_parts)
        + "\n\nAnalyse the above content and extract actionable social proof. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=5000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "analysing", "label": "Analysis complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["brand_name"] = body.brand_name
    payload["harvest_goal"] = body.harvest_goal
    payload["keywords_searched"] = body.keywords

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
