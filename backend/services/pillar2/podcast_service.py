"""
Podcast Show Notes - OpenAI Whisper (transcription) + Claude (show notes), SSE streaming.

Accepts either a public audio URL (transcribed via Whisper) or a raw transcript string.
Generates structured show notes: summary, key points, timestamps, quotes, description, tags.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar2 import PodcastNotesRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, a podcast producer and show notes writer.
Transform a transcript into polished, SEO-friendly show notes.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "episode_title": "The title of the episode",
  "summary": "2-3 sentence executive summary of the episode",
  "key_takeaways": [
    "Takeaway 1",
    "Takeaway 2",
    "Takeaway 3"
  ],
  "timestamps": [
    { "time": "0:00", "topic": "Introduction" },
    { "time": "5:30", "topic": "Main discussion point" }
  ],
  "notable_quotes": [
    { "speaker": "Guest name or 'Host'", "quote": "The exact quote" }
  ],
  "platform_description": "300-500 word episode description suitable for Spotify/Apple Podcasts (includes SEO keywords)",
  "linkedin_post": "A compelling LinkedIn post to promote this episode (150-200 words)",
  "tags": ["podcast", "relevant", "tags", "for", "discovery"],
  "chapter_markers": "00:00 Intro\\n05:30 Topic One\\n..."
}

RULES:
1. Timestamps must be real - only include ones that appear in the transcript.
2. Quotes must be verbatim from the transcript.
3. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def _transcribe_audio(audio_url: str) -> str:
    """Download audio and transcribe using OpenAI Whisper API."""
    if not settings.OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not configured - cannot transcribe audio")

    async with httpx.AsyncClient(timeout=120.0) as client:
        # Download the audio file
        audio_resp = await client.get(audio_url, follow_redirects=True)
        audio_resp.raise_for_status()
        audio_bytes = audio_resp.content

        # Determine filename from URL for content-type hint
        url_path = audio_url.split("?")[0]
        ext = url_path.rsplit(".", 1)[-1].lower() if "." in url_path else "mp3"
        filename = f"audio.{ext}"

        # Send to Whisper
        whisper_resp = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
            files={"file": (filename, audio_bytes, f"audio/{ext}")},
            data={"model": "whisper-1", "response_format": "verbose_json"},
        )
        whisper_resp.raise_for_status()
        result = whisper_resp.json()
        return result.get("text", "")


async def generate(
    project: dict,
    body: PodcastNotesRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")

        ep_title = body.episode_title or "Podcast Episode"
        title = f"Show Notes - {ep_title[:50]}"
        doc = firebase_service.create_pillar1_doc(project_id, "podcast", owner_uid, title)
        doc_id = doc["id"]

        transcript = body.transcript or ""

        # ── Step 1: Whisper transcription (if audio URL provided) ─────────────
        if body.audio_url and not transcript:
            yield _sse({"type": "research_step", "step": "whisper_transcription",
                        "label": "Transcribing audio with Whisper...", "status": "running"})
            try:
                transcript = await _transcribe_audio(body.audio_url)
                word_count = len(transcript.split())
                yield _sse({"type": "research_step", "step": "whisper_transcription",
                            "label": f"Transcribed {word_count:,} words", "status": "done"})
            except Exception as exc:
                yield _sse({"type": "research_step", "step": "whisper_transcription",
                            "label": f"Transcription failed: {exc}", "status": "skipped"})
                transcript = f"[Transcription unavailable - {exc}]"
        else:
            yield _sse({"type": "research_step", "step": "whisper_transcription",
                        "label": "Using provided transcript", "status": "skipped"})

        if not transcript:
            yield _sse({"type": "error", "message": "No transcript or audio URL provided."})
            return

        # ── Step 2: Claude show notes generation ─────────────────────────────
        yield _sse({"type": "research_step", "step": "claude_notes",
                    "label": "Writing show notes...", "status": "running"})

        speakers = ""
        if body.speaker_names:
            speakers = f"Speakers: {', '.join(body.speaker_names)}\n"

        user_prompt = f"""\
Brand/Show: {brand_name}
Episode title: {ep_title}
{speakers}
TRANSCRIPT:
{transcript[:15000]}

Generate complete show notes for this podcast episode.
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
            "credits_spent": 20,
        })

        yield _sse({"type": "research_step", "step": "claude_notes",
                    "label": "Show notes ready", "status": "done"})
        yield _sse({"type": "podcast_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
