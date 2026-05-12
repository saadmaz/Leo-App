"""Brand Voice Model - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar2 import BrandVoiceRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, an expert brand strategist and linguistics analyst.
Analyse writing samples to extract a precise brand voice model.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "voice_name": "A memorable 2-word name for this voice (e.g. 'The Confident Challenger')",
  "one_liner": "One sentence that captures the essence of this brand voice",
  "tone_dimensions": {
    "formal_vs_casual": 7,
    "serious_vs_playful": 4,
    "authoritative_vs_approachable": 6,
    "concise_vs_expansive": 8
  },
  "vocabulary": {
    "power_words": ["words they use frequently"],
    "banned_words": ["corporate jargon to avoid"],
    "signature_phrases": ["phrases that are distinctively theirs"]
  },
  "sentence_style": {
    "avg_sentence_length": "short (under 15 words)",
    "structure": "Active voice, direct, starts with verbs",
    "use_of_questions": "Frequent - used to engage and challenge",
    "use_of_data": "Always cite specifics, not vague claims"
  },
  "content_patterns": {
    "opening_hooks": ["How they typically open content"],
    "closing_patterns": ["How they typically close"],
    "cta_style": "Direct and action-oriented"
  },
  "dos": ["Concrete dos"],
  "donts": ["Concrete don'ts"],
  "example_rewrites": [
    {"original": "Our solution provides value to customers", "on_brand": "Rewritten in brand voice"}
  ],
  "application_guide": {
    "blog": "How to apply this voice to blog posts",
    "email": "How to apply to emails",
    "social": "How to apply to social posts",
    "ads": "How to apply to ad copy"
  }
}
"""

async def generate(project: dict, body: BrandVoiceRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        doc = firebase_service.create_pillar1_doc(project_id, "brand_voice", owner_uid, f"Brand Voice - {brand_name}")
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "analysing", "label": "Analysing writing samples…", "status": "running"})

        samples_str = "\n\n---SAMPLE---\n".join(body.sample_content)
        user_prompt = f"""\
Brand: {brand_name}
Content types in samples: {', '.join(body.content_types) if body.content_types else 'Mixed'}
Voice guidance: {body.desired_voice_notes or 'None provided'}

WRITING SAMPLES:
---SAMPLE---
{samples_str}
---END---

Analyse all samples and produce a comprehensive brand voice model.
"""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=3000, system=_SYSTEM,
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
        yield _sse({"type": "research_step", "step": "analysing", "label": "Brand voice model ready", "status": "done"})
        yield _sse({"type": "brand_voice_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
