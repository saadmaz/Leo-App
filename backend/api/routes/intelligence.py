"""
Intelligence routes - Phase 1 + Competitor Profiles.

Endpoints:
  POST /projects/{id}/brand-voice/score               - Score text against Brand Core
  POST /projects/{id}/content/predict                 - Predict content performance
  POST /projects/{id}/intelligence/refresh            - Scrape + analyse competitors (SSE)
  GET  /projects/{id}/intelligence                    - Get stored competitor snapshots
  POST /projects/{id}/memory/feedback                 - Record user feedback on AI output
  GET  /projects/{id}/memory                          - Get brand memory summary
  POST /projects/{id}/drift/check                     - Check for brand voice drift

  # Competitor Profiles (5-dimension classification)
  POST /projects/{id}/competitors/profiles/classify           - Classify competitor (SSE)
  GET  /projects/{id}/competitors/profiles                    - List all profiles
  GET  /projects/{id}/competitors/profiles/{profile_id}       - Get single profile
  DELETE /projects/{id}/competitors/profiles/{profile_id}     - Delete profile
  POST /projects/{id}/competitors/profiles/{profile_id}/refresh - Re-classify
"""

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.api.deps import get_project_as_member, get_project_as_editor
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service, intelligence_service
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["intelligence"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ScoreBrandVoiceRequest(BaseModel):
    text: str = Field(..., min_length=10, max_length=5000)


class PredictPerformanceRequest(BaseModel):
    content: str = Field(..., min_length=10, max_length=5000)
    platform: str = Field(..., min_length=1, max_length=64)


class CompetitorProfile(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    website: Optional[str] = None
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    tiktok: Optional[str] = None
    linkedin: Optional[str] = None
    youtube: Optional[str] = None


class RefreshIntelligenceRequest(BaseModel):
    competitors: list[CompetitorProfile] = Field(..., min_length=1, max_length=5)


class AddDiscoveredRequest(BaseModel):
    competitor: dict  # DiscoveredCompetitor fields from the frontend


class MemoryFeedbackRequest(BaseModel):
    type: str = Field(..., pattern="^(edit|approve|reject|instruction)$")
    original: Optional[str] = Field(None, max_length=500)
    edited: Optional[str] = Field(None, max_length=500)
    reason: Optional[str] = Field(None, max_length=300)
    instruction: Optional[str] = Field(None, max_length=300)
    platform: Optional[str] = Field(None, max_length=64)
    context: Optional[str] = Field(None, max_length=200)


class DriftCheckRequest(BaseModel):
    own_content: list[str] = Field(..., min_length=1, max_length=20)


# ---------------------------------------------------------------------------
# Brand Voice Scorer
# ---------------------------------------------------------------------------

@router.post("/brand-voice/score")
async def score_brand_voice(
    project_id: str,
    body: ScoreBrandVoiceRequest,
    user: CurrentUser,
):
    """Score any text against the project's Brand Core."""
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore")

    if not brand_core:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Brand Core not set up. Run brand ingestion first.",
        )

    try:
        result = await intelligence_service.score_brand_voice(body.text, brand_core)
        return result
    except Exception as exc:
        logger.error("Brand voice scoring failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Content Performance Predictor
# ---------------------------------------------------------------------------

@router.post("/content/predict")
async def predict_performance(
    project_id: str,
    body: PredictPerformanceRequest,
    user: CurrentUser,
):
    """Predict how content will perform on a given platform."""
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    try:
        result = await intelligence_service.predict_performance(
            body.content, body.platform, brand_core
        )
        return result
    except Exception as exc:
        logger.error("Performance prediction failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Competitive Intelligence
# ---------------------------------------------------------------------------

@router.post("/intelligence/refresh")
async def refresh_intelligence(
    project_id: str,
    body: RefreshIntelligenceRequest,
    user: CurrentUser,
):
    """
    Scrape + analyse competitors with live SSE progress stream.
    Uses Apify (all 5 platforms), Firecrawl (website), Exa+Tavily (web), Claude.
    """
    import json as _json
    from fastapi.responses import StreamingResponse as _SR
    from backend.services.intelligence_service import stream_refresh_competitor_intelligence as _stream

    get_project_as_editor(project_id, user["uid"])
    competitors = [c.model_dump() for c in body.competitors]

    async def event_stream():
        try:
            async for event in _stream(project_id=project_id, competitors=competitors):
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


@router.post("/intelligence/add-discovered")
async def add_discovered_competitor(
    project_id: str,
    body: AddDiscoveredRequest,
    user: CurrentUser,
):
    """
    Auto-add a discovered competitor: scrape their website for social links,
    then run the full intelligence refresh stream.
    """
    import json as _json
    from fastapi.responses import StreamingResponse as _SR
    from backend.services.intelligence_service import stream_add_discovered_competitor as _stream

    project = get_project_as_editor(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}
    brand_name = project.get("name", "")

    async def event_stream():
        try:
            async for event in _stream(project_id, body.competitor, brand_core, brand_name):
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


@router.get("/intelligence")
async def get_intelligence(
    project_id: str,
    user: CurrentUser,
):
    """Return stored competitor snapshots for this project."""
    get_project_as_member(project_id, user["uid"])

    snapshots = await asyncio.to_thread(
        firebase_service.get_competitor_snapshots, project_id
    )
    return {"snapshots": snapshots}


@router.get("/intelligence/strategy")
async def get_strategy_plan(
    project_id: str,
    user: CurrentUser,
):
    """
    Generate a competitive strategy plan comparing brand core vs competitors.
    Requires at least one competitor snapshot and a configured Brand Core.
    """
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    snapshots = await asyncio.to_thread(
        firebase_service.get_competitor_snapshots, project_id
    )

    if not snapshots:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No competitor snapshots found. Run intelligence refresh first.",
        )

    try:
        result = await intelligence_service.generate_competitive_strategy(
            brand_core=brand_core,
            brand_name=project.get("name", ""),
            competitor_snapshots=snapshots,
        )
        return result
    except Exception as exc:
        logger.error("Strategy generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/intelligence/competitors/{competitor_name}/report")
async def get_competitor_report(
    project_id: str,
    competitor_name: str,
    user: CurrentUser,
):
    """
    Generate a comprehensive deep-dive report for a single competitor.
    Uses stored snapshot + brand core for comparison.
    """
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    await asyncio.to_thread(check_and_deduct, user["uid"], "competitor_report")

    snapshot = await asyncio.to_thread(
        firebase_service.get_competitor_snapshot, project_id, competitor_name
    )

    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No snapshot found for competitor '{competitor_name}'. Run analysis first.",
        )

    try:
        result = await intelligence_service.generate_competitor_report(
            competitor_snapshot=snapshot,
            brand_core=brand_core,
            brand_name=project.get("name", ""),
        )
        return result
    except Exception as exc:
        logger.error("Competitor report generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Brand Memory
# ---------------------------------------------------------------------------

@router.post("/memory/feedback")
async def record_feedback(
    project_id: str,
    body: MemoryFeedbackRequest,
    user: CurrentUser,
):
    """Record feedback on AI-generated content to build brand memory."""
    get_project_as_member(project_id, user["uid"])

    feedback_data = body.model_dump(exclude_none=True)
    feedback_data["userId"] = user["uid"]

    await asyncio.to_thread(firebase_service.save_memory_feedback, project_id, feedback_data)
    return {"saved": True}


@router.get("/memory")
async def get_memory(
    project_id: str,
    user: CurrentUser,
):
    """Return a summary of what LEO has learned for this project."""
    get_project_as_member(project_id, user["uid"])

    items = await asyncio.to_thread(firebase_service.get_memory_feedback, project_id, 50)
    summary = intelligence_service.build_memory_context(items)
    return {"items": items, "summary": summary, "count": len(items)}


# ---------------------------------------------------------------------------
# Brand Drift Detector
# ---------------------------------------------------------------------------

@router.post("/drift/check")
async def check_drift(
    project_id: str,
    body: DriftCheckRequest,
    user: CurrentUser,
):
    """
    Analyse recent content against the Brand Core to detect voice drift.
    Pass in your last 10–20 post texts as own_content.
    """
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore")

    if not brand_core:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Brand Core not set up. Run brand ingestion first.",
        )

    try:
        result = await intelligence_service.check_brand_drift(body.own_content, brand_core)
        return result
    except Exception as exc:
        logger.error("Brand drift check failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Hashtag Research
# ---------------------------------------------------------------------------

class HashtagResearchRequest(BaseModel):
    topic: str = Field(..., min_length=2, max_length=300)
    platform: str = Field(..., min_length=1, max_length=64)
    content: Optional[str] = Field(None, max_length=2000)


@router.post("/hashtags/suggest")
async def suggest_hashtags(
    project_id: str,
    body: HashtagResearchRequest,
    user: CurrentUser,
):
    """
    Generate a tiered hashtag strategy for the given topic and platform.
    Returns hashtags grouped by tier: mega (1M+), large (100k-1M), medium (10k-100k), niche (<10k).
    """
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    try:
        from backend.config import settings as _settings
        if _settings.EXA_API_KEY or _settings.TAVILY_API_KEY:
            result = await intelligence_service.research_hashtags_enriched(
                body.topic, body.platform, body.content or "", brand_core,
                project_id=project_id,
            )
        else:
            result = await intelligence_service.research_hashtags(
                body.topic, body.platform, body.content or "", brand_core
            )
        return result
    except Exception as exc:
        logger.error("Hashtag research failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# AI Proactive Insights
# ---------------------------------------------------------------------------

@router.get("/insights")
async def get_insights(
    project_id: str,
    user: CurrentUser,
):
    """
    Generate 3-5 proactive AI insights by analysing brand memory, performance data,
    competitor snapshots, calendar, and library. Returns actionable recommendations.
    """
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    # Gather context from Firestore
    memory_items = await asyncio.to_thread(firebase_service.get_memory_feedback, project_id, 20)
    competitor_snapshots = await asyncio.to_thread(firebase_service.get_competitor_snapshots, project_id)
    analytics = await asyncio.to_thread(firebase_service.get_project_analytics, project_id)

    try:
        result = await intelligence_service.generate_insights(
            project_name=project.get("name", ""),
            brand_core=brand_core,
            memory_items=memory_items,
            competitor_snapshots=competitor_snapshots,
            analytics=analytics,
        )
        return result
    except Exception as exc:
        logger.error("Insights generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Competitor Profiles - 5-Dimension Classification
# ---------------------------------------------------------------------------

class ClassifyCompetitorRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    website: Optional[str] = Field(None, max_length=300)


@router.post("/competitors/profiles/classify")
async def classify_competitor(
    project_id: str,
    body: ClassifyCompetitorRequest,
    user: CurrentUser,
):
    """
    Classify a competitor across 5 dimensions using public web data + Claude.
    Returns a live SSE stream with step progress events and a final 'complete' event.
    """
    import json as _json
    from fastapi.responses import StreamingResponse as _SR
    from backend.services.competitor_classifier_service import classify_competitor as _classify

    project = get_project_as_editor(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}
    brand_name = project.get("name", "")

    async def event_stream():
        try:
            async for event in _classify(
                name=body.name,
                website=body.website,
                brand_core=brand_core,
                brand_name=brand_name,
                project_id=project_id,
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


@router.get("/competitors/profiles")
async def list_competitor_profiles(
    project_id: str,
    user: CurrentUser,
):
    """Return all classified competitor profiles for this project."""
    get_project_as_member(project_id, user["uid"])
    profiles = await asyncio.to_thread(
        firebase_service.get_competitor_profiles, project_id
    )
    return {"profiles": profiles}


@router.get("/competitors/profiles/{profile_id}")
async def get_competitor_profile(
    project_id: str,
    profile_id: str,
    user: CurrentUser,
):
    """Return a single competitor profile by ID."""
    get_project_as_member(project_id, user["uid"])
    profile = await asyncio.to_thread(
        firebase_service.get_competitor_profile, project_id, profile_id
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Competitor profile not found.")
    return profile


@router.delete("/competitors/profiles/{profile_id}", status_code=204)
async def delete_competitor_profile(
    project_id: str,
    profile_id: str,
    user: CurrentUser,
):
    """Permanently delete a competitor profile."""
    get_project_as_editor(project_id, user["uid"])
    await asyncio.to_thread(
        firebase_service.delete_competitor_profile, project_id, profile_id
    )


@router.post("/competitors/profiles/{profile_id}/refresh")
async def refresh_competitor_profile(
    project_id: str,
    profile_id: str,
    user: CurrentUser,
):
    """
    Re-run the 5-dimension classification for an existing competitor profile.
    Returns a live SSE stream identical to /classify.
    """
    import json as _json
    from fastapi.responses import StreamingResponse as _SR
    from backend.services.competitor_classifier_service import classify_competitor as _classify

    project = get_project_as_editor(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}
    brand_name = project.get("name", "")

    existing = await asyncio.to_thread(
        firebase_service.get_competitor_profile, project_id, profile_id
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Competitor profile not found.")

    # Delete the old profile so classify() creates a fresh one
    await asyncio.to_thread(
        firebase_service.delete_competitor_profile, project_id, profile_id
    )

    async def event_stream():
        try:
            async for event in _classify(
                name=existing.get("competitor_name", ""),
                website=existing.get("website") or None,
                brand_core=brand_core,
                brand_name=brand_name,
                project_id=project_id,
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
