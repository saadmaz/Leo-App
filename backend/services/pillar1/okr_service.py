"""
Quarterly OKR Drafting service - pure Claude, no external APIs.

Generates structured OKRs (Objectives + Key Results) for a given quarter
based on company goals, Brand Core context, and optional team focus.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar1 import OKRGenerateRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, an expert OKR coach and strategic planning advisor.
Your task is to draft quarterly OKRs that are ambitious, measurable, and aligned with the brand's voice and goals.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences) in this exact shape:
{
  "quarter": "Q3 2026",
  "objectives": [
    {
      "title": "Objective title (inspiring, action-oriented)",
      "description": "One sentence explaining why this matters",
      "key_results": [
        {
          "metric": "Increase X from Y to Z",
          "owner": "Marketing",
          "tracking": "Weekly via analytics dashboard"
        }
      ]
    }
  ],
  "summary": "2-3 sentence strategic rationale for these OKRs"
}

RULES:
1. Each objective must have exactly 3 key results.
2. Key results must be measurable (numbers, percentages, or clear milestones).
3. Objectives must be ambitious but achievable in one quarter.
4. Align with the brand's tone and audience from Brand Core.
5. Return ONLY valid JSON - no prose, no markdown.
"""


async def generate(
    project: dict,
    body: OKRGenerateRequest,
    project_id: str,
    owner_uid: str,
) -> dict:
    """
    Generate OKRs synchronously (fast - pure LLM, no external calls).
    Returns the saved Firestore document dict.
    """
    brand_core = project.get("brandCore") or {}
    brand_name = project.get("name", "the brand")

    brand_ctx = ""
    tone = brand_core.get("tone") or {}
    audience = brand_core.get("audience") or {}
    if tone:
        brand_ctx += f"Brand tone: {tone.get('style', '')} / {tone.get('formality', '')}\n"
    if audience.get("demographics"):
        brand_ctx += f"Target audience: {audience['demographics']}\n"
    messaging = brand_core.get("messaging") or {}
    if messaging.get("valueProp"):
        brand_ctx += f"Value proposition: {messaging['valueProp']}\n"

    user_prompt = f"""\
Brand: {brand_name}
{brand_ctx}
Quarter: {body.quarter}
Company goals: {body.company_goals}
{f"Team focus: {body.team_focus}" if body.team_focus else ""}
Number of objectives needed: {body.num_objectives}

Draft {body.num_objectives} OKRs for {body.quarter}. Each objective must have 3 key results.
"""

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=2000,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = response.content[0].text.strip()

    # Parse JSON, strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {"raw": raw, "parse_error": True}

    # Save to Firestore
    title = f"OKRs - {body.quarter}"
    doc = firebase_service.create_pillar1_doc(project_id, "okr", owner_uid, title)
    firebase_service.update_pillar1_doc(project_id, doc["id"], {
        "status": "complete",
        "payload": payload,
        "credits_spent": 10,
    })
    doc.update({"status": "complete", "payload": payload})
    return doc
