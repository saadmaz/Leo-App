"""
Campaign routes - CRUD + AI-powered SSE generation.

Endpoints:
  GET    /projects/{id}/campaigns            - list campaigns
  GET    /projects/{id}/campaigns/{cid}      - get campaign
  DELETE /projects/{id}/campaigns/{cid}      - delete campaign
  POST   /projects/{id}/campaigns/generate   - generate campaign (SSE stream)
"""

import json
import logging
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.api.deps import get_project_or_404, assert_editor, assert_member
from backend.middleware.auth import CurrentUser
from backend.services import billing_service, firebase_service, campaign_service
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["campaigns"])


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class CampaignGenerateRequest(BaseModel):
    name: str
    objective: str
    audience: str
    channels: List[str]
    timeline: str = "4 weeks"
    kpis: List[str] = []
    budgetGuidance: str = ""


class CampaignUpdateRequest(BaseModel):
    contentPacks: Optional[Dict[str, Any]] = None
    name: Optional[str] = None


# ---------------------------------------------------------------------------
# SSE helper
# ---------------------------------------------------------------------------

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/{project_id}/campaigns")
def list_campaigns(project_id: str, user: CurrentUser) -> list:
    """List all campaigns for a project."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    return firebase_service.list_campaigns(project_id)


@router.get("/{project_id}/campaigns/{campaign_id}")
def get_campaign(project_id: str, campaign_id: str, user: CurrentUser) -> dict:
    """Get a single campaign."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    campaign = firebase_service.get_campaign(project_id, campaign_id)
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found.")
    return campaign


@router.patch("/{project_id}/campaigns/{campaign_id}")
def update_campaign(project_id: str, campaign_id: str, body: CampaignUpdateRequest, user: CurrentUser) -> dict:
    """Partially update a campaign (e.g. edited contentPacks or name)."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    campaign = firebase_service.get_campaign(project_id, campaign_id)
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found.")
    updates = body.model_dump(exclude_none=True)
    if updates:
        firebase_service.update_campaign(project_id, campaign_id, updates)
    return firebase_service.get_campaign(project_id, campaign_id)


@router.post("/{project_id}/campaigns/{campaign_id}/duplicate")
def duplicate_campaign(project_id: str, campaign_id: str, user: CurrentUser) -> dict:
    """Duplicate an existing campaign with a 'Copy of…' name."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    original = firebase_service.get_campaign(project_id, campaign_id)
    if not original:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found.")
    data = {k: v for k, v in original.items() if k not in ("id", "createdAt", "updatedAt")}
    data["name"] = f"Copy of {original.get('name', 'Campaign')}"
    data["status"] = "ready"
    return firebase_service.create_campaign(project_id, data)


@router.delete("/{project_id}/campaigns/{campaign_id}", status_code=204)
def delete_campaign(project_id: str, campaign_id: str, user: CurrentUser) -> None:
    """Delete a campaign."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    campaign = firebase_service.get_campaign(project_id, campaign_id)
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found.")
    firebase_service.delete_campaign(project_id, campaign_id)


@router.post("/{project_id}/campaigns/generate")
async def generate_campaign(
    project_id: str,
    body: CampaignGenerateRequest,
    user: CurrentUser,
) -> StreamingResponse:
    """
    Generate an AI campaign brief + content packs and persist to Firestore.
    Returns an SSE stream of step/progress/done/error events.

    The campaign document is created immediately with status='generating',
    then updated to status='ready' with the full content when generation completes.
    """
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])

    # Check campaign quota + credits before doing anything else.
    import asyncio
    await asyncio.to_thread(billing_service.assert_can_generate_campaign, user["uid"], project_id)
    await asyncio.to_thread(check_and_deduct, user["uid"], "campaign_generate")

    # Create a placeholder campaign document to get an ID
    campaign = firebase_service.create_campaign(project_id, {
        "name": body.name,
        "objective": body.objective,
        "audience": body.audience,
        "channels": body.channels,
        "timeline": body.timeline,
        "kpis": body.kpis,
        "budgetGuidance": body.budgetGuidance,
    })
    campaign_id = campaign["id"]

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in campaign_service.generate_campaign(
                project=project,
                name=body.name,
                objective=body.objective,
                audience=body.audience,
                channels=body.channels,
                timeline=body.timeline,
                kpis=body.kpis,
                budget_guidance=body.budgetGuidance,
            ):
                if event["type"] == "done":
                    # Persist the full campaign data
                    campaign_data = event["campaign"]
                    try:
                        firebase_service.update_campaign(project_id, campaign_id, campaign_data)
                    except Exception as exc:
                        logger.error("Failed to save campaign %s: %s", campaign_id, exc)
                        yield _sse({"type": "error", "message": f"Saved content but failed to persist: {exc}"})
                        return
                    # Include the campaign id so the client can navigate to it
                    yield _sse({**event, "campaignId": campaign_id, "campaign": {**campaign_data, "id": campaign_id}})
                else:
                    yield _sse(event)
        except Exception as exc:
            logger.exception("Campaign generation stream error for project %s: %s", project_id, exc)
            firebase_service.update_campaign(project_id, campaign_id, {"status": "error"})
            yield _sse({"type": "error", "message": str(exc)})
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
