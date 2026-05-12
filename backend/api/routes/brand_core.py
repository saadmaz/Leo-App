"""
Brand Core CRUD routes.

Endpoints:
  GET    /projects/{id}/brand-core           → return current brand core + ingestion status
  PATCH  /projects/{id}/brand-core           → deep-merge provided fields into existing core
  PATCH  /projects/{id}/brand-core/{field}   → update a single named section
  DELETE /projects/{id}/brand-core           → wipe brand core and ingestion status

Auth is delegated to backend.api.deps.
"""

import logging
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from backend.api.deps import get_project_as_editor, get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["brand-core"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class BrandCoreUpdate(BaseModel):
    """
    Partial update payload. Any combination of top-level brand core sections
    may be provided; omitted fields are left unchanged (shallow merge).
    """
    tone: Optional[dict] = None
    visual: Optional[dict] = None
    themes: Optional[list[str]] = None
    tagline: Optional[str] = None
    messaging: Optional[dict] = None
    audience: Optional[dict] = None
    competitors: Optional[list[str]] = None


# Allowed Brand Core section names. Validated before writing to prevent
# arbitrary keys being injected into the Firestore document.
_ALLOWED_FIELDS = frozenset({
    "tone", "visual", "themes", "tagline", "messaging", "audience", "competitors"
})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/{project_id}/brand-core")
async def get_brand_core(project_id: str, user: CurrentUser) -> dict:
    """Return the project's current Brand Core and ingestion status."""
    project = get_project_as_member(project_id, user["uid"])
    return {
        "brandCore": project.get("brandCore"),
        "ingestionStatus": project.get("ingestionStatus"),
    }


@router.patch("/{project_id}/brand-core")
async def update_brand_core(
    project_id: str,
    body: BrandCoreUpdate,
    user: CurrentUser,
) -> dict:
    """
    Merge the provided fields into the existing Brand Core.
    Only sections included in the request body are updated.
    """
    project = get_project_as_editor(project_id, user["uid"])
    existing: dict = project.get("brandCore") or {}
    updates = body.model_dump(exclude_none=True)

    # Shallow merge - replaces top-level sections that were provided.
    merged = {**existing, **updates}
    firebase_service.update_project(project_id, {"brandCore": merged})
    return {"brandCore": merged}


@router.patch("/{project_id}/brand-core/{field}")
async def update_brand_core_field(
    project_id: str,
    field: str,
    # Body() tells FastAPI to read this from the JSON request body rather
    # than treating it as a query/path param.
    body: Annotated[Any, Body()],
    user: CurrentUser,
) -> dict:
    """
    Update a single named section of the Brand Core (e.g. 'tone', 'visual').
    The request body should be the new value for that section.
    """
    if field not in _ALLOWED_FIELDS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown Brand Core field: {field!r}. Allowed: {sorted(_ALLOWED_FIELDS)}",
        )

    project = get_project_as_editor(project_id, user["uid"])
    existing: dict = project.get("brandCore") or {}

    # Accept either {"value": ...} wrapper or the bare value directly.
    value = body.get("value", body) if isinstance(body, dict) else body
    merged = {**existing, field: value}

    firebase_service.update_project(project_id, {"brandCore": merged})
    return {"brandCore": merged}


@router.delete("/{project_id}/brand-core")
async def clear_brand_core(project_id: str, user: CurrentUser) -> dict:
    """Wipe the Brand Core and reset ingestion status to None."""
    get_project_as_editor(project_id, user["uid"])
    firebase_service.update_project(project_id, {"brandCore": None, "ingestionStatus": None})
    return {"ok": True}
