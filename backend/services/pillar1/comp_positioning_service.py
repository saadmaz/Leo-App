"""
Competitive Positioning Map service - existing competitor data + SerpAPI + Claude.

Builds a 2D positioning map placing competitors on user-defined axes (e.g. Price vs Features),
drawing from the project's existing competitor profiles and live SerpAPI research.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar1 import CompMapGenerateRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _serp_search(query: str) -> list[dict]:
    if not settings.SERPAPI_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://serpapi.com/search",
                params={"engine": "google", "q": query, "num": 6, "api_key": settings.SERPAPI_API_KEY},
            )
            resp.raise_for_status()
            return resp.json().get("organic_results", [])
    except Exception as exc:
        logger.warning("SerpAPI search failed: %s", exc)
        return []


_SYSTEM_PROMPT = """\
You are LEO, a competitive intelligence analyst. You map competitors on a 2D positioning grid.

Each competitor gets an X and Y score from 0-10. You must also position the brand itself.
OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "x_axis": "Price",
  "y_axis": "Feature Depth",
  "x_description": "0 = Budget / Low Cost, 10 = Premium / High Cost",
  "y_description": "0 = Simple / Few Features, 10 = Enterprise / Feature-Rich",
  "competitors": [
    {
      "name": "CompetitorA",
      "x": 7.5,
      "y": 8.2,
      "quadrant": "Premium & Feature-Rich",
      "summary": "Enterprise-grade, high-priced, broad feature set",
      "evidence": "Pricing starts at $500/mo, 200+ integrations listed",
      "threat_level": "High"
    }
  ],
  "your_brand": {
    "name": "...",
    "x": 4.5,
    "y": 6.0,
    "quadrant": "Mid-Market Sweet Spot",
    "positioning_opportunity": "Underserved mid-market - more powerful than budget tools, cheaper than enterprise"
  },
  "white_space": "High-value / Low-price quadrant is empty - opportunity to position here",
  "strategic_recommendation": "Own the mid-market by emphasising feature depth at accessible pricing",
  "summary": "2-sentence strategic overview"
}

RULES:
1. X and Y scores must be based on specific evidence (pricing, feature lists, reviews).
2. The 'evidence' field must cite actual data points, not vague impressions.
3. Identify the white space (unoccupied quadrant) as a positioning opportunity.
4. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: CompMapGenerateRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for competitive positioning map generation."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_core = project.get("brandCore") or {}
        brand_name = project.get("name", "the brand")

        title = f"Positioning Map - {body.x_axis} vs {body.y_axis}"
        doc = firebase_service.create_pillar1_doc(project_id, "comp_map", owner_uid, title)
        doc_id = doc["id"]

        # ── Step 1: Load existing competitor profiles from Firestore ─────────
        existing_profiles = firebase_service.list_pillar1_docs(project_id, doc_type=None, limit=0)
        # Also pull from competitor profiles collection
        try:
            competitor_profiles = firebase_service.list_pillar1_docs(project_id, limit=20)
        except Exception:
            competitor_profiles = []

        # ── Step 2: SerpAPI research per competitor ──────────────────────────
        yield _sse({"type": "research_step", "step": "serp_research", "label": f"Researching {len(body.competitors)} competitors...", "status": "running"})

        competitor_research: list[dict] = []
        for comp in body.competitors[:6]:
            results = await _serp_search(f"{comp} pricing features review vs competitors 2025")
            snippets = [r.get("snippet", "") for r in results[:4] if r.get("snippet")]
            competitor_research.append({"name": comp, "snippets": snippets})

        yield _sse({"type": "research_step", "step": "serp_research", "label": "Competitor research complete", "status": "done"})

        # ── Step 3: Claude map synthesis ─────────────────────────────────────
        yield _sse({"type": "research_step", "step": "claude_map_synthesis", "label": "Building positioning map...", "status": "running"})

        messaging = brand_core.get("messaging") or {}
        brand_ctx = f"Brand: {brand_name}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value proposition: {messaging['valueProp']}\n"
        if messaging.get("keyClaims"):
            brand_ctx += f"Key claims: {', '.join(messaging['keyClaims'][:3])}\n"

        research_ctx = "\nCOMPETITOR RESEARCH:\n"
        for comp in competitor_research:
            research_ctx += f"\n{comp['name']}:\n"
            for s in comp["snippets"]:
                research_ctx += f"  - {s}\n"

        user_prompt = f"""\
{brand_ctx}
Axis X: {body.x_axis} (0=low, 10=high)
Axis Y: {body.y_axis} (0=low, 10=high)
Competitors to map: {', '.join(body.competitors)}

{research_ctx}

Place each competitor and our brand on the 2D grid using the research evidence above.
Identify the white space (unoccupied positioning opportunity).
"""

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=settings.LLM_MAX_TOKENS,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "research_cache": {"competitor_research": competitor_research},
            "credits_spent": 35,
        })

        yield _sse({"type": "research_step", "step": "claude_map_synthesis", "label": "Positioning map ready", "status": "done"})
        yield _sse({"type": "comp_map_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
