"""
Phase 5 Content Studio routes.

Endpoints:
  POST /projects/{id}/seo/blog-post        - stream a full blog post (SSE)
  POST /projects/{id}/seo/meta-tags        - generate meta tags
  POST /projects/{id}/seo/website-copy     - generate website copy sections
  POST /projects/{id}/emails/sequence      - generate email sequence
  POST /projects/{id}/emails/single        - generate a single email
  POST /projects/{id}/brand/style-guide    - generate brand style guide
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.api.deps import get_project_as_member, get_project_as_editor
from backend.middleware.auth import CurrentUser
from backend.services import content_studio_service
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["content-studio"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class BlogPostRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=300)
    keywords: list[str] = Field(default_factory=list, max_length=10)
    tone: str = Field(default="informative and engaging", max_length=100)
    word_count: int = Field(default=1000, ge=300, le=3000)


class MetaTagsRequest(BaseModel):
    page_title: str = Field(..., min_length=1, max_length=200)
    page_description: str = Field(..., min_length=1, max_length=1000)
    page_type: str = Field(default="homepage", max_length=50)


class WebsiteCopyRequest(BaseModel):
    page_type: str = Field(..., max_length=50)
    context: Optional[str] = Field(None, max_length=1000)


class EmailSequenceRequest(BaseModel):
    sequence_type: str = Field(..., max_length=50)
    goal: str = Field(..., min_length=1, max_length=300)
    product_or_service: str = Field(..., min_length=1, max_length=300)


class SingleEmailRequest(BaseModel):
    email_type: str = Field(..., max_length=100)
    context: str = Field(..., min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# SEO - Blog Post (SSE)
# ---------------------------------------------------------------------------

@router.post("/seo/blog-post")
async def generate_blog_post(
    project_id: str,
    body: BlogPostRequest,
    user: CurrentUser,
):
    """Stream a full SEO-optimised blog post in markdown."""
    project = get_project_as_editor(project_id, user["uid"])
    await asyncio.to_thread(check_and_deduct, user["uid"], "blog_post")
    brand_core = project.get("brandCore") or {}

    async def event_stream():
        async for chunk in content_studio_service.stream_blog_post(
            project_name=project.get("name", ""),
            brand_core=brand_core,
            topic=body.topic,
            keywords=body.keywords,
            tone=body.tone,
            word_count=body.word_count,
        ):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# SEO - Meta Tags
# ---------------------------------------------------------------------------

@router.post("/seo/meta-tags")
async def generate_meta_tags(
    project_id: str,
    body: MetaTagsRequest,
    user: CurrentUser,
):
    """Generate a full set of SEO + Open Graph + Twitter meta tags."""
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    try:
        result = await content_studio_service.generate_meta_tags(
            project_name=project.get("name", ""),
            brand_core=brand_core,
            page_title=body.page_title,
            page_description=body.page_description,
            page_type=body.page_type,
        )
        return result
    except Exception as exc:
        logger.error("Meta tags generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# SEO - Website Copy
# ---------------------------------------------------------------------------

@router.post("/seo/website-copy")
async def generate_website_copy(
    project_id: str,
    body: WebsiteCopyRequest,
    user: CurrentUser,
):
    """Generate website copy sections for a given page type."""
    project = get_project_as_editor(project_id, user["uid"])
    await asyncio.to_thread(check_and_deduct, user["uid"], "website_copy")
    brand_core = project.get("brandCore") or {}

    try:
        result = await content_studio_service.generate_website_copy(
            project_name=project.get("name", ""),
            brand_core=brand_core,
            page_type=body.page_type,
            context=body.context or "",
        )
        return result
    except Exception as exc:
        logger.error("Website copy generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Email Studio - Sequence
# ---------------------------------------------------------------------------

@router.post("/emails/sequence")
async def generate_email_sequence(
    project_id: str,
    body: EmailSequenceRequest,
    user: CurrentUser,
):
    """Generate a complete email sequence (welcome, nurture, launch, etc.)."""
    project = get_project_as_editor(project_id, user["uid"])
    await asyncio.to_thread(check_and_deduct, user["uid"], "email_sequence")
    brand_core = project.get("brandCore") or {}

    try:
        result = await content_studio_service.generate_email_sequence(
            project_name=project.get("name", ""),
            brand_core=brand_core,
            sequence_type=body.sequence_type,
            goal=body.goal,
            product_or_service=body.product_or_service,
        )
        return result
    except Exception as exc:
        logger.error("Email sequence generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Email Studio - Single Email
# ---------------------------------------------------------------------------

@router.post("/emails/single")
async def generate_single_email(
    project_id: str,
    body: SingleEmailRequest,
    user: CurrentUser,
):
    """Generate a single one-off marketing email."""
    project = get_project_as_editor(project_id, user["uid"])
    await asyncio.to_thread(check_and_deduct, user["uid"], "email_single")
    brand_core = project.get("brandCore") or {}

    try:
        result = await content_studio_service.generate_single_email(
            project_name=project.get("name", ""),
            brand_core=brand_core,
            email_type=body.email_type,
            context=body.context,
        )
        return result
    except Exception as exc:
        logger.error("Single email generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Brand Style Guide
# ---------------------------------------------------------------------------

@router.post("/brand/style-guide")
async def generate_style_guide(
    project_id: str,
    user: CurrentUser,
):
    """Generate a comprehensive brand style guide from the project's Brand Core."""
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore")

    if not brand_core:
        raise HTTPException(
            status_code=400,
            detail="Brand Core not set up. Run brand ingestion first.",
        )

    await asyncio.to_thread(check_and_deduct, user["uid"], "style_guide")

    try:
        result = await content_studio_service.generate_style_guide(
            project_name=project.get("name", ""),
            brand_core=brand_core,
        )
        return result
    except Exception as exc:
        logger.error("Style guide generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
