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
