"""
Case Study Production - Claude, SSE streaming.

Transforms client inputs (challenge, solution, results) into a polished,
publication-ready case study with headline, narrative, pull quotes, and CTA.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar2 import CaseStudyRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SYSTEM_PROMPT = """\
You are LEO, a B2B content strategist and case study writer.
Transform client success story inputs into a polished, conversion-optimised case study.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "headline": "A compelling, results-focused headline (e.g. 'How Acme Corp 3x'd Revenue in 90 Days')",
  "subheadline": "Supporting context sentence",
  "client_snapshot": {
    "company": "Client name",
    "industry": "Industry",
    "size": "Company size if mentioned",
    "use_case": "What they used the product for"
  },
  "sections": [
    {
      "title": "The Challenge",
      "content": "2-3 paragraphs detailing the problem",
      "pull_quote": null
    },
    {
      "title": "The Solution",
      "content": "2-3 paragraphs on the approach and implementation",
      "pull_quote": "Short quote from the testimonial or synthesised version"
    },
    {
      "title": "The Results",
      "content": "2-3 paragraphs with specific metrics and outcomes",
      "pull_quote": null
    }
  ],
  "key_stats": [
    { "metric": "40%", "label": "Revenue increase" },
    { "metric": "3 months", "label": "Time to value" }
  ],
  "testimonial_formatted": "The testimonial formatted as a blockquote ready to display",
  "cta": "What the reader should do next (e.g. 'Book a demo to see how LEO can do the same for you')",
  "meta_description": "SEO meta description (150-160 chars) for the case study page",
  "social_proof_snippet": "A 1-2 sentence snippet for LinkedIn or email signature social proof"
}

RULES:
1. Key stats must be SPECIFIC numbers from the inputs - never invent metrics.
2. Headline must be results-first (lead with the win, not the client).
3. Testimonial formatted quote must use the exact text provided.
4. Return ONLY valid JSON - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: CaseStudyRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        messaging = brand_core.get("messaging") or {}

        title = f"Case Study - {body.client_name}"
        doc = firebase_service.create_pillar1_doc(project_id, "case_study", owner_uid, title)
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "writing",
                    "label": f"Writing case study for {body.client_name}...", "status": "running"})

        brand_ctx = f"Product/Brand: {brand_name}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value proposition: {messaging['valueProp']}\n"

        user_prompt = f"""\
{brand_ctx}
Client: {body.client_name}
Industry: {body.industry}

CHALLENGE:
{body.challenge}

SOLUTION:
{body.solution}

RESULTS / METRICS:
{body.results}

{"TESTIMONIAL:" if body.testimonial else ""}
{body.testimonial or ""}

Write a complete, publication-ready case study.
"""

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=settings.LLM_MAX_TOKENS,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "credits_spent": 15,
        })

        yield _sse({"type": "research_step", "step": "writing",
                    "label": "Case study ready", "status": "done"})
        yield _sse({"type": "case_study_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
