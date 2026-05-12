"""
Competitor Deep Research routes.

POST /projects/{id}/competitors/discover               - Auto-discover competitors
POST /projects/{id}/competitors/research               - Run 7-layer deep dive (SSE)
GET  /projects/{id}/competitors/reports                - List all reports
GET  /projects/{id}/competitors/reports/{report_id}    - Get single report
POST /projects/{id}/competitors/monitor                - Set up weekly monitoring
GET  /projects/{id}/competitors/monitors               - List active monitors
DELETE /projects/{id}/competitors/monitors/{id}        - Deactivate monitor
POST /projects/{id}/competitors/monitors/{id}/run      - Manual monitor run
GET  /projects/{id}/competitors/monitors/{id}/alerts   - Get monitor alerts
"""

import json
import logging

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional

from backend.api.deps import get_project_as_member, get_project_as_editor
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["competitors"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CompetitorInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    website: Optional[str] = Field(None, max_length=200)
    domain: Optional[str] = Field(None, max_length=100)
    instagram: Optional[str] = Field(None, max_length=100)
    tiktok: Optional[str] = Field(None, max_length=100)
    facebook: Optional[str] = Field(None, max_length=200)
    linkedin: Optional[str] = Field(None, max_length=200)
    youtube: Optional[str] = Field(None, max_length=200)


class DeepResearchRequest(BaseModel):
    competitors: list[CompetitorInput] = Field(..., min_length=1, max_length=5)


class CreateMonitorRequest(BaseModel):
    competitor: CompetitorInput
    frequency: str = Field(default="weekly", pattern="^(weekly|monthly)$")


# ---------------------------------------------------------------------------
# Auto-Discovery
# ---------------------------------------------------------------------------

@router.post("/competitors/discover")
async def discover_competitors(project_id: str, user: CurrentUser):
    """Auto-discover competitors via Tavily + Exa parallel search + Claude synthesis."""
    project = get_project_as_member(project_id, user["uid"])

    brand_core = project.get("brandCore") or {}
    website_url = project.get("websiteUrl") or project.get("website_url") or None

    try:
        from backend.services.intelligence_service import discover_competitors as _discover
        result = await _discover(project_id, brand_core=brand_core, website_url=website_url)
        return result
    except Exception as exc:
        logger.error("Competitor discovery failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Deep Research (SSE)
# ---------------------------------------------------------------------------

@router.post("/competitors/research")
async def deep_research(
    project_id: str,
    body: DeepResearchRequest,
    user: CurrentUser,
):
    """
    Run 7-layer competitor intelligence research.
    Streams SSE events as each layer completes.
    Returns full report stored in Firestore.
    """
    get_project_as_editor(project_id, user["uid"])

    competitors = [c.model_dump() for c in body.competitors]

    async def event_stream():
        try:
            from backend.services.competitor_research_service import stream_deep_research
            async for event in stream_deep_research(project_id=project_id, competitors=competitors):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            logger.error("Deep research stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@router.get("/competitors/reports")
async def list_reports(project_id: str, user: CurrentUser):
    """List all deep research reports for a project."""
    get_project_as_member(project_id, user["uid"])
    try:
        reports = firebase_service.list_competitor_reports(project_id)
        # Return lightweight list (omit heavy layer data)
        return {
            "reports": [
                {
                    "id": r.get("id"),
                    "run_id": r.get("run_id"),
                    "competitor": r.get("competitor", {}),
                    "threat_level": (r.get("overview") or {}).get("threat_level", "medium"),
                    "created_at": r.get("created_at"),
                }
                for r in reports
            ]
        }
    except Exception as exc:
        logger.error("List reports failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/competitors/reports/{report_id}")
async def get_report(project_id: str, report_id: str, user: CurrentUser):
    """Return the full deep research report."""
    get_project_as_member(project_id, user["uid"])
    report = firebase_service.get_competitor_report(project_id, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


# ---------------------------------------------------------------------------
# Monitors
# ---------------------------------------------------------------------------

@router.post("/competitors/monitor")
async def create_monitor(
    project_id: str,
    body: CreateMonitorRequest,
    user: CurrentUser,
):
    """Set up weekly competitor monitoring."""
    get_project_as_editor(project_id, user["uid"])
    try:
        monitor = firebase_service.save_competitor_monitor(
            project_id,
            {
                "competitor": body.competitor.model_dump(),
                "frequency": body.frequency,
                "last_run_at": None,
                "last_snapshot": {},
                "has_significant_changes": False,
            },
        )
        return monitor
    except Exception as exc:
        logger.error("Create monitor failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/competitors/monitors")
async def list_monitors(project_id: str, user: CurrentUser):
    """List all active competitor monitors."""
    get_project_as_member(project_id, user["uid"])
    try:
        monitors = firebase_service.list_competitor_monitors(project_id)
        return {"monitors": monitors}
    except Exception as exc:
        logger.error("List monitors failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/competitors/monitors/{monitor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_monitor(project_id: str, monitor_id: str, user: CurrentUser):
    """Deactivate a competitor monitor."""
    get_project_as_editor(project_id, user["uid"])
    monitor = firebase_service.get_competitor_monitor(project_id, monitor_id)
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor not found")
    firebase_service.delete_competitor_monitor(project_id, monitor_id)


@router.post("/competitors/monitors/{monitor_id}/run")
async def run_monitor(project_id: str, monitor_id: str, user: CurrentUser):
    """Manually trigger a monitor diff run."""
    get_project_as_editor(project_id, user["uid"])
    monitor = firebase_service.get_competitor_monitor(project_id, monitor_id)
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor not found")
    try:
        from backend.services.competitor_research_service import run_monitor_diff
        result = await run_monitor_diff(project_id, monitor)
        return result
    except Exception as exc:
        logger.error("Monitor run failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/competitors/monitors/{monitor_id}/alerts")
async def list_alerts(project_id: str, monitor_id: str, user: CurrentUser):
    """Return alerts for a monitor."""
    get_project_as_member(project_id, user["uid"])
    monitor = firebase_service.get_competitor_monitor(project_id, monitor_id)
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor not found")
    alerts = firebase_service.list_competitor_monitor_alerts(project_id, monitor_id)
    return {"alerts": alerts}
