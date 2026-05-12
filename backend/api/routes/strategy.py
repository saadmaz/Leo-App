"""
Funnel Strategy Engine - API routes.

POST /projects/{project_id}/strategy/start
    Detect intent, create session, return first question.

POST /projects/{project_id}/strategy/{session_id}/answer
    Store an intake answer, return next question or signal done.

POST /projects/{project_id}/strategy/{session_id}/research  (SSE)
    Run live research (Trends + Apify + Firecrawl), stream progress.

POST /projects/{project_id}/strategy/{session_id}/generate  (SSE)
    Build prompt from research + Brand Core, stream Claude strategy.

GET  /projects/{project_id}/strategy/list
    Return all saved strategies for a project.

POST /projects/{project_id}/strategy/{strategy_id}/refine   (SSE)
    Follow-up conversation on an existing strategy.
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from backend.api.deps import get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.schemas.strategy import (
    StrategyAnswerRequest,
    StrategyRefineRequest,
    StrategyStartRequest,
)
from backend.schemas.pillar1 import (
    ICPGenerateRequest,
    GTMGenerateRequest,
    OKRGenerateRequest,
    BudgetModelRequest,
    PersonaGenerateRequest,
    MarketSizingRequest,
    PositioningStartRequest,
    PositioningMessageRequest,
    CompMapGenerateRequest,
    LaunchPlanRequest,
    RiskScanRequest,
)
from backend.schemas.pillar2 import (
    HeadlineGenerateRequest,
    VisualBriefRequest,
    VideoScriptRequest,
    PodcastNotesRequest,
    QualityScoreRequest,
    TranslateRequest,
    CaseStudyRequest,
    ContentGapRequest,
)
from backend.schemas.pillar3 import (
    KeywordResearchRequest,
    SerpIntentRequest,
    OnPageSeoRequest,
    FeaturedSnippetRequest,
    ContentFreshnessRequest,
    TechnicalSeoRequest,
)
from backend.schemas.pillar4 import (
    AdBriefRequest,
    AdCopyRequest,
    RetargetingRequest,
    AttributionRequest,
)
from backend.services import firebase_service, strategy_service, credits_service
from backend.services.pillar1 import (
    icp_service,
    gtm_service,
    okr_service,
    budget_service,
    persona_service,
    market_sizing_service,
    positioning_service,
    comp_positioning_service,
    launch_service,
    risk_service,
)
from backend.services.pillar2 import (
    headline_service,
    visual_brief_service,
    video_script_service,
    podcast_service,
    quality_service,
    translate_service,
    case_study_service,
    content_gap_service,
)
from backend.services.pillar3 import (
    keyword_research_service,
    serp_intent_service,
    on_page_service,
    featured_snippet_service,
    content_freshness_service,
    technical_seo_service,
)
from backend.schemas.pillar5 import (
    EmailSequenceRequest,
    SubjectLineRequest,
    SendTimeRequest,
    NewsletterRequest,
    ChurnRiskRequest,
    LeadScoringRequest,
    WinLossRequest,
)
from backend.schemas.pillar6 import (
    CommunityManagementRequest,
    SocialProofRequest,
    EmployeeAdvocacyRequest,
)
from backend.schemas.pillar7 import (
    UnifiedDashboardRequest,
    CohortAnalysisRequest,
    FunnelAnalysisRequest,
    AnomalyDetectionRequest,
    ForecastingRequest,
    CacLtvRequest,
    BoardReportRequest,
)
from backend.schemas.pillar8 import (
    PressReleaseRequest,
    MediaListRequest,
    PitchEmailRequest,
    CoverageMonitoringRequest,
    CrisisCommsRequest,
    AwardSubmissionRequest,
    AnalystRelationsRequest,
    PartnershipCommsRequest,
)
from backend.services.pillar4 import (
    ad_brief_service,
    ad_copy_service,
    retargeting_service,
    attribution_service,
)
from backend.services.pillar5 import (
    email_sequence_service,
    subject_line_service,
    send_time_service,
    newsletter_service,
    churn_risk_service,
    lead_scoring_service,
    winloss_service,
)
from backend.services.pillar6 import (
    community_management_service,
    social_proof_service,
    employee_advocacy_service,
)
from backend.services.pillar7 import (
    unified_dashboard_service,
    cohort_analysis_service,
    funnel_analysis_service,
    anomaly_detection_service,
    forecasting_service,
    cac_ltv_service,
    board_report_service,
)
from backend.services.pillar8 import (
    press_release_service,
    media_list_service,
    pitch_email_service,
    coverage_monitoring_service,
    crisis_comms_service,
    award_submissions_service,
    analyst_relations_service,
    partnership_comms_service,
)
from backend.schemas.pillar10 import (
    ABTestDesignRequest,
    LandingPageCRORequest,
    MessagingResonanceRequest,
    EmailABTestRequest,
    ExperimentLogCreate,
    ExperimentLogUpdate,
    LearningPropagationRequest,
)
from backend.services.pillar10 import (
    ab_test_design_service,
    landing_page_cro_service,
    messaging_resonance_service,
    email_ab_service,
    learning_propagation_service,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects/{project_id}/strategy", tags=["strategy"])


# ---------------------------------------------------------------------------
# Start a strategy session
# ---------------------------------------------------------------------------

@router.post("/start")
async def start_strategy(
    project_id: str,
    body: StrategyStartRequest,
    user: CurrentUser,
):
    """
    Creates a new strategy session and returns the first intake question.
    Also validates that strategy intent was actually present.
    """
    project = get_project_as_member(project_id, user["uid"])

    # Create the session in Firestore (status: intake, no funnel type yet)
    session = firebase_service.create_strategy_session(project_id, {
        "user_goal": body.user_goal,
        "funnel_type": None,
        "funnel_framework": None,
        "intake_answers": {},
        "status": "intake",
        "owner_uid": user["uid"],
    })

    # The very first "question" is the funnel selector - the frontend renders
    # this as a special widget, but we include a text fallback too.
    return {
        "session_id": session["id"],
        "status": "intake",
        "next_question": {
            "index": -1,            # -1 = funnel selector (special)
            "text": "Which funnel are you working on?",
            "type": "funnel_selector",
        },
        "message": "Let's build your strategy. First, which part of the funnel do you want to focus on?",
    }


# ---------------------------------------------------------------------------
# Submit an answer
# ---------------------------------------------------------------------------

@router.post("/{session_id}/answer")
async def answer_question(
    project_id: str,
    session_id: str,
    body: StrategyAnswerRequest,
    user: CurrentUser,
):
    """
    Stores one intake answer and returns the next question.
    When question_index == -1 the answer is the funnel type selection.
    When all questions are answered returns status='research_ready'.
    """
    project = get_project_as_member(project_id, user["uid"])
    session = firebase_service.get_strategy_session(project_id, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    intake: dict = session.get("intake_answers") or {}

    if body.question_index == -1:
        # Funnel type selection
        funnel_type = body.funnel_type or body.answer.lower()
        if funnel_type not in strategy_service.FUNNEL_TYPES:
            funnel_type = "full"
        firebase_service.update_strategy_session(project_id, session_id, {
            "funnel_type": funnel_type,
            "intake_answers": intake,
        })
        session["funnel_type"] = funnel_type
        answer_count = 0
    else:
        # Regular intake question - store with key q{index}
        key = f"q{body.question_index}"
        intake[key] = body.answer
        firebase_service.update_strategy_session(project_id, session_id, {
            "intake_answers": intake,
        })
        session["intake_answers"] = intake
        answer_count = len([v for v in intake.values() if v])

    next_q = strategy_service.get_question_for_session(session, answer_count)

    if next_q is None:
        # All questions answered
        firebase_service.update_strategy_session(project_id, session_id, {"status": "researching"})
        return {
            "session_id": session_id,
            "status": "research_ready",
            "next_question": None,
            "message": (
                "Got it. Give me a moment - I'm going to research your industry, "
                "check what's trending, and look at what's working for similar brands."
            ),
        }

    return {
        "session_id": session_id,
        "status": "intake",
        "next_question": next_q,
        "question_number": answer_count + 1,
        "total_questions": len(
            strategy_service.FUNNEL_TYPES.get(
                session.get("funnel_type", "full"), {}
            ).get("questions", [])
        ),
    }


# ---------------------------------------------------------------------------
# Research (SSE)
# ---------------------------------------------------------------------------

@router.post("/{session_id}/research")
async def run_research(
    project_id: str,
    session_id: str,
    user: CurrentUser,
):
    """
    Triggers live research (Google Trends + Apify + Firecrawl).
    Streams SSE progress events then emits research_complete.
    """
    project = get_project_as_member(project_id, user["uid"])
    session = firebase_service.get_strategy_session(project_id, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    async def event_stream():
        try:
            async for chunk in strategy_service.run_research(session, project, project_id):
                yield chunk
        except Exception as exc:
            logger.exception("Research stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Generate strategy (SSE)
# ---------------------------------------------------------------------------

@router.post("/{session_id}/generate")
async def generate_strategy(
    project_id: str,
    session_id: str,
    user: CurrentUser,
):
    """
    Generates the full strategy document from research cache + Brand Core.
    Streams Claude token deltas then emits strategy_saved with the ID.
    """
    project = get_project_as_member(project_id, user["uid"])
    session = firebase_service.get_strategy_session(project_id, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    async def event_stream():
        try:
            async for chunk in strategy_service.generate_strategy(session, project, project_id):
                yield chunk
        except Exception as exc:
            logger.exception("Generation stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# List saved strategies
# ---------------------------------------------------------------------------

@router.get("/list")
async def list_strategies(
    project_id: str,
    user: CurrentUser,
):
    """Return all saved strategies for a project, newest first."""
    get_project_as_member(project_id, user["uid"])
    strategies = firebase_service.list_marketing_strategies(project_id)
    return {"strategies": strategies}


# ---------------------------------------------------------------------------
# Refine / follow-up (SSE)
# ---------------------------------------------------------------------------

@router.post("/{strategy_id}/refine")
async def refine_strategy(
    project_id: str,
    strategy_id: str,
    body: StrategyRefineRequest,
    user: CurrentUser,
):
    """
    Stream a follow-up response to an existing strategy.
    The full strategy markdown is included as context for Claude.
    """
    get_project_as_member(project_id, user["uid"])
    strategy = firebase_service.get_marketing_strategy(project_id, strategy_id)
    if not strategy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Strategy not found.")

    async def event_stream():
        try:
            async for chunk in strategy_service.refine_strategy(strategy, body.follow_up_message):
                yield chunk
        except Exception as exc:
            logger.exception("Refinement stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ===========================================================================
# Pillar 1 - Strategy & Planning features
# ===========================================================================

# ---------------------------------------------------------------------------
# ICP Builder
# ---------------------------------------------------------------------------

@router.post("/pillar1/icp/generate")
async def generate_icp(project_id: str, body: ICPGenerateRequest, user: CurrentUser):
    """Generate Ideal Customer Profile segments. Streams SSE events."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_icp")

    async def event_stream():
        try:
            gen = await icp_service.generate(project, body, project_id, user["uid"])
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("ICP generation error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/pillar1/icp/list")
async def list_icps(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "icp")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# GTM Strategy
# ---------------------------------------------------------------------------

@router.post("/pillar1/gtm/generate")
async def generate_gtm(project_id: str, body: GTMGenerateRequest, user: CurrentUser):
    """Generate GTM strategy. Streams SSE events."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_gtm")

    async def event_stream():
        try:
            gen = await gtm_service.generate(project, body, project_id, user["uid"])
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("GTM generation error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/pillar1/gtm/list")
async def list_gtms(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "gtm")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Quarterly OKR Drafting
# ---------------------------------------------------------------------------

@router.post("/pillar1/okr/generate")
async def generate_okr(project_id: str, body: OKRGenerateRequest, user: CurrentUser):
    """Generate quarterly OKRs (fast, non-streaming)."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_okr")
    doc = await okr_service.generate(project, body, project_id, user["uid"])
    return doc


@router.get("/pillar1/okr/list")
async def list_okrs(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "okr")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Budget Modelling
# ---------------------------------------------------------------------------

@router.post("/pillar1/budget/model")
async def model_budget(project_id: str, body: BudgetModelRequest, user: CurrentUser):
    """Generate budget model. Streams SSE events."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_budget")

    async def event_stream():
        try:
            gen = await budget_service.generate(project, body, project_id, user["uid"])
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Budget model error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/pillar1/budget/list")
async def list_budgets(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "budget")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Persona Generation
# ---------------------------------------------------------------------------

@router.post("/pillar1/personas/generate")
async def generate_personas(project_id: str, body: PersonaGenerateRequest, user: CurrentUser):
    """Generate buyer personas. Streams SSE events."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_persona")

    async def event_stream():
        try:
            gen = await persona_service.generate(project, body, project_id, user["uid"])
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Persona generation error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/pillar1/personas/list")
async def list_personas(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "persona")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Market Sizing
# ---------------------------------------------------------------------------

@router.post("/pillar1/market-size/analyze")
async def analyze_market_size(project_id: str, body: MarketSizingRequest, user: CurrentUser):
    """Generate TAM/SAM/SOM analysis. Streams SSE events."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_market_sizing")

    async def event_stream():
        try:
            gen = await market_sizing_service.generate(project, body, project_id, user["uid"])
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Market sizing error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/pillar1/market-size/list")
async def list_market_sizes(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "market_sizing")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Positioning Workshop
# ---------------------------------------------------------------------------

@router.post("/pillar1/positioning/start")
async def start_positioning(project_id: str, body: PositioningStartRequest, user: CurrentUser):
    """Start a new Positioning Workshop session. Returns doc_id."""
    get_project_as_member(project_id, user["uid"])
    doc = await asyncio.to_thread(
        positioning_service.start_session, project_id, user["uid"], body
    )
    return {"doc_id": doc["id"], "stage": 0, "stage_label": "Who are you for?"}


@router.post("/pillar1/positioning/{doc_id}/message")
async def positioning_message(
    project_id: str,
    doc_id: str,
    body: PositioningMessageRequest,
    user: CurrentUser,
):
    """Send a message in the Positioning Workshop. Streams SSE events. 5 credits/message."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_positioning_msg")

    async def event_stream():
        try:
            gen = await positioning_service.send_message(project, doc_id, body, project_id)
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Positioning workshop error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/pillar1/positioning/{doc_id}")
async def get_positioning_session(project_id: str, doc_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    doc = await asyncio.to_thread(firebase_service.get_pillar1_doc, project_id, doc_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    messages = await asyncio.to_thread(firebase_service.list_pillar1_messages, project_id, doc_id)
    return {"doc": doc, "messages": messages}


# ---------------------------------------------------------------------------
# Competitive Positioning Map
# ---------------------------------------------------------------------------

@router.post("/pillar1/comp-map/generate")
async def generate_comp_map(project_id: str, body: CompMapGenerateRequest, user: CurrentUser):
    """Generate competitive positioning map. Streams SSE events."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_comp_map")

    async def event_stream():
        try:
            gen = await comp_positioning_service.generate(project, body, project_id, user["uid"])
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Comp map generation error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/pillar1/comp-map/list")
async def list_comp_maps(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "comp_map")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Launch Planning
# ---------------------------------------------------------------------------

@router.post("/pillar1/launch/plan")
async def plan_launch(project_id: str, body: LaunchPlanRequest, user: CurrentUser):
    """Generate launch plan. Streams SSE events."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_launch")

    async def event_stream():
        try:
            gen = await launch_service.generate(project, body, project_id, user["uid"])
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Launch plan error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/pillar1/launch/list")
async def list_launches(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "launch")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Risk Flagging
# ---------------------------------------------------------------------------

@router.post("/pillar1/risk/scan")
async def scan_risks(project_id: str, body: RiskScanRequest, user: CurrentUser):
    """Run risk scan. Streams SSE events."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar1_risk_scan")

    async def event_stream():
        try:
            gen = await risk_service.generate(project, body, project_id, user["uid"])
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Risk scan error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/pillar1/risk/alerts")
async def list_risk_alerts(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "risk_flag")
    return {"docs": docs}


@router.post("/pillar1/risk/alerts/{doc_id}/dismiss/{risk_id}")
async def dismiss_risk_alert(project_id: str, doc_id: str, risk_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(firebase_service.dismiss_risk_alert, project_id, doc_id, risk_id)
    return {"status": "dismissed"}


# ===========================================================================
# Pillar 2 - Content Creation & Management
# ===========================================================================

def _p2_stream(service_fn, project, body, project_id, uid):
    """Helper: wrap a pillar2 service generator in a StreamingResponse."""
    async def event_stream():
        try:
            gen = await service_fn(project, body, project_id, uid)
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Pillar 2 stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# Headline A/B Variants
# ---------------------------------------------------------------------------

@router.post("/pillar2/headline/generate")
async def generate_headlines(project_id: str, body: HeadlineGenerateRequest, user: CurrentUser):
    """Generate headline A/B variants. Streams SSE events. 5 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar2_headline")
    return _p2_stream(headline_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar2/headline/list")
async def list_headlines(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "headline")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Visual Brief Generation
# ---------------------------------------------------------------------------

@router.post("/pillar2/visual-brief/generate")
async def generate_visual_brief(project_id: str, body: VisualBriefRequest, user: CurrentUser):
    """Generate a visual creative brief. Streams SSE events. 5 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar2_visual_brief")
    return _p2_stream(visual_brief_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar2/visual-brief/list")
async def list_visual_briefs(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "visual_brief")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Video Script Writing
# ---------------------------------------------------------------------------

@router.post("/pillar2/video-script/generate")
async def generate_video_script(project_id: str, body: VideoScriptRequest, user: CurrentUser):
    """Generate a full video script. Streams SSE events. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar2_video_script")
    return _p2_stream(video_script_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar2/video-script/list")
async def list_video_scripts(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "video_script")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Podcast Show Notes
# ---------------------------------------------------------------------------

@router.post("/pillar2/podcast/process")
async def process_podcast(project_id: str, body: PodcastNotesRequest, user: CurrentUser):
    """Transcribe and generate podcast show notes. Streams SSE events. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar2_podcast")
    return _p2_stream(podcast_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar2/podcast/list")
async def list_podcasts(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "podcast")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Content Quality Scoring
# ---------------------------------------------------------------------------

@router.post("/pillar2/quality/score")
async def score_content_quality(project_id: str, body: QualityScoreRequest, user: CurrentUser):
    """Score content quality across 6 dimensions. Streams SSE events. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar2_quality")
    return _p2_stream(quality_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar2/quality/list")
async def list_quality_scores(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "quality_score")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Multilingual Adaptation
# ---------------------------------------------------------------------------

@router.post("/pillar2/translate/adapt")
async def adapt_translation(project_id: str, body: TranslateRequest, user: CurrentUser):
    """Translate and adapt content via DeepL + Claude. Streams SSE events. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar2_translate")
    return _p2_stream(translate_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar2/translate/list")
async def list_translations(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "translation")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Case Study Production
# ---------------------------------------------------------------------------

@router.post("/pillar2/case-study/generate")
async def generate_case_study(project_id: str, body: CaseStudyRequest, user: CurrentUser):
    """Generate a publication-ready case study. Streams SSE events. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar2_case_study")
    return _p2_stream(case_study_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar2/case-study/list")
async def list_case_studies(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "case_study")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Content Gap Analysis
# ---------------------------------------------------------------------------

@router.post("/pillar2/content-gap/analyze")
async def analyze_content_gap(project_id: str, body: ContentGapRequest, user: CurrentUser):
    """Analyse content gaps via DataForSEO + Claude. Streams SSE events. 40 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar2_content_gap")
    return _p2_stream(content_gap_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar2/content-gap/list")
async def list_content_gaps(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "content_gap")
    return {"docs": docs}


# ===========================================================================
# Pillar 3 - SEO & Organic Search
# ===========================================================================

def _p3_stream(service_fn, project, body, project_id, uid):
    """Helper: wrap a pillar3 service generator in a StreamingResponse."""
    async def event_stream():
        try:
            gen = await service_fn(project, body, project_id, uid)
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Pillar 3 stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# Keyword Research Engine
# ---------------------------------------------------------------------------

@router.post("/pillar3/keywords/research")
async def research_keywords(project_id: str, body: KeywordResearchRequest, user: CurrentUser):
    """Keyword research via DataForSEO + Claude. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar3_keyword_research")
    return _p3_stream(keyword_research_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar3/keywords/list")
async def list_keyword_research(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "keyword_research")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# SERP Intent Mapping
# ---------------------------------------------------------------------------

@router.post("/pillar3/serp-intent/map")
async def map_serp_intent(project_id: str, body: SerpIntentRequest, user: CurrentUser):
    """SERP intent mapping via DataForSEO + Claude. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar3_serp_intent")
    return _p3_stream(serp_intent_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar3/serp-intent/list")
async def list_serp_intents(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "serp_intent")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# On-Page SEO Optimisation
# ---------------------------------------------------------------------------

@router.post("/pillar3/on-page/audit")
async def audit_on_page(project_id: str, body: OnPageSeoRequest, user: CurrentUser):
    """On-page SEO audit via DataForSEO + Claude. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar3_on_page_seo")
    return _p3_stream(on_page_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar3/on-page/list")
async def list_on_page_audits(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "on_page_seo")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Featured Snippet Optimisation
# ---------------------------------------------------------------------------

@router.post("/pillar3/featured-snippet/optimize")
async def optimize_featured_snippet(project_id: str, body: FeaturedSnippetRequest, user: CurrentUser):
    """Featured snippet optimisation via DataForSEO + Claude. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar3_featured_snippet")
    return _p3_stream(featured_snippet_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar3/featured-snippet/list")
async def list_featured_snippets(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "featured_snippet")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Content Freshness Management
# ---------------------------------------------------------------------------

@router.post("/pillar3/freshness/check")
async def check_content_freshness(project_id: str, body: ContentFreshnessRequest, user: CurrentUser):
    """Content freshness check via DataForSEO + Claude. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar3_content_freshness")
    return _p3_stream(content_freshness_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar3/freshness/list")
async def list_freshness_checks(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "content_freshness")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Technical SEO Monitor
# ---------------------------------------------------------------------------

@router.post("/pillar3/technical/audit")
async def audit_technical_seo(project_id: str, body: TechnicalSeoRequest, user: CurrentUser):
    """Technical SEO audit via DataForSEO + Claude. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar3_technical_seo")
    return _p3_stream(technical_seo_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar3/technical/list")
async def list_technical_audits(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "technical_seo")
    return {"docs": docs}


# ===========================================================================
# Pillar 4 - Paid Advertising
# ===========================================================================

def _p4_stream(service_fn, project, body, project_id, uid):
    """Helper: wrap a pillar4 service generator in a StreamingResponse."""
    async def event_stream():
        try:
            gen = await service_fn(project, body, project_id, uid)
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Pillar 4 stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# Ad Campaign Brief Generator
# ---------------------------------------------------------------------------

@router.post("/pillar4/ad-brief/generate")
async def generate_ad_brief(project_id: str, body: AdBriefRequest, user: CurrentUser):
    """Generate a comprehensive paid ad campaign brief. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar4_ad_brief")
    return _p4_stream(ad_brief_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar4/ad-brief/list")
async def list_ad_briefs(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "ad_brief")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Ad Copy Generator
# ---------------------------------------------------------------------------

@router.post("/pillar4/ad-copy/generate")
async def generate_ad_copy(project_id: str, body: AdCopyRequest, user: CurrentUser):
    """Generate multi-variant platform-specific ad copy. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar4_ad_copy")
    return _p4_stream(ad_copy_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar4/ad-copy/list")
async def list_ad_copies(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "ad_copy")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Retargeting Sequence Builder
# ---------------------------------------------------------------------------

@router.post("/pillar4/retargeting/build")
async def build_retargeting_sequence(project_id: str, body: RetargetingRequest, user: CurrentUser):
    """Build a full retargeting funnel sequence. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar4_retargeting")
    return _p4_stream(retargeting_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar4/retargeting/list")
async def list_retargeting_sequences(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "retargeting_sequence")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Cross-Channel Attribution
# ---------------------------------------------------------------------------

@router.post("/pillar4/attribution/analyse")
async def analyse_attribution(project_id: str, body: AttributionRequest, user: CurrentUser):
    """Cross-channel attribution analysis via GA4 + Claude. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar4_attribution")
    return _p4_stream(attribution_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar4/attribution/list")
async def list_attribution_reports(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "attribution")
    return {"docs": docs}


# ===========================================================================
# Pillar 5 - Email Marketing & CRM
# ===========================================================================

def _p5_stream(service_fn, project, body, project_id, uid):
    """Helper: wrap a pillar5 service generator in a StreamingResponse."""
    async def event_stream():
        try:
            gen = await service_fn(project, body, project_id, uid)
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Pillar 5 stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# Email Sequence Builder
# ---------------------------------------------------------------------------

@router.post("/pillar5/email-sequence/build")
async def build_email_sequence(project_id: str, body: EmailSequenceRequest, user: CurrentUser):
    """Write a full email sequence + optionally push to Loops.so. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar5_email_sequence")
    return _p5_stream(email_sequence_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar5/email-sequence/list")
async def list_email_sequences(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "email_sequence")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Subject Line Optimiser
# ---------------------------------------------------------------------------

@router.post("/pillar5/subject-lines/optimise")
async def optimise_subject_lines(project_id: str, body: SubjectLineRequest, user: CurrentUser):
    """Generate subject line variants with open-rate scores. Streams SSE. 5 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar5_subject_lines")
    return _p5_stream(subject_line_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar5/subject-lines/list")
async def list_subject_line_results(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "subject_lines")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Send Time Optimiser
# ---------------------------------------------------------------------------

@router.post("/pillar5/send-time/optimise")
async def optimise_send_time(project_id: str, body: SendTimeRequest, user: CurrentUser):
    """Recommend optimal email send windows from audience data. Streams SSE. 5 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar5_send_time")
    return _p5_stream(send_time_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar5/send-time/list")
async def list_send_time_results(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "send_time")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Newsletter Production
# ---------------------------------------------------------------------------

@router.post("/pillar5/newsletter/produce")
async def produce_newsletter(project_id: str, body: NewsletterRequest, user: CurrentUser):
    """Write a full newsletter edition + optionally push to Loops.so. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar5_newsletter")
    return _p5_stream(newsletter_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar5/newsletter/list")
async def list_newsletters(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "newsletter")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Churn Risk Detection
# ---------------------------------------------------------------------------

@router.post("/pillar5/churn-risk/analyse")
async def analyse_churn_risk(project_id: str, body: ChurnRiskRequest, user: CurrentUser):
    """Score contact churn risk + generate win-back emails. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar5_churn_risk")
    return _p5_stream(churn_risk_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar5/churn-risk/list")
async def list_churn_risk_reports(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "churn_risk")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Lead Scoring
# ---------------------------------------------------------------------------

@router.post("/pillar5/lead-scoring/score")
async def score_leads(project_id: str, body: LeadScoringRequest, user: CurrentUser):
    """Score leads against ICP + optionally sync to HubSpot. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar5_lead_scoring")
    return _p5_stream(lead_scoring_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar5/lead-scoring/list")
async def list_lead_scoring_results(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "lead_scoring")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Win/Loss Analysis
# ---------------------------------------------------------------------------

@router.post("/pillar5/winloss/analyse")
async def analyse_winloss(project_id: str, body: WinLossRequest, user: CurrentUser):
    """Synthesise deal outcomes into competitive intelligence. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar5_winloss")
    return _p5_stream(winloss_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar5/winloss/list")
async def list_winloss_reports(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "winloss")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# ZeroBounce - Email Validation (utility endpoint, no credit cost)
# ---------------------------------------------------------------------------

@router.post("/pillar5/list-hygiene/validate")
async def validate_emails(project_id: str, body: dict, user: CurrentUser):
    """
    Validate up to 100 email addresses via ZeroBounce.
    Body: { "emails": ["a@b.com", ...] }
    Returns ZeroBounce result list. No credit charge (free tier 100/mo).
    """
    get_project_as_member(project_id, user["uid"])
    emails: list[str] = body.get("emails", [])
    if not emails:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="emails list is required.")

    from backend.services.pillar5 import zerobounce_client
    if len(emails) == 1:
        result = await zerobounce_client.validate_single(emails[0])
        return {"results": [result]}
    results = await zerobounce_client.validate_batch(emails[:100])
    return {"results": results, "validated": len(results)}


# ===========================================================================
# Pillar 6 - Social Media (gap features)
# Already built: Scheduling, Listening, Trends, Hashtags, Analytics, Ad Creative
# New here: Community Management, Social Proof Harvesting, Employee Advocacy
# ===========================================================================

def _p6_stream(service_fn, project, body, project_id, uid):
    """Helper: wrap a pillar6 service generator in a StreamingResponse."""
    async def event_stream():
        try:
            gen = await service_fn(project, body, project_id, uid)
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Pillar 6 stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# Community Management
# ---------------------------------------------------------------------------

@router.post("/pillar6/community/manage")
async def manage_community(project_id: str, body: CommunityManagementRequest, user: CurrentUser):
    """Draft brand-aligned replies to social comments (Ayrshare pull or manual). Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar6_community_management")
    return _p6_stream(community_management_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar6/community/list")
async def list_community_sessions(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "community_management")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Social Proof Harvesting
# ---------------------------------------------------------------------------

@router.post("/pillar6/social-proof/harvest")
async def harvest_social_proof(project_id: str, body: SocialProofRequest, user: CurrentUser):
    """Search for brand mentions + surface top testimonials & UGC via Tavily + Claude. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar6_social_proof")
    return _p6_stream(social_proof_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar6/social-proof/list")
async def list_social_proof_harvests(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "social_proof")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Employee Advocacy
# ---------------------------------------------------------------------------

@router.post("/pillar6/employee-advocacy/generate")
async def generate_employee_advocacy(project_id: str, body: EmployeeAdvocacyRequest, user: CurrentUser):
    """Generate pre-approved employee-voice posts per platform. Optionally push to Ayrshare. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar6_employee_advocacy")
    return _p6_stream(employee_advocacy_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar6/employee-advocacy/list")
async def list_employee_advocacy_sessions(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "employee_advocacy")
    return {"docs": docs}


# ===========================================================================
# Pillar 7 - Analytics & Reporting
# Already built: Weekly Digest, Research Reports, Content Analytics, Competitive Intel
# New here: Unified Dashboard, Cohort Analysis, Funnel Analysis, Anomaly Detection,
#           Forecasting, CAC+LTV, Board-Ready Reporting
# ===========================================================================

def _p7_stream(service_fn, project, body, project_id, uid):
    """Helper: wrap a pillar7 service generator in a StreamingResponse."""
    async def event_stream():
        try:
            gen = await service_fn(project, body, project_id, uid)
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Pillar 7 stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/pillar7/unified-dashboard/generate")
async def generate_unified_dashboard(project_id: str, body: UnifiedDashboardRequest, user: CurrentUser):
    """Unified GA4 + Meta + manual channel dashboard with Claude narrative. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar7_unified_dashboard")
    return _p7_stream(unified_dashboard_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar7/unified-dashboard/list")
async def list_unified_dashboards(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "unified_dashboard")
    return {"docs": docs}


@router.post("/pillar7/cohort/analyse")
async def analyse_cohorts(project_id: str, body: CohortAnalysisRequest, user: CurrentUser):
    """Interpret cohort retention/activation data with Claude. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar7_cohort_analysis")
    return _p7_stream(cohort_analysis_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar7/cohort/list")
async def list_cohort_analyses(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "cohort_analysis")
    return {"docs": docs}


@router.post("/pillar7/funnel/analyse")
async def analyse_funnel(project_id: str, body: FunnelAnalysisRequest, user: CurrentUser):
    """Diagnose funnel drop-offs and prescribe CRO fixes. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar7_funnel_analysis")
    return _p7_stream(funnel_analysis_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar7/funnel/list")
async def list_funnel_analyses(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "funnel_analysis")
    return {"docs": docs}


@router.post("/pillar7/anomaly/detect")
async def detect_anomalies(project_id: str, body: AnomalyDetectionRequest, user: CurrentUser):
    """Statistical + Claude anomaly detection across metric time series. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar7_anomaly_detection")
    return _p7_stream(anomaly_detection_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar7/anomaly/list")
async def list_anomaly_reports(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "anomaly_detection")
    return {"docs": docs}


@router.post("/pillar7/forecast/generate")
async def generate_forecast(project_id: str, body: ForecastingRequest, user: CurrentUser):
    """Claude-driven metric forecasting with base/optimistic/pessimistic scenarios. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar7_forecasting")
    return _p7_stream(forecasting_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar7/forecast/list")
async def list_forecasts(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "forecast")
    return {"docs": docs}


@router.post("/pillar7/cac-ltv/calculate")
async def calculate_cac_ltv(project_id: str, body: CacLtvRequest, user: CurrentUser):
    """Calculate CAC, LTV, payback period from Stripe/HubSpot/manual data. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar7_cac_ltv")
    return _p7_stream(cac_ltv_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar7/cac-ltv/list")
async def list_cac_ltv_reports(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "cac_ltv")
    return {"docs": docs}


@router.post("/pillar7/board-report/generate")
async def generate_board_report(project_id: str, body: BoardReportRequest, user: CurrentUser):
    """Write a board/investor-ready report with narrative, KPI table, and appendix. Streams SSE. 25 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar7_board_report")
    return _p7_stream(board_report_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar7/board-report/list")
async def list_board_reports(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "board_report")
    return {"docs": docs}


# ===========================================================================
# Pillar 8 - PR & Communications
# Features: Press Release, Media List, Pitch Email, Coverage Monitoring,
#           Crisis Comms, Award Submissions, Analyst Relations, Partnership Comms
# ===========================================================================

def _p8_stream(service_fn, project, body, project_id, uid):
    """Helper: wrap a pillar8 service generator in a StreamingResponse."""
    async def event_stream():
        try:
            gen = await service_fn(project, body, project_id, uid)
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Pillar 8 stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# Press Release Writing
# ---------------------------------------------------------------------------

@router.post("/pillar8/press-release/write")
async def write_press_release(project_id: str, body: PressReleaseRequest, user: CurrentUser):
    """Draft a brand-aligned press release. Pure Claude. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar8_press_release")
    return _p8_stream(press_release_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar8/press-release/list")
async def list_press_releases(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "press_release")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Media List Building
# ---------------------------------------------------------------------------

@router.post("/pillar8/media-list/build")
async def build_media_list(project_id: str, body: MediaListRequest, user: CurrentUser):
    """Build a prioritised journalist media list via Hunter.io + Claude. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar8_media_list")
    return _p8_stream(media_list_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar8/media-list/list")
async def list_media_lists(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "media_list")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Pitch Email Generation
# ---------------------------------------------------------------------------

@router.post("/pillar8/pitch-email/generate")
async def generate_pitch_email(project_id: str, body: PitchEmailRequest, user: CurrentUser):
    """Write a personalised journalist pitch email with subject line variants. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar8_pitch_email")
    return _p8_stream(pitch_email_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar8/pitch-email/list")
async def list_pitch_emails(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "pitch_email")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Coverage Monitoring
# ---------------------------------------------------------------------------

@router.post("/pillar8/coverage/monitor")
async def monitor_coverage(project_id: str, body: CoverageMonitoringRequest, user: CurrentUser):
    """Scan news and Reddit for brand coverage, synthesise sentiment report. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar8_coverage_monitoring")
    return _p8_stream(coverage_monitoring_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar8/coverage/list")
async def list_coverage_reports(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "coverage_monitoring")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Crisis Communications
# ---------------------------------------------------------------------------

@router.post("/pillar8/crisis/respond")
async def respond_to_crisis(project_id: str, body: CrisisCommsRequest, user: CurrentUser):
    """Generate a crisis communications playbook with stakeholder statements. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar8_crisis_comms")
    return _p8_stream(crisis_comms_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar8/crisis/list")
async def list_crisis_responses(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "crisis_comms")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Award Submissions
# ---------------------------------------------------------------------------

@router.post("/pillar8/awards/submit")
async def write_award_submission(project_id: str, body: AwardSubmissionRequest, user: CurrentUser):
    """Draft an award submission aligned to the award criteria. Firecrawl + Claude. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar8_award_submission")
    return _p8_stream(award_submissions_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar8/awards/list")
async def list_award_submissions(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "award_submission")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Analyst Relations
# ---------------------------------------------------------------------------

@router.post("/pillar8/analyst/brief")
async def brief_analyst(project_id: str, body: AnalystRelationsRequest, user: CurrentUser):
    """Prepare an analyst briefing document with positioning & Q&A. Firecrawl + Claude. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar8_analyst_relations")
    return _p8_stream(analyst_relations_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar8/analyst/list")
async def list_analyst_briefings(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "analyst_relations")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Partnership Communications
# ---------------------------------------------------------------------------

@router.post("/pillar8/partnership/draft")
async def draft_partnership_comms(project_id: str, body: PartnershipCommsRequest, user: CurrentUser):
    """Draft partnership outreach, proposals, or joint press releases. Pure Claude. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar8_partnership_comms")
    return _p8_stream(partnership_comms_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar8/partnership/list")
async def list_partnership_comms(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "partnership_comms")
    return {"docs": docs}


# ===========================================================================
# Pillar 10 - Experimentation & Optimisation
# Features: A/B Test Design, Landing Page CRO, Messaging Resonance,
#           Email A/B Testing, Experiment Log (CRUD), Learning Propagation
# ===========================================================================

def _p10_stream(service_fn, project, body, project_id, uid):
    """Helper: wrap a pillar10 service generator in a StreamingResponse."""
    async def event_stream():
        try:
            gen = await service_fn(project, body, project_id, uid)
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.exception("Pillar 10 stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# A/B Test Design
# ---------------------------------------------------------------------------

@router.post("/pillar10/ab-test/design")
async def design_ab_test(project_id: str, body: ABTestDesignRequest, user: CurrentUser):
    """Design a statistically rigorous A/B test with variants and sample size. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar10_ab_test_design")
    return _p10_stream(ab_test_design_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar10/ab-test/list")
async def list_ab_tests(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "ab_test_design")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Landing Page CRO
# ---------------------------------------------------------------------------

@router.post("/pillar10/cro/generate")
async def generate_cro_variants(project_id: str, body: LandingPageCRORequest, user: CurrentUser):
    """Generate copy variants for each landing page section. Firecrawl + Claude. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar10_landing_page_cro")
    return _p10_stream(landing_page_cro_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar10/cro/list")
async def list_cro_sessions(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "landing_page_cro")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Messaging Resonance Testing
# ---------------------------------------------------------------------------

@router.post("/pillar10/messaging-resonance/analyse")
async def analyse_messaging_resonance(project_id: str, body: MessagingResonanceRequest, user: CurrentUser):
    """Read Meta Ads test results and identify which message angle resonated. Streams SSE. 15 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar10_messaging_resonance")
    return _p10_stream(messaging_resonance_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar10/messaging-resonance/list")
async def list_resonance_analyses(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "messaging_resonance")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Email A/B Testing
# ---------------------------------------------------------------------------

@router.post("/pillar10/email-ab/analyse")
async def analyse_email_ab(project_id: str, body: EmailABTestRequest, user: CurrentUser):
    """Analyse email A/B test results, identify winner, recommend next iteration. Streams SSE. 10 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar10_email_ab_test")
    return _p10_stream(email_ab_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar10/email-ab/list")
async def list_email_ab_tests(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "email_ab_test")
    return {"docs": docs}


# ---------------------------------------------------------------------------
# Experiment Log - CRUD (no SSE, no credits)
# ---------------------------------------------------------------------------

@router.post("/pillar10/experiment-log")
async def create_experiment(project_id: str, body: ExperimentLogCreate, user: CurrentUser):
    """Create a new experiment in the log."""
    get_project_as_member(project_id, user["uid"])
    entry = await asyncio.to_thread(
        firebase_service.create_experiment,
        project_id,
        user["uid"],
        body.model_dump(exclude_none=True),
    )
    return {"experiment": entry}


@router.get("/pillar10/experiment-log")
async def list_experiment_log(
    project_id: str,
    user: CurrentUser,
    status: str | None = None,
):
    """List all experiments for this project."""
    get_project_as_member(project_id, user["uid"])
    experiments = await asyncio.to_thread(firebase_service.list_experiments, project_id, status)
    return {"experiments": experiments}


@router.get("/pillar10/experiment-log/{experiment_id}")
async def get_experiment(project_id: str, experiment_id: str, user: CurrentUser):
    """Get a single experiment."""
    get_project_as_member(project_id, user["uid"])
    exp = await asyncio.to_thread(firebase_service.get_experiment, project_id, experiment_id)
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return {"experiment": exp}


@router.patch("/pillar10/experiment-log/{experiment_id}")
async def update_experiment(project_id: str, experiment_id: str, body: ExperimentLogUpdate, user: CurrentUser):
    """Update an experiment - results, winner, learnings, status."""
    get_project_as_member(project_id, user["uid"])
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    await asyncio.to_thread(firebase_service.update_experiment, project_id, experiment_id, updates)
    return {"ok": True}


@router.delete("/pillar10/experiment-log/{experiment_id}")
async def delete_experiment(project_id: str, experiment_id: str, user: CurrentUser):
    """Delete an experiment from the log."""
    get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(firebase_service.delete_experiment, project_id, experiment_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Learning Propagation
# ---------------------------------------------------------------------------

@router.post("/pillar10/learning-propagation/generate")
async def propagate_learnings(project_id: str, body: LearningPropagationRequest, user: CurrentUser):
    """Synthesise experiment learnings and generate a propagation action plan. Streams SSE. 20 credits."""
    project = get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(credits_service.check_and_deduct, user["uid"], "pillar10_learning_propagation")
    return _p10_stream(learning_propagation_service.generate, project, body, project_id, user["uid"])


@router.get("/pillar10/learning-propagation/list")
async def list_propagation_reports(project_id: str, user: CurrentUser):
    get_project_as_member(project_id, user["uid"])
    docs = await asyncio.to_thread(firebase_service.list_pillar1_docs, project_id, "learning_propagation")
    return {"docs": docs}
