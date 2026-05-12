"""
Email Sequence Builder - Claude writes the full sequence, Loops.so stores/sends it.

Produces:
  - Per-email: subject line, preview text, full HTML-ready body, send delay, trigger condition
  - Sequence overview: goal, tone, frequency rationale
  - Optionally pushes each email to Loops.so as a campaign draft (if LOOPS_API_KEY set)
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar5 import EmailSequenceRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND = 2000

SYSTEM = """\
You are an expert email marketing strategist and copywriter. You write high-converting \
email sequences that feel personal, not salesy.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "sequence_name": "string",
  "goal": "string",
  "audience": "string",
  "sequence_overview": "string (2-3 sentences on strategy and tone)",
  "frequency_rationale": "string",
  "emails": [
    {
      "email_number": number,
      "send_delay": "string (e.g. 'Immediately', 'Day 2', 'Day 5 - 10am recipient time')",
      "trigger_condition": "string (e.g. 'On signup', 'If previous email not opened')",
      "subject_line": "string",
      "preview_text": "string (≤90 chars - shows after subject in inbox)",
      "body_text": "string (full plain-text email body, ~150-300 words)",
      "cta_text": "string",
      "cta_url_placeholder": "string (e.g. '{{dashboard_url}}')",
      "personalization_tokens": ["string (e.g. '{{first_name}}')"],
      "angle": "string (e.g. 'value delivery', 'social proof', 'objection handling')",
      "purpose": "string (1 sentence: what this email achieves in the sequence)"
    }
  ],
  "behavioural_triggers": [
    {"trigger": "string", "action": "string"}
  ],
  "a_b_test_suggestions": ["string"]
}

Rules:
- body_text must be complete, send-ready prose (not placeholders like [INSERT CONTENT]).
- Use {{first_name}}, {{company}}, {{product_name}} tokens where natural.
- send_delay must be concrete (Day N, not 'a few days').
- Vary angles across emails - never repeat the same hook twice.
- The final email should be a win-back or 'last chance' if goal is re-engagement,
  or a testimonial/case study if goal is nurture.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: EmailSequenceRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Email Sequence - {body.sequence_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "email_sequence", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand context loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "writing", "label": f"Writing {body.num_emails}-email sequence…", "status": "running"})

    prompt = (
        f"BRAND CORE:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"EMAIL SEQUENCE REQUEST:\n"
        f"- Sequence Name: {body.sequence_name}\n"
        f"- Goal: {body.goal}\n"
        f"- Audience: {body.audience}\n"
        f"- Product: {body.product_name}\n"
        f"- Description: {body.product_description}\n"
        f"- Number of Emails: {body.num_emails}\n"
        f"- Tone: {body.tone}\n"
        f"\nWrite a complete {body.num_emails}-email sequence now."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=6000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "writing", "label": "Sequence written", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    loops_result = None
    if body.push_to_loops and settings.LOOPS_API_KEY:
        yield _sse({"type": "research_step", "step": "loops", "label": "Pushing to Loops.so…", "status": "running"})
        from backend.services.pillar5 import loops_client
        pushed = []
        for email in payload.get("emails", []):
            try:
                res = await loops_client.create_campaign(
                    name=f"{body.sequence_name} - Email {email['email_number']}",
                    subject=email.get("subject_line", ""),
                    html_body=f"<p>{email.get('body_text', '').replace(chr(10), '<br>')}</p>",
                )
                pushed.append({"email_number": email["email_number"], "result": res})
            except Exception as exc:
                pushed.append({"email_number": email["email_number"], "error": str(exc)})
        loops_result = pushed
        yield _sse({"type": "research_step", "step": "loops", "label": f"Pushed {len(pushed)} emails to Loops", "status": "done"})

    if loops_result:
        payload["loops_push_result"] = loops_result

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
