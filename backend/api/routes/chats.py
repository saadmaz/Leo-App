"""
Chat CRUD + message listing routes.

Auth is delegated to backend.api.deps - no inline membership checks here.
"""

from fastapi import APIRouter, HTTPException, Query, status
from typing import Optional

from backend.api.deps import get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.schemas.chat import Chat, ChatCreate, ChatRename
from backend.schemas.message import Message
from backend.services import firebase_service

router = APIRouter(prefix="/projects/{project_id}/chats", tags=["chats"])


@router.post("", response_model=Chat, status_code=status.HTTP_201_CREATED)
async def create_chat(project_id: str, body: ChatCreate, user: CurrentUser):
    """Create a new chat under a project. Any member may create chats."""
    get_project_as_member(project_id, user["uid"])
    return firebase_service.create_chat(project_id, name=body.name or "New Chat")


@router.get("", response_model=list[Chat])
async def list_chats(project_id: str, user: CurrentUser):
    """List all chats for a project. Any member may list chats."""
    get_project_as_member(project_id, user["uid"])
    return firebase_service.list_chats(project_id)


@router.get("/{chat_id}", response_model=Chat)
async def get_chat(project_id: str, chat_id: str, user: CurrentUser):
    """Return a single chat. Any member may read chats."""
    get_project_as_member(project_id, user["uid"])
    chat = firebase_service.get_chat(project_id, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found.")
    return chat


@router.patch("/{chat_id}", response_model=Chat)
async def rename_chat(project_id: str, chat_id: str, body: ChatRename, user: CurrentUser):
    """Rename a chat. Any member may rename chats."""
    get_project_as_member(project_id, user["uid"])
    firebase_service.rename_chat(project_id, chat_id, body.name)
    chat = firebase_service.get_chat(project_id, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found.")
    return chat


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(project_id: str, chat_id: str, user: CurrentUser):
    """Delete a chat. Any member may delete chats."""
    get_project_as_member(project_id, user["uid"])
    firebase_service.delete_chat(project_id, chat_id)


@router.get("/{chat_id}/messages", response_model=list[Message])
async def list_messages(
    project_id: str,
    chat_id: str,
    user: CurrentUser,
    before: Optional[str] = Query(
        default=None,
        description="ISO 8601 createdAt timestamp - return only messages older than this (pagination cursor).",
    ),
):
    """
    Return the most recent 50 messages in chronological order.
    Pass `?before=<ISO timestamp>` to page back through older messages.
    """
    from backend.config import settings
    get_project_as_member(project_id, user["uid"])
    return firebase_service.list_messages(
        project_id, chat_id, limit=settings.MESSAGES_LOAD_LIMIT, before=before
    )
