"""
Win/Loss Analysis - Claude synthesises deal outcomes into competitive intelligence.

Input: deal records with outcome, competitor chosen, reason given, sales notes, survey responses.
Output: patterns, competitive positioning gaps, sales process improvements, playbook.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar5 import WinLossRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

_MAX_BRAND = 1200

SYSTEM = """\
You are a strategic revenue analyst who turns deal outcomes into competitive intelligence \
and sales process improvements. You find patterns humans miss.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "analysis_period": "string",
  "product_name": "string",
  "executive_summary": "string (3-4 sentences: biggest insight from this batch of deals)",
  "outcome_breakdown": {
    "won": number,
    "lost": number,
    "churned": number,
    "no_decision": number,
    "win_rate_pct": number,
    "average_deal_size_won": number | null,
    "average_deal_size_lost": number | null
  },
  "win_patterns": [
    {
      "pattern": "string",
      "frequency": "string (e.g. 'seen in 7/10 wins')",
      "implication": "string"
    }
  ],
  "loss_patterns": [
    {
      "pattern": "string",
      "frequency": "string",
      "root_cause": "string",
      "fix": "string (specific corrective action)"
    }
  ],
  "competitive_analysis": [
    {
      "competitor": "string",
      "times_chosen_over_us": number,
      "primary_reason": "string",
      "our_response": "string (how to counter this objection or position against them)"
    }
  ],
  "objection_playbook": [
    {
      "objection": "string",
      "frequency": "string",
      "best_response": "string (2-4 sentences - the winning response)",
      "supporting_evidence": "string"
    }
  ],
  "sales_process_gaps": [
    {"stage": "string", "gap": "string", "recommended_fix": "string"}
  ],
  "product_gaps": [
    {"gap": "string", "mentioned_in_n_deals": number, "priority": "high|medium|low", "suggested_response": "string"}
  ],
  "ideal_deal_profile": {
    "company_size": "string",
    "industry": "string",
    "buying_trigger": "string",
    "champion_persona": "string",
    "deal_velocity_days": "string"
  },
  "recommended_actions": [
    {"action": "string", "owner": "string (Sales, Product, Marketing, CS)", "priority": "high|medium|low", "timeline": "string"}
  ]
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: WinLossRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    period_label = body.date_range or f"{len(body.deals)} deals"
    title = f"Win/Loss Analysis - {body.product_name} · {period_label}"
    doc = firebase_service.create_pillar1_doc(project_id, "winloss", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})
    yield _sse({"type": "research_step", "step": "analysing", "label": f"Analysing {len(body.deals)} deal outcomes…", "status": "running"})

    deals_json = json.dumps(
        [d.model_dump(exclude_none=True) for d in body.deals], indent=2
    )

    prompt = (
        f"BRAND / PRODUCT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"WIN/LOSS ANALYSIS REQUEST:\n"
        f"- Product: {body.product_name}\n"
        + (f"- Period: {body.date_range}\n" if body.date_range else "")
        + f"- Deals ({len(body.deals)} total):\n{deals_json}\n\n"
        "Analyse all deals for patterns. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=6000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "analysing", "label": "Analysis complete", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["product_name"] = body.product_name
    payload["analysis_period"] = period_label

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 15})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
