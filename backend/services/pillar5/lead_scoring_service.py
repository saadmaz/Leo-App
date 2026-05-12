"""
Lead Scoring - Claude scores each lead against the ICP and behavioural signals.

Optionally writes scores back to HubSpot contact properties if HUBSPOT_ACCESS_TOKEN is set.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar5 import LeadScoringRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND = 1200

SYSTEM = """\
You are a revenue operations specialist expert at building and running lead scoring models. \
You score leads against the Ideal Customer Profile and intent signals.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "scoring_model_summary": "string (2-3 sentences: model logic, key signals weighted)",
  "icp_fit_criteria": ["string (attributes that define a perfect fit)"],
  "scoring_breakdown": {
    "icp_fit_weight_pct": number,
    "behavioural_weight_pct": number,
    "intent_weight_pct": number
  },
  "leads": [
    {
      "contact_id": "string",
      "email": "string or null",
      "name": "string or null",
      "company": "string or null",
      "total_score": number (0-100),
      "grade": "A+" | "A" | "B" | "C" | "D",
      "icp_fit_score": number (0-100),
      "behavioural_score": number (0-100),
      "intent_score": number (0-100),
      "score_rationale": "string (2-3 sentences: why this score)",
      "top_positive_signals": ["string"],
      "top_negative_signals": ["string"],
      "recommended_action": "string (Sales Dev, AE, Nurture, or Disqualify - with specifics)",
      "next_step": "string (concrete immediate next step)",
      "hubspot_lifecycle_recommendation": "string (lead|marketingqualifiedlead|salesqualifiedlead|opportunity|customer)"
    }
  ],
  "pipeline_summary": {
    "hot_leads": number,
    "warm_leads": number,
    "cold_leads": number,
    "disqualified": number
  },
  "model_improvement_suggestions": ["string (what additional data would improve accuracy)"]
}

Rules:
- Grade: A+ (90-100), A (80-89), B (65-79), C (45-64), D (<45).
- icp_fit_score is purely firmographic/demographic (job title, company size, industry).
- behavioural_score is engagement depth (pages, content, emails).
- intent_score is purchase-intent signals (demo request, trial, pricing page visit).
- If a signal is missing, score that dimension at 50 (neutral) - do not penalise.
- recommended_action must specify the exact outreach type (e.g. 'SDR cold call within 24h',
  'Enrol in nurture sequence: Trial Activation', 'Disqualify - company too small for ROI').
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: LeadScoringRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Lead Scoring - {len(body.leads)} leads · {body.product_name}"
    doc = firebase_service.create_pillar1_doc(project_id, "lead_scoring", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})
    yield _sse({"type": "research_step", "step": "scoring", "label": f"Scoring {len(body.leads)} leads against ICP…", "status": "running"})

    leads_json = json.dumps(
        [l.model_dump(exclude_none=True) for l in body.leads], indent=2
    )

    prompt = (
        f"BRAND / PRODUCT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"LEAD SCORING REQUEST:\n"
        f"- Product: {body.product_name}\n"
        f"- Ideal Customer Profile: {body.ideal_customer_profile}\n"
        f"- Leads ({len(body.leads)} total):\n{leads_json}\n\n"
        "Score each lead. Return valid JSON only."
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

    # Optionally write scores back to HubSpot
    hs_result = None
    if body.push_scores_to_hubspot and settings.HUBSPOT_ACCESS_TOKEN:
        yield _sse({"type": "research_step", "step": "hubspot", "label": "Writing scores to HubSpot…", "status": "running"})
        from backend.services.pillar5 import hubspot_client
        updates = []
        for lead in payload.get("leads", []):
            cid = lead.get("contact_id", "")
            if cid:
                updates.append({
                    "id": cid,
                    "properties": {
                        "leo_lead_score": str(lead.get("total_score", "")),
                        "leo_lead_grade": lead.get("grade", ""),
                        "lifecyclestage": lead.get("hubspot_lifecycle_recommendation", ""),
                    },
                })
        try:
            hs_result = await hubspot_client.batch_update_contacts(updates)
        except Exception as exc:
            hs_result = {"error": str(exc)}
        yield _sse({"type": "research_step", "step": "hubspot", "label": f"HubSpot updated ({hs_result.get('updated', 0)} contacts)", "status": "done"})

    if hs_result:
        payload["hubspot_sync_result"] = hs_result

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 20})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
