"""
Launch Planning service - pure Claude, SSE streaming.

Generates a week-by-week launch plan (pre-launch, launch week, post-launch)
for a product or campaign, aligned with the brand's channels and voice.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar1 import LaunchPlanRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, a launch strategist and campaign architect.
Your task is to produce a detailed, week-by-week launch plan.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "product_name": "...",
  "launch_date": "YYYY-MM-DD",
  "phases": [
    {
      "phase": "Pre-Launch",
      "weeks": "Weeks 1-4",
      "goal": "Build anticipation and grow waitlist",
      "milestones": ["Teaser post on Instagram", "Email announcement to existing list"],
      "content_calendar": [
        {"week": 1, "channel": "Instagram", "content_type": "Teaser Reel", "copy_hook": "Something big is coming..."}
      ],
      "metrics": ["Email signups", "Social reach"]
    }
  ],
  "budget_guidance": "Split 60% pre-launch (awareness) / 40% launch week (conversion)",
  "risk_flags": ["If launch date falls on a holiday, shift paid ads by 48h"],
  "summary": "2-3 sentence strategic overview"
}

RULES:
1. Always include 3 phases: Pre-Launch, Launch Week, Post-Launch.
2. Content calendar entries must reference specific channels passed in the request.
3. Copy hooks must match the brand's tone exactly - never generic.
4. Risk flags must be specific (dates, platform algorithm changes, competitor activity).
5. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: LaunchPlanRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for launch plan generation."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_core = project.get("brandCore") or {}
        brand_name = project.get("name", "the brand")

        tone = brand_core.get("tone") or {}
        brand_ctx = ""
        if tone:
            brand_ctx += f"Brand tone: {tone.get('style', '')} / {tone.get('formality', '')}\n"
            if tone.get("keyPhrases"):
                brand_ctx += f"Key phrases: {', '.join(tone['keyPhrases'][:5])}\n"
        audience = brand_core.get("audience") or {}
        if audience.get("demographics"):
            brand_ctx += f"Target audience: {audience['demographics']}\n"

        # Create doc
        title = f"Launch Plan - {body.product_name} ({body.launch_date})"
        doc = firebase_service.create_pillar1_doc(project_id, "launch", owner_uid, title)
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "claude_timeline_gen", "label": "Building your launch timeline...", "status": "running"})

        user_prompt = f"""\
Brand: {brand_name}
{brand_ctx}
Product/Campaign: {body.product_name}
Launch Date: {body.launch_date}
Channels: {', '.join(body.channels)}
{f"Budget: {body.budget}" if body.budget else ""}
{f"Target audience: {body.target_audience}" if body.target_audience else ""}

Generate a detailed week-by-week launch plan. Include pre-launch, launch week, and post-launch phases.
Tailor all content hooks to the brand's tone and the listed channels.
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
            "credits_spent": 20,
        })

        yield _sse({"type": "research_step", "step": "claude_timeline_gen", "label": "Launch plan ready", "status": "done"})
        yield _sse({"type": "launch_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
