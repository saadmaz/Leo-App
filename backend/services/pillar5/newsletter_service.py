"""
Newsletter Production - Claude curates + writes a full edition, optionally pushed to Loops.

Produces:
  - Complete newsletter edition with all requested sections
  - HTML-formatted body ready to paste into any email platform
  - Subject line + preview text options
  - Optionally creates a draft campaign in Loops.so
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar5 import NewsletterRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND = 1500

SYSTEM = """\
You are an expert newsletter editor and copywriter. You produce well-structured, \
engaging newsletters that readers actually open and forward.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "newsletter_name": "string",
  "edition_topic": "string",
  "subject_line_options": [
    {"subject": "string", "preview_text": "string (≤90 chars)"}
  ],
  "sections": [
    {
      "section_key": "string (e.g. 'intro', 'main_story', 'quick_hits')",
      "section_title": "string (display title)",
      "content": "string (full prose content, HTML-friendly)",
      "word_count": number
    }
  ],
  "html_body": "string (complete newsletter as clean HTML with inline styles - email-client safe)",
  "plain_text_version": "string (full plain text fallback)",
  "total_word_count": number,
  "estimated_read_time_minutes": number,
  "cta": {
    "text": "string",
    "url_placeholder": "string (e.g. '{{article_url}}')"
  },
  "social_snippets": [
    {"platform": "string", "text": "string"}
  ]
}

Rules:
- html_body must use inline CSS (no <style> blocks) for email client compatibility.
- Each section must have complete, publish-ready prose - no lorem ipsum or placeholders.
- subject_line_options: provide exactly 3 options with different angles.
- social_snippets: provide Twitter/X and LinkedIn versions of the main story hook.
- word_count per section: intro 80-150w, main_story 300-500w, quick_hits 150-250w total,
  tip_of_the_week 100-150w, cta 40-80w.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: NewsletterRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Newsletter - {body.newsletter_name} · {body.edition_topic[:50]}"
    doc = firebase_service.create_pillar1_doc(project_id, "newsletter", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})

    # Summarise source URLs if provided (Claude will use them as context)
    source_note = ""
    if body.source_urls:
        source_note = f"\nSOURCE URLs TO DRAW FROM:\n" + "\n".join(f"- {u}" for u in body.source_urls)
        source_note += "\n(Synthesise and cite these sources in the main story section.)"

    yield _sse({"type": "research_step", "step": "brand", "label": "Brand context loaded", "status": "done"})
    yield _sse({"type": "research_step", "step": "writing", "label": "Writing newsletter edition…", "status": "running"})

    sections_str = ", ".join(body.sections)
    prompt = (
        f"BRAND CORE:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"NEWSLETTER REQUEST:\n"
        f"- Newsletter Name: {body.newsletter_name}\n"
        f"- Edition Topic: {body.edition_topic}\n"
        f"- Audience: {body.audience}\n"
        f"- Tone: {body.tone}\n"
        f"- Sections to include: {sections_str}\n"
        + source_note
        + "\n\nWrite the complete newsletter edition now."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=6000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "writing", "label": "Edition written", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    # Push to Loops if requested
    loops_result = None
    if body.push_to_loops and settings.LOOPS_API_KEY:
        yield _sse({"type": "research_step", "step": "loops", "label": "Pushing draft to Loops.so…", "status": "running"})
        from backend.services.pillar5 import loops_client
        subject = (payload.get("subject_line_options") or [{}])[0].get("subject", body.edition_topic)
        html = payload.get("html_body", "")
        try:
            loops_result = await loops_client.create_campaign(
                name=f"{body.newsletter_name} - {body.edition_topic[:60]}",
                subject=subject,
                html_body=html,
            )
        except Exception as exc:
            loops_result = {"error": str(exc)}
        yield _sse({"type": "research_step", "step": "loops", "label": "Loops draft created", "status": "done"})

    if loops_result:
        payload["loops_result"] = loops_result

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
