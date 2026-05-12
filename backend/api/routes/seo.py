"""
SEO & content gap analysis routes.

POST /projects/{id}/seo/content-gaps        - analyse competitor content gaps
POST /projects/{id}/seo/content-topics      - generate content topic list
POST /projects/{id}/intelligence/discover-competitors - auto-discover competitors
POST /projects/{id}/influencers/discover    - discover relevant influencers
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from typing import Optional

from backend.api.deps import get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.middleware.rate_limit import limiter
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["seo", "intelligence"])


# ---------------------------------------------------------------------------
# SEO / Content Gap Analysis
# ---------------------------------------------------------------------------

class ContentGapsRequest(BaseModel):
    competitors: list[str] = Field(..., min_length=1, max_items=5)
    topic: Optional[str] = Field(None, max_length=200)


@router.post("/seo/content-gaps")
@limiter.limit("5/minute")
async def analyse_content_gaps(
    request: Request,
    project_id: str,
    body: ContentGapsRequest,
    user: CurrentUser,
):
    """
    Analyse what content topics competitors cover that the brand doesn't.
    Returns prioritised gap list with brand-specific content angles.
    """
    project = get_project_as_member(project_id, user["uid"])
    import asyncio
    await asyncio.to_thread(check_and_deduct, user["uid"], "seo_analysis")
    brand_core = project.get("brandCore") or {}

    from backend.services import seo_service
    result = await seo_service.analyse_content_gaps(
        project_id=project_id,
        brand_core=brand_core,
        competitors=body.competitors,
        topic=body.topic,
    )
    return result


class ContentTopicsRequest(BaseModel):
    gaps: list[dict] = Field(..., min_length=1)
    num_topics: int = Field(default=10, ge=3, le=20)


@router.post("/seo/content-topics")
@limiter.limit("5/minute")
async def suggest_content_topics(
    request: Request,
    project_id: str,
    body: ContentTopicsRequest,
    user: CurrentUser,
):
    """Generate ready-to-execute content topics from gap analysis results."""
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    from backend.services import seo_service
    result = await seo_service.suggest_content_topics(
        project_id=project_id,
        brand_core=brand_core,
        gaps=body.gaps,
        num_topics=body.num_topics,
    )
    return result


# ---------------------------------------------------------------------------
# Competitor Auto-Discovery
# ---------------------------------------------------------------------------

@router.get("/intelligence/discover-competitors")
@limiter.limit("5/minute")
async def discover_competitors(
    request: Request,
    project_id: str,
    user: CurrentUser,
):
    """
    Auto-discover competitors with live SSE progress stream.
    Uses Tavily, Exa (findSimilar + company search + answer), and Firecrawl.
    """
    import json as _json
    from fastapi.responses import StreamingResponse as _SR
    from backend.services.intelligence_service import stream_discover_competitors as _stream

    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}
    website_url = project.get("websiteUrl") or project.get("website_url") or None

    async def event_stream():
        try:
            async for event in _stream(
                project_id=project_id,
                brand_core=brand_core,
                website_url=website_url,
            ):
                yield f"data: {_json.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {_json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return _SR(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Influencer Discovery
# ---------------------------------------------------------------------------

class InfluencerDiscoveryRequest(BaseModel):
    topic: str = Field(..., min_length=2, max_length=200)
    platform: str = Field(..., max_length=64)
    audience_size: str = Field(default="micro", pattern="^(micro|macro|mega)$")
    location: Optional[str] = Field(None, max_length=100)


@router.post("/influencers/discover")
@limiter.limit("5/minute")
async def discover_influencers(
    request: Request,
    project_id: str,
    body: InfluencerDiscoveryRequest,
    user: CurrentUser,
):
    """
    Discover relevant influencers using Exa's 1B+ people index.
    Returns scored list with brand alignment analysis.
    """
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    from backend.services.intelligence_service import discover_influencers as _discover
    result = await _discover(
        topic=body.topic,
        platform=body.platform,
        audience_size=body.audience_size,
        brand_core=brand_core,
        location=body.location,
        project_id=project_id,
    )
    return result
