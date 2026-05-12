"""Local SEO Management - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar3 import LocalSeoRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, a local SEO specialist with deep expertise in Google Business Profile optimisation, local citations, and geo-targeted content.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "audit_summary": "Overall local SEO health assessment",
  "gbp_optimisation": {
    "business_name_format": "Recommended GBP listing name",
    "category_primary": "Primary Google Business category",
    "categories_secondary": ["Additional categories"],
    "description": "Optimised GBP description (750 chars max)",
    "services": ["Service items to add"],
    "post_ideas": ["5 GBP post ideas for the next 30 days"],
    "photo_checklist": ["Photos to add/update"]
  },
  "local_keyword_targets": [
    {"keyword": "dentist near me", "location_modifier": "London", "intent": "transactional", "priority": "high"}
  ],
  "citation_strategy": {
    "priority_directories": ["Google Business Profile", "Bing Places", "Apple Maps", "Yelp", "industry-specific"],
    "nap_standard": "Business Name | Address | Phone (as it should appear everywhere)",
    "inconsistencies_to_fix": ["Common NAP inconsistency patterns to audit for"]
  },
  "content_recommendations": [
    {"page_type": "location_page", "url_structure": "/location/city-name", "key_content_elements": ["..."], "example_title": "..."}
  ],
  "review_strategy": {
    "request_cadence": "When and how to ask for reviews",
    "response_templates": {"positive": "Template for positive review responses", "negative": "Template for negative review responses"},
    "platforms_to_prioritise": ["Google", "Trustpilot", "G2"]
  },
  "competitor_gaps": ["Local SEO opportunities your competitors are exploiting"],
  "quick_wins": ["High-impact actions to implement this week"],
  "30_day_action_plan": [{"week": 1, "actions": ["..."]}]
}
"""

async def generate(project: dict, body: LocalSeoRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        doc = firebase_service.create_pillar1_doc(project_id, "local_seo", owner_uid, f"Local SEO - {body.business_name}")
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "audit", "label": "Running local SEO audit…", "status": "running"})

        user_prompt = f"""\
Business: {body.business_name}
Category: {body.business_category}
Locations: {', '.join(body.locations)}
Primary service: {body.primary_service}
Known issues: {', '.join(body.current_issues) if body.current_issues else 'None specified'}
Competitors: {', '.join(body.competitors) if body.competitors else 'Unknown'}

Produce a comprehensive local SEO plan for all locations.
"""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=3500, system=_SYSTEM,
                                           messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 20})
        yield _sse({"type": "research_step", "step": "audit", "label": "Local SEO plan ready", "status": "done"})
        yield _sse({"type": "local_seo_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
