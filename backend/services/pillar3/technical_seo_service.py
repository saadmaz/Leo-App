"""
Technical SEO Monitor - DataForSEO OnPage instant_pages + Claude.

Performs a comprehensive technical SEO audit of a URL, covering Core Web Vitals
signals, crawlability, structured data, canonicalisation, and mobile-friendliness.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar3 import TechnicalSeoRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _dfs_auth() -> str:
    creds = f"{settings.DATAFORSEO_LOGIN}:{settings.DATAFORSEO_PASSWORD}"
    return "Basic " + base64.b64encode(creds.encode()).decode()


async def _technical_crawl(url: str, enable_js: bool) -> dict:
    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            "https://api.dataforseo.com/v3/on_page/instant_pages",
            headers={"Authorization": _dfs_auth(), "Content-Type": "application/json"},
            json=[{
                "url": url,
                "enable_javascript": enable_js,
                "load_resources": True,
                "enable_browser_rendering": enable_js,
                "enable_xhr": True,
                "custom_js": "",
            }],
        )
        resp.raise_for_status()
        result = resp.json()
        items = result.get("tasks", [{}])[0].get("result", [{}])[0].get("items", [])
        return items[0] if items else {}


def _build_technical_context(page: dict) -> str:
    """Extract all technical signals from DataForSEO OnPage result."""
    meta = page.get("meta", {}) or {}
    checks = page.get("checks", {}) or {}
    content = meta.get("content", {}) or {}

    lines = [
        "=== TECHNICAL SEO DATA ===",
        f"URL: {page.get('url', 'N/A')}",
        f"Status code: {page.get('status_code', 'N/A')}",
        f"Page size (bytes): {page.get('size', 'N/A')}",
        f"Fetch time (ms): {int((page.get('fetch_time') or 0) * 1000) or 'N/A'}",
        "",
        "--- Meta ---",
        f"Title: {meta.get('title', 'N/A')} ({len(meta.get('title') or '')} chars)",
        f"Description: {(meta.get('description') or 'N/A')[:150]} ({len(meta.get('description') or '')} chars)",
        f"Canonical: {meta.get('canonical', 'N/A')}",
        f"Robots meta: {meta.get('robots_meta', 'not set')}",
        f"Language: {meta.get('language', 'N/A')}",
        f"Charset: {meta.get('charset', 'N/A')}",
        f"Viewport: {meta.get('viewport', 'N/A')}",
        "",
        "--- Content ---",
        f"Word count: {content.get('plain_text_word_count', 'N/A')}",
        f"H1 tags: {', '.join((meta.get('htags') or {}).get('h1', [])) or 'None'}",
        f"H2 count: {len((meta.get('htags') or {}).get('h2', []))}",
        f"Internal links: {page.get('internal_links_count', 'N/A')}",
        f"External links: {page.get('external_links_count', 'N/A')}",
        f"Images without alt: {checks.get('no_image_alt', 'N/A')}",
        "",
        "--- Technical Checks ---",
        f"HTTPS: {checks.get('is_https', False)}",
        f"Is redirect: {checks.get('is_redirect', False)}",
        f"Redirect chain length: {page.get('redirect_count', 0)}",
        f"Has structured data: {bool((meta.get('structured_data') or {}).get('types'))}",
        f"Structured data types: {', '.join((meta.get('structured_data') or {}).get('types', [])) or 'None'}",
        f"Has Open Graph: {bool(meta.get('social_graph_tags'))}",
        f"Has Twitter card: {bool((meta.get('social_graph_tags') or {}).get('twitter:card'))}",
        "",
        "--- Failing Checks ---",
    ]

    failing = {k: v for k, v in checks.items() if v is True and "error" in k.lower() or v is False and k in (
        "is_https", "has_h1", "has_meta_description", "has_title",
    )}
    all_checks = {k: v for k, v in checks.items() if isinstance(v, bool)}
    bad_checks = [k for k, v in all_checks.items() if not v and k not in ("is_redirect", "is_4xx_code", "is_5xx_code")][:15]
    lines.append(", ".join(bad_checks) if bad_checks else "None detected")

    return "\n".join(lines)


async def generate(
    project: dict,
    body: TechnicalSeoRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")

        title = f"Technical SEO - {body.url[:60]}"
        doc = firebase_service.create_pillar1_doc(project_id, "technical_seo", owner_uid, title)
        doc_id = doc["id"]

        use_dfs = bool(settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD)
        tech_context = ""

        # ── Step 1: DataForSEO technical crawl ───────────────────────────────
        if use_dfs:
            yield _sse({"type": "research_step", "step": "technical_crawl",
                        "label": f"Running technical audit on {body.url[:50]}...", "status": "running"})
            try:
                page_data = await _technical_crawl(body.url, body.enable_javascript)
                if page_data:
                    tech_context = _build_technical_context(page_data)
                    yield _sse({"type": "research_step", "step": "technical_crawl",
                                "label": "Technical crawl complete", "status": "done"})
                else:
                    yield _sse({"type": "research_step", "step": "technical_crawl",
                                "label": "Page returned no data - Claude heuristic audit", "status": "skipped"})
                    use_dfs = False
            except Exception as exc:
                logger.warning("DataForSEO technical crawl failed: %s", exc)
                yield _sse({"type": "research_step", "step": "technical_crawl",
                            "label": "Crawl unavailable - heuristic audit", "status": "skipped"})
                use_dfs = False
        else:
            yield _sse({"type": "research_step", "step": "technical_crawl",
                        "label": "DataForSEO not configured - heuristic audit", "status": "skipped"})

        # ── Step 2: Claude technical analysis ────────────────────────────────
        yield _sse({"type": "research_step", "step": "technical_analysis",
                    "label": "Generating technical SEO report...", "status": "running"})

        system_prompt = """\
You are LEO, a technical SEO expert. Produce a comprehensive technical SEO audit with prioritised action items.

OUTPUT FORMAT - respond with ONLY a valid JSON object (no markdown fences):
{
  "url": "https://...",
  "crawl_score": 78,
  "page_load_time": 1800,
  "mobile_friendly": true,
  "https_enabled": true,
  "canonical_url": "https://... or null",
  "structured_data": ["Article", "BreadcrumbList"],
  "issues": [
    {
      "category": "Performance | Crawlability | Structured Data | Meta | Mobile | Security | Core Web Vitals | Indexability",
      "severity": "critical | warning | info",
      "description": "Clear description of the technical issue",
      "affected_elements": ["specific element or tag"],
      "fix": "Exact fix - include code snippet or step-by-step if helpful"
    }
  ],
  "performance_metrics": {
    "estimated_lcp": "< 2.5s (Good) | 2.5-4s (Needs Improvement) | > 4s (Poor)",
    "estimated_cls": "< 0.1 (Good) | ...",
    "estimated_fid": "< 100ms (Good) | ...",
    "page_size_assessment": "Lightweight | Average | Heavy"
  },
  "recommendations": [
    "Top 5 technical improvements ordered by impact"
  ],
  "quick_technical_wins": ["Changes implementable in under 1 hour"],
  "technical_score_breakdown": {
    "crawlability": 85,
    "page_speed": 70,
    "mobile": 90,
    "structured_data": 40,
    "security": 95,
    "meta_tags": 75
  }
}

Rules:
- crawl_score: 0-100 overall technical health score.
- Include up to 10 issues, sorted by severity (critical first).
- fix must be specific and actionable.
- Return ONLY valid JSON - no prose, no markdown.
"""

        user_prompt = f"""\
Brand: {brand_name}
URL being audited: {body.url}

{tech_context if tech_context else "No live crawl data available - produce a technical SEO audit based on URL structure, common technical issues, and industry best practices."}

Produce a comprehensive technical SEO audit report.
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
            "credits_spent": 20,
        })

        yield _sse({"type": "research_step", "step": "technical_analysis",
                    "label": "Technical SEO audit complete", "status": "done"})
        yield _sse({"type": "technical_seo_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
