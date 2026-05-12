"""International SEO - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar3 import InternationalSeoRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, an international SEO specialist with expertise in hreflang, technical implementation, and market-specific keyword strategy.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "expansion_strategy": "Overall international SEO approach and rationale",
  "recommended_structure": {
    "architecture": "subdirectory | subdomain | ccTLD",
    "rationale": "Why this structure fits their current setup",
    "url_examples": ["example.com/de/", "example.com/fr/"]
  },
  "hreflang_implementation": {
    "example_tags": ["<link rel='alternate' hreflang='de' href='https://example.com/de/' />"],
    "common_mistakes": ["Mistakes to avoid"],
    "implementation_checklist": ["Step-by-step implementation steps"]
  },
  "markets": [
    {
      "market": "Germany",
      "language_code": "de",
      "country_code": "DE",
      "priority": "high",
      "market_size": "Estimated search volume potential",
      "localization_notes": "Cultural and linguistic adaptation notes",
      "top_keyword_adaptations": [{"original": "CRM software", "adapted": "CRM Software (de-DE)", "search_volume_estimate": "high"}],
      "competitor_landscape": "Brief overview of who dominates this market",
      "content_priority": ["First 3 pages/sections to translate/adapt"]
    }
  ],
  "content_strategy": {
    "approach": "What content strategy is right for their budget/resources",
    "translation_vs_adaptation": "When to translate vs. culturally adapt vs. create new",
    "local_link_building": "How to build authority in each target market"
  },
  "technical_checklist": ["Technical SEO items to fix before going international"],
  "rollout_order": ["Which market to launch first and why"],
  "kpis": ["How to measure international SEO success"]
}
"""

async def generate(project: dict, body: InternationalSeoRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        doc = firebase_service.create_pillar1_doc(project_id, "international_seo", owner_uid, f"International SEO - {body.domain}")
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "market_analysis", "label": f"Analysing {len(body.target_markets)} target markets…", "status": "running"})

        user_prompt = f"""\
Domain: {body.domain}
Current market: {body.current_market}
Target markets: {', '.join(body.target_markets)}
Content strategy: {body.content_strategy}
Current site structure: {body.current_structure}
Top current keywords: {', '.join(body.top_keywords) if body.top_keywords else 'Not provided'}

Produce a comprehensive international SEO strategy.
"""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=4000, system=_SYSTEM,
                                           messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 25})
        yield _sse({"type": "research_step", "step": "market_analysis", "label": "International SEO strategy ready", "status": "done"})
        yield _sse({"type": "international_seo_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
