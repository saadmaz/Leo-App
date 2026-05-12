"""
Content Quality Scoring - Claude, SSE streaming.

Scores content across multiple dimensions (clarity, brand voice, SEO,
engagement, platform fit) and returns actionable improvement suggestions.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar2 import QualityScoreRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, a senior content strategist and brand editor.
Analyse the provided content and score it across 6 dimensions.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "overall_score": 78,
  "grade": "B+",
  "verdict": "One-sentence overall assessment",
  "platform": "LinkedIn",
  "content_type": "post",
  "dimensions": [
    {
      "name": "Clarity",
      "score": 85,
      "feedback": "Specific, actionable feedback on this dimension",
      "examples": "Quote or specific phrase from the content that illustrates the score"
    },
    {
      "name": "Brand Voice Alignment",
      "score": 70,
      "feedback": "...",
      "examples": "..."
    },
    {
      "name": "Engagement Potential",
      "score": 80,
      "feedback": "...",
      "examples": "..."
    },
    {
      "name": "Platform Fit",
      "score": 75,
      "feedback": "...",
      "examples": "..."
    },
    {
      "name": "SEO / Discoverability",
      "score": 60,
      "feedback": "...",
      "examples": "..."
    },
    {
      "name": "Call to Action",
      "score": 90,
      "feedback": "...",
      "examples": "..."
    }
  ],
  "top_3_improvements": [
    "Specific, actionable improvement #1",
    "Specific, actionable improvement #2",
    "Specific, actionable improvement #3"
  ],
  "rewrite_suggestion": "A short rewritten version of the weakest part of the content",
  "publish_ready": true
}

SCORING SCALE: 90-100 = A (Excellent), 80-89 = B (Good), 70-79 = C (Average),
60-69 = D (Needs work), below 60 = F (Rewrite recommended).

RULES:
1. Scores must be integers between 0 and 100.
2. Feedback must reference specific words or phrases from the content.
3. Improvements must be actionable, not generic ("Add a hook" not "Improve the intro").
4. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: QualityScoreRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        tone = brand_core.get("tone") or {}

        title = f"Quality Score - {body.platform} {body.content_type}"
        doc = firebase_service.create_pillar1_doc(project_id, "quality_score", owner_uid, title)
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "analysis",
                    "label": "Analysing content quality...", "status": "running"})

        brand_ctx = f"Brand: {brand_name}\n"
        if tone.get("style"):
            brand_ctx += f"Brand tone: {tone['style']}\n"
        if tone.get("formality"):
            brand_ctx += f"Brand formality: {tone['formality']}\n"

        user_prompt = f"""\
{brand_ctx}
Platform: {body.platform}
Content type: {body.content_type}

CONTENT TO SCORE:
---
{body.content}
---

Score this content across all 6 quality dimensions.
"""

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=2000,
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
            "credits_spent": 10,
        })

        yield _sse({"type": "research_step", "step": "analysis",
                    "label": "Quality report ready", "status": "done"})
        yield _sse({"type": "quality_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
