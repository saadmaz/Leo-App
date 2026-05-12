"""
Crisis Communications - conversational urgent mode, pure Claude.

Input:  crisis type, summary, severity, affected stakeholders.
Output: crisis response playbook with statements for each stakeholder group,
        internal FAQ, holding statement, and action checklist.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar8 import CrisisCommsRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500

SYSTEM = """\
You are a crisis communications expert who has advised Fortune 500 companies during their \
most difficult moments. You provide clear-headed, legally mindful, empathetic communications \
that protect the brand while doing right by stakeholders.

URGENT MODE: Prioritise speed, clarity, and accuracy. No fluff.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "crisis_assessment": {
    "severity_confirmed": "low|medium|high|critical",
    "reputational_risk": "string (1-2 sentences)",
    "legal_risk_note": "string (general note - not legal advice)",
    "time_sensitivity": "string (how quickly to act)",
    "do_not_say": ["string (phrases to avoid)"]
  },
  "holding_statement": "string (a brief statement buyable for up to 24h while you gather facts - max 50 words)",
  "stakeholder_statements": [
    {
      "stakeholder": "string (e.g. 'customers', 'media', 'employees', 'investors')",
      "channel": "string (e.g. 'email', 'press release', 'internal memo', 'social media')",
      "statement": "string (full draft statement)",
      "key_messages": ["string"],
      "tone_guidance": "string"
    }
  ],
  "internal_faq": [
    {"question": "string", "answer": "string"}
  ],
  "action_checklist": [
    {"priority": "immediate|24h|48h|week", "action": "string", "owner": "string or null"}
  ],
  "media_q_and_a": [
    {"question": "string (likely journalist question)", "answer": "string (recommended response)"}
  ],
  "recovery_roadmap": "string (narrative on how to rebuild trust post-crisis - 2-3 paragraphs)"
}

Rules:
- Holding statement MUST acknowledge the situation without admitting liability.
- Never advise the company to 'no comment' - silence amplifies suspicion.
- Statements must match the channel - press releases are formal, social is brief.
- action_checklist should have 8-12 items prioritised clearly.
- media_q_and_a should anticipate the 5 hardest questions journalists will ask.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: CrisisCommsRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Crisis Comms - {body.crisis_type.replace('_', ' ').title()} [{body.severity.upper()}]"
    doc = firebase_service.create_pillar1_doc(project_id, "crisis_comms", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "drafting", "label": "Drafting crisis response playbook…", "status": "running"})

    facts_text = "\n".join(f"• {f}" for f in (body.facts_confirmed or []))
    unknown_text = "\n".join(f"• {f}" for f in (body.facts_unknown or []))

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"CRISIS BRIEF:\n"
        f"- Company: {body.company_name}\n"
        f"- Crisis type: {body.crisis_type}\n"
        f"- Severity: {body.severity}\n"
        f"- Summary: {body.crisis_summary}\n"
        f"- Affected stakeholders: {', '.join(body.affected_stakeholders)}\n"
        + (f"- Response given so far: {body.company_response_so_far}\n" if body.company_response_so_far else "- No response given yet.\n")
        + (f"- Spokesperson: {body.spokesperson_name}, {body.spokesperson_title}\n" if body.spokesperson_name else "")
        + (f"\nCONFIRMED FACTS:\n{facts_text}\n" if facts_text else "")
        + (f"\nSTILL UNDER INVESTIGATION:\n{unknown_text}\n" if unknown_text else "")
        + "\nDraft the full crisis communications playbook. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=6000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI drafting failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "drafting", "label": "Playbook drafted", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["company_name"] = body.company_name
    payload["crisis_type"] = body.crisis_type
    payload["severity"] = body.severity

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 20})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
