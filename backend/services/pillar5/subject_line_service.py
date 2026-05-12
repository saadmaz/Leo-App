"""
Subject Line Optimiser - Claude generates variants with predicted open-rate scores.

Produces:
  - N subject line variants across different psychological angles
  - Preview text pairing for each
  - Predicted open-rate score (1-10) with reasoning
  - Spam word check and deliverability flags
  - A/B testing recommendation
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar5 import SubjectLineRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)

SYSTEM = """\
You are a world-class email marketing specialist with deep expertise in inbox psychology, \
deliverability, and open-rate optimisation.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "email_topic": "string",
  "audience": "string",
  "variants": [
    {
      "variant_id": "A" | "B" | ... ,
      "subject_line": "string",
      "preview_text": "string (≤90 chars)",
      "angle": "string (curiosity|urgency|benefit|social_proof|personalisation|question|list|fear_of_missing_out|storytelling)",
      "predicted_open_rate_score": number (1-10),
      "score_rationale": "string (1-2 sentences)",
      "character_count": number,
      "emoji_used": boolean,
      "spam_risk": "low|medium|high",
      "spam_flags": ["string (specific words/patterns flagged)"],
      "best_for": "string (e.g. 'cold lists', 're-engagement', 'engaged subscribers')"
    }
  ],
  "recommended_variant": "A" | "B" | ...,
  "recommendation_rationale": "string",
  "a_b_test_pairs": [
    {"test_name": "string", "variant_a": "string", "variant_b": "string", "what_you_are_testing": "string"}
  ],
  "deliverability_notes": "string",
  "timing_tip": "string"
}

Rules:
- Never repeat the same angle twice.
- subject_line must be ≤60 characters for mobile optimisation; flag if over.
- Spam risk 'high' if subject contains: FREE, GUARANTEED, ACT NOW, CLICK HERE, $$$, !!!,
  all-caps words, or excessive punctuation.
- predicted_open_rate_score: 9-10 = exceptional, 7-8 = strong, 5-6 = average, <5 = weak.
- Include at least one emoji variant and one no-emoji variant for A/B insight.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def generate(
    project: dict,
    body: SubjectLineRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Subject Lines - {body.email_topic[:60]}"
    doc = firebase_service.create_pillar1_doc(project_id, "subject_lines", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand context loaded", "status": "done"})
    yield _sse({"type": "research_step", "step": "generating", "label": f"Generating {body.num_variants} subject line variants…", "status": "running"})

    spam_note = "Apply strict spam word filtering." if body.avoid_spam_words else "Spam filtering is relaxed for this request."

    prompt = (
        f"BRAND CORE (tone reference):\n{brand_context[:1000]}\n\n"
        f"SUBJECT LINE REQUEST:\n"
        f"- Email Topic: {body.email_topic}\n"
        f"- Audience: {body.audience}\n"
        f"- Goal: {body.goal}\n"
        f"- Tone: {body.tone}\n"
        f"- Number of Variants: {body.num_variants}\n"
        f"- {spam_note}\n\n"
        f"Generate {body.num_variants} subject line variants with paired preview text and scores."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=2500)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI generation failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "generating", "label": "Variants ready", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 5})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
