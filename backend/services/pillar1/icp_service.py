"""
ICP (Ideal Customer Profile) Builder service - Apollo.io + Claude, SSE streaming.

Searches Apollo for companies and decision-makers matching the brand's target,
then synthesises detailed ICP segments with firmographic and psychographic data.
Degrades gracefully if APOLLO_API_KEY is not set (Claude generates from Brand Core alone).
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar1 import ICPGenerateRequest
from backend.services import firebase_service
from backend.services.integrations.apollo_client import search_companies, search_people

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, a B2B and B2C customer intelligence expert.
Your task is to define precise Ideal Customer Profiles (ICPs) based on Brand Core data and enrichment signals.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "segments": [
    {
      "name": "Segment name (e.g. 'Growth-Stage SaaS Founders')",
      "firmographics": {
        "company_size": "11-50 employees",
        "industry": "B2B SaaS",
        "revenue_range": "$1M-$10M ARR",
        "geography": "US, UK, Australia",
        "tech_stack_signals": ["HubSpot", "Slack"]
      },
      "psychographics": {
        "goals": ["Scale MRR", "Reduce churn", "Build brand authority"],
        "pain_points": ["No dedicated marketing team", "Low brand awareness", "Limited budget"],
        "motivators": ["ROI clarity", "Time savings", "Competitive advantage"],
        "objections": ["Too expensive", "Not sure it will work for us"]
      },
      "buying_signals": ["Recently hired CMO", "Raised Series A", "Posting job ads for marketing roles"],
      "preferred_channels": ["LinkedIn", "Email newsletters", "Podcast ads"],
      "decision_maker_titles": ["CEO", "Founder", "Head of Marketing"],
      "apollo_companies_found": 0,
      "apollo_contacts_found": 0
    }
  ],
  "go_to_market_priority": "Segment 1 > Segment 2 with rationale",
  "outreach_angle": "Lead with ROI proof - this ICP responds to numbers over features",
  "summary": "2-3 sentence ICP strategy overview"
}

RULES:
1. Each segment must be distinct - no overlapping customer definitions.
2. Pain points must be specific to the segment, not generic.
3. Buying signals must be detectable (LinkedIn activity, funding news, hiring patterns).
4. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: ICPGenerateRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for ICP generation."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_core = project.get("brandCore") or {}
        brand_name = project.get("name", "the brand")

        title = f"ICP Builder - {brand_name}"
        doc = firebase_service.create_pillar1_doc(project_id, "icp", owner_uid, title)
        doc_id = doc["id"]

        apollo_companies: list[dict] = []
        apollo_people: list[dict] = []

        # ── Step 1: Apollo company search ────────────────────────────────────
        if body.use_apollo and settings.APOLLO_API_KEY:
            yield _sse({"type": "research_step", "step": "apollo_search", "label": "Searching Apollo for target companies...", "status": "running"})
            apollo_companies = await search_companies(
                industry_tags=body.industry_tags or [],
                employee_ranges=body.employee_ranges or ["11,50", "51,200"],
                locations=[body.target_region] if body.target_region != "Global" else [],
                api_key=settings.APOLLO_API_KEY,
                per_page=10,
            )
            yield _sse({"type": "research_step", "step": "apollo_search", "label": f"Found {len(apollo_companies)} target companies via Apollo", "status": "done"})

            # ── Step 2: Apollo people search ─────────────────────────────────
            yield _sse({"type": "research_step", "step": "apollo_search", "label": "Finding decision-makers...", "status": "running"})
            domains = [c.get("primary_domain", "") for c in apollo_companies[:5] if c.get("primary_domain")]
            if domains:
                apollo_people = await search_people(
                    domains=domains,
                    titles=["CEO", "Founder", "CMO", "Head of Marketing", "VP Marketing"],
                    api_key=settings.APOLLO_API_KEY,
                    per_page=10,
                )
            yield _sse({"type": "research_step", "step": "apollo_search", "label": f"Found {len(apollo_people)} decision-makers", "status": "done"})
        else:
            yield _sse({"type": "research_step", "step": "apollo_search", "label": "Apollo not configured - generating ICP from Brand Core", "status": "skipped"})

        # ── Step 3: Claude ICP synthesis ─────────────────────────────────────
        yield _sse({"type": "research_step", "step": "claude_synthesis", "label": "Synthesising ICP segments...", "status": "running"})

        tone = brand_core.get("tone") or {}
        audience = brand_core.get("audience") or {}
        messaging = brand_core.get("messaging") or {}
        competitors = brand_core.get("competitors") or []

        brand_ctx = f"Brand: {brand_name}\n"
        if tone:
            brand_ctx += f"Tone: {tone.get('style', '')} / {tone.get('formality', '')}\n"
        if audience.get("demographics"):
            brand_ctx += f"Current audience: {audience['demographics']}\n"
        if audience.get("interests"):
            brand_ctx += f"Audience interests: {', '.join(audience['interests'][:8])}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value proposition: {messaging['valueProp']}\n"
        if competitors:
            brand_ctx += f"Known competitors: {', '.join(competitors[:5])}\n"
        if body.manual_segments:
            brand_ctx += f"Segment hints from user: {', '.join(body.manual_segments)}\n"

        apollo_ctx = ""
        if apollo_companies:
            sample = apollo_companies[:5]
            apollo_ctx = "\nAPOLLO COMPANY DATA (sample):\n"
            for c in sample:
                apollo_ctx += f"- {c.get('name', 'Unknown')} | {c.get('industry', '')} | {c.get('estimated_num_employees', '')} employees | {c.get('country', '')}\n"
        if apollo_people:
            sample = apollo_people[:5]
            apollo_ctx += "\nAPOLLO DECISION-MAKERS (sample):\n"
            for p in sample:
                apollo_ctx += f"- {p.get('first_name', '')} {p.get('last_name', '')} | {p.get('title', '')} at {p.get('organization', {}).get('name', '')}\n"

        user_prompt = f"""\
{brand_ctx}
Target region: {body.target_region}
{apollo_ctx}

Build 2-3 distinct ICP segments for this brand.
For each segment, include firmographics, psychographics, buying signals, and preferred channels.
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
            # Annotate with Apollo counts
            for i, seg in enumerate(payload.get("segments", [])):
                seg["apollo_companies_found"] = len(apollo_companies) if i == 0 else 0
                seg["apollo_contacts_found"] = len(apollo_people) if i == 0 else 0
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "research_cache": {
                "apollo_companies": apollo_companies[:10],
                "apollo_people": apollo_people[:10],
            },
            "credits_spent": 40,
        })

        yield _sse({"type": "research_step", "step": "claude_synthesis", "label": "ICP segments ready", "status": "done"})
        yield _sse({"type": "icp_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
