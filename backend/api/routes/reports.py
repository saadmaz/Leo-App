"""
Reports routes - Phase 10.

Endpoints:
  GET  /projects/{id}/reports/digest        - AI-generated weekly digest
  POST /projects/{id}/reports/score-content - Batch brand voice score for library items
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

import asyncio

from backend.api.deps import get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.services import analytics_service, intelligence_service, firebase_service
from backend.services.credits_service import check_and_deduct
from backend.config import settings
from backend.services.llm_service import get_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["reports"])


# ---------------------------------------------------------------------------
# Weekly digest
# ---------------------------------------------------------------------------

@router.get("/reports/digest")
async def get_weekly_digest(project_id: str, user: CurrentUser):
    """Generate an AI-powered weekly digest with trends and recommendations."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(check_and_deduct, user["uid"], "weekly_digest")
    brand_core = project.get("brandCore") or {}

    overview = await analytics_service.get_overview(project_id)
    trends = await analytics_service.get_trends(project_id)
    activity = await analytics_service.get_activity_feed(project_id, limit=30)

    # Recent activity summary
    recent_types: dict[str, int] = {}
    for evt in activity:
        t = evt.get("event_type", "other")
        recent_types[t] = recent_types.get(t, 0) + 1

    brand_name = brand_core.get("messaging", {}).get("valueProp", "") or project.get("name", "your brand")
    tone = brand_core.get("tone", {}).get("style", "professional")

    prompt = f"""You are a senior marketing strategist reviewing weekly performance for {brand_name}.

CONTENT STATS:
- Total content items: {overview['total_content']}
- Posted this period: {overview['total_posted']}
- Average engagement: {overview['avg_engagement']} (tracked posts)
- Total impressions tracked: {overview['total_impressions']}
- Best performing platform: {overview['best_platform'] or 'not yet determined'}
- Platform distribution: {overview['platform_breakdown']}

CONTENT MIX:
- Status breakdown: {trends['status_breakdown']}
- Platform breakdown: {trends['platform_breakdown']}

RECENT ACTIVITY EVENTS: {recent_types}

Generate a professional weekly digest report with these exact sections (use markdown headers):

## Performance Summary
2-3 sentences highlighting the key wins and metrics.

## What Worked
2-3 bullet points of what's performing well.

## Opportunities
2-3 bullet points identifying gaps or underperforming areas.

## This Week's Recommendations
4-5 specific, actionable content recommendations. Be concrete (e.g. "Post 2 LinkedIn articles this week focused on X" not "post more content").

## Content Health Score
Give an overall content health score out of 10 with a one-line justification.

Keep the tone {tone} and focused on actionable insights. Be direct - no filler text."""

    client = get_client()
    response = await client.messages.create(
        model=settings.LLM_MODEL,
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}],
    )

    digest_text = response.content[0].text

    return {
        "digest": digest_text,
        "overview": overview,
        "trends": trends,
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Batch content scoring
# ---------------------------------------------------------------------------

class ScoreRequest(BaseModel):
    item_ids: list[str]


@router.post("/reports/score-content")
async def score_content_batch(
    project_id: str,
    body: ScoreRequest,
    user: CurrentUser,
):
    """Score a batch of content library items against brand voice. Returns scores keyed by item_id."""
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore")

    if not brand_core:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Brand Core not set up yet.",
        )

    db = firebase_service.get_db()
    results: dict[str, dict] = {}
    for item_id in body.item_ids[:20]:  # cap at 20 to avoid timeout
        try:
            item_doc = (
                db
                .collection("projects").document(project_id)
                .collection("content_library").document(item_id)
                .get()
            )
            if not item_doc.exists:
                continue
            content = item_doc.to_dict().get("content", "")
            if not content:
                continue
            score_result = await intelligence_service.score_brand_voice(content, brand_core)
            score = score_result.get("score", 0)
            # Persist score on content item
            db \
                .collection("projects").document(project_id) \
                .collection("content_library").document(item_id) \
                .update({"voice_score": score})
            results[item_id] = {"score": score, "feedback": score_result.get("feedback", "")}
        except Exception as exc:
            logger.warning("Score failed for item %s: %s", item_id, exc)
            results[item_id] = {"score": None, "error": str(exc)}

    return results


# ---------------------------------------------------------------------------
# Deep Research Reports (Exa + Tavily)
# ---------------------------------------------------------------------------

import json as _json
import asyncio as _asyncio
from fastapi import Query as _Query
from fastapi.responses import StreamingResponse as _StreamingResponse
from pydantic import Field as _Field
from fastapi import Request as _Request
from backend.middleware.rate_limit import limiter as _limiter


class StartResearchRequest(BaseModel):
    topic: str = _Field(..., min_length=3, max_length=300)
    report_type: str = _Field(default="market_landscape")
    model: str = _Field(default="exa-research")


def _normalize_report(report: dict) -> dict:
    """
    Map Firestore field names to the frontend ResearchReport type.
    Converts snake_case timestamps, normalises status values, maps
    citations → sources, and parses report_markdown into summary + sections.
    """
    # Status normalisation: backend may save "running" or "started"
    _status_map = {"running": "processing", "started": "pending"}
    raw_status = report.get("status", "pending")
    fe_status = _status_map.get(raw_status, raw_status)

    # Parse report_markdown into summary + sections
    summary = None
    sections = []
    markdown = report.get("report_markdown") or ""
    if markdown:
        lines = markdown.split("\n")
        # First non-heading, non-empty line becomes the summary
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                summary = stripped[:500]
                break
        # H2 headings (##) become sections
        current_title: str | None = None
        current_body: list[str] = []
        for line in lines:
            if line.startswith("## "):
                if current_title is not None:
                    sections.append({
                        "title": current_title,
                        "content": "\n".join(current_body).strip(),
                    })
                current_title = line[3:].strip()
                current_body = []
            elif current_title is not None:
                current_body.append(line)
        if current_title is not None:
            sections.append({
                "title": current_title,
                "content": "\n".join(current_body).strip(),
            })

    # Citations → sources
    sources = [
        {"title": c.get("title", ""), "url": c.get("url", "")}
        for c in (report.get("citations") or [])
        if c.get("url")
    ]

    return {
        "id": report.get("id", ""),
        "projectId": report.get("project_id", ""),
        "topic": report.get("query") or report.get("topic") or report.get("title", ""),
        "title": report.get("title"),
        "report_type": report.get("report_type"),
        "status": fe_status,
        "summary": summary or None,
        "sections": sections if sections else None,
        "sources": sources if sources else None,
        "error": report.get("error"),
        "createdAt": report.get("created_at") or report.get("createdAt", ""),
        "completedAt": report.get("completed_at") or report.get("completedAt"),
    }


@router.post("/reports/research/start")
@_limiter.limit("3/minute")
async def start_research(
    request: _Request,
    project_id: str,
    body: StartResearchRequest,
    user: CurrentUser,
):
    """
    Start an async deep research task. Returns report_id immediately.
    Poll /reports/research/{id}/status for completion.
    """
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(check_and_deduct, user["uid"], "research_report")

    from backend.services import research_service
    report_id = await research_service.start_research_report(
        project_id=project_id,
        user_id=user["uid"],
        title=body.topic,
        query=body.topic,
        report_type=body.report_type,
        model=body.model,
        brand_core=project.get("brandCore"),
    )

    return {"report_id": report_id, "status": "started"}


@router.get("/reports/research/{report_id}/status")
async def get_research_status(
    project_id: str,
    report_id: str,
    user: CurrentUser,
):
    """
    Poll or stream the status of a research task.
    Returns current report state; call repeatedly until status='complete'.
    """
    get_project_as_member(project_id, user["uid"])

    from backend.services import research_service
    report = await research_service.poll_research_report(project_id, report_id)
    return _normalize_report(report)


@router.get("/reports/research")
async def list_research_reports(
    project_id: str,
    user: CurrentUser,
    limit: int = _Query(20, ge=1, le=50),
):
    """List all research reports for a project."""
    get_project_as_member(project_id, user["uid"])

    reports = firebase_service.list_research_reports(project_id, limit=limit)
    normalized = [_normalize_report(r) for r in reports]
    return {"reports": normalized, "total": len(normalized)}


@router.get("/reports/research/{report_id}")
async def get_research_report(
    project_id: str,
    report_id: str,
    user: CurrentUser,
):
    """Get a single research report by ID."""
    get_project_as_member(project_id, user["uid"])

    report = firebase_service.get_research_report(project_id, report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    return _normalize_report(report)


@router.delete("/reports/research/{report_id}")
async def delete_research_report(
    project_id: str,
    report_id: str,
    user: CurrentUser,
):
    """Delete a research report."""
    get_project_as_member(project_id, user["uid"])

    firebase_service.delete_research_report(project_id, report_id)
    return {"success": True}
