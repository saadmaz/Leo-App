"""
Churn Risk Detection - Claude scores each contact's engagement signals and flags at-risk users.

Works with any engagement data the user provides (LEO internal, HubSpot, custom).
Optionally generates a win-back email for each at-risk contact.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar5 import ChurnRiskRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND = 1200

SYSTEM = """\
You are a customer success analyst specialising in churn prediction and retention. \
You interpret behavioural signals and classify churn risk with actionable interventions.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "analysis_summary": "string (2-3 sentences: overall health of this cohort)",
  "cohort_stats": {
    "total_contacts": number,
    "high_risk_count": number,
    "medium_risk_count": number,
    "low_risk_count": number,
    "healthy_count": number,
    "average_risk_score": number
  },
  "contacts": [
    {
      "contact_id": "string",
      "email": "string or null",
      "name": "string or null",
      "risk_score": number (0-100, higher = more at risk),
      "risk_level": "high" | "medium" | "low" | "healthy",
      "churn_probability_pct": number (0-100),
      "risk_factors": ["string"],
      "positive_signals": ["string"],
      "recommended_action": "string (specific, immediate action for CSM)",
      "intervention_urgency": "immediate" | "this_week" | "this_month" | "monitor",
      "win_back_email": {
        "subject": "string",
        "preview_text": "string",
        "body": "string (complete, personalised email body)"
      } | null
    }
  ],
  "top_churn_signals": ["string (most common risk factors across the cohort)"],
  "retention_playbook": [
    {"segment": "string", "action": "string", "timing": "string", "owner": "string"}
  ],
  "early_warning_indicators": ["string (signals to monitor proactively going forward)"]
}

Rules:
- risk_score: weight recency of activity highest (50%), then breadth (30%), then support signals (20%).
- win_back_email: only generate if risk_level is 'high' and win_back_sequence=true was requested.
- recommended_action must be a concrete, single next step (not vague advice).
- If a field is null in the input, exclude it from risk factors (don't penalise missing data).
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: ChurnRiskRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Churn Risk - {len(body.contacts)} contacts · {body.product_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "churn_risk", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})
    yield _sse({"type": "research_step", "step": "scoring", "label": f"Scoring {len(body.contacts)} contacts…", "status": "running"})

    contacts_json = json.dumps(
        [c.model_dump(exclude_none=True) for c in body.contacts], indent=2
    )

    prompt = (
        f"BRAND / PRODUCT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"CHURN RISK ANALYSIS REQUEST:\n"
        f"- Product: {body.product_name}\n"
        f"- Generate win-back emails for high-risk contacts: {body.win_back_sequence}\n"
        f"- Contacts ({len(body.contacts)} total):\n{contacts_json}\n\n"
        "Score each contact's churn risk based on the engagement signals provided. "
        "Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=8000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "scoring", "label": "Scoring complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 20})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
