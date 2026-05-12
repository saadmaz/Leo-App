"""
Headline A/B Variants - Claude, SSE streaming.

Generates N platform-optimised headline variants with angle rationale
for a given topic, article, or content piece.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar2 import HeadlineGenerateRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, a world-class copywriter and conversion strategist.
Generate headline A/B test variants that are distinct in angle and psychology.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "platform": "LinkedIn",
  "topic": "...",
  "variants": [
    {
      "text": "The exact headline text",
      "angle": "curiosity | authority | benefit | urgency | social_proof | data | question | story",
      "psychology": "One sentence explaining why this works",
      "character_count": 72
    }
  ],
  "recommendation": "Which variant to test first and why (1-2 sentences)"
}

RULES:
1. Each variant MUST use a different angle - no two variants can use the same angle.
2. Tailor length and style to the specified platform.
3. Avoid clickbait - every headline must deliver on its promise.
4. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: HeadlineGenerateRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for headline variant generation."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        tone = brand_core.get("tone") or {}

        title = f"Headlines - {body.topic[:50]}"
        doc = firebase_service.create_pillar1_doc(project_id, "headline", owner_uid, title)
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "claude_writing",
                    "label": f"Generating {body.count} headline variants...", "status": "running"})

        brand_ctx = f"Brand: {brand_name}\n"
        if tone.get("style"):
            brand_ctx += f"Brand tone: {tone['style']}\n"
        if body.tone:
            brand_ctx += f"Requested tone override: {body.tone}\n"

        user_prompt = f"""\
{brand_ctx}
Platform: {body.platform}
Topic / Content: {body.topic}
Number of variants requested: {body.count}

Generate {body.count} distinct headline variants optimised for {body.platform}.
"""

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=1024,
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
            "credits_spent": 5,
        })

        yield _sse({"type": "research_step", "step": "claude_writing",
                    "label": f"{body.count} variants ready", "status": "done"})
        yield _sse({"type": "headline_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
