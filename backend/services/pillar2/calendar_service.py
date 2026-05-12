"""Content Calendar Management - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar2 import ContentCalendarRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, a content strategist who builds data-driven editorial calendars.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "planning_horizon": "90 days",
  "strategy_summary": "2-3 sentence overview of the content strategy",
  "content_pillars": [
    {"pillar": "Pillar name", "percentage": 35, "purpose": "Why this pillar matters"}
  ],
  "monthly_themes": [
    {"month": "Month 1", "theme": "...", "rationale": "..."}
  ],
  "content_items": [
    {
      "week": 1,
      "date_suggestion": "Week of [date]",
      "channel": "linkedin",
      "content_type": "thought_leadership_post",
      "title": "Content title or topic",
      "hook_angle": "The specific angle/hook",
      "content_pillar": "Which pillar this serves",
      "seo_keyword": "Target keyword if applicable",
      "notes": "Production notes"
    }
  ],
  "seasonal_opportunities": ["Upcoming seasonal/event tie-ins"],
  "distribution_cadence": {
    "linkedin": "5x/week",
    "email": "1x/week",
    "blog": "2x/week"
  },
  "kpis": ["What to measure to know the calendar is working"]
}
"""

async def generate(project: dict, body: ContentCalendarRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}

        doc = firebase_service.create_pillar1_doc(project_id, "content_calendar", owner_uid, f"{body.planning_horizon_days}-Day Content Calendar")
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "planning", "label": f"Building {body.planning_horizon_days}-day content calendar…", "status": "running"})

        events_str = "\n".join(f"- {e}" for e in body.upcoming_events) if body.upcoming_events else "None specified"
        pillars_str = "\n".join(f"- {p}" for p in body.content_pillars) if body.content_pillars else "Derive from brand"

        user_prompt = f"""\
Brand: {brand_name}
Brand context: {json.dumps(brand_core.get('positioning') or {}, indent=2)}
Planning horizon: {body.planning_horizon_days} days
Channels: {', '.join(body.channels)}
Posting frequency: {body.posting_frequency or 'Recommend based on channels'}
Content pillars: {pillars_str}
Upcoming events/launches: {events_str}

Build a complete {body.planning_horizon_days}-day content calendar with specific content items per week.
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

        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 20})
        yield _sse({"type": "research_step", "step": "planning", "label": "Calendar ready", "status": "done"})
        yield _sse({"type": "calendar_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
