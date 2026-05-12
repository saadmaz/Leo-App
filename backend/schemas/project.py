from pydantic import BaseModel
from typing import Optional


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    projectType: Optional[str] = "business"   # "business" | "personal"
    # Social links - website + instagram are mandatory in the UI but optional at schema level
    websiteUrl: Optional[str] = None
    instagramUrl: Optional[str] = None
    facebookUrl: Optional[str] = None
    linkedinUrl: Optional[str] = None
    tiktokUrl: Optional[str] = None
    xUrl: Optional[str] = None
    youtubeUrl: Optional[str] = None
    threadsUrl: Optional[str] = None
    pinterestUrl: Optional[str] = None
    snapchatUrl: Optional[str] = None
    # Model selection per task type
    contentModel: Optional[str] = "claude-sonnet-4-6"
    imageModel: Optional[str] = "dall-e-3"
    videoModel: Optional[str] = "gemini-flash"
    promptModel: Optional[str] = "claude-opus-4-6"


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    # Social links - all editable post-creation from Project Settings
    websiteUrl: Optional[str] = None
    instagramUrl: Optional[str] = None
    facebookUrl: Optional[str] = None
    linkedinUrl: Optional[str] = None
    tiktokUrl: Optional[str] = None
    xUrl: Optional[str] = None
    youtubeUrl: Optional[str] = None
    threadsUrl: Optional[str] = None
    pinterestUrl: Optional[str] = None
    snapchatUrl: Optional[str] = None
    # Model selection
    contentModel: Optional[str] = None
    imageModel: Optional[str] = None
    videoModel: Optional[str] = None
    promptModel: Optional[str] = None


class Project(BaseModel):
    id: str
    name: str
    description: Optional[str] = ""
    ownerId: str
    projectType: Optional[str] = "business"   # "business" | "personal"
    brandCore: Optional[dict] = None
    ingestionStatus: Optional[str] = None
    # Social links
    websiteUrl: Optional[str] = None
    instagramUrl: Optional[str] = None
    facebookUrl: Optional[str] = None
    linkedinUrl: Optional[str] = None
    tiktokUrl: Optional[str] = None
    xUrl: Optional[str] = None
    youtubeUrl: Optional[str] = None
    threadsUrl: Optional[str] = None
    pinterestUrl: Optional[str] = None
    snapchatUrl: Optional[str] = None
    # Model settings
    contentModel: Optional[str] = None
    imageModel: Optional[str] = None
    videoModel: Optional[str] = None
    promptModel: Optional[str] = None
    createdAt: str
    updatedAt: str
