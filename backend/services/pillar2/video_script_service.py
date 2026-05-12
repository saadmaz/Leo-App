"""
Video Script Writing - Claude, SSE streaming.

Generates a full video script with timestamps, sections, B-roll suggestions,
and a CTA, tailored to the target platform and duration.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar2 import VideoScriptRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, a professional video scriptwriter who understands platform algorithms,
audience retention, and brand storytelling.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "title": "Video title",
  "platform": "YouTube",
  "estimated_duration": "3:45",
  "hook": "The opening 5-second hook sentence",
  "sections": [
    {
      "timestamp": "0:00",
      "section_title": "Hook",
      "script": "Word-for-word script for this section",
      "broll": "B-roll suggestion (what to show on screen)",
      "notes": "Director/presenter notes"
    }
  ],
  "cta": "Exact CTA script at the end",
  "thumbnail_concept": "Visual concept for the thumbnail",
  "tags": ["relevant", "youtube", "tags"],
  "description_snippet": "First 2-3 lines of the YouTube/platform description"
}

PLATFORM RULES:
- TikTok / Instagram Reels: Hook in first 1s, fast cuts, conversational, trending audio note
- YouTube: Strong hook in 30s, chapters, SEO-friendly title, retention loop
- LinkedIn: Professional tone, insight-led, end with a question for engagement

RULES:
1. Script must be word-for-word - ready for a teleprompter.
2. B-roll must be specific and achievable (no "generic stock footage").
3. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: VideoScriptRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        tone = brand_core.get("tone") or {}
        messaging = brand_core.get("messaging") or {}

        title = f"Video Script - {body.topic[:40]}"
        doc = firebase_service.create_pillar1_doc(project_id, "video_script", owner_uid, title)
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "scripting",
                    "label": f"Writing {body.duration_minutes}-min {body.platform} script...",
                    "status": "running"})

        brand_ctx = f"Brand: {brand_name}\n"
        if tone.get("style"):
            brand_ctx += f"Brand tone: {tone['style']}\n"
        if body.tone:
            brand_ctx += f"Requested tone: {body.tone}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value proposition: {messaging['valueProp']}\n"

        user_prompt = f"""\
{brand_ctx}
Platform: {body.platform}
Topic: {body.topic}
Target duration: {body.duration_minutes} minutes
Include B-roll suggestions: {body.include_broll}
CTA goal: {body.cta or 'Follow / Subscribe / Visit website'}

Write a complete, word-for-word video script ready for production.
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

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "credits_spent": 15,
        })

        yield _sse({"type": "research_step", "step": "scripting",
                    "label": "Script ready", "status": "done"})
        yield _sse({"type": "video_script_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
