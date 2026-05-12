"""Audience Building - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar4 import AudienceBuildingRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)
def _sse(d: dict) -> str: return f"data: {json.dumps(d)}\n\n"

_SYSTEM = """\
You are LEO, a paid media specialist expert in audience strategy for Meta, Google, LinkedIn, and TikTok.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "audience_strategy": "Overall approach and rationale",
  "primary_audience": {
    "name": "Audience segment name",
    "platform": "meta",
    "type": "custom | lookalike | interest",
    "estimated_size": "1.2M–3.5M",
    "targeting_parameters": {
      "demographics": {"age": "25-45", "gender": "all", "location": "US, UK"},
      "interests": ["Interest categories"],
      "behaviors": ["Behavioral targeting options"],
      "custom_audience_source": "Website visitors last 180 days / CRM list"
    },
    "build_instructions": "Step-by-step instructions to build this audience in the platform"
  },
  "lookalike_audiences": [
    {"seed_audience": "Top 5% website converters", "lookalike_size": "1%", "estimated_reach": "2.1M"}
  ],
  "audience_exclusions": ["Audiences to exclude from targeting"],
  "audience_layering": "How to combine audiences for maximum efficiency",
  "testing_plan": {
    "phase_1": "Which audience to test first and why",
    "phase_2": "How to expand based on results",
    "budget_split": "How to split budget across audiences"
  },
  "crm_upload_instructions": "How to prepare and upload CRM data for custom audiences",
  "expected_performance": {"ctr_benchmark": "1.2–2.5%", "cpa_estimate": "$45–$85", "notes": "..."}
}
"""

async def generate(project: dict, body: AudienceBuildingRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        doc = firebase_service.create_pillar1_doc(project_id, "audience_building", owner_uid, f"Audience - {body.platform} - {body.audience_type}")
        doc_id = doc["id"]
        yield _sse({"type": "research_step", "step": "building", "label": "Building audience strategy…", "status": "running"})
        user_prompt = f"""Brand: {brand_name}\nProduct: {body.product_name}\nPlatform: {body.platform}\nAudience type: {body.audience_type}\nTarget: {body.target_description}\nCRM summary: {body.crm_data_summary or 'Not provided'}\nSeed size: {body.existing_audience_size or 'Unknown'}\nBudget: {body.budget or 'Not specified'}\n\nBuild a complete audience strategy."""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=3000, system=_SYSTEM, messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text); yield _sse({"type": "delta", "content": text})
        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try: payload = json.loads(raw)
        except: payload = {"raw": raw, "parse_error": True}
        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 15})
        yield _sse({"type": "research_step", "step": "building", "label": "Audience strategy ready", "status": "done"})
        yield _sse({"type": "audience_building_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"
    return _stream()
