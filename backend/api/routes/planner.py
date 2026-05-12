"""
AI Content Planner routes.

Endpoints:
  POST /projects/{id}/planner/generate  - Generate a multi-week content plan
  POST /projects/{id}/planner/apply     - Apply planned posts to the content calendar
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import asyncio

from backend.api.deps import get_project_or_404, assert_member
from backend.middleware.auth import CurrentUser
from backend.middleware.rate_limit import limiter
from backend.services import content_studio_service, firebase_service
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["planner"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PlannerGenerateRequest(BaseModel):
    duration: str = "2_weeks"      # "1_week" | "2_weeks" | "1_month"
    platforms: list[str] = ["Instagram", "LinkedIn"]
    goal: str = ""                  # e.g. "Launch new product", "Build brand awareness"
    postsPerWeek: int = 5


class PlannerApplyRequest(BaseModel):
    items: list[dict]               # Array of ContentPlanItem dicts
    mode: str = "library"           # "library" | "calendar"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/{project_id}/planner/generate")
@limiter.limit("10/minute")
async def generate_plan(
    request: Request,
    project_id: str,
    body: PlannerGenerateRequest,
    user: CurrentUser,
) -> dict:
    """Generate an AI content plan for the given duration and platforms."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    await asyncio.to_thread(check_and_deduct, user["uid"], "content_plan")

    brand_core = project.get("brandCore") or {}
    project_name = project.get("name", "the brand")

    try:
        plan = await content_studio_service.generate_content_plan(
            project_name=project_name,
            brand_core=brand_core,
            duration=body.duration,
            platforms=body.platforms,
            goal=body.goal,
            posts_per_week=body.postsPerWeek,
        )
    except Exception as exc:
        logger.error("Content plan generation failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Failed to generate plan: {exc}")

    return {"items": plan, "count": len(plan)}


@router.post("/{project_id}/planner/apply")
async def apply_plan(
    project_id: str,
    body: PlannerApplyRequest,
    user: CurrentUser,
) -> dict:
    """
    Bulk-add a list of planned content items to the content library as drafts.
    Returns the number of items saved.
    """
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])

    saved = 0
    for item in body.items:
        try:
            if body.mode == "calendar":
                firebase_service.save_calendar_entry(project_id, {
                    "date": item.get("date", ""),
                    "platform": item.get("platform", "Instagram"),
                    "content": item.get("suggestedContent", item.get("topic", "")),
                    "time": item.get("postingTime", ""),
                    "hashtags": item.get("hashtags", []),
                    "type": item.get("contentType", "caption"),
                    "status": "draft",
                })
            else:
                firebase_service.save_content_library_item(project_id, {
                    "platform": item.get("platform", "Instagram"),
                    "type": item.get("contentType", "caption"),
                    "content": item.get("suggestedContent", item.get("topic", "")),
                    "hashtags": item.get("hashtags", []),
                    "metadata": {
                        "plannedDate": item.get("date", ""),
                        "postingTime": item.get("postingTime", ""),
                        "contentAngle": item.get("contentAngle", ""),
                    },
                    "status": "draft",
                    "tags": ["ai-planned"],
                    "scheduledAt": None,
                })
            saved += 1
        except Exception as exc:
            logger.warning("Failed to save plan item: %s", exc)

    return {"saved": saved, "total": len(body.items), "mode": body.mode}
