"""Programmatic SEO - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar3 import ProgrammaticSeoRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SYSTEM = """\
You are LEO, an expert in programmatic SEO and large-scale content strategy.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "template_type": "location_service",
  "seed_keyword": "...",
  "scale_potential": "Estimated number of pages this template could generate",
  "page_template": {
    "url_pattern": "/[variable]/[seed-keyword-slug]",
    "title_tag_pattern": "[Variable] [Keyword] - [Brand] | [Benefit]",
    "meta_description_pattern": "Template meta description with [Variable] placeholders",
    "h1_pattern": "H1 template",
    "intro_paragraph_pattern": "Template intro with [Variable] fill-ins",
    "key_sections": ["Section 1 name - what it covers", "Section 2 name"]
  },
  "example_pages": [
    {
      "variable": "Healthcare",
      "url": "/healthcare/crm-software",
      "title_tag": "CRM Software for Healthcare - Brand",
      "h1": "CRM Software for Healthcare Teams",
      "intro": "Full intro paragraph for this specific page",
      "unique_content": "What unique content this page should have beyond the template"
    }
  ],
  "internal_linking_strategy": "How to interlink these pages for maximum SEO value",
  "schema_markup": "Recommended schema.org type and key fields",
  "quality_signals": ["How to add enough unique content per page to avoid thin content penalties"],
  "priority_variables": ["Which variable values to launch first and why"],
  "traffic_estimate": "Estimated organic traffic potential per month at scale"
}
"""

async def generate(project: dict, body: ProgrammaticSeoRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        doc = firebase_service.create_pillar1_doc(project_id, "programmatic_seo", owner_uid, f"Programmatic SEO - {body.seed_keyword}")
        doc_id = doc["id"]

        yield _sse({"type": "research_step", "step": "template_design", "label": "Designing page template…", "status": "running"})

        user_prompt = f"""\
Brand: {brand_name}
Product: {body.product_name}
Description: {body.product_description}
Template type: {body.template_type}
Seed keyword pattern: {body.seed_keyword}
Variables to fill: {', '.join(body.variables[:20])}
Number of example pages to generate: {body.num_examples}

Design a scalable programmatic SEO template and generate {body.num_examples} example pages.
"""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=4000, system=_SYSTEM,
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
        yield _sse({"type": "research_step", "step": "template_design", "label": "Template ready", "status": "done"})
        yield _sse({"type": "programmatic_seo_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
