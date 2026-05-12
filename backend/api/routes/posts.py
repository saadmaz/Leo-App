"""
Posts CRUD routes - ClickUp/Slack-style posts for project teams.

Posts are scoped to a project and accessible to any project member.
Creating and editing requires editor+ role; deletion requires the author or admin.
"""

import asyncio

from fastapi import APIRouter, HTTPException, status

from backend.api.deps import assert_editor, assert_member, get_project_or_404
from backend.middleware.auth import CurrentUser
from backend.schemas.post import Post, PostCreate, PostUpdate
from backend.services import firebase_service

router = APIRouter(prefix="/projects/{project_id}/posts", tags=["posts"])


@router.post("", response_model=Post, status_code=status.HTTP_201_CREATED)
async def create_post(project_id: str, body: PostCreate, user: CurrentUser):
    """Create a post. Requires editor or admin role."""
    project = await asyncio.to_thread(get_project_or_404, project_id)
    assert_editor(project, user["uid"])

    post = await asyncio.to_thread(
        firebase_service.create_post,
        project_id=project_id,
        author_uid=user["uid"],
        author_email=user.get("email", ""),
        author_name=user.get("name", ""),
        title=body.title,
        body=body.body or "",
        status=body.status or "open",
        priority=body.priority or "medium",
        tags=body.tags or [],
        due_date=body.dueDate,
        assignees=body.assignees or [],
    )
    return post


@router.get("", response_model=list[Post])
async def list_posts(project_id: str, user: CurrentUser):
    """List all posts for a project. Requires member access."""
    project = await asyncio.to_thread(get_project_or_404, project_id)
    assert_member(project, user["uid"])

    return await asyncio.to_thread(firebase_service.list_posts, project_id)


@router.get("/{post_id}", response_model=Post)
async def get_post(project_id: str, post_id: str, user: CurrentUser):
    """Get a single post. Requires member access."""
    project = await asyncio.to_thread(get_project_or_404, project_id)
    assert_member(project, user["uid"])

    post = await asyncio.to_thread(firebase_service.get_post, project_id, post_id)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found.")
    return post


@router.patch("/{post_id}", response_model=Post)
async def update_post(project_id: str, post_id: str, body: PostUpdate, user: CurrentUser):
    """Update a post. Requires editor role or being the post author."""
    project = await asyncio.to_thread(get_project_or_404, project_id)
    assert_member(project, user["uid"])

    post = await asyncio.to_thread(firebase_service.get_post, project_id, post_id)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found.")

    # Authors can edit their own posts; editors/admins can edit any post.
    members: dict = project.get("members", {})
    user_role = members.get(user["uid"], "viewer")
    is_author = post.get("authorId") == user["uid"]
    is_editor = user_role in ("editor", "admin")

    if not is_author and not is_editor:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the author or an editor can update this post.")

    updates = body.model_dump(exclude_none=True)
    if updates:
        await asyncio.to_thread(firebase_service.update_post, project_id, post_id, updates)

    return await asyncio.to_thread(firebase_service.get_post, project_id, post_id)


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(project_id: str, post_id: str, user: CurrentUser):
    """Delete a post. Requires being the author or an admin."""
    project = await asyncio.to_thread(get_project_or_404, project_id)
    assert_member(project, user["uid"])

    post = await asyncio.to_thread(firebase_service.get_post, project_id, post_id)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found.")

    members: dict = project.get("members", {})
    user_role = members.get(user["uid"], "viewer")
    is_author = post.get("authorId") == user["uid"]
    is_admin = user_role == "admin"

    if not is_author and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the author or an admin can delete this post.")

    await asyncio.to_thread(firebase_service.delete_post, project_id, post_id)
