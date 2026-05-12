"""Behavioral Trigger Automation - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar5 import BehavioralTriggerRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)
def _sse(d: dict) -> str: return f"data: {json.dumps(d)}\n\n"

_SYSTEM = """\
You are LEO, an email automation specialist who designs high-converting behavioral trigger sequences.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "trigger_name": "Pricing Page Visit - Non-buyer",
  "trigger_logic": "Send email 1 within 1 hour of trigger event",
  "sequence": [
    {
      "email_number": 1,
      "send_timing": "1 hour after trigger",
      "subject_line": "Primary subject line",
      "subject_line_variants": ["Variant A", "Variant B"],
      "preview_text": "Email preview text",
      "goal": "What this email should achieve",
      "body": "Full email body (ready to use)",
      "cta_primary": "Primary CTA text",
      "cta_url_placeholder": "[LINK]",
      "personalization": ["Dynamic fields to use: {{first_name}}, {{company}}"],
      "send_condition": "Send to all | Only if email 1 was opened | Only if no reply"
    }
  ],
  "exit_conditions": ["When to remove someone from this sequence"],
  "success_metrics": {
    "primary": "Click-to-conversion rate",
    "target": ">8% of triggered contacts convert",
    "secondary": ["Open rate >45%", "Reply rate >3%"]
  },
  "platform_setup": {
    "platform": "Loops",
    "trigger_type": "Event | Tag | List | API call",
    "setup_steps": ["Step-by-step instructions to build this in the platform"]
  },
  "a_b_test_plan": "What to A/B test in this sequence first"
}
"""

async def generate(project: dict, body: BehavioralTriggerRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        tone = (brand_core.get("tone") or {}).get("style", "professional")
        doc = firebase_service.create_pillar1_doc(project_id, "behavioral_triggers", owner_uid, f"Trigger - {body.trigger_event[:40]}")
        doc_id = doc["id"]
        yield _sse({"type": "research_step", "step": "designing", "label": f"Designing {body.sequence_length}-email trigger sequence…", "status": "running"})
        user_prompt = f"""Brand: {brand_name}\nBrand tone: {tone}\nProduct: {body.product_name}\nTrigger event: {body.trigger_event}\nAudience: {body.audience_context}\nEmail platform: {body.email_platform}\nSequence length: {body.sequence_length} emails\nConversion goal: {body.conversion_goal}\nTone: {body.tone}\n\nWrite a complete behavioral trigger sequence."""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=3500, system=_SYSTEM, messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text); yield _sse({"type": "delta", "content": text})
        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try: payload = json.loads(raw)
        except: payload = {"raw": raw, "parse_error": True}
        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 20})
        yield _sse({"type": "research_step", "step": "designing", "label": "Trigger sequence ready", "status": "done"})
        yield _sse({"type": "behavioral_triggers_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"
    return _stream()
