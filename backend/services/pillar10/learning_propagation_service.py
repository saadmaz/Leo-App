"""
Learning Propagation - Claude reads concluded experiments from the Experiment Log
and generates a synthesised learning report with a prioritised action plan for
applying insights across other content and campaigns.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar10 import LearningPropagationRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500

SYSTEM = """\
You are an experimentation programme manager. You synthesise learnings from multiple
A/B tests and experiments into a coherent, actionable knowledge base - then prescribe
exactly how those learnings should be applied across other channels and content.

Return ONLY a valid JSON object - no markdown fences.

Schema:
{
  "experiments_analysed": number,
  "programme_health": "strong | developing | early_stage",
  "programme_summary": "string (overall state of the experimentation programme - 3-4 sentences)",
  "top_learnings": [
    {
      "learning": "string (the insight)",
      "confidence": "high | medium | low",
      "supported_by": ["string (experiment name/id)"],
      "underlying_principle": "string (psychological or behavioural principle)",
      "applicability": "broad | narrow"
    }
  ],
  "propagation_plan": [
    {
      "target": "string (e.g. 'homepage hero', 'onboarding email sequence', 'Meta Ads copy')",
      "change_recommended": "string (specific change to make)",
      "based_on_learning": "string (which learning drives this)",
      "expected_impact": "string",
      "priority": "high | medium | low",
      "effort": "low | medium | high"
    }
  ],
  "quick_wins": ["string (changes to make this week - low effort, high impact)"],
  "contradictions_flagged": ["string (experiments that gave conflicting signals - needs investigation)"],
  "knowledge_gaps": ["string (what you haven't tested yet that you should)"],
  "next_experiments_recommended": [
    {
      "hypothesis": "string",
      "rationale": "string (why this is the logical next test)",
      "expected_learning_value": "string"
    }
  ],
  "north_star_insight": "string (the single most important thing your experiments have taught you)"
}

Rules:
- Only propagate learnings with at least medium confidence.
- propagation_plan must be specific - not 'improve copy' but 'change headline from X to Y approach'.
- quick_wins must be immediately actionable without design resources.
- contradictions_flagged is critical - never paper over conflicting results.
- north_star_insight should be memorable and strategy-defining.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: LearningPropagationRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = "Learning Propagation Report"
    doc = firebase_service.create_pillar1_doc(project_id, "learning_propagation", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    # Fetch experiment log
    yield _sse({"type": "research_step", "step": "log", "label": "Reading experiment log…", "status": "running"})
    all_experiments = firebase_service.list_experiments(project_id, limit=50)

    # Filter to concluded experiments (or specific IDs if provided)
    if body.experiment_ids:
        experiments = [e for e in all_experiments if e.get("id") in body.experiment_ids]
    else:
        experiments = [e for e in all_experiments if e.get("status") == "concluded"]

    yield _sse({"type": "research_step", "step": "log", "label": f"Found {len(experiments)} concluded experiments", "status": "done"})

    if not experiments:
        yield _sse({"type": "error", "message": "No concluded experiments found. Run some tests first, then mark them as concluded in the Experiment Log."})
        return

    yield _sse({"type": "research_step", "step": "synthesising", "label": "Synthesising learnings…", "status": "running"})

    # Trim experiments to avoid token overflow
    exp_summary = []
    for e in experiments[:20]:
        exp_summary.append({
            "id": e.get("id"),
            "name": e.get("name"),
            "hypothesis": e.get("hypothesis"),
            "winner_variant": e.get("winner_variant"),
            "results_summary": e.get("results_summary"),
            "learnings": e.get("learnings"),
            "lift_achieved": e.get("lift_achieved"),
            "confidence_level_achieved": e.get("confidence_level_achieved"),
            "target_surface": e.get("target_surface"),
            "test_type": e.get("test_type"),
        })

    targets_text = ", ".join(body.propagation_targets)

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"PROPAGATION REQUEST:\n"
        f"- Propagation targets: {targets_text}\n"
        f"- Generate action plan: {body.generate_action_plan}\n"
        + (f"- Additional context: {body.context}\n" if body.context else "")
        + f"\nCONCLUDED EXPERIMENTS ({len(exp_summary)}):\n{json.dumps(exp_summary, indent=2)}\n\n"
        "Synthesise learnings and generate the propagation plan. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=6000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"Synthesis failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "synthesising", "label": "Learnings synthesised", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["propagation_targets"] = body.propagation_targets

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 20})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
