"""Long-Form Content Generation - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar2 import LongFormRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, an expert content strategist and writer with deep knowledge across B2B and B2C industries.
Write high-quality long-form content that is research-backed, on-brand, and structured for maximum engagement.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "content_type": "blog_post",
  "title": "Final title",
  "meta_description": "SEO meta description (150–160 chars)",
  "estimated_read_time": "8 min",
  "target_keyword": "...",
  "outline": [
    {"section": "Introduction", "word_count": 150, "purpose": "Hook and thesis"}
  ],
  "full_content": "The complete article content in clean markdown",
  "key_takeaways": ["..."],
  "internal_link_suggestions": ["Suggested anchor text → target page topic"],
  "social_snippets": ["Short social share variant 1", "Short social share variant 2"],
  "cta": "The call-to-action text"
}
"""

async def generate(project: dict, body: LongFormRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        tone = brand_core.get("tone") or {}

        title = f"{body.content_type.replace('_',' ').title()} - {body.title[:40]}"
        doc = firebase_service.create_pillar1_doc(project_id, "longform", owner_uid, title)
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "planning", "label": "Planning structure & outline…", "status": "running"})

        brand_ctx = f"Brand: {brand_name}\nTone: {tone.get('style', 'professional')}\n"
        key_points_str = "\n".join(f"- {p}" for p in body.key_points) if body.key_points else "None specified"

        user_prompt = f"""\
{brand_ctx}
Content type: {body.content_type}
Title: {body.title}
Topic: {body.topic}
Target audience: {body.target_audience}
Target word count: {body.word_count}
Tone: {body.tone}
Key points to cover:
{key_points_str}
Target keyword: {body.target_keyword or 'Not specified'}
Include citation markers: {body.include_citations}
CTA: {body.cta or 'Not specified'}

Write the complete long-form piece now. Ensure every section is fully written (not just outlined).
"""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        yield _sse({"type": "research_step", "step": "writing", "label": f"Writing {body.word_count}-word {body.content_type.replace('_',' ')}…", "status": "running"})
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=6000, system=_SYSTEM,
                                           messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 25})
        yield _sse({"type": "research_step", "step": "writing", "label": "Content ready", "status": "done"})
        yield _sse({"type": "longform_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
