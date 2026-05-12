"""
A/B Test Design - pure Claude.

Input:  what to test, goal, traffic, current conversion rate, desired effect size.
Output: hypothesis, variants, sample size calculation, success metrics, run checklist.
"""
from __future__ import annotations

import json
import logging
import math
import re
from typing import AsyncGenerator

from backend.config import settings
from backend.schemas.pillar10 import ABTestDesignRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500

SYSTEM = """\
You are a conversion optimisation and experimentation expert. You design rigorous,
statistically sound A/B tests that marketers can actually run.

Return ONLY a valid JSON object - no markdown fences, no commentary.

Schema:
{
  "test_name": "string",
  "hypothesis": "string (If we change X to Y, we expect Z because W)",
  "control_description": "string (the control/current version)",
  "variants": [
    {
      "variant_id": "string (A, B, C…)",
      "label": "string",
      "description": "string (what is different)",
      "copy_or_change": "string (exact copy/design change if applicable)",
      "rationale": "string (psychological or data principle behind this variant)",
      "expected_direction": "increase | decrease | neutral"
    }
  ],
  "sample_size": {
    "per_variant": number,
    "total": number,
    "calculation_notes": "string",
    "estimated_run_days": number or null
  },
  "primary_metric": "string",
  "secondary_metrics": ["string"],
  "guardrail_metrics": ["string (metrics that must not worsen - e.g. unsubscribe rate)"],
  "success_criteria": "string (exact condition that declares a winner)",
  "pre_test_checklist": ["string"],
  "implementation_notes": "string (how to set up in common platforms like VWO, Optimizely, Google Optimize alternative)",
  "common_pitfalls": ["string"],
  "expected_duration": "string",
  "statistical_approach": "string (frequentist | bayesian - and why)"
}

Sample size formula reference (frequentist, two-tailed):
n ≈ 2 × ((z_α/2 + z_β)² × p(1−p)) / (MDE²)
where p = baseline conversion rate, MDE = minimum detectable effect (absolute).
z_α/2 = 1.96 for 95% confidence, z_β = 0.84 for 80% power.

Rules:
- Hypothesis must be falsifiable and specific.
- Variants must differ on ONE thing from the control (unless explicitly multivariate).
- Always include at least one guardrail metric.
- implementation_notes must be practical and tool-specific.
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _estimate_sample_size(
    baseline_rate: float,
    mde_pct: float,
    confidence: int,
    num_variants: int,
) -> dict:
    """Quick frequentist sample size estimate."""
    try:
        p = baseline_rate / 100
        mde_abs = p * (mde_pct / 100)
        z_alpha = {90: 1.645, 95: 1.96, 99: 2.576}.get(confidence, 1.96)
        z_beta = 0.84  # 80% power
        if mde_abs == 0 or p == 0:
            return {"per_variant": None, "total": None}
        n_per = 2 * ((z_alpha + z_beta) ** 2 * p * (1 - p)) / (mde_abs ** 2)
        n_per = math.ceil(n_per)
        return {"per_variant": n_per, "total": n_per * num_variants}
    except Exception:
        return {"per_variant": None, "total": None}


async def generate(
    project: dict,
    body: ABTestDesignRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"A/B Test - {body.what_to_test[:60]}"
    doc = firebase_service.create_pillar1_doc(project_id, "ab_test_design", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    # Pre-calculate sample size if inputs are available
    sample_hint = ""
    if body.current_conversion_rate and body.minimum_detectable_effect:
        ss = _estimate_sample_size(
            body.current_conversion_rate,
            body.minimum_detectable_effect,
            body.confidence_level,
            body.num_variants,
        )
        if ss["per_variant"]:
            sample_hint = (
                f"\nPre-calculated sample size: {ss['per_variant']:,} per variant "
                f"({ss['total']:,} total) at {body.confidence_level}% confidence, "
                f"{body.minimum_detectable_effect}% MDE, "
                f"{body.current_conversion_rate}% baseline rate.\n"
            )

    yield _sse({"type": "research_step", "step": "designing", "label": "Designing the experiment…", "status": "running"})

    prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"A/B TEST REQUEST:\n"
        f"- What to test: {body.what_to_test}\n"
        f"- Test type: {body.test_type}\n"
        f"- Business goal: {body.business_goal}\n"
        f"- Platform: {body.platform or 'not specified'}\n"
        f"- Number of variants (incl. control): {body.num_variants}\n"
        f"- Confidence level: {body.confidence_level}%\n"
        f"- Minimum detectable effect: {body.minimum_detectable_effect}%\n"
        + (f"- Current version (control): {body.current_version}\n" if body.current_version else "")
        + (f"- Target audience: {body.target_audience}\n" if body.target_audience else "")
        + (f"- Daily traffic to surface: {body.traffic_per_day:,}\n" if body.traffic_per_day else "")
        + (f"- Current conversion rate: {body.current_conversion_rate}%\n" if body.current_conversion_rate else "")
        + sample_hint
        + "\nDesign the complete A/B test. Return valid JSON only."
    )

    try:
        raw = await call_claude_raw(prompt, system=SYSTEM, max_tokens=5000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"AI design failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "designing", "label": "Test designed", "status": "done"})

    clean = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    clean = re.sub(r"\s*```$", "", clean, flags=re.MULTILINE)
    try:
        payload = json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["what_to_test"] = body.what_to_test
    payload["test_type"] = body.test_type
    payload["business_goal"] = body.business_goal

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 10})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
