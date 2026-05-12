"""Budget Pacing - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar4 import BudgetPacingRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)
def _sse(d: dict) -> str: return f"data: {json.dumps(d)}\n\n"

_SYSTEM = """\
You are LEO, a paid media budget optimization specialist.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "pacing_summary": "Overall pacing health (on_track | underspending | overspending | at_risk)",
  "campaigns": [
    {
      "name": "Campaign name",
      "platform": "google",
      "status": "on_track | underspending | overspending",
      "pacing_pct": 95,
      "projected_end_of_period_spend": 4820,
      "budget": 5000,
      "action": "No change needed",
      "urgency": "low | medium | high"
    }
  ],
  "reallocation_recommendations": [
    {
      "from_campaign": "Campaign A",
      "to_campaign": "Campaign B",
      "amount": 500,
      "rationale": "Campaign A is 40% behind pace with declining CVR; Campaign B is outperforming CPA target by 25%"
    }
  ],
  "daily_budget_adjustments": [
    {"campaign": "Campaign B", "current_daily": 150, "recommended_daily": 200, "rationale": "..."}
  ],
  "week_end_projections": {
    "total_spend_projected": 18500,
    "total_budget": 20000,
    "pacing_pct": 92.5,
    "conversions_projected": 415
  },
  "automation_rules": [
    {"rule": "Pause if daily spend < 50% of daily target after 3pm", "platforms": ["Google", "Meta"]}
  ],
  "action_checklist": ["Prioritised actions to take today"]
}
"""

async def generate(project: dict, body: BudgetPacingRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        doc = firebase_service.create_pillar1_doc(project_id, "budget_pacing", owner_uid, f"Budget Pacing - {body.pacing_period.title()}")
        doc_id = doc["id"]
        yield _sse({"type": "research_step", "step": "analysing", "label": "Analysing budget pacing…", "status": "running"})
        user_prompt = f"""Pacing period: {body.pacing_period}\nOptimization goal: {body.optimization_goal}\nReallocation threshold: {body.reallocation_threshold_pct}%\n\nCampaign data:\n{json.dumps(body.campaigns, indent=2)}\n\nAnalyse pacing and recommend reallocation."""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=2500, system=_SYSTEM, messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text); yield _sse({"type": "delta", "content": text})
        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try: payload = json.loads(raw)
        except: payload = {"raw": raw, "parse_error": True}
        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 10})
        yield _sse({"type": "research_step", "step": "analysing", "label": "Pacing analysis ready", "status": "done"})
        yield _sse({"type": "budget_pacing_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"
    return _stream()
