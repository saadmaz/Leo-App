"""Content Repurposing Engine - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar2 import RepurposeRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, a content strategist expert at repurposing long-form content into high-performing derivative assets.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "source_summary": "One-sentence summary of the source content",
  "core_insight": "The single most powerful insight that will anchor all repurposed content",
  "repurposed_pieces": [
    {
      "format": "linkedin_post",
      "title": "Short descriptor",
      "content": "Full ready-to-publish content",
      "character_count": 850,
      "hook": "The opening hook used",
      "notes": "Publishing tips for this format"
    }
  ],
  "content_calendar_suggestion": "When and how to release these pieces for maximum impact",
  "what_was_preserved": ["Key ideas that were carried across all formats"],
  "what_was_adapted": ["What changed per format and why"]
}

Supported formats: linkedin_post, twitter_thread, email_newsletter, short_video_script, instagram_caption, facebook_post, podcast_outline, press_release_angle, slide_deck_outline, infographic_brief
"""

async def generate(project: dict, body: RepurposeRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        tone = (brand_core.get("tone") or {}).get("style", "professional")

        formats_str = ", ".join(body.target_formats)
        doc = firebase_service.create_pillar1_doc(project_id, "repurpose", owner_uid, f"Repurpose - {body.source_type.replace('_',' ')}")
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "analysing", "label": "Analysing source content…", "status": "running"})
        yield _sse({"type": "research_step", "step": "repurposing", "label": f"Creating {len(body.target_formats)} format variants…", "status": "running"})

        user_prompt = f"""\
Brand: {brand_name}
Brand tone: {tone}
Source type: {body.source_type}
Target formats: {formats_str}

SOURCE CONTENT:
{body.source_content}

Repurpose this content into the following formats: {formats_str}
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
        yield _sse({"type": "research_step", "step": "repurposing", "label": f"{len(body.target_formats)} formats ready", "status": "done"})
        yield _sse({"type": "repurpose_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
