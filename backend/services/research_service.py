"""
Research service - async deep market research using Exa /research API.

Creates research tasks that run for 5-60 seconds, returning structured
markdown reports with citations. Results are persisted to Firestore so
they can be retrieved later via the reports route.

For fast/cheap research, falls back to Tavily search + Claude synthesis.
"""

import asyncio
import logging
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)

# Output schema for structured market research reports
MARKET_REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "executive_summary": {"type": "string"},
        "market_overview": {"type": "string"},
        "key_players": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "positioning": {"type": "string"},
                    "strengths": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "trends": {"type": "array", "items": {"type": "string"}},
        "audience_insights": {"type": "string"},
        "content_opportunities": {"type": "array", "items": {"type": "string"}},
        "threats": {"type": "array", "items": {"type": "string"}},
        "recommendations": {"type": "array", "items": {"type": "string"}},
    },
}


async def start_research_report(
    project_id: str,
    user_id: str,
    title: str,
    query: str,
    report_type: str = "market",
    model: str = "exa-research",
    brand_core: Optional[dict] = None,
) -> str:
    """
    Kick off an async Exa /research task.
    Saves a pending report to Firestore and returns the report_id.

    report_type: "market" | "competitor" | "audience" | "trend" | "seo"
    model: "exa-research-fast" | "exa-research" | "exa-research-pro"
    Returns: Firestore report_id
    """
    from backend.services import firebase_service

    # Build enriched instructions from brand context
    brand_context = ""
    if brand_core:
        themes = brand_core.get("themes") or []
        audience = (brand_core.get("audience") or {}).get("demographics", "")
        if themes:
            brand_context = f"\nBrand themes: {', '.join(themes[:4])}."
        if audience:
            brand_context += f"\nTarget audience: {audience}."

    instructions = f"{query}{brand_context}\n\nProvide a comprehensive analysis suitable for a marketing strategy report. Include specific examples, data points, and actionable insights."

    # Save pending report to Firestore immediately
    report_doc = firebase_service.save_research_report(project_id, {
        "title": title,
        "query": query,
        "report_type": report_type,
        "model_used": model,
        "created_by": user_id,
        "task_id": None,
        "report_markdown": None,
        "citations": [],
    })
    report_id = report_doc["id"]

    # Start Exa research task (or fall back to Tavily if key missing)
    if settings.EXA_API_KEY:
        try:
            from backend.services.integrations import exa_client
            task_id = await exa_client.start_research(
                instructions=instructions,
                model=model,
                project_id=project_id,
            )
            firebase_service.update_research_report(project_id, report_id, {
                "task_id": task_id,
                "status": "running",
            })
            logger.info("Exa research task %s started for report %s", task_id, report_id)
        except Exception as exc:
            logger.error("Exa research start failed: %s - falling back to Tavily", exc)
            # Fall back to synchronous Tavily research
            asyncio.create_task(_run_tavily_research(project_id, report_id, query, brand_core))
    elif settings.TAVILY_API_KEY:
        asyncio.create_task(_run_tavily_research(project_id, report_id, query, brand_core))
    else:
        firebase_service.update_research_report(project_id, report_id, {
            "status": "error",
            "error": "No search API keys configured (EXA_API_KEY or TAVILY_API_KEY required)",
        })

    return report_id


async def _run_tavily_research(
    project_id: str,
    report_id: str,
    query: str,
    brand_core: Optional[dict],
) -> None:
    """Fallback: run research via Tavily search + Claude synthesis."""
    from backend.services import firebase_service

    try:
        from backend.services.integrations import tavily_client
        from backend.services.llm_service import get_client, build_brand_core_context
        from backend.config import settings as _settings

        # Run multiple searches for comprehensive coverage
        results = await tavily_client.search_advanced(
            query=query,
            max_results=10,
            include_answer=True,
            project_id=project_id,
        )

        sources = results.get("results", [])
        answer = results.get("answer", "")
        combined_content = answer + "\n\n" + "\n\n".join(
            f"Source: {r['title']} ({r['url']})\n{r.get('content', '')[:500]}"
            for r in sources[:8]
        )

        # Synthesise with Claude
        client = get_client()
        brand_context = build_brand_core_context(brand_core) if brand_core else ""

        synthesis_prompt = f"""You are a senior marketing strategist. Synthesise this research into a comprehensive report.

QUERY: {query}
BRAND CONTEXT: {brand_context}

RESEARCH DATA:
{combined_content[:6000]}

Write a detailed marketing research report with these sections:
1. Executive Summary
2. Market Overview
3. Key Players & Competitors
4. Trends & Opportunities
5. Audience Insights
6. Content Opportunities
7. Strategic Recommendations

Use markdown formatting. Be specific and actionable."""

        response = await client.messages.create(
            model=_settings.LLM_CHAT_MODEL,
            max_tokens=3000,
            messages=[{"role": "user", "content": synthesis_prompt}],
        )

        report_markdown = response.content[0].text
        citations = [
            {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("content", "")[:200]}
            for r in sources[:8]
        ]

        from datetime import datetime, timezone
        firebase_service.update_research_report(project_id, report_id, {
            "status": "complete",
            "report_markdown": report_markdown,
            "citations": citations,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Tavily research complete for report %s", report_id)

    except Exception as exc:
        logger.error("Tavily research failed for report %s: %s", report_id, exc)
        from backend.services import firebase_service as fs
        fs.update_research_report(project_id, report_id, {
            "status": "error",
            "error": str(exc),
        })


async def poll_research_report(project_id: str, report_id: str) -> dict:
    """
    Check status of an Exa async research task and update Firestore when complete.
    Returns the current report document.
    """
    from backend.services import firebase_service

    report = firebase_service.get_research_report(project_id, report_id)
    if not report:
        return {"status": "not_found"}

    if report.get("status") in ("complete", "error"):
        return report

    task_id = report.get("task_id")
    if not task_id:
        return report

    try:
        from backend.services.integrations import exa_client
        status_data = await exa_client.get_research_status(task_id)
        exa_status = status_data.get("status", "unknown")

        if exa_status == "completed":
            content = status_data.get("content", "")

            # Parse structured JSON content or use as markdown
            report_markdown = ""
            if isinstance(content, dict):
                import json
                report_markdown = f"```json\n{json.dumps(content, indent=2)}\n```"
            elif isinstance(content, str):
                report_markdown = content

            from datetime import datetime, timezone
            firebase_service.update_research_report(project_id, report_id, {
                "status": "complete",
                "report_markdown": report_markdown,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "cost_dollars": status_data.get("cost_dollars", 0),
            })
            return firebase_service.get_research_report(project_id, report_id) or report

        elif exa_status == "failed":
            firebase_service.update_research_report(project_id, report_id, {
                "status": "error",
                "error": "Exa research task failed",
            })

        return report

    except Exception as exc:
        logger.error("Research poll error for %s: %s", report_id, exc)
        return report
