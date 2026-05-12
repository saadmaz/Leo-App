"""
Team member management routes.

Endpoints:
  GET    /projects/{id}/members            → list members with display names/emails
  POST   /projects/{id}/members            → invite a user by email (admin only)
  DELETE /projects/{id}/members/{uid}      → remove a member (admin only)

Notes:
- Only project admins can invite or remove members.
- The last admin of a project cannot be removed.
- Inviting an already-existing member returns 409.
- The invited user must already have a LEO account (Firebase Auth record).
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from backend.api.deps import get_project_as_admin, get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["members"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class InviteMemberBody(BaseModel):
    email: str
    role: str = "editor"  # "editor" | "viewer"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/{project_id}/members")
async def list_members(project_id: str, user: CurrentUser) -> list[dict]:
    """Return all project members with their profile info and role."""
    project = get_project_as_member(project_id, user["uid"])
    members_map: dict = project.get("members") or {}

    joined_at_map: dict = project.get("membersJoinedAt") or {}

    result = []
    for uid, role in members_map.items():
        profile = firebase_service.get_user_profile(uid)
        joined_ts = joined_at_map.get(uid)
        joined_str = joined_ts.isoformat() if hasattr(joined_ts, "isoformat") else (str(joined_ts) if joined_ts else None)
        if profile:
            result.append({**profile, "role": role, "joinedAt": joined_str})
        else:
            # Auth record missing - include uid only so the list still shows
            result.append({"uid": uid, "email": "", "displayName": uid, "role": role, "joinedAt": joined_str})

    # Admins first, then editors, then viewers
    _order = {"admin": 0, "editor": 1, "viewer": 2}
    result.sort(key=lambda m: _order.get(m["role"], 9))
    return result


@router.post("/{project_id}/members", status_code=status.HTTP_201_CREATED)
async def invite_member(project_id: str, body: InviteMemberBody, user: CurrentUser) -> dict:
    """
    Add a user (looked up by email) to the project.
    The caller must be an admin. Invited role may be 'editor' or 'viewer'.
    """
    if body.role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="role must be 'editor' or 'viewer'")

    project = get_project_as_admin(project_id, user["uid"])
    members: dict = dict(project.get("members") or {})

    # Resolve email → uid via Firebase Auth
    profile = firebase_service.get_user_by_email(body.email.strip().lower())
    if not profile:
        raise HTTPException(
            status_code=404,
            detail=f"No LEO account found for {body.email}. They must sign up first.",
        )

    uid = profile["uid"]
    if uid in members:
        raise HTTPException(status_code=409, detail="User is already a member of this project.")

    members[uid] = body.role
    now = datetime.now(timezone.utc)
    joined_at_map: dict = dict(project.get("membersJoinedAt") or {})
    joined_at_map[uid] = now
    firebase_service.update_project(project_id, {"members": members, "membersJoinedAt": joined_at_map})
    logger.info("User %s invited %s (%s) to project %s", user["uid"], uid, body.role, project_id)
    return {**profile, "role": body.role, "joinedAt": now.isoformat()}


class UpdateRoleBody(BaseModel):
    role: str  # "admin" | "editor" | "viewer"


@router.patch("/{project_id}/members/{member_uid}")
async def update_member_role(
    project_id: str, member_uid: str, body: UpdateRoleBody, user: CurrentUser
) -> dict:
    """Change a member's role. Admin only. Cannot demote the last admin."""
    if body.role not in ("admin", "editor", "viewer"):
        raise HTTPException(status_code=400, detail="role must be 'admin', 'editor', or 'viewer'")

    project = get_project_as_admin(project_id, user["uid"])
    members: dict = dict(project.get("members") or {})

    if member_uid not in members:
        raise HTTPException(status_code=404, detail="Member not found in this project.")

    if body.role != "admin" and members[member_uid] == "admin":
        remaining_admins = [u for u, r in members.items() if r == "admin" and u != member_uid]
        if not remaining_admins:
            raise HTTPException(status_code=400, detail="Cannot demote the last admin.")

    members[member_uid] = body.role
    firebase_service.update_project(project_id, {"members": members})
    profile = firebase_service.get_user_profile(member_uid) or {"uid": member_uid, "email": "", "displayName": member_uid}
    return {**profile, "role": body.role}


@router.delete("/{project_id}/members/{member_uid}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(project_id: str, member_uid: str, user: CurrentUser) -> None:
    """
    Remove a member from the project. Admin only.
    The last admin cannot be removed.
    """
    project = get_project_as_admin(project_id, user["uid"])
    members: dict = dict(project.get("members") or {})

    if member_uid not in members:
        raise HTTPException(status_code=404, detail="Member not found in this project.")

    # Guard: never leave a project with zero admins
    remaining_admins = [
        uid for uid, role in members.items()
        if role == "admin" and uid != member_uid
    ]
    if members[member_uid] == "admin" and not remaining_admins:
        raise HTTPException(
            status_code=400,
            detail="Cannot remove the last admin from a project.",
        )

    del members[member_uid]
    firebase_service.update_project(project_id, {"members": members})
    logger.info("User %s removed member %s from project %s", user["uid"], member_uid, project_id)
