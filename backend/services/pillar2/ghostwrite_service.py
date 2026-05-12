"""Thought Leadership Ghostwriting - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar2 import GhostwriteRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, an expert ghostwriter who captures the authentic voice of executives and thought leaders.
Your job is to write content that sounds genuinely like the person - not corporate, not generic.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "content_type": "linkedin_post",
  "executive": "Name",
  "primary_content": "The full ready-to-publish content",
  "hook": "The opening hook extracted",
  "voice_notes": "How you captured their voice - what specific techniques you used",
  "alternative_opening": "An alternative first paragraph with a different hook angle",
  "suggested_hashtags": ["hashtag1"],
  "best_time_to_post": "Tuesday morning 8-10am",
  "engagement_prediction": "Why this will perform well for them",
  "follow_up_prompt": "A follow-up question to ask their audience in the comments"
}
"""

async def generate(project: dict, body: GhostwriteRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")

        title = f"Ghostwrite - {body.executive_name} - {body.content_type}"
        doc = firebase_service.create_pillar1_doc(project_id, "ghostwrite", owner_uid, title)
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "voice_capture", "label": f"Capturing {body.executive_name}'s voice…", "status": "running"})

        points_str = "\n".join(f"- {p}" for p in body.supporting_points) if body.supporting_points else "None"
        user_prompt = f"""\
Brand: {brand_name}
Executive: {body.executive_name}, {body.executive_title}
Content type: {body.content_type}
Topic: {body.topic}
Main argument: {body.key_argument}
Supporting points:
{points_str}
Target audience: {body.target_audience or 'Their LinkedIn/professional network'}
Target word count: {body.word_count}
Tone: {body.tone}

Voice sample (if provided):
{body.executive_voice_sample or 'No sample provided - infer a personal, first-person, authentic professional voice'}

Write content that sounds like this specific person wrote it themselves.
"""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=2500, system=_SYSTEM,
                                           messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 15})
        yield _sse({"type": "research_step", "step": "voice_capture", "label": "Draft ready", "status": "done"})
        yield _sse({"type": "ghostwrite_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
