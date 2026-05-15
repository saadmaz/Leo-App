"""
Phase 6 Content Templates routes.

Endpoints:
  GET    /projects/{id}/templates              - list templates
  POST   /projects/{id}/templates              - create template
  GET    /projects/{id}/templates/{tid}        - get template
  PATCH  /projects/{id}/templates/{tid}        - update template
  DELETE /projects/{id}/templates/{tid}        - delete template
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from backend.api.deps import get_project_as_member, get_project_as_editor
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects/{project_id}", tags=["templates"])

TEMPLATE_CATEGORIES = ["caption", "email", "ad_copy", "blog_post", "video_script", "website_copy", "other"]


class TemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    category: str = Field(..., max_length=50)
    platform: Optional[str] = Field(None, max_length=64)
    description: Optional[str] = Field(None, max_length=300)
    # The template body - use {placeholder} syntax for variable fields
    body: str = Field(..., min_length=5, max_length=5000)
    # Extracted list of placeholder names e.g. ["brand_name", "product"]
    placeholders: list[str] = Field(default_factory=list)
    hashtags: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class TemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=300)
    body: Optional[str] = Field(None, max_length=5000)
    placeholders: Optional[list[str]] = None
    hashtags: Optional[list[str]] = None
    tags: Optional[list[str]] = None


@router.get("/templates")
async def list_templates(
    project_id: str,
    user: CurrentUser,
    category: Optional[str] = Query(None),
):
    get_project_as_member(project_id, user["uid"])
    items = await asyncio.to_thread(firebase_service.list_templates, project_id, category)
    return {"templates": items}


@router.post("/templates", status_code=status.HTTP_201_CREATED)
async def create_template(
    project_id: str,
    body: TemplateCreate,
    user: CurrentUser,
):
    get_project_as_editor(project_id, user["uid"])
    item = await asyncio.to_thread(
        firebase_service.save_template, project_id, body.model_dump()
    )
    return item


@router.get("/templates/{template_id}")
async def get_template(
    project_id: str,
    template_id: str,
    user: CurrentUser,
):
    get_project_as_member(project_id, user["uid"])
    item = await asyncio.to_thread(firebase_service.get_template, project_id, template_id)
    if not item:
        raise HTTPException(status_code=404, detail="Template not found.")
    return item


@router.patch("/templates/{template_id}")
async def update_template(
    project_id: str,
    template_id: str,
    body: TemplateUpdate,
    user: CurrentUser,
):
    get_project_as_editor(project_id, user["uid"])
    try:
        item = await asyncio.to_thread(
            firebase_service.update_template,
            project_id, template_id, body.model_dump(exclude_none=True),
        )
        return item
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    project_id: str,
    template_id: str,
    user: CurrentUser,
):
    get_project_as_editor(project_id, user["uid"])
    await asyncio.to_thread(firebase_service.delete_template, project_id, template_id)


# ---------------------------------------------------------------------------
# Community sharing
# ---------------------------------------------------------------------------

class ShareTemplateRequest(BaseModel):
    share: bool = True    # True = share, False = un-share


@router.post("/templates/{template_id}/share")
async def toggle_template_share(
    project_id: str,
    template_id: str,
    body: ShareTemplateRequest,
    user: CurrentUser,
):
    """Share (or un-share) a template to the community gallery."""
    get_project_as_editor(project_id, user["uid"])
    template = await asyncio.to_thread(firebase_service.get_template, project_id, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")

    updates: dict = {"isShared": body.share}
    if body.share:
        # Record the sharer's display name so the gallery can attribute it.
        user_doc = await asyncio.to_thread(firebase_service.get_user, user["uid"]) or {}
        updates["sharedBy"] = user_doc.get("displayName") or user.get("email", "Anonymous")
        updates["sharedAt"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        # Publish into the global community collection
        await asyncio.to_thread(
            firebase_service.publish_community_template,
            template_id=template_id,
            project_id=project_id,
            template_data={**template, **updates},
        )
    else:
        await asyncio.to_thread(firebase_service.unpublish_community_template, template_id)

    updated = await asyncio.to_thread(
        firebase_service.update_template, project_id, template_id, updates
    )
    return updated


router_community = APIRouter(prefix="/templates/community", tags=["templates"])


@router_community.get("")
async def list_community_templates(
    user: CurrentUser,
    category: Optional[str] = Query(None),
    limit: int = Query(50, le=100),
):
    """Browse the public community template gallery (no project scope required)."""
    templates = await asyncio.to_thread(firebase_service.list_community_templates, category, limit)
    return {"templates": templates, "count": len(templates)}


@router_community.post("/{template_id}/copy")
async def copy_community_template(
    template_id: str,
    project_id: str,
    user: CurrentUser,
):
    """Copy a community template into the caller's project."""
    source = await asyncio.to_thread(firebase_service.get_community_template, template_id)
    if not source:
        raise HTTPException(status_code=404, detail="Community template not found.")

    # Strip sharing metadata before copying
    copy_data = {
        k: v for k, v in source.items()
        if k not in ("id", "isShared", "sharedBy", "sharedAt", "projectId", "usageCount")
    }
    copy_data["name"] = copy_data.get("name", "Copied template") + " (copy)"
    copy_data["copiedFrom"] = template_id

    # Increment the community template usage counter
    await asyncio.to_thread(firebase_service.increment_community_template_uses, template_id)

    item = await asyncio.to_thread(firebase_service.save_template, project_id, copy_data)
    return item
