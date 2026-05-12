"""Bid Strategy Optimization - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar4 import BidStrategyRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)
def _sse(d: dict) -> str: return f"data: {json.dumps(d)}\n\n"

_SYSTEM = """\
You are LEO, a performance marketing specialist expert in bidding strategy across Google, Meta, LinkedIn, and TikTok.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "diagnosis": "Assessment of the current bidding situation",
  "recommended_strategy": {
    "name": "Target CPA",
    "rationale": "Why this is the right strategy for this stage and objective",
    "settings": {"target_cpa": 42.50, "bid_cap": null, "budget_type": "daily"}
  },
  "transition_plan": {
    "phase_1": {"strategy": "Manual CPC", "duration": "2 weeks", "reason": "Build conversion data"},
    "phase_2": {"strategy": "Target CPA", "settings": "...", "trigger": "50+ conversions in 30 days"}
  },
  "bid_adjustments": [
    {"dimension": "device", "adjustment": "+20% mobile", "rationale": "Mobile converts 40% better for this audience"},
    {"dimension": "time_of_day", "adjustment": "-30% overnight (12am-6am)", "rationale": "No conversions during this window"}
  ],
  "smart_bidding_requirements": ["Data thresholds needed before switching to smart bidding"],
  "monitoring_schedule": {
    "daily": ["Metrics to check daily"],
    "weekly": ["Metrics to review weekly"],
    "triggers_to_intervene": ["When to override the algorithm"]
  },
  "expected_outcomes": {
    "week_2": "Initial CPA stabilisation",
    "week_4": "CPA optimisation beginning",
    "week_8": "Target performance expected"
  },
  "red_flags": ["Signs the current strategy is failing and you need to change course"]
}
"""

async def generate(project: dict, body: BidStrategyRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        doc = firebase_service.create_pillar1_doc(project_id, "bid_strategy", owner_uid, f"Bid Strategy - {body.campaign_name}")
        doc_id = doc["id"]
        yield _sse({"type": "research_step", "step": "analysing", "label": "Analysing campaign performance…", "status": "running"})
        user_prompt = f"""Campaign: {body.campaign_name}\nPlatform: {body.platform}\nObjective: {body.objective}\nCurrent strategy: {body.current_bid_strategy or 'Not specified'}\nCurrent metrics: {body.current_metrics or 'Not provided'}\nTarget CPA: {body.target_cpa or 'Not set'}\nTarget ROAS: {body.target_roas or 'Not set'}\nMonthly budget: ${body.monthly_budget or 'Not specified'}\nCampaign maturity: {body.campaign_maturity}\n\nProvide a complete bid strategy optimisation plan."""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=2500, system=_SYSTEM, messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text); yield _sse({"type": "delta", "content": text})
        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try: payload = json.loads(raw)
        except: payload = {"raw": raw, "parse_error": True}
        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 10})
        yield _sse({"type": "research_step", "step": "analysing", "label": "Bid strategy ready", "status": "done"})
        yield _sse({"type": "bid_strategy_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"
    return _stream()
