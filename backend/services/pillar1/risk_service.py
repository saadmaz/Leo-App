"""
Risk Flagging service - existing monitoring + SerpAPI news scan + Claude Haiku sentiment.

Composes three signal sources:
1. Re-runs the brand monitor (Tavily + Exa - already built)
2. SerpAPI news search for market/regulatory risk signals
3. Claude Haiku trend classification on existing monitor alerts
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar1 import RiskScanRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _serp_news_search(query: str) -> list[dict]:
    if not settings.SERPAPI_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://serpapi.com/search",
                params={"engine": "google", "q": query, "tbm": "nws", "num": 8, "api_key": settings.SERPAPI_API_KEY},
            )
            resp.raise_for_status()
            return resp.json().get("news_results", [])
    except Exception as exc:
        logger.warning("SerpAPI news search failed: %s", exc)
        return []


async def _tavily_search(query: str) -> list[dict]:
    if not settings.TAVILY_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={"api_key": settings.TAVILY_API_KEY, "query": query, "search_depth": "basic", "max_results": 5},
            )
            resp.raise_for_status()
            return resp.json().get("results", [])
    except Exception as exc:
        logger.warning("Tavily search failed: %s", exc)
        return []


_RISK_CLASSIFICATION_PROMPT = """\
You are a risk analyst. Classify the following market signals into structured risk alerts.
For each signal, assess severity and recommend an action.

Return ONLY a JSON array of risk objects (no markdown fences):
[
  {
    "risk_id": "uuid-here",
    "category": "market_signal",
    "severity": "medium",
    "title": "Short risk title",
    "description": "1-2 sentence description of the risk",
    "trigger_source": "serpapi_news",
    "evidence_urls": ["url1"],
    "detected_at": "ISO timestamp",
    "recommended_action": "Specific action to take",
    "dismissed": false
  }
]

Categories: "competitor_aggression" | "market_signal" | "sentiment_decline" | "regulatory"
Severities: "low" | "medium" | "high" | "critical"

Return ONLY valid JSON array - no prose, no markdown fences.
"""


async def generate(
    project: dict,
    body: RiskScanRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for risk scanning."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_core = project.get("brandCore") or {}
        brand_name = project.get("name", "the brand")
        competitors_from_core = brand_core.get("competitors") or []

        title = f"Risk Scan - {brand_name}"
        doc = firebase_service.create_pillar1_doc(project_id, "risk_flag", owner_uid, title)
        doc_id = doc["id"]

        all_signals: list[dict] = []

        # ── Step 1: Brand monitor (Tavily) ───────────────────────────────────
        yield _sse({"type": "research_step", "step": "brand_monitor", "label": "Monitoring brand mentions...", "status": "running"})
        brand_query = f'"{brand_name}" news reviews complaints'
        brand_results = await _tavily_search(brand_query)
        for r in brand_results:
            all_signals.append({
                "source": "tavily",
                "title": r.get("title", ""),
                "content": (r.get("content") or "")[:300],
                "url": r.get("url", ""),
                "signal_type": "brand_mention",
            })
        yield _sse({"type": "research_step", "step": "brand_monitor", "label": f"Found {len(brand_results)} brand signals", "status": "done"})

        # ── Step 2: SerpAPI news - market/regulatory risks ───────────────────
        yield _sse({"type": "research_step", "step": "serp_news_scan", "label": "Scanning for market & regulatory risks...", "status": "running"})

        themes = brand_core.get("themes") or []
        industry_hint = themes[0] if themes else brand_name
        keywords = body.keywords or [industry_hint]

        news_queries = [
            f"{industry_hint} regulation law 2025 2026",
            f"{industry_hint} market risk trend disruption",
        ]
        if body.include_competitor_signals and competitors_from_core:
            comp = competitors_from_core[0]
            news_queries.append(f"{comp} new feature launch campaign 2025")

        for q in news_queries[:3]:
            results = await _serp_news_search(q)
            for r in results[:4]:
                all_signals.append({
                    "source": "serpapi_news",
                    "title": r.get("title", ""),
                    "content": r.get("snippet", "")[:300],
                    "url": r.get("link", ""),
                    "signal_type": "news",
                    "date": r.get("date", ""),
                })

        yield _sse({"type": "research_step", "step": "serp_news_scan", "label": f"Captured {len(all_signals)} market signals total", "status": "done"})

        # ── Step 3: Claude Haiku risk classification ─────────────────────────
        yield _sse({"type": "research_step", "step": "sentiment_analysis", "label": "Classifying risks with AI...", "status": "running"})

        signals_text = json.dumps(all_signals[:20], indent=2)
        user_prompt = f"""\
Brand: {brand_name}
Now: {_utcnow()}

SIGNALS DETECTED:
{signals_text}

Classify these signals into risk alerts. Assign a unique UUID to each risk_id.
Only include signals that represent a genuine risk - skip routine news with no risk implication.
"""

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = await client.messages.create(
            model=settings.LLM_CLASSIFICATION_MODEL,
            max_tokens=2000,
            system=_RISK_CLASSIFICATION_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        risks: list[dict] = []
        try:
            risks = json.loads(raw)
            # Ensure risk_ids are unique UUIDs
            for risk in risks:
                if not risk.get("risk_id") or risk["risk_id"] == "uuid-here":
                    risk["risk_id"] = str(uuid.uuid4())
                risk.setdefault("dismissed", False)
        except json.JSONDecodeError:
            logger.warning("Risk classification JSON parse failed")
            risks = []

        yield _sse({"type": "research_step", "step": "sentiment_analysis", "label": f"Identified {len(risks)} risks", "status": "done"})

        # Count by severity
        critical = sum(1 for r in risks if r.get("severity") == "critical")
        high = sum(1 for r in risks if r.get("severity") == "high")

        payload = {
            "risks": risks,
            "scan_summary": {
                "total_risks": len(risks),
                "critical": critical,
                "high": high,
                "scanned_at": _utcnow(),
            },
        }

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "research_cache": {"raw_signals": all_signals},
            "credits_spent": 30,
        })

        yield _sse({"type": "risk_scan_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
