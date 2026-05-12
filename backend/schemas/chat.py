from typing import Optional

from pydantic import BaseModel, field_validator


class ChatCreate(BaseModel):
    name: Optional[str] = "New Chat"

    @field_validator("name")
    @classmethod
    def sanitise_name(cls, v: Optional[str]) -> str:
        """Strip whitespace and fall back to 'New Chat' if the name is empty."""
        cleaned = (v or "").strip()
        return cleaned if cleaned else "New Chat"


class ChatRename(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, v: str) -> str:
        """Reject blank or whitespace-only names - they create confusing UI state."""
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Chat name cannot be blank.")
        if len(cleaned) > 100:
            raise ValueError("Chat name must be 100 characters or fewer.")
        return cleaned


class Chat(BaseModel):
    id: str
    projectId: str
    name: str
    createdAt: str
    updatedAt: str
