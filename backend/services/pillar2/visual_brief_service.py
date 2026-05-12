"""
Visual Brief Generation - Claude, SSE streaming.

Generates a structured creative brief for designers (social posts, blog covers,
ad creatives, email banners, thumbnails) grounded in Brand Core.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar2 import VisualBriefRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, a creative director and brand designer.
Produce a detailed visual brief that a designer can hand to a tool like Canva, Figma, or Midjourney.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "content_type": "social_post",
  "platform": "Instagram",
  "dimensions": "1080x1080px",
  "concept": "One-line creative concept",
  "mood": "Bold and energetic | Calm and trustworthy | etc.",
  "color_palette": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "background": "#hex",
    "rationale": "Why these colours work for this brief"
  },
  "typography": {
    "headline_font": "Font name or style description",
    "body_font": "Font name or style description",
    "hierarchy": "Headline big and bold, supporting text smaller"
  },
  "layout": "Description of the visual layout (e.g. full-bleed image with text overlay bottom-left)",
  "imagery": {
    "style": "Photo | Illustration | Abstract | Flat design | 3D render",
    "subject": "What should be in the image",
    "lighting": "Natural light | Studio | Dark/dramatic | Bright/airy",
    "negative_space": "How much empty space to leave"
  },
  "copy_suggestions": {
    "headline": "The headline text to overlay",
    "subheadline": "Supporting copy",
    "cta": "Call to action text"
  },
  "midjourney_prompt": "A ready-to-use Midjourney prompt for the background/hero image",
  "do": ["List of design dos"],
  "dont": ["List of design don'ts"]
}

RULES:
1. Colour palette must be hex codes that actually go well together.
2. Midjourney prompt must be specific, evocative, and under 200 words.
3. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: VisualBriefRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        visual = brand_core.get("visual") or {}
        tone = brand_core.get("tone") or {}

        title = f"Visual Brief - {body.content_type}"
        doc = firebase_service.create_pillar1_doc(project_id, "visual_brief", owner_uid, title)
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "claude_brief",
                    "label": "Crafting visual brief...", "status": "running"})

        brand_ctx = f"Brand: {brand_name}\n"
        if visual.get("primaryColor"):
            brand_ctx += f"Brand primary colour: {visual['primaryColor']}\n"
        if visual.get("secondaryColor"):
            brand_ctx += f"Brand secondary colour: {visual['secondaryColor']}\n"
        if visual.get("fontFamily"):
            brand_ctx += f"Brand font: {visual['fontFamily']}\n"
        if tone.get("style"):
            brand_ctx += f"Brand tone: {tone['style']}\n"
        if body.brand_tone:
            brand_ctx += f"Tone override: {body.brand_tone}\n"

        user_prompt = f"""\
{brand_ctx}
Content type: {body.content_type}
Platform: {body.platform or 'Not specified'}
Dimensions: {body.dimensions or 'Standard for platform'}
Description / objective: {body.description}

Create a complete visual brief for a designer.
"""

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=1500,
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

        yield _sse({"type": "research_step", "step": "claude_brief",
                    "label": "Visual brief ready", "status": "done"})
        yield _sse({"type": "visual_brief_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
