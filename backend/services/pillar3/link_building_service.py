"""Link Building Outreach - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar3 import LinkBuildingRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, an expert link building strategist and outreach specialist.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "strategy": {
    "approach": "outreach_style",
    "rationale": "Why this approach works for this URL/niche",
    "success_rate_estimate": "Typically 3-8% for cold outreach in this niche"
  },
  "target_prospects": [
    {
      "site_type": "Type of site to target",
      "search_query": "Google search query to find prospects",
      "qualification_criteria": "How to qualify this site",
      "link_opportunity": "Where the link would live (resource page, article, etc.)"
    }
  ],
  "outreach_templates": [
    {
      "template_name": "Initial outreach",
      "subject_line": "...",
      "body": "Full email body with [Personalization] placeholders",
      "personalization_tips": "How to personalise before sending"
    },
    {
      "template_name": "Follow-up 1 (7 days later)",
      "subject_line": "...",
      "body": "..."
    }
  ],
  "value_proposition_angles": ["Different angles to use for different prospect types"],
  "tracking_metrics": ["Open rate", "Reply rate", "Link secured rate"],
  "tools_recommended": ["Tools to streamline this outreach"],
  "red_flags": ["Signs a prospect is not worth pursuing"]
}
"""

async def generate(project: dict, body: LinkBuildingRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        doc = firebase_service.create_pillar1_doc(project_id, "link_building", owner_uid, f"Link Building - {body.outreach_style}")
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "strategy", "label": "Building outreach strategy…", "status": "running"})

        user_prompt = f"""\
Brand: {brand_name}
Domain: {body.your_domain}
Target URL: {body.your_url}
Link angle: {body.link_angle}
Target niches: {', '.join(body.target_niches)}
Outreach style: {body.outreach_style}
Number of prospect types: {body.num_prospects}
Sender name: {body.your_name or 'The user'}
Sender title: {body.your_title or 'Marketing team'}

Create a complete link building outreach plan with templates.
"""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=3000, system=_SYSTEM,
                                           messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 15})
        yield _sse({"type": "research_step", "step": "strategy", "label": "Outreach plan ready", "status": "done"})
        yield _sse({"type": "link_building_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
