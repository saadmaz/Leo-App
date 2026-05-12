"""Creative Performance Analysis - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar4 import CreativePerformanceRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)
def _sse(d: dict) -> str: return f"data: {json.dumps(d)}\n\n"

_SYSTEM = """\
You are LEO, a creative performance analyst specialising in paid social and paid search.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "performance_tier": {
    "winners": [{"name": "creative_name", "reason": "why it wins", "scale_recommendation": "Increase budget by X%"}],
    "mid_tier": [{"name": "creative_name", "reason": "...", "test_recommendation": "..."}],
    "losers": [{"name": "creative_name", "reason": "why it underperforms", "action": "Pause immediately | Test new variant"}]
  },
  "creative_fatigue_signals": [
    {"creative": "creative_name", "age_days": 45, "ctr_trend": "declining -30% over 2 weeks", "action": "Refresh or pause"}
  ],
  "pattern_analysis": {
    "winning_themes": ["What the top creatives have in common"],
    "losing_themes": ["What the worst creatives have in common"],
    "format_insights": "Which ad format is outperforming",
    "hook_insights": "What opening styles work best"
  },
  "creative_briefs": [
    {
      "brief_name": "Replacement for [loser]",
      "format": "video | static | carousel",
      "hook": "Opening hook to test",
      "angle": "pain_point | benefit | social_proof | curiosity | offer",
      "key_message": "Core message",
      "visual_direction": "What the visual should show",
      "cta": "CTA to test"
    }
  ],
  "budget_reallocation": "How to reallocate ${budget} freed from paused creatives",
  "testing_velocity": "Recommended rate of new creative testing per week/month"
}
"""

async def generate(project: dict, body: CreativePerformanceRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        doc = firebase_service.create_pillar1_doc(project_id, "creative_performance", owner_uid, f"Creative Performance - {body.platform}")
        doc_id = doc["id"]
        yield _sse({"type": "research_step", "step": "ranking", "label": f"Ranking {len(body.creatives)} creatives…", "status": "running"})
        user_prompt = f"""Brand: {brand_name}\nPlatform: {body.platform}\nOptimization goal: {body.optimization_goal}\nBudget to reallocate: ${body.budget_to_reallocate or 0}\n\nCreative data:\n{json.dumps(body.creatives, indent=2)}\n\nAnalyse all creatives and provide a complete performance report."""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=3000, system=_SYSTEM, messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text); yield _sse({"type": "delta", "content": text})
        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try: payload = json.loads(raw)
        except: payload = {"raw": raw, "parse_error": True}
        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 15})
        yield _sse({"type": "research_step", "step": "ranking", "label": "Creative analysis ready", "status": "done"})
        yield _sse({"type": "creative_performance_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"
    return _stream()
