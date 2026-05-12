# -*- coding: utf-8 -*-
"""
Carousel Studio - API Routes

POST /projects/{project_id}/carousel/scrape-brand    (SSE)
POST /projects/{project_id}/carousel/session
POST /projects/{project_id}/carousel/intake
POST /projects/{project_id}/carousel/generate        (SSE)
POST /projects/{project_id}/carousel/edit-slide
POST /projects/{project_id}/carousel/export          (SSE)
GET  /projects/{project_id}/carousel/list
GET  /projects/{project_id}/carousel/{carousel_id}
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import uuid
import zipfile
from pathlib import Path
from typing import Optional

import boto3
from botocore.config import Config
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from backend.api.deps import get_project_as_member
from backend.config import settings
from backend.middleware.auth import CurrentUser
from backend.schemas.carousel import (
    CreateSessionRequest,
    EditSlideRequest,
    ExportCarouselRequest,
    GenerateCarouselRequest,
    IntakeAnswerRequest,
    ScrapeBrandRequest,
)
from backend.services import firebase_service
from backend.services.carousel import brand_scraper, copy_writer, html_renderer, playwright_exporter
from backend.services.ingestion import firecrawl_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects/{project_id}/carousel", tags=["carousel"])


# ---------------------------------------------------------------------------
# Intake question definitions (Q1–Q5)
# ---------------------------------------------------------------------------

INTAKE_QUESTIONS = {
    1: {
        "index": 1,
        "text": "What type of carousel do you want?",
        "options": [
            {"value": "educational",  "label": "📚 Educational",  "description": "Teach something step-by-step"},
            {"value": "stats",        "label": "📊 Stats / Data",  "description": "Bold numbers that make a point"},
            {"value": "product",      "label": "🛍️ Product",       "description": "Showcase features or a launch"},
            {"value": "story",        "label": "💬 Story",          "description": "Narrative arc, before/after"},
            {"value": "viral_hook",   "label": "🔥 Viral Hook",     "description": "Controversial or scroll-stopping"},
            {"value": "tips",         "label": "💡 Tips",           "description": "Quick wins, listicle format"},
            {"value": "social_proof", "label": "🙌 Social Proof",   "description": "Testimonials, results, UGC"},
            {"value": "lead_magnet",  "label": "🎯 Lead Magnet",    "description": "CTA-heavy, drive action"},
        ],
    },
    2: {
        "index": 2,
        "text": "Which format do you want?",
        "options": [
            {"value": "portrait",  "label": "📱 Portrait 4:5",    "description": "1080×1350px - max feed space (Recommended)"},
            {"value": "square",    "label": "⬛ Square 1:1",       "description": "1080×1080px - clean, balanced"},
            {"value": "landscape", "label": "🖥️ Landscape 1.91:1", "description": "1080×566px - wide visuals"},
            {"value": "stories",   "label": "📲 Stories 9:16",     "description": "1080×1920px - full screen"},
        ],
    },
    3: {
        "index": 3,
        "text": "How many slides?",
        "options": [
            {"value": "5",      "label": "5 slides",  "description": "Quick hit - high retention"},
            {"value": "7",      "label": "7 slides",  "description": "Sweet spot - best save rate"},
            {"value": "10",     "label": "10 slides", "description": "Deep dive - educational content"},
            {"value": "custom", "label": "Custom",    "description": "Tell me how many you want"},
        ],
    },
    4: {
        "index": 4,
        "text": "Pick your design vibe:",
        "options": [
            {"value": "dark_bold",       "label": "🖤 Dark & Bold",      "description": "Dark backgrounds, high contrast, large type"},
            {"value": "light_clean",     "label": "🤍 Light & Clean",    "description": "White backgrounds, minimal, editorial"},
            {"value": "brand_gradient",  "label": "🎨 Brand Gradient",   "description": "Rich colour gradients using your brand palette"},
            {"value": "editorial",       "label": "📰 Editorial",         "description": "Magazine layout, sophisticated"},
            {"value": "high_energy",     "label": "⚡ High Energy",       "description": "Bold colours, big numbers, energetic"},
        ],
    },
    5: {
        "index": 5,
        "text": "Last one - what's the carousel about?",
        "type": "free_text",
        "placeholder": (
            "Give me a topic, URL, brief, or paste your content. "
            "I've already studied your brand so I'll write in your exact voice."
        ),
    },
}


# ---------------------------------------------------------------------------
# R2 upload helper
# ---------------------------------------------------------------------------

def _get_r2_client():
    if not all([
        settings.CLOUDFLARE_R2_ACCESS_KEY_ID,
        settings.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        settings.CLOUDFLARE_R2_ENDPOINT,
        settings.CLOUDFLARE_R2_BUCKET_NAME,
    ]):
        return None
    return boto3.client(
        "s3",
        endpoint_url=settings.CLOUDFLARE_R2_ENDPOINT,
        aws_access_key_id=settings.CLOUDFLARE_R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _upload_bytes_to_r2(data: bytes, key: str, content_type: str) -> Optional[str]:
    r2 = _get_r2_client()
    if not r2:
        return None
    try:
        r2.put_object(
            Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000",
        )
        public_base = settings.CLOUDFLARE_R2_PUBLIC_URL
        if public_base:
            return f"{public_base.rstrip('/')}/{key}"
    except Exception as exc:
        logger.error("R2 upload failed for %s: %s", key, exc)
    return None


# ---------------------------------------------------------------------------
# POST /scrape-brand  (SSE)
# ---------------------------------------------------------------------------

@router.post("/scrape-brand")
async def scrape_brand(
    project_id: str,
    body: ScrapeBrandRequest,
    user: CurrentUser,
):
    """
    Run the brand scraping pipeline and stream progress events.
    Results are cached for 24 hours. Returns brand_profile on done event.
    """
    get_project_as_member(project_id, user["uid"])

    # Check cache first
    cached = await asyncio.to_thread(firebase_service.get_brand_scrape_cache, project_id)
    if cached:
        async def cached_stream():
            yield f"data: {json.dumps({'type': 'done', 'brand_profile': cached, 'cached': True})}\n\n"
        return StreamingResponse(cached_stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    async def event_stream():
        brand_profile = None
        try:
            async for event in brand_scraper.run(
                project_id,
                body.website_url,
                body.instagram_url,
            ):
                if event.get("type") == "done":
                    brand_profile = event.get("brand_profile", {})
                yield f"data: {json.dumps(event)}\n\n"

            # Cache the result
            if brand_profile:
                await asyncio.to_thread(
                    firebase_service.save_brand_scrape_cache,
                    project_id,
                    brand_profile,
                )
        except Exception as exc:
            logger.exception("Brand scrape error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# POST /session
# ---------------------------------------------------------------------------

@router.post("/session")
async def create_session(
    project_id: str,
    body: CreateSessionRequest,
    user: CurrentUser,
):
    """Create a new carousel session. Returns session_id."""
    get_project_as_member(project_id, user["uid"])
    session = await asyncio.to_thread(
        firebase_service.create_carousel_session,
        project_id,
        {"project_id": project_id, "intake_answers": {}, "status": "intake", "owner_uid": user["uid"]},
    )
    return {"session_id": session["id"], "status": "intake"}


# ---------------------------------------------------------------------------
# POST /intake
# ---------------------------------------------------------------------------

@router.post("/intake")
async def submit_intake(
    project_id: str,
    body: IntakeAnswerRequest,
    user: CurrentUser,
):
    """Store one intake answer, return next question or ready_to_generate signal."""
    get_project_as_member(project_id, user["uid"])
    session = await asyncio.to_thread(
        firebase_service.get_carousel_session, project_id, body.session_id
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    # question=0 is a special init call - just return Q1
    if body.question == 0:
        return {
            "session_id": body.session_id,
            "status": "intake",
            "next_question": INTAKE_QUESTIONS[1],
            "question_number": 1,
            "total_questions": 5,
        }

    intake: dict = session.get("intake_answers", {}) or {}
    key_map: dict = {1: "q1_type", 2: "q2_format", 3: "q3_slides", 4: "q4_style", 5: "q5_topic"}
    q_num = body.question
    key = key_map.get(q_num) if isinstance(q_num, int) else None  # type: ignore[call-overload]
    if key:
        intake[key] = body.answer

    # Handle custom slide count
    if q_num == 3 and body.answer == "custom":
        return {
            "session_id": body.session_id,
            "status": "intake",
            "next_question": {
                "index": "3b",
                "text": "How many slides do you want? (max 20)",
                "type": "free_text",
                "placeholder": "Enter a number between 3 and 20",
            },
        }
    if q_num == "3b":
        try:
            count = min(20, max(3, int(body.answer)))
        except ValueError:
            count = 7
        intake["q3_slides"] = str(count)

    await asyncio.to_thread(
        firebase_service.update_carousel_session,
        project_id, body.session_id,
        {"intake_answers": intake},
    )

    answered = len([v for v in intake.values() if v])

    if answered >= 5:
        await asyncio.to_thread(
            firebase_service.update_carousel_session,
            project_id, body.session_id,
            {"status": "generating"},
        )
        return {"session_id": body.session_id, "status": "ready_to_generate", "next_question": None}

    next_q_num = (q_num + 1) if isinstance(q_num, int) else 4
    next_q = INTAKE_QUESTIONS.get(next_q_num)
    return {
        "session_id": body.session_id,
        "status": "intake",
        "next_question": next_q,
        "question_number": answered + 1,
        "total_questions": 5,
    }


# ---------------------------------------------------------------------------
# POST /generate  (SSE)
# ---------------------------------------------------------------------------

@router.post("/generate")
async def generate_carousel(
    project_id: str,
    body: GenerateCarouselRequest,
    user: CurrentUser,
):
    """
    Generate the full carousel from intake answers + brand profile.
    Streams: status events, then done event with carousel_id + html_content.
    """
    project = get_project_as_member(project_id, user["uid"])
    session = await asyncio.to_thread(
        firebase_service.get_carousel_session, project_id, body.session_id
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    async def event_stream():
        try:
            yield f"data: {json.dumps({'type': 'status', 'message': 'Writing your carousel copy...'})}\n\n"

            intake = session.get("intake_answers", {})
            topic = intake.get("q5_topic", "")

            # Get brand profile from cache
            brand_profile = await asyncio.to_thread(
                firebase_service.get_brand_scrape_cache, project_id
            ) or {}

            # Merge Brand Core data
            brand_core = project.get("brandCore", {})
            if brand_core:
                tone_data = brand_core.get("tone", {})
                if tone_data.get("style") and not brand_profile.get("tone"):
                    brand_profile["tone"] = tone_data["style"]
                visual_data = brand_core.get("visual", {})
                if visual_data.get("primaryColour") and not brand_profile.get("primary_color"):
                    brand_profile["primary_color"] = visual_data["primaryColour"]
                if visual_data.get("fonts") and not brand_profile.get("heading_font"):
                    fonts = visual_data["fonts"]
                    if fonts:
                        brand_profile["heading_font"] = fonts[0] if isinstance(fonts[0], str) else str(fonts[0])

            # Scrape URL content if Q5 is a URL
            source_content = None
            if topic.startswith("http") and settings.FIRECRAWL_API_KEY:
                try:
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Reading your URL...'})}\n\n"
                    page_data = await firecrawl_client.scrape_url(topic, settings.FIRECRAWL_API_KEY)
                    source_content = page_data.get("markdown", "")
                except Exception as exc:
                    logger.warning("URL scrape failed: %s", exc)

            yield f"data: {json.dumps({'type': 'status', 'message': 'Generating slides...'})}\n\n"

            result = await copy_writer.generate_slides(
                brand_profile=brand_profile,
                intake_answers=intake,
                source_content=source_content,
            )

            slides = result.get("slides", [])
            heading_font = result.get("heading_font", brand_profile.get("heading_font", "Plus Jakarta Sans"))
            body_font = result.get("body_font", brand_profile.get("body_font", "Plus Jakarta Sans"))
            title = result.get("title", f"Carousel - {topic[:40]}")

            # Derive colour system
            primary = brand_profile.get("primary_color", "#6366f1")
            cs = html_renderer.derive_colour_system(primary)
            cs["primary_color"] = primary

            design_style = intake.get("q4_style", "dark_bold")
            carousel_format = intake.get("q2_format", "portrait")
            carousel_type = intake.get("q1_type", "educational")

            yield f"data: {json.dumps({'type': 'status', 'message': 'Rendering HTML...'})}\n\n"

            html_content = html_renderer.render_carousel(
                slide_data=slides,
                colour_system=cs,
                heading_font=heading_font,
                body_font=body_font,
                design_style=design_style,
                carousel_format=carousel_format,
                brand_profile=brand_profile,
                brand_name=project.get("name", ""),
            )

            carousel = await asyncio.to_thread(
                firebase_service.create_carousel,
                project_id,
                {
                    "project_id": project_id,
                    "session_id": body.session_id,
                    "title": title,
                    "carousel_type": carousel_type,
                    "format": carousel_format,
                    "design_style": design_style,
                    "slide_count": len(slides),
                    "html_content": html_content,
                    "slide_data": slides,
                    "colour_system": cs,
                    "heading_font": heading_font,
                    "body_font": body_font,
                    "status": "draft",
                },
            )

            yield f"data: {json.dumps({'type': 'done', 'carousel_id': carousel['id'], 'html_content': html_content, 'slide_count': len(slides), 'title': title})}\n\n"

        except Exception as exc:
            logger.exception("Carousel generation error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# POST /edit-slide
# ---------------------------------------------------------------------------

@router.post("/edit-slide")
async def edit_slide(
    project_id: str,
    body: EditSlideRequest,
    user: CurrentUser,
):
    """Apply a targeted natural-language edit to a single slide."""
    get_project_as_member(project_id, user["uid"])
    carousel = await asyncio.to_thread(
        firebase_service.get_carousel, project_id, body.carousel_id
    )
    if not carousel:
        raise HTTPException(status_code=404, detail="Carousel not found.")

    slides: list[dict] = carousel.get("slide_data", [])
    if body.slide_index >= len(slides):
        raise HTTPException(status_code=400, detail="Slide index out of range.")

    brand_profile = await asyncio.to_thread(
        firebase_service.get_brand_scrape_cache, project_id
    ) or {}

    updated_slide = await copy_writer.edit_slide(
        slides[body.slide_index], body.instruction, brand_profile
    )
    slides[body.slide_index] = updated_slide

    # Re-render full HTML
    cs = carousel.get("colour_system", {})
    if not cs:
        cs = html_renderer.derive_colour_system(brand_profile.get("primary_color", "#6366f1"))

    project = await asyncio.to_thread(firebase_service.get_project, project_id)

    updated_html = html_renderer.render_carousel(
        slide_data=slides,
        colour_system=cs,
        heading_font=carousel.get("heading_font", "Plus Jakarta Sans"),
        body_font=carousel.get("body_font", "Plus Jakarta Sans"),
        design_style=carousel.get("design_style", "dark_bold"),
        carousel_format=carousel.get("format", "portrait"),
        brand_profile=brand_profile,
        brand_name=(project or {}).get("name", ""),
    )

    await asyncio.to_thread(
        firebase_service.update_carousel,
        project_id, body.carousel_id,
        {"slide_data": slides, "html_content": updated_html},
    )

    return {"updated_html": updated_html, "updated_slide": updated_slide}


# ---------------------------------------------------------------------------
# POST /export  (SSE)
# ---------------------------------------------------------------------------

@router.post("/export")
async def export_carousel(
    project_id: str,
    body: ExportCarouselRequest,
    user: CurrentUser,
):
    """
    Export all carousel slides as individual PNGs and return a ZIP download URL.
    Streams per-slide progress events.
    """
    get_project_as_member(project_id, user["uid"])
    carousel = await asyncio.to_thread(
        firebase_service.get_carousel, project_id, body.carousel_id
    )
    if not carousel:
        raise HTTPException(status_code=404, detail="Carousel not found.")

    html_content = carousel.get("html_content", "")
    total_slides = carousel.get("slide_count", 0)
    carousel_format = body.format or carousel.get("format", "portrait")

    async def event_stream():
        slide_paths: list[str] = []
        try:
            async for event in playwright_exporter.export_slides(
                html_content=html_content,
                total_slides=total_slides,
                carousel_format=carousel_format,
            ):
                if event.get("type") == "done":
                    slide_paths = event.get("paths", [])
                elif event.get("type") == "error":
                    yield f"data: {json.dumps(event)}\n\n"
                    return
                else:
                    yield f"data: {json.dumps(event)}\n\n"

            if not slide_paths:
                yield f"data: {json.dumps({'type': 'error', 'message': 'No slides were exported.'})}\n\n"
                return

            yield f"data: {json.dumps({'type': 'status', 'message': 'Creating ZIP...'})}\n\n"

            # Build ZIP in memory
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for path_str in slide_paths:
                    p = Path(path_str)
                    if p.exists():
                        zf.write(p, p.name)
            zip_buffer.seek(0)
            zip_bytes = zip_buffer.read()

            # Upload to R2
            run_id = uuid.uuid4().hex
            zip_key = f"carousels/{body.carousel_id}/{run_id}/slides.zip"
            zip_url = _upload_bytes_to_r2(zip_bytes, zip_key, "application/zip")

            # Upload individual PNGs
            slide_urls: list[str] = []
            for path_str in slide_paths:
                p = Path(path_str)
                if p.exists():
                    png_data = p.read_bytes()
                    png_key = f"carousels/{body.carousel_id}/{run_id}/{p.name}"
                    url = _upload_bytes_to_r2(png_data, png_key, "image/png")
                    if url:
                        slide_urls.append(url)

            # Update carousel record
            updates: dict = {"status": "exported"}
            if zip_url:
                updates["zip_url"] = zip_url
            if slide_urls:
                updates["slide_urls"] = slide_urls
                updates["cover_png_url"] = slide_urls[0]

            await asyncio.to_thread(
                firebase_service.update_carousel,
                project_id, body.carousel_id, updates,
            )

            yield f"data: {json.dumps({'type': 'done', 'zip_url': zip_url, 'slide_urls': slide_urls, 'slide_count': len(slide_paths)})}\n\n"

        except Exception as exc:
            logger.exception("Export error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# GET /list
# ---------------------------------------------------------------------------

@router.get("/list")
async def list_carousels(
    project_id: str,
    user: CurrentUser,
):
    """Return all carousels for a project, newest first."""
    get_project_as_member(project_id, user["uid"])
    carousels = await asyncio.to_thread(firebase_service.list_carousels, project_id)
    # Strip html_content from list view - it's large and not needed here
    for c in carousels:
        c.pop("html_content", None)
    return {"carousels": carousels}


# ---------------------------------------------------------------------------
# GET /{carousel_id}
# ---------------------------------------------------------------------------

@router.get("/{carousel_id}")
async def get_carousel(
    project_id: str,
    carousel_id: str,
    user: CurrentUser,
):
    """Fetch a single carousel including its html_content."""
    get_project_as_member(project_id, user["uid"])
    carousel = await asyncio.to_thread(
        firebase_service.get_carousel, project_id, carousel_id
    )
    if not carousel:
        raise HTTPException(status_code=404, detail="Carousel not found.")
    return carousel


# ---------------------------------------------------------------------------
# GET /intake-questions  (helper for frontend)
# ---------------------------------------------------------------------------

@router.get("/intake-questions")
async def get_intake_questions(project_id: str, user: CurrentUser):
    """Return all 5 intake question definitions."""
    get_project_as_member(project_id, user["uid"])
    return {"questions": INTAKE_QUESTIONS}
