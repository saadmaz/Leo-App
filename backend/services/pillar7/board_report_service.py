"""
Board-Ready Reporting - Claude formats a polished executive report.

Input: key metrics, wins, challenges, priorities.
Output: structured board/investor update with narrative, KPI table, appendix.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar7 import BoardReportRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 800

SYSTEM = """\
You are an expert at writing board-level and investor-level business reports. \
You synthesise metrics into a clear narrative that confident executives present \
to boards, investors, or senior leadership - data-driven, concise, forward-looking.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "report_title": "string",
  "report_period": "string",
  "report_type": "string",
  "prepared_date": "string (today's date YYYY-MM-DD)",
  "executive_summary": "string (3-5 sentence executive summary - lead with the biggest number, acknowledge the key challenge, end with confidence)",
  "business_narrative": "string (400-600 word narrative: context → performance → wins → challenges → outlook → call to action)",
  "kpi_table": [
    {
      "metric": "string",
      "value": "string",
      "vs_prior_period": "string or null",
      "status": "on_track | at_risk | exceeded | below_target",
      "commentary": "string (1 sentence)"
    }
  ],
  "wins_section": {
    "headline": "string (e.g. 'Three Standout Wins This Quarter')",
    "wins": [
      {"win": "string", "impact": "string", "what_we_did": "string"}
    ]
  },
  "challenges_section": {
    "headline": "string",
    "challenges": [
      {"challenge": "string", "root_cause": "string", "mitigation_plan": "string", "timeline": "string"}
    ]
  },
  "priorities_section": {
    "headline": "string",
    "priorities": [
      {"priority": "string", "owner": "string or null", "target_outcome": "string", "timeline": "string"}
    ]
  },
  "financial_snapshot": "string (2-3 sentence narrative on the financial health)",
  "appendix": [
    {"section": "string", "content": "string"}
  ],
  "talk_track": "string (what the presenter should verbally emphasise beyond the slides - 2-3 bullets)"
}

Rules:
- NEVER use jargon for jargon's sake. Clear > clever.
- Lead with facts, end with confidence.
- Challenges must have mitigation plans - boards don't want problems, they want leadership.
- The business_narrative must flow as readable paragraphs, not bullet points.
- talk_track is the off-slide context the presenter should add verbally.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: BoardReportRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Board Report - {body.company_name} · {body.report_period}"
    doc = firebase_service.create_pillar1_doc(project_id, "board_report", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    yield _sse({"type": "research_step", "step": "writing",
                "label": f"Writing {body.report_type.replace('_', ' ')} for {body.report_period}…", "status": "running"})

    metrics_json = json.dumps(
        [m.model_dump(exclude_none=True) for m in body.metrics], indent=2
    )

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"BOARD REPORT REQUEST:\n"
        f"- Company: {body.company_name}\n"
        f"- Period: {body.report_period}\n"
        f"- Report type: {body.report_type}\n"
        f"- Tone: {body.tone}\n"
        f"- Include appendix: {body.include_appendix}\n\n"
        f"KEY METRICS:\n{metrics_json}\n\n"
        + (f"WINS:\n" + "\n".join(f"• {w}" for w in body.wins) + "\n\n" if body.wins else "")
        + (f"CHALLENGES:\n" + "\n".join(f"• {c}" for c in body.challenges) + "\n\n" if body.challenges else "")
        + (f"NEXT PERIOD PRIORITIES:\n" + "\n".join(f"• {p}" for p in body.priorities_next_period) + "\n\n" if body.priorities_next_period else "")
        + (f"NARRATIVE CONTEXT:\n{body.narrative_context}\n\n" if body.narrative_context else "")
        + "Write the board report. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=8000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI report writing failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "writing", "label": "Report written", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["company_name"] = body.company_name
    payload.setdefault("report_period", body.report_period)
    payload.setdefault("report_type", body.report_type)

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 25})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
