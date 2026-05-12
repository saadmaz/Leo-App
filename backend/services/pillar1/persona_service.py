"""
Persona Generation service - Apollo.io enrichment + Claude synthesis, SSE streaming.

Builds detailed buyer personas for named segments using Apollo company data
and Claude narrative synthesis.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar1 import PersonaGenerateRequest
from backend.services import firebase_service
from backend.services.integrations.apollo_client import enrich_company, search_people

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, a buyer persona specialist. You create vivid, actionable persona profiles
that marketers can use to write copy, design campaigns, and choose channels.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "personas": [
    {
      "name": "Persona name (e.g. 'Growth-Focused Gemma')",
      "archetype": "The Ambitious Founder",
      "demographics": {
        "age_range": "32-42",
        "role": "Founder / CEO",
        "industry": "B2B SaaS",
        "company_size": "11-50 employees",
        "geography": "London, UK"
      },
      "a_day_in_their_life": "Gemma starts her day checking Slack and Linear...",
      "goals": ["Grow MRR to £500K", "Build a recognisable brand", "Hire first marketing lead"],
      "challenges": ["No time for marketing", "Competing against well-funded rivals", "Small budget"],
      "how_they_find_us": ["LinkedIn ad", "Founder community referral", "Google search"],
      "what_they_say": "I just need something that works without a 6-month setup",
      "what_they_think": "I'm skeptical of marketing tools that promise everything",
      "content_preferences": {
        "formats": ["Short LinkedIn posts", "Case studies", "Podcast episodes"],
        "tone": "Direct, no-nonsense, data-backed",
        "trusted_sources": ["Lenny's Newsletter", "SaaStr", "Indie Hackers"]
      },
      "buying_trigger": "Sees a case study from a similar company with a clear ROI number",
      "messaging_angle": "Lead with time savings + specific ROI - skip the fluff",
      "apollo_enrichment": {}
    }
  ],
  "summary": "2-sentence overview of persona set"
}

RULES:
1. Each persona must be a vivid, named character - not a demographic table.
2. 'a_day_in_their_life' must be a mini-narrative (3+ sentences).
3. Messaging angles must be actionable for copywriters.
4. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: PersonaGenerateRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for persona generation."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_core = project.get("brandCore") or {}
        brand_name = project.get("name", "the brand")

        title = f"Personas - {', '.join(body.segment_names[:2])}"
        doc = firebase_service.create_pillar1_doc(project_id, "persona", owner_uid, title)
        doc_id = doc["id"]

        enrichments: list[dict] = []

        # ── Step 1: Apollo enrichment ────────────────────────────────────────
        if body.use_apollo and settings.APOLLO_API_KEY:
            yield _sse({"type": "research_step", "step": "apollo_enrich", "label": "Enriching persona data via Apollo...", "status": "running"})

            # Enrich provided domains
            for domain in (body.domains_for_enrichment or [])[:3]:
                company_data = await enrich_company(domain, settings.APOLLO_API_KEY)
                if company_data:
                    enrichments.append({"domain": domain, "company": company_data})

            # Search for people matching segment names
            if not enrichments:
                for segment in body.segment_names[:2]:
                    people = await search_people(
                        domains=[],
                        titles=[segment],
                        api_key=settings.APOLLO_API_KEY,
                        per_page=5,
                    )
                    enrichments.extend([{"person": p} for p in people[:3]])

            yield _sse({"type": "research_step", "step": "apollo_enrich", "label": f"Apollo returned {len(enrichments)} enrichment records", "status": "done"})
        else:
            yield _sse({"type": "research_step", "step": "apollo_enrich", "label": "Apollo not configured - generating from Brand Core", "status": "skipped"})

        # ── Step 2: Claude synthesis ─────────────────────────────────────────
        yield _sse({"type": "research_step", "step": "claude_synthesis", "label": "Writing persona profiles...", "status": "running"})

        tone = brand_core.get("tone") or {}
        audience = brand_core.get("audience") or {}
        messaging = brand_core.get("messaging") or {}

        brand_ctx = f"Brand: {brand_name}\n"
        if tone:
            brand_ctx += f"Brand tone: {tone.get('style', '')} / {tone.get('formality', '')}\n"
        if audience.get("demographics"):
            brand_ctx += f"Known audience: {audience['demographics']}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value prop: {messaging['valueProp']}\n"

        enrich_ctx = ""
        if enrichments:
            enrich_ctx = "\nAPOLLO ENRICHMENT DATA:\n"
            for e in enrichments[:5]:
                if "company" in e:
                    c = e["company"]
                    enrich_ctx += f"- Company: {c.get('name', '')} | {c.get('industry', '')} | {c.get('estimated_num_employees', '')} staff | {c.get('country', '')}\n"
                elif "person" in e:
                    p = e["person"]
                    enrich_ctx += f"- Person: {p.get('title', '')} at {p.get('organization', {}).get('name', '')}\n"

        user_prompt = f"""\
{brand_ctx}
Segments to build personas for: {', '.join(body.segment_names)}
{enrich_ctx}

Create one detailed persona per segment. Make each persona vivid and named.
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
            "research_cache": {"enrichments": enrichments},
            "credits_spent": 25,
        })

        yield _sse({"type": "research_step", "step": "claude_synthesis", "label": "Personas ready", "status": "done"})
        yield _sse({"type": "personas_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
