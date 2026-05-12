"""
Personal Branding Module routes.

Endpoints:
  POST   /projects/{id}/persona/core/init         – Create initial Personal Core
  GET    /projects/{id}/persona/core               – Get Personal Core
  PATCH  /projects/{id}/persona/core               – Update Personal Core fields
  GET    /projects/{id}/persona/interview/questions – Get all interview questions
  GET    /projects/{id}/persona/interview/next      – Get next unanswered question
  POST   /projects/{id}/persona/interview/answer    – Save a single answer
  POST   /projects/{id}/persona/interview/extract   – Synthesise answers → PersonalCore (SSE)
  GET    /projects/{id}/persona/voice               – Get voice profile
"""

import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from backend.api.deps import assert_editor, assert_member, get_project_or_404
from backend.middleware.auth import CurrentUser
from backend.schemas.personal_brand import (
    AddSamplesRequest,
    ApproveOutputRequest,
    ArticleRequest,
    CancelScheduledRequest,
    GeneratePostRequest,
    InterviewAnswerRequest,
    OpinionRequest,
    PersonalCore,
    PersonalCoreCreate,
    PersonalCoreUpdate,
    PublishNowRequest,
    ReformatRequest,
    SchedulePostRequest,
    StoryToPostRequest,
)
from backend.services import firebase_service
from backend.services.personal_brand.interview_questions import (
    INTERVIEW_MODULES,
    calculate_progress,
    get_all_questions,
    get_next_unanswered,
)
from backend.services.personal_brand import extraction_agent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["personal-brand"])


# ---------------------------------------------------------------------------
# Guard helper - ensures project is a personal brand project
# ---------------------------------------------------------------------------

def _assert_personal(project: dict) -> None:
    if project.get("projectType") != "personal":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This project is not a Personal Brand project.",
        )


# ---------------------------------------------------------------------------
# Personal Core - init / get / update
# ---------------------------------------------------------------------------

@router.post("/{project_id}/persona/core/init", status_code=status.HTTP_201_CREATED)
async def init_personal_core(project_id: str, body: PersonalCoreCreate, user: CurrentUser):
    """
    Create the initial Personal Core for a personal brand project.
    Called immediately after project creation on the personal brand wizard.
    """
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    existing = await asyncio.to_thread(firebase_service.get_personal_core, project_id)
    if existing:
        return existing

    core = await asyncio.to_thread(
        firebase_service.create_personal_core,
        project_id,
        body.fullName,
        body.linkedinUrl,
    )
    return core


@router.get("/{project_id}/persona/core")
async def get_personal_core(project_id: str, user: CurrentUser):
    """Return the Personal Core for a personal brand project."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    core = await asyncio.to_thread(firebase_service.get_personal_core, project_id)
    if not core:
        raise HTTPException(status_code=404, detail="Personal Core not found. Complete onboarding first.")
    return core


@router.patch("/{project_id}/persona/core")
async def update_personal_core(project_id: str, body: PersonalCoreUpdate, user: CurrentUser):
    """Update fields of the Personal Core."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    updated = await asyncio.to_thread(firebase_service.update_personal_core, project_id, updates)
    return updated


# ---------------------------------------------------------------------------
# Interview - questions
# ---------------------------------------------------------------------------

@router.get("/{project_id}/persona/interview/questions")
async def get_interview_questions(project_id: str, user: CurrentUser):
    """Return all interview questions grouped by module."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)
    return {"modules": INTERVIEW_MODULES}


@router.get("/{project_id}/persona/interview/next")
async def get_next_question(project_id: str, user: CurrentUser):
    """
    Return the next unanswered question and current progress.
    Returns null for 'question' when the interview is complete.
    """
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    core = await asyncio.to_thread(firebase_service.get_personal_core, project_id)
    if not core:
        raise HTTPException(status_code=404, detail="Personal Core not found.")

    answered_keys = list(core.get("interviewAnswers", {}).keys())
    next_q = get_next_unanswered(answered_keys)
    progress = calculate_progress(answered_keys)

    return {
        "question": next_q,
        "progress": progress,
        "answeredCount": len(answered_keys),
        "totalCount": len(get_all_questions()),
        "interviewStatus": core.get("interviewStatus", "not_started"),
    }


# ---------------------------------------------------------------------------
# Interview - save answer
# ---------------------------------------------------------------------------

@router.post("/{project_id}/persona/interview/answer")
async def save_interview_answer(project_id: str, body: InterviewAnswerRequest, user: CurrentUser):
    """
    Persist a single interview answer. The client calls this after each question.
    Returns the updated next question and progress.
    """
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    if not body.answer.strip():
        raise HTTPException(status_code=400, detail="Answer cannot be empty.")

    await asyncio.to_thread(
        firebase_service.save_interview_answer,
        project_id,
        body.questionKey,
        body.answer.strip(),
    )

    # Return the next question
    core = await asyncio.to_thread(firebase_service.get_personal_core, project_id)
    answered_keys = list(core.get("interviewAnswers", {}).keys())
    next_q = get_next_unanswered(answered_keys)
    progress = calculate_progress(answered_keys)

    return {
        "saved": True,
        "nextQuestion": next_q,
        "progress": progress,
        "answeredCount": len(answered_keys),
        "totalCount": len(get_all_questions()),
    }


# ---------------------------------------------------------------------------
# Interview - extract (SSE)
# ---------------------------------------------------------------------------

@router.post("/{project_id}/persona/interview/extract")
async def extract_personal_core(project_id: str, user: CurrentUser):
    """
    Synthesise all collected interview answers into a structured Personal Core.
    Streams progress events via SSE. Same format as the ingestion pipeline.

    The client should call this after the user has answered all questions,
    or when they want to generate from partial answers (minimum 5 answers).
    """
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    core = await asyncio.to_thread(firebase_service.get_personal_core, project_id)
    if not core:
        raise HTTPException(status_code=404, detail="Personal Core not found.")

    answers = core.get("interviewAnswers", {})
    if len(answers) < 5:
        raise HTTPException(
            status_code=400,
            detail=f"At least 5 answers are needed to generate your Personal Core (you have {len(answers)}).",
        )

    full_name = core.get("fullName", "")

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in extraction_agent.run(project_id, full_name, answers):
            yield chunk
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Voice Profile
# ---------------------------------------------------------------------------

@router.get("/{project_id}/persona/voice")
async def get_voice_profile(project_id: str, user: CurrentUser):
    """Return the voice profile for a personal brand project."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    db = firebase_service.get_db()
    doc = db.collection("personal_voice_profiles").document(project_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Voice profile not found. Complete the interview first.")
    return {"projectId": project_id, **doc.to_dict()}


# ---------------------------------------------------------------------------
# Personal Strategy Engine
# ---------------------------------------------------------------------------

@router.get("/{project_id}/persona/strategy")
async def get_personal_strategy(project_id: str, user: CurrentUser):
    """Return the saved personal brand strategy (if generated)."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    db = firebase_service.get_db()
    doc = db.collection("personal_strategies").document(project_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Strategy not yet generated.")
    return doc.to_dict()


@router.post("/{project_id}/persona/strategy/generate")
async def generate_personal_strategy(project_id: str, user: CurrentUser):
    """Stream a full personal brand strategy (platform plan + roadmap) via SSE."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found. Complete the interview first.")

    from backend.services.personal_brand import strategy_engine

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in strategy_engine.generate_strategy(project_id, personal_core):
                yield chunk
        except Exception as exc:
            logger.exception("Strategy generation error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{project_id}/persona/strategy/niche")
async def research_niche(project_id: str, user: CurrentUser):
    """Stream niche competitor research via SSE."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    from backend.services.personal_brand import strategy_engine

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in strategy_engine.research_niche(project_id, personal_core):
                yield chunk
        except Exception as exc:
            logger.exception("Niche research error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Personal Brand Analytics
# ---------------------------------------------------------------------------

@router.get("/{project_id}/persona/analytics")
async def get_analytics(project_id: str, user: CurrentUser):
    """Return analytics snapshots for the personal brand project."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    db = firebase_service.get_db()
    snaps = (
        db.collection("personal_brand_analytics")
        .where("projectId", "==", project_id)
        .order_by("snapshotDate", direction="DESCENDING")
        .limit(40)
        .stream()
    )
    return [{"id": s.id, **s.to_dict()} for s in snaps]


@router.post("/{project_id}/persona/analytics/snapshot")
async def trigger_snapshot(project_id: str, user: CurrentUser):
    """Manually trigger an analytics snapshot for all connected platforms."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    from backend.services.personal_brand import analytics_service
    result = await asyncio.to_thread(analytics_service.take_snapshot, project_id, personal_core)
    return {"status": "ok", "snapshotId": result.get("id")}


@router.get("/{project_id}/persona/analytics/brief")
async def get_weekly_brief(project_id: str, user: CurrentUser):
    """Return the latest weekly brief, generating one if needed."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    db = firebase_service.get_db()
    doc = db.collection("personal_weekly_briefs").document(project_id).get()
    if doc.exists:
        return doc.to_dict()

    # Generate on first call
    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    from backend.services.personal_brand import analytics_service
    brief = await asyncio.to_thread(analytics_service.generate_weekly_brief, project_id, personal_core)
    return brief


@router.post("/{project_id}/persona/analytics/brief/regenerate")
async def regenerate_weekly_brief(project_id: str, user: CurrentUser):
    """Force-regenerate the weekly brief (ignores any cached version)."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    from backend.services.personal_brand import analytics_service
    brief = await asyncio.to_thread(analytics_service.generate_weekly_brief, project_id, personal_core)
    return brief


# ---------------------------------------------------------------------------
# Reputation Monitoring
# ---------------------------------------------------------------------------

@router.get("/{project_id}/persona/reputation")
async def get_reputation(project_id: str, user: CurrentUser):
    """Return the latest reputation snapshot."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    db = firebase_service.get_db()
    doc = db.collection("personal_reputation").document(project_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="No reputation data yet. Run a check first.")
    return doc.to_dict()


# ---------------------------------------------------------------------------
# Content Engine
# ---------------------------------------------------------------------------

def _get_voice_profile(project_id: str) -> dict | None:
    """Load voice profile from Firestore, return None if missing."""
    db = firebase_service.get_db()
    doc = db.collection("personal_voice_profiles").document(project_id).get()
    return doc.to_dict() if doc.exists else None


@router.post("/{project_id}/persona/content/generate")
async def generate_post(project_id: str, body: GeneratePostRequest, user: CurrentUser):
    """Stream a quick on-brand post for any platform (SSE)."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found. Complete the interview first.")

    voice_profile = await asyncio.to_thread(_get_voice_profile, project_id)

    from backend.services.personal_brand import content_engine

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in content_engine.generate_post(
                project_id, personal_core, voice_profile, body.platform, body.topic
            ):
                yield chunk
        except Exception as exc:
            logger.exception("Content generation error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{project_id}/persona/content/story")
async def story_to_post(project_id: str, body: StoryToPostRequest, user: CurrentUser):
    """Stream a story → platform-native post conversion (SSE)."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    voice_profile = await asyncio.to_thread(_get_voice_profile, project_id)

    from backend.services.personal_brand import content_engine

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in content_engine.story_to_post(
                project_id, personal_core, voice_profile, body.story, body.platform
            ):
                yield chunk
        except Exception as exc:
            logger.exception("Story-to-post error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{project_id}/persona/content/opinion")
async def opinion_extractor(project_id: str, body: OpinionRequest, user: CurrentUser):
    """
    Opinion extractor - two-phase SSE flow.
    Phase 1 (answers=null): returns 3 probing questions.
    Phase 2 (answers provided): returns the full opinion post.
    """
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    voice_profile = await asyncio.to_thread(_get_voice_profile, project_id)

    from backend.services.personal_brand import content_engine

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in content_engine.opinion_extractor(
                project_id, personal_core, voice_profile,
                body.take, body.answers, body.platform,
            ):
                yield chunk
        except Exception as exc:
            logger.exception("Opinion extractor error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{project_id}/persona/content/bio")
async def bio_writer(project_id: str, user: CurrentUser):
    """Stream per-platform bio + headline generation (SSE)."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    voice_profile = await asyncio.to_thread(_get_voice_profile, project_id)

    from backend.services.personal_brand import content_engine

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in content_engine.bio_writer(project_id, personal_core, voice_profile):
                yield chunk
        except Exception as exc:
            logger.exception("Bio writer error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{project_id}/persona/content/reformat")
async def reformat_content(project_id: str, body: ReformatRequest, user: CurrentUser):
    """Stream reformatting of one piece of content for multiple platforms (SSE)."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    if not body.targetPlatforms:
        raise HTTPException(status_code=400, detail="At least one target platform is required.")

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    voice_profile = await asyncio.to_thread(_get_voice_profile, project_id)

    from backend.services.personal_brand import content_engine

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in content_engine.reformat_content(
                project_id, personal_core, voice_profile,
                body.content, body.sourcePlatform, body.targetPlatforms,
            ):
                yield chunk
        except Exception as exc:
            logger.exception("Reformat error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{project_id}/persona/content/approve")
async def approve_output(project_id: str, body: ApproveOutputRequest, user: CurrentUser):
    """Save an approved (or edited) output to the voice profile for future calibration."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    from backend.services.personal_brand import content_engine
    result = await asyncio.to_thread(
        content_engine.approve_output,
        project_id, body.content, body.platform, body.editedByUser,
    )
    return result


@router.post("/{project_id}/persona/content/article")
async def write_article(project_id: str, body: ArticleRequest, user: CurrentUser):
    """Stream a full thought leadership article in the user's voice (SSE)."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    voice_profile = await asyncio.to_thread(_get_voice_profile, project_id)

    from backend.services.personal_brand import content_engine

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in content_engine.write_article(
                project_id, personal_core, voice_profile,
                body.topic, body.platform, body.outline,
            ):
                yield chunk
        except Exception as exc:
            logger.exception("Article writer error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Voice Calibration
# ---------------------------------------------------------------------------

@router.post("/{project_id}/persona/voice/samples")
async def add_voice_samples(project_id: str, body: AddSamplesRequest, user: CurrentUser):
    """Add new writing samples and trigger voice re-calibration (SSE)."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    if not body.samples or not any(s.strip() for s in body.samples):
        raise HTTPException(status_code=400, detail="At least one non-empty writing sample is required.")

    from backend.services.personal_brand import voice_calibration

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in voice_calibration.add_samples_and_calibrate(
                project_id, [s for s in body.samples if s.strip()]
            ):
                yield chunk
        except Exception as exc:
            logger.exception("Add samples error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{project_id}/persona/voice/calibrate")
async def calibrate_voice(project_id: str, user: CurrentUser):
    """Re-calibrate voice profile from accumulated approved outputs (SSE)."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    from backend.services.personal_brand import voice_calibration

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in voice_calibration.recalibrate_from_outputs(project_id):
                yield chunk
        except Exception as exc:
            logger.exception("Voice calibration error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Reputation Monitoring
# ---------------------------------------------------------------------------

@router.post("/{project_id}/persona/reputation/check")
async def check_reputation(project_id: str, user: CurrentUser):
    """Run a reputation check: Google name search + social mention scan."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    personal_core = firebase_service.get_personal_core(project_id)
    if not personal_core:
        raise HTTPException(status_code=400, detail="Personal Core not found.")

    full_name = personal_core.get("fullName", "")
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name not set in Personal Core.")

    from backend.services.personal_brand import reputation_service
    result = await asyncio.to_thread(reputation_service.check_reputation, project_id, full_name)
    return result


# ---------------------------------------------------------------------------
# Publishing - Ayrshare
# ---------------------------------------------------------------------------

@router.get("/{project_id}/persona/publishing/profile")
async def get_publishing_profile(project_id: str, user: CurrentUser):
    """Return the Ayrshare profile + connected platforms for this project."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    from backend.services.personal_brand import ayrshare_service
    if not ayrshare_service.settings.AYRSHARE_API_KEY:
        raise HTTPException(status_code=503, detail="Publishing integration not configured.")

    profile = await ayrshare_service.get_profile(project_id)
    if not profile:
        # Auto-create profile on first call
        profile = await ayrshare_service.get_or_create_profile(project_id)

    platforms = await ayrshare_service.get_connected_platforms(project_id)
    return {"profile": profile, "connectedPlatforms": platforms}


@router.get("/{project_id}/persona/publishing/connect/{platform}")
async def get_connect_url(project_id: str, platform: str, user: CurrentUser):
    """Return a social-auth URL for connecting a platform to this project's profile."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    from backend.services.personal_brand import ayrshare_service
    if not ayrshare_service.settings.AYRSHARE_API_KEY:
        raise HTTPException(status_code=503, detail="Publishing integration not configured.")

    try:
        data = await ayrshare_service.get_social_link_url(project_id, platform)
        return data
    except Exception as exc:
        logger.error("Connect URL error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Could not generate connect URL: {exc}") from exc


@router.post("/{project_id}/persona/publishing/publish")
async def publish_post_now(project_id: str, body: PublishNowRequest, user: CurrentUser):
    """Publish a post immediately to the selected platforms."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    if not body.platforms:
        raise HTTPException(status_code=400, detail="At least one platform is required.")

    from backend.services.personal_brand import ayrshare_service
    if not ayrshare_service.settings.AYRSHARE_API_KEY:
        raise HTTPException(status_code=503, detail="Publishing integration not configured.")

    try:
        result = await ayrshare_service.publish_now(
            project_id, body.post, body.platforms, body.mediaUrls
        )
        return result
    except Exception as exc:
        logger.error("Publish error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Publishing failed: {exc}") from exc


@router.post("/{project_id}/persona/publishing/schedule")
async def schedule_post(project_id: str, body: SchedulePostRequest, user: CurrentUser):
    """Schedule a post for a future UTC datetime."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    if not body.platforms:
        raise HTTPException(status_code=400, detail="At least one platform is required.")

    from backend.services.personal_brand import ayrshare_service
    if not ayrshare_service.settings.AYRSHARE_API_KEY:
        raise HTTPException(status_code=503, detail="Publishing integration not configured.")

    try:
        result = await ayrshare_service.schedule_post(
            project_id, body.post, body.platforms, body.scheduledDate, body.mediaUrls
        )
        return result
    except Exception as exc:
        logger.error("Schedule error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Scheduling failed: {exc}") from exc


@router.get("/{project_id}/persona/publishing/scheduled")
async def list_scheduled(project_id: str, user: CurrentUser):
    """Return all pending scheduled posts for this project."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    from backend.services.personal_brand import ayrshare_service
    if not ayrshare_service.settings.AYRSHARE_API_KEY:
        raise HTTPException(status_code=503, detail="Publishing integration not configured.")

    try:
        posts = await ayrshare_service.list_scheduled_posts(project_id)
        return {"posts": posts}
    except Exception as exc:
        logger.error("List scheduled error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Could not fetch scheduled posts: {exc}") from exc


@router.delete("/{project_id}/persona/publishing/scheduled")
async def cancel_scheduled(project_id: str, body: CancelScheduledRequest, user: CurrentUser):
    """Cancel a pending scheduled post."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])
    _assert_personal(project)

    from backend.services.personal_brand import ayrshare_service
    if not ayrshare_service.settings.AYRSHARE_API_KEY:
        raise HTTPException(status_code=503, detail="Publishing integration not configured.")

    try:
        result = await ayrshare_service.cancel_scheduled_post(project_id, body.postId)
        return result
    except Exception as exc:
        logger.error("Cancel scheduled error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Could not cancel post: {exc}") from exc


@router.get("/{project_id}/persona/publishing/history")
async def get_publish_history(project_id: str, user: CurrentUser):
    """Return the publish history stored in Firestore."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    db = firebase_service.get_db()
    docs = (
        db.collection("personal_publishing_history")
        .where("projectId", "==", project_id)
        .order_by("createdAt", direction="DESCENDING")
        .limit(100)
        .stream()
    )
    return {"posts": [{"id": d.id, **d.to_dict()} for d in docs]}


@router.get("/{project_id}/persona/publishing/analytics/{post_id}")
async def get_post_analytics(project_id: str, post_id: str, user: CurrentUser):
    """Return Ayrshare post-level analytics for a specific published post."""
    project = get_project_or_404(project_id)
    assert_member(project, user["uid"])
    _assert_personal(project)

    from backend.services.personal_brand import ayrshare_service
    if not ayrshare_service.settings.AYRSHARE_API_KEY:
        raise HTTPException(status_code=503, detail="Publishing integration not configured.")

    try:
        data = await ayrshare_service.get_post_analytics(project_id, post_id)
        return data
    except Exception as exc:
        logger.error("Post analytics error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Could not fetch post analytics: {exc}") from exc
