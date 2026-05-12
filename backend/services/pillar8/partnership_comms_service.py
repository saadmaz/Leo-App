"""
Partnership Communications - pure Claude copywriting.

Input:  comms type (outreach/proposal/announcement/joint PR), companies, value prop.
Output: the appropriate communication with messaging framework.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar8 import PartnershipCommsRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500

SYSTEM = """\
You are a business development and partnership communications expert. \
You write partnership communications that open doors, advance deals, and craft \
compelling joint narratives - clear about value, respectful of the partner's business.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "comms_type": "string",
  "document_title": "string",
  "primary_document": "string (the main communication - email, proposal section, or press release body)",
  "subject_line": "string or null (email subject if comms_type is outreach or proposal)",
  "value_proposition_summary": {
    "for_us": "string (what we get)",
    "for_partner": "string (what they get)",
    "combined_market_opportunity": "string"
  },
  "key_messages": ["string"],
  "partnership_terms_outline": [
    {"term": "string", "description": "string"}
  ],
  "follow_up_sequence": [
    {"timing": "string (e.g. '3 days after send')", "action": "string", "template": "string"}
  ],
  "objection_handling": [
    {"objection": "string", "response": "string"}
  ],
  "success_metrics": ["string (how you'll both measure partnership success)"],
  "tone_notes": "string (how this communication is calibrated for the partner)"
}

Rules:
- primary_document must be complete and ready to send/use - not a template.
- For initial_outreach: lead with what's in it for them, keep under 200 words.
- For proposal: structure as executive summary → value prop → terms → next steps.
- For joint_press_release: balance both companies equally; quote one exec from each.
- For announcement_draft: write for internal audience first, then adapt.
- partnership_terms_outline only populated if include_terms_outline is true.
- follow_up_sequence provides 2-3 follow-up touchpoints.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: PartnershipCommsRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Partnership Comms - {body.your_company} × {body.partner_company} ({body.comms_type.replace('_', ' ').title()})"
    doc = firebase_service.create_pillar1_doc(project_id, "partnership_comms", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "writing", "label": "Drafting partnership communication…", "status": "running"})

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"PARTNERSHIP COMMS REQUEST:\n"
        f"- Type: {body.comms_type}\n"
        f"- Our company: {body.your_company}\n"
        f"- Partner company: {body.partner_company}\n"
        f"- Partnership type: {body.partnership_type}\n"
        f"- Value proposition: {body.value_proposition}\n"
        f"- Tone: {body.tone}\n"
        f"- Include terms outline: {body.include_terms_outline}\n"
        + (f"- Key ask: {body.key_ask}\n" if body.key_ask else "")
        + (f"- Partner contact: {body.partner_contact_name}, {body.partner_contact_title}\n" if body.partner_contact_name else "")
        + "\nDraft the partnership communication. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=4000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI writing failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "writing", "label": "Communication drafted", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["your_company"] = body.your_company
    payload["partner_company"] = body.partner_company

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 10})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
