"""
Analytics routes - Phase 7.

Endpoints:
  POST /projects/{id}/analytics/{item_id}/metrics  - Log performance metrics
  GET  /projects/{id}/analytics/overview           - Aggregate stats
  GET  /projects/{id}/analytics/content            - Per-content performance table
  GET  /projects/{id}/analytics/trends             - Time-series trend data
  GET  /projects/{id}/analytics/activity           - Activity feed
  GET  /projects/{id}/analytics/ai-summary         - AI performance analysis
"""

import logging
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from backend.api.deps import get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.services import analytics_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["analytics"])


class MetricsPayload(BaseModel):
    platform: str = ""
    impressions: int = 0
    reach: int = 0
    clicks: int = 0
    likes: int = 0
    comments: int = 0
    shares: int = 0


@router.post("/analytics/{item_id}/metrics")
async def log_metrics(
    project_id: str,
    item_id: str,
    payload: MetricsPayload,
    user: CurrentUser,
):
    get_project_as_member(project_id, user["uid"])
    return await analytics_service.log_metrics(project_id, item_id, payload.model_dump())


@router.get("/analytics/overview")
async def get_overview(
    project_id: str,
    user: CurrentUser,
):
    get_project_as_member(project_id, user["uid"])
    return await analytics_service.get_overview(project_id)


@router.get("/analytics/content")
async def get_content_performance(
    project_id: str,
    user: CurrentUser,
):
    get_project_as_member(project_id, user["uid"])
    return await analytics_service.get_content_performance(project_id)


@router.get("/analytics/trends")
async def get_trends(
    project_id: str,
    user: CurrentUser,
):
    get_project_as_member(project_id, user["uid"])
    return await analytics_service.get_trends(project_id)


@router.get("/analytics/activity")
async def get_activity(
    project_id: str,
    user: CurrentUser,
):
    get_project_as_member(project_id, user["uid"])
    return await analytics_service.get_activity_feed(project_id)


@router.get("/analytics/ai-summary")
async def get_ai_summary(
    project_id: str,
    user: CurrentUser,
):
    get_project_as_member(project_id, user["uid"])
    summary = await analytics_service.generate_performance_summary(project_id)
    return {"summary": summary}


@router.get("/analytics/compare")
async def get_comparison(
    project_id: str,
    user: CurrentUser,
    period: Optional[str] = Query("7d", regex="^(7d|30d)$"),
):
    """Compare key metrics for the current period vs the previous same-length period."""
    get_project_as_member(project_id, user["uid"])
    days = 30 if period == "30d" else 7
    return await analytics_service.get_comparison(project_id, days)
