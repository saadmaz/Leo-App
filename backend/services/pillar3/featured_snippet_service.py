"""
Featured Snippet Optimisation - DataForSEO SERP + Claude.

Detects if a featured snippet exists for the target keyword, analyses its
structure, and produces Claude-rewritten content optimised to win position zero.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar3 import FeaturedSnippetRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _dfs_auth() -> str:
    creds = f"{settings.DATAFORSEO_LOGIN}:{settings.DATAFORSEO_PASSWORD}"
    return "Basic " + base64.b64encode(creds.encode()).decode()


async def _fetch_serp_with_snippet(keyword: str, location_code: int, language_code: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.dataforseo.com/v3/serp/google/organic/live/regular",
            headers={"Authorization": _dfs_auth(), "Content-Type": "application/json"},
            json=[{
                "keyword": keyword,
                "location_code": location_code,
                "language_code": language_code,
                "depth": 10,
            }],
        )
        resp.raise_for_status()
        result = resp.json()
        return result.get("tasks", [{}])[0].get("result", [{}])[0].get("items", [])


async def generate(
    project: dict,
    body: FeaturedSnippetRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        messaging = brand_core.get("messaging") or {}

        title = f"Featured Snippet - {body.keyword}"
        doc = firebase_service.create_pillar1_doc(project_id, "featured_snippet", owner_uid, title)
        doc_id = doc["id"]

        use_dfs = bool(settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD)
        serp_context = ""
        has_snippet = False
        snippet_owner = None
        snippet_type = None

        # ── Step 1: Fetch SERP ────────────────────────────────────────────────
        if use_dfs:
            yield _sse({"type": "research_step", "step": "serp_fetch",
                        "label": f"Checking SERP for featured snippet on \"{body.keyword}\"...", "status": "running"})
            try:
                items = await _fetch_serp_with_snippet(body.keyword, body.location_code, body.language_code)
                snippet_items = [i for i in items if i.get("type") == "featured_snippet"]
                organic_items = [i for i in items if i.get("type") == "organic"][:5]

                if snippet_items:
                    s = snippet_items[0]
                    has_snippet = True
                    snippet_owner = s.get("domain", s.get("url", "Unknown"))
                    snippet_type = s.get("featured_snippet", {}).get("featured_snippet_type", "paragraph")
                    serp_context += f"CURRENT FEATURED SNIPPET:\n"
                    serp_context += f"Owner: {snippet_owner}\n"
                    serp_context += f"Type: {snippet_type}\n"
                    serp_context += f"Title: {s.get('title', '')}\n"
                    serp_context += f"Content: {s.get('description', '')[:500]}\n\n"

                if organic_items:
                    serp_context += "TOP ORGANIC RESULTS:\n" + "\n".join(
                        f"#{i.get('rank_absolute', idx+1)} {i.get('title', '')} - {i.get('domain', '')}"
                        for idx, i in enumerate(organic_items)
                    )

                status_label = f"Snippet found (owned by {snippet_owner})" if has_snippet else "No featured snippet - opportunity open"
                yield _sse({"type": "research_step", "step": "serp_fetch",
                            "label": status_label, "status": "done"})
            except Exception as exc:
                logger.warning("DataForSEO SERP failed: %s", exc)
                yield _sse({"type": "research_step", "step": "serp_fetch",
                            "label": "SERP unavailable - Claude-only optimisation", "status": "skipped"})
                use_dfs = False
        else:
            yield _sse({"type": "research_step", "step": "serp_fetch",
                        "label": "DataForSEO not configured - generating optimised content", "status": "skipped"})

        # ── Step 2: Claude optimisation ───────────────────────────────────────
        yield _sse({"type": "research_step", "step": "snippet_optimise",
                    "label": "Generating snippet-optimised content...", "status": "running"})

        system_prompt = """\
You are LEO, a featured snippet optimisation expert. Your goal is to help brands win the position zero featured snippet on Google.

OUTPUT FORMAT - respond with ONLY a valid JSON object (no markdown fences):
{
  "keyword": "the target keyword",
  "has_snippet": false,
  "current_snippet_owner": "domain.com or null",
  "snippet_type": "paragraph | list | table | video | null",
  "opportunity_assessment": "How winnable is this snippet - Low / Medium / High",
  "optimised_heading": "The exact H2/H3 heading to use that matches the search query",
  "optimised_answer": "The ideal paragraph (40-60 words) written to win the featured snippet - direct answer, factual, no fluff",
  "optimised_list": ["If it's a list snippet: bullet point 1", "bullet point 2", "bullet point 3"],
  "schema_markup_suggestion": "The @type of structured data to add (FAQPage | HowTo | Article | null)",
  "content_tips": [
    "Specific tip for optimising the surrounding content",
    "Another actionable tip"
  ],
  "page_requirements": "What the full page needs (word count, structure, etc.) to compete",
  "estimated_time_to_win": "Days or weeks estimate"
}

Rules:
- optimised_answer: must be 40-60 words, written as a direct answer starting with the keyword.
- If snippet_type is list, populate optimised_list with 4-7 steps/items.
- schema_markup_suggestion: only suggest if highly relevant.
- Return ONLY valid JSON - no prose, no markdown.
"""

        brand_ctx = f"Brand: {brand_name}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value prop: {messaging['valueProp']}\n"

        user_prompt = f"""\
{brand_ctx}
Target keyword: "{body.keyword}"

{serp_context if serp_context else "No live SERP data - optimise based on keyword intent and best practices."}

{"Existing content to rewrite:\n" + body.your_content[:1000] if body.your_content else "No existing content provided - generate ideal snippet content from scratch."}

Produce a featured snippet optimisation plan.
"""

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=settings.LLM_MAX_TOKENS,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                yield _sse({"type": "delta", "content": text})

        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw, "parse_error": True}

        payload["dataforseo_used"] = use_dfs
        # Merge live snippet data if available
        if use_dfs:
            payload["has_snippet"] = has_snippet
            payload["current_snippet_owner"] = snippet_owner
            payload["snippet_type"] = snippet_type

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "credits_spent": 10,
        })

        yield _sse({"type": "research_step", "step": "snippet_optimise",
                    "label": "Snippet optimisation complete", "status": "done"})
        yield _sse({"type": "featured_snippet_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
