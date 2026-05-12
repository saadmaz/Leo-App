"""
Brand monitoring routes - on-demand monitoring scans and alert management.

POST /projects/{id}/monitor/run          Stream a monitoring scan (SSE)
GET  /projects/{id}/monitor/alerts       List alerts
POST /projects/{id}/monitor/alerts/{id}/read  Mark alert as read
"""

import json
import logging

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional

from backend.api.deps import get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.middleware.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["monitoring"])


@router.post("/monitor/run")
@limiter.limit("5/minute")
async def run_monitor(
    request: Request,
    project_id: str,
    user: CurrentUser,
):
    """
    Trigger an on-demand brand monitoring scan.
    Streams SSE events: progress, new_alert, done.
    """
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}
    brand_name = project.get("name", "")

    if not brand_name:
        raise HTTPException(status_code=400, detail="Project has no name set.")

    async def event_stream():
        yield f"data: {json.dumps({'type': 'progress', 'message': 'Starting brand monitoring scan…'})}\n\n"

        try:
            from backend.services import monitoring_service
            result = await monitoring_service.run_brand_monitor(
                project_id=project_id,
                brand_core=brand_core,
                brand_name=brand_name,
            )

            for alert in result.get("alerts", []):
                yield f"data: {json.dumps({'type': 'new_alert', 'alert': alert})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'new_alerts': result['new_alerts'], 'targets': result['targets_searched']})}\n\n"

        except Exception as exc:
            logger.error("Monitoring scan error for project %s: %s", project_id, exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/monitor/alerts")
async def list_alerts(
    project_id: str,
    user: CurrentUser,
    unread_only: bool = Query(False),
    days: int = Query(30, ge=1, le=90),
    limit: int = Query(50, ge=1, le=100),
):
    """List brand monitoring alerts for a project."""
    get_project_as_member(project_id, user["uid"])

    from backend.services import firebase_service
    alerts = firebase_service.list_monitor_alerts(
        project_id,
        unread_only=unread_only,
        limit=limit,
        days=days,
    )
    return {"alerts": alerts, "total": len(alerts)}


@router.post("/monitor/alerts/{alert_id}/read")
async def mark_alert_read(
    project_id: str,
    alert_id: str,
    user: CurrentUser,
):
    """Mark a monitoring alert as read."""
    get_project_as_member(project_id, user["uid"])

    from backend.services import firebase_service
    firebase_service.mark_alert_read(project_id, alert_id)
    return {"success": True}
