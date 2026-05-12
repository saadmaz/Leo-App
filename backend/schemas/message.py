from pydantic import BaseModel, field_validator
from typing import List, Literal, Optional

# Hard cap on user message length - prevents prompt-stuffing and runaway costs.
_MAX_MESSAGE_LENGTH = 32_000
# Cap on channel key to prevent injection via that field.
_MAX_CHANNEL_LENGTH = 64


class ImageAttachment(BaseModel):
    """A base64-encoded image sent alongside a user message."""
    base64: str       # raw base64 (no data-URL prefix)
    mediaType: str    # image/jpeg | image/png | image/gif | image/webp


class MessageCreate(BaseModel):
    content: str
    # Optional channel key (e.g. "instagram", "linkedin") used to inject
    # platform-specific constraints into the system prompt.
    channel: Optional[str] = None
    # Optional images attached by the user (vision).
    images: Optional[List[ImageAttachment]] = None

    @field_validator("content")
    @classmethod
    def check_content_length(cls, v: str) -> str:
        if len(v) > _MAX_MESSAGE_LENGTH:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=400,
                detail=f"Message exceeds the {_MAX_MESSAGE_LENGTH:,}-character limit.",
            )
        return v

    @field_validator("channel")
    @classmethod
    def check_channel(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > _MAX_CHANNEL_LENGTH:
            return v[:_MAX_CHANNEL_LENGTH]
        return v


class Message(BaseModel):
    id: str
    chatId: str
    projectId: str
    role: Literal["user", "assistant"]
    content: str
    createdAt: str
