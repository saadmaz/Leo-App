"""Negative Keyword Management - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar4 import NegativeKeywordsRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)
def _sse(d: dict) -> str: return f"data: {json.dumps(d)}\n\n"

_SYSTEM = """\
You are LEO, a Google Ads specialist with deep expertise in search term analysis and negative keyword strategy.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "waste_identified": "Total estimated wasted spend from poor search terms",
  "negative_keywords": {
    "exact_match": ["[keyword]"],
    "phrase_match": ['"keyword phrase"'],
    "broad_match": ["keyword"]
  },
  "negative_keyword_lists": [
    {
      "list_name": "Competitor Brand Terms",
      "keywords": ["competitor1", "competitor2"],
      "apply_to": "All campaigns"
    }
  ],
  "from_search_terms_report": [
    {
      "search_term": "free crm software",
      "issue": "Non-buyer intent - 'free' seekers won't convert at our price point",
      "recommended_negative": "[free crm]",
      "match_type": "exact",
      "estimated_savings": "$240/month"
    }
  ],
  "proactive_negatives": [
    {"category": "Job seekers", "keywords": ["jobs", "careers", "salary", "hiring"], "rationale": "..."}
  ],
  "implementation_steps": ["Step-by-step guide to add negatives in the platform"],
  "ongoing_hygiene": "How often to review and how to set up automated alerts",
  "expected_impact": "CPA improvement and waste reduction estimates"
}
"""

async def generate(project: dict, body: NegativeKeywordsRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        doc = firebase_service.create_pillar1_doc(project_id, "negative_keywords", owner_uid, f"Negative Keywords - {body.campaign_name}")
        doc_id = doc["id"]
        yield _sse({"type": "research_step", "step": "analysing", "label": "Analysing search terms…", "status": "running"})
        user_prompt = f"""Campaign: {body.campaign_name}\nPlatform: {body.platform}\nType: {body.campaign_type}\nProduct: {body.product_name}\nDescription: {body.product_description}\nIndustry: {body.industry or 'Not specified'}\nExisting negatives: {', '.join(body.existing_negatives) if body.existing_negatives else 'None'}\n\nSearch terms report:\n{body.search_terms_report or 'Not provided - generate proactive negatives based on industry'}\n\nGenerate comprehensive negative keyword recommendations."""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=2500, system=_SYSTEM, messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text); yield _sse({"type": "delta", "content": text})
        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try: payload = json.loads(raw)
        except: payload = {"raw": raw, "parse_error": True}
        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 10})
        yield _sse({"type": "research_step", "step": "analysing", "label": "Negative keywords ready", "status": "done"})
        yield _sse({"type": "negative_keywords_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"
    return _stream()
