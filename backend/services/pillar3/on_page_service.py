"""
On-Page SEO Optimisation - DataForSEO OnPage instant_pages + Claude.

Crawls a single URL with DataForSEO OnPage API, then Claude prioritises
fixes, scores the page, and produces an actionable optimisation report.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar3 import OnPageSeoRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _dfs_auth() -> str:
    creds = f"{settings.DATAFORSEO_LOGIN}:{settings.DATAFORSEO_PASSWORD}"
    return "Basic " + base64.b64encode(creds.encode()).decode()


async def _crawl_page(url: str) -> dict:
    """Synchronous single-page audit via DataForSEO OnPage instant_pages."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.dataforseo.com/v3/on_page/instant_pages",
            headers={"Authorization": _dfs_auth(), "Content-Type": "application/json"},
            json=[{
                "url": url,
                "enable_javascript": True,
                "load_resources": True,
                "enable_browser_rendering": True,
                "custom_js": "",
            }],
        )
        resp.raise_for_status()
        result = resp.json()
        items = result.get("tasks", [{}])[0].get("result", [{}])[0].get("items", [])
        return items[0] if items else {}


def _extract_onpage_summary(page: dict) -> str:
    """Turn the DataForSEO OnPage item into a compact text summary for Claude."""
    meta = page.get("meta", {}) or {}
    checks = page.get("checks", {}) or {}

    lines = [
        f"URL: {page.get('url', '')}",
        f"Title: {meta.get('title', 'N/A')} ({len(meta.get('title') or '')} chars)",
        f"Description: {meta.get('description', 'N/A')[:120]} ({len(meta.get('description') or '')} chars)",
        f"H1: {', '.join((meta.get('htags') or {}).get('h1', [])[:3])}",
        f"Word count: {meta.get('content', {}).get('plain_text_word_count', 'N/A')}",
        f"Page size (bytes): {page.get('size', 'N/A')}",
        f"Load time (ms): {int((page.get('fetch_time') or 0) * 1000) or 'N/A'}",
        f"HTTPS: {checks.get('is_https', 'N/A')}",
        f"Canonical: {meta.get('canonical', 'N/A')}",
        f"Robots meta: {meta.get('robots_meta', 'N/A') or 'not set'}",
        f"Internal links: {page.get('internal_links_count', 'N/A')}",
        f"External links: {page.get('external_links_count', 'N/A')}",
        f"Images without alt: {checks.get('no_image_alt', 'N/A')}",
        f"Duplicate content: {checks.get('is_redirect', False)}",
        f"Structured data: {', '.join(meta.get('structured_data', {}).get('types', [])) or 'None detected'}",
    ]

    # Include top checks that are failing
    failing = [k for k, v in checks.items() if v is True and k not in ("is_https",)][:10]
    if failing:
        lines.append(f"Failing checks: {', '.join(failing)}")

    return "\n".join(lines)


async def generate(
    project: dict,
    body: OnPageSeoRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        messaging = brand_core.get("messaging") or {}

        title = f"On-Page Audit - {body.url[:60]}"
        doc = firebase_service.create_pillar1_doc(project_id, "on_page_seo", owner_uid, title)
        doc_id = doc["id"]

        use_dfs = bool(settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD)
        page_data: dict = {}
        page_summary = ""

        # ── Step 1: DataForSEO OnPage crawl ───────────────────────────────────
        if use_dfs:
            yield _sse({"type": "research_step", "step": "page_crawl",
                        "label": f"Crawling {body.url[:50]}...", "status": "running"})
            try:
                page_data = await _crawl_page(body.url)
                page_summary = _extract_onpage_summary(page_data)
                yield _sse({"type": "research_step", "step": "page_crawl",
                            "label": "Page crawl complete", "status": "done"})
            except Exception as exc:
                logger.warning("DataForSEO OnPage crawl failed: %s", exc)
                yield _sse({"type": "research_step", "step": "page_crawl",
                            "label": "Crawl unavailable - Claude-only analysis", "status": "skipped"})
                use_dfs = False
        else:
            yield _sse({"type": "research_step", "step": "page_crawl",
                        "label": "DataForSEO not configured - heuristic analysis", "status": "skipped"})

        # ── Step 2: Claude optimisation analysis ─────────────────────────────
        yield _sse({"type": "research_step", "step": "seo_analysis",
                    "label": "Generating optimisation recommendations...", "status": "running"})

        system_prompt = """\
You are LEO, an expert on-page SEO consultant. Analyse the page data and produce an actionable SEO audit report.

OUTPUT FORMAT - respond with ONLY a valid JSON object (no markdown fences):
{
  "url": "https://...",
  "overall_score": 72,
  "grade": "B",
  "title_tag": "Current title or null",
  "meta_description": "Current meta description or null",
  "word_count": 1200,
  "load_time_ms": 1800,
  "issues": [
    {
      "type": "title_too_long | missing_h1 | duplicate_content | missing_alt | slow_load | no_schema | thin_content | missing_canonical | keyword_missing | etc.",
      "severity": "critical | warning | info",
      "description": "Clear explanation of the issue",
      "fix": "Exact fix with example if possible"
    }
  ],
  "strengths": ["What the page is doing well - up to 5 items"],
  "priority_fixes": ["Top 3 fixes that will have the most SEO impact, ordered by impact"],
  "quick_wins": ["2-3 changes you can make in under 30 minutes"],
  "optimised_title": "Suggested improved title tag",
  "optimised_description": "Suggested improved meta description",
  "estimated_impact": "What these changes could do for rankings in 30-60 days"
}

Rules:
- overall_score: 0-100 (0=terrible, 100=perfect).
- grade: A (90+), B (75-89), C (60-74), D (45-59), F (<45).
- severity: critical = must fix now; warning = fix soon; info = nice to have.
- Return ONLY valid JSON - no prose, no markdown.
"""

        brand_ctx = f"Brand: {brand_name}\n"
        if body.target_keyword:
            brand_ctx += f"Target keyword: {body.target_keyword}\n"
        if messaging.get("valueProp"):
            brand_ctx += f"Value prop: {messaging['valueProp']}\n"

        user_prompt = f"""\
{brand_ctx}
URL being audited: {body.url}

{page_summary if page_summary else "No live crawl data available - analyse based on URL structure and brand context, then recommend general best-practice SEO improvements."}

Produce a comprehensive on-page SEO audit.
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

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "credits_spent": 15,
        })

        yield _sse({"type": "research_step", "step": "seo_analysis",
                    "label": "On-page audit complete", "status": "done"})
        yield _sse({"type": "on_page_seo_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
