"""
Generation routes - AI media generation beyond text.

Endpoints:
  POST /projects/{id}/generate/image         - Imagen 3 image generation
  POST /projects/{id}/generate/ai-prompt     - Claude generates brand-aligned image prompt
  GET  /projects/{id}/images                 - List saved images
  POST /projects/{id}/images                 - Save a generated image
  DELETE /projects/{id}/images/{image_id}    - Delete a saved image
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

import asyncio

from backend.api.deps import get_project_or_404, assert_member
from backend.middleware.auth import CurrentUser
from backend.middleware.rate_limit import limiter
from backend.services import image_service, firebase_service
from backend.services.llm_service import get_client, build_brand_core_context
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["generate"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ImageGenerateRequest(BaseModel):
    prompt: str
    style: str = "vivid"        # "vivid" | "natural"
    aspectRatio: str = "square" # "square" | "landscape" | "portrait"

    @field_validator("prompt")
    @classmethod
    def check_prompt_length(cls, v: str) -> str:
        if len(v) > 2000:
            raise ValueError("Image prompt exceeds the 2,000-character limit.")
        return v


class AiPromptRequest(BaseModel):
    brief: str              # What the image should convey
    platform: str = "instagram"
    style: str = "vivid"


class SaveImageRequest(BaseModel):
    dataUrl: str            # base64 data URL
    prompt: str
    aspectRatio: str = "square"
    style: str = "vivid"
    platform: str = "instagram"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/{project_id}/generate/image")
@limiter.limit("10/minute")
async def generate_image(
    request: Request,
    project_id: str,
    body: ImageGenerateRequest,
    user: CurrentUser,
) -> dict:
    """Generate an image via Imagen 3 and return a base64 data URL."""
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required.")

    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    await asyncio.to_thread(check_and_deduct, user["uid"], "image_generate")

    try:
        url = await image_service.generate_image(
            prompt=body.prompt,
            style=body.style,
            aspect_ratio=body.aspectRatio,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"url": url}


@router.post("/{project_id}/generate/ai-prompt")
@limiter.limit("20/minute")
async def generate_ai_prompt(
    request: Request,
    project_id: str,
    body: AiPromptRequest,
    user: CurrentUser,
) -> dict:
    """Use Claude to generate a brand-aligned image prompt from a plain brief."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])

    brand_core = project.get("brandCore") or {}
    brand_context = build_brand_core_context(brand_core)
    project_name = project.get("name", "the brand")

    client = get_client()
    system = (
        "You are an expert creative director specialising in brand-consistent visual content. "
        "Generate a single, detailed image generation prompt that is highly visual, specific, "
        "and consistent with the brand's identity. Output ONLY the prompt text - no explanations, "
        "no quotes, no preamble."
    )
    user_msg = (
        f"BRAND: {project_name}\n"
        f"{brand_context}\n\n"
        f"PLATFORM: {body.platform}\n"
        f"STYLE: {body.style}\n"
        f"BRIEF: {body.brief}\n\n"
        "Write a single detailed image generation prompt (max 400 characters) that brings this brief "
        "to life with the brand's visual identity, colours, and tone."
    )

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )
    prompt = response.content[0].text.strip()
    return {"prompt": prompt}


@router.get("/{project_id}/images")
async def list_images(
    project_id: str,
    user: CurrentUser,
) -> dict:
    """Return all saved generated images for this project."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    images = firebase_service.list_generated_images(project_id)
    return {"images": images, "count": len(images)}


@router.post("/{project_id}/images")
async def save_image(
    project_id: str,
    body: SaveImageRequest,
    user: CurrentUser,
) -> dict:
    """Save a generated image to Firestore."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    image = firebase_service.save_generated_image(project_id, {
        "dataUrl": body.dataUrl,
        "prompt": body.prompt,
        "aspectRatio": body.aspectRatio,
        "style": body.style,
        "platform": body.platform,
        "savedBy": user["uid"],
    })
    return image


@router.delete("/{project_id}/images/{image_id}")
async def delete_image(
    project_id: str,
    image_id: str,
    user: CurrentUser,
) -> dict:
    """Delete a saved image."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    firebase_service.delete_generated_image(project_id, image_id)
    return {"ok": True}
