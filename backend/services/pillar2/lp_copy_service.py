"""Landing Page Copywriting - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar2 import LandingPageCopyRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, a conversion copywriting expert trained on the top-performing landing pages across SaaS, e-commerce, and professional services.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "framework_used": "AIDA",
  "above_the_fold": {
    "headline": "Primary headline",
    "subheadline": "Supporting subheadline",
    "hero_cta": "CTA button text",
    "hero_supporting_text": "1 short line under the CTA (trust signal)"
  },
  "sections": [
    {
      "section_name": "Problem Agitation",
      "headline": "Section heading",
      "body_copy": "Full body copy for this section",
      "cta": "Optional inline CTA"
    }
  ],
  "social_proof_block": {
    "headline": "What others are saying",
    "proof_points": ["Formatted proof points (stats, quotes, logos)"]
  },
  "faq": [{"question": "...", "answer": "..."}],
  "final_cta": {
    "headline": "Final CTA headline",
    "subtext": "Supporting text",
    "button": "CTA button copy",
    "guarantee": "Risk reversal statement if applicable"
  },
  "headline_variants": ["3 alternative above-the-fold headlines to A/B test"],
  "conversion_notes": "Key conversion principles applied and why they work for this product/audience"
}
"""

async def generate(project: dict, body: LandingPageCopyRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        tone = (brand_core.get("tone") or {}).get("style", "professional")

        doc = firebase_service.create_pillar1_doc(project_id, "lp_copy", owner_uid, f"LP Copy - {body.product_name}")
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "strategy", "label": f"Applying {body.framework} framework…", "status": "running"})

        pain_str = "\n".join(f"- {p}" for p in body.pain_points) if body.pain_points else "Infer from product description"
        benefits_str = "\n".join(f"- {b}" for b in body.secondary_benefits) if body.secondary_benefits else "None"
        proof_str = "\n".join(f"- {s}" for s in body.social_proof) if body.social_proof else "None"

        user_prompt = f"""\
Brand: {brand_name}
Brand tone: {tone}
Product: {body.product_name}
Description: {body.product_description}
Target audience: {body.target_audience}
Primary benefit: {body.primary_benefit}
Secondary benefits: {benefits_str}
Pain points addressed: {pain_str}
Framework: {body.framework}
Page goal: {body.page_goal}
Primary CTA: {body.cta_action}
Social proof available: {proof_str}

Write the complete landing page copy using the {body.framework} framework.
"""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=3500, system=_SYSTEM,
                                           messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 20})
        yield _sse({"type": "research_step", "step": "strategy", "label": "Landing page copy ready", "status": "done"})
        yield _sse({"type": "lp_copy_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
