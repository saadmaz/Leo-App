"""
Content Operations routes - Phase 2.

Endpoints:
  POST /projects/{id}/content-library                 - Save item to library
  GET  /projects/{id}/content-library                 - List library items (with filters)
  PATCH /projects/{id}/content-library/{item_id}      - Update status / content
  DELETE /projects/{id}/content-library/{item_id}     - Delete item

  POST /projects/{id}/content/bulk-generate           - Bulk generate (SSE)
  POST /projects/{id}/content/recycle                 - Recycle content variants
  POST /projects/{id}/content/transform               - Transform to all platforms

  POST /projects/{id}/calendar/generate               - AI calendar generation
  GET  /projects/{id}/calendar                        - List calendar entries
  POST /projects/{id}/calendar/entries                - Add entry manually
  PATCH /projects/{id}/calendar/entries/{entry_id}    - Update entry
  DELETE /projects/{id}/calendar/entries/{entry_id}   - Delete entry
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.api.deps import get_project_as_member, get_project_as_editor
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service, content_ops_service
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["content-ops"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ContentLibraryItemCreate(BaseModel):
    platform: str = Field(..., max_length=64)
    type: str = Field(..., max_length=64)       # caption | ad_copy | video_script | email | image_prompt
    content: str = Field(..., max_length=10000)
    hashtags: list[str] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)  # headline, hook, cta, scenes, subject, etc.
    status: str = Field(default="draft")          # draft | approved | scheduled | posted
    tags: list[str] = Field(default_factory=list)


class ContentLibraryItemUpdate(BaseModel):
    content: Optional[str] = Field(None, max_length=10000)
    status: Optional[str] = None
    tags: Optional[list[str]] = None
    hashtags: Optional[list[str]] = None
    scheduledAt: Optional[str] = None


class BulkGenerateRequest(BaseModel):
    platforms: list[str] = Field(..., min_length=1, max_length=6)
    count_per_platform: int = Field(default=5, ge=1, le=10)
    themes: list[str] = Field(default_factory=list, max_length=10)
    period: str = Field(default="this month", max_length=100)
    goal: str = Field(default="grow brand awareness", max_length=300)


class RecycleRequest(BaseModel):
    content: str = Field(..., min_length=10, max_length=5000)
    platform: str = Field(..., max_length=64)
    count: int = Field(default=3, ge=1, le=5)


class TransformRequest(BaseModel):
    content: str = Field(..., min_length=10, max_length=5000)
    target_platforms: list[str] = Field(..., min_length=1, max_length=6)


class CalendarGenerateRequest(BaseModel):
    platforms: list[str] = Field(..., min_length=1, max_length=6)
    period: str = Field(default="next 4 weeks", max_length=100)
    goals: str = Field(default="grow brand awareness and engagement", max_length=500)
    posts_per_week: int = Field(default=3, ge=1, le=14)


class CalendarEntryCreate(BaseModel):
    date: str = Field(..., max_length=10)         # YYYY-MM-DD
    platform: str = Field(..., max_length=64)
    content: str = Field(default="", max_length=50000)
    title: Optional[str] = Field(None, max_length=300)
    time: Optional[str] = Field(None, max_length=5)   # HH:MM
    hashtags: list[str] = Field(default_factory=list)
    type: str = Field(default="post", max_length=64)
    content_format: str = Field(default="post", max_length=64)
    status: str = Field(default="planned")
    content_library_item_id: Optional[str] = None
    media_url: Optional[str] = Field(None, max_length=2000)
    media_type: Optional[str] = Field(None, max_length=32)   # image | video | blog | carousel


class CalendarEntryUpdate(BaseModel):
    content: Optional[str] = Field(None, max_length=50000)
    title: Optional[str] = Field(None, max_length=300)
    date: Optional[str] = None
    time: Optional[str] = None
    status: Optional[str] = None
    hashtags: Optional[list[str]] = None
    platform: Optional[str] = Field(None, max_length=64)
    type: Optional[str] = Field(None, max_length=64)
    content_format: Optional[str] = Field(None, max_length=64)
    media_url: Optional[str] = Field(None, max_length=2000)
    media_type: Optional[str] = Field(None, max_length=32)


# ---------------------------------------------------------------------------
# Content Library
# ---------------------------------------------------------------------------

@router.post("/content-library")
async def save_to_library(
    project_id: str,
    body: ContentLibraryItemCreate,
    user: CurrentUser,
):
    """Save a content item to the project's library."""
    get_project_as_member(project_id, user["uid"])
    item = await asyncio.to_thread(
        firebase_service.save_content_library_item,
        project_id,
        body.model_dump(),
    )
    return item


@router.get("/content-library")
async def list_library(
    project_id: str,
    user: CurrentUser,
    platform: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    limit: int = Query(default=50, ge=1, le=100),
):
    """List content library items with optional filters."""
    get_project_as_member(project_id, user["uid"])
    items = await asyncio.to_thread(
        firebase_service.list_content_library_items,
        project_id, platform, status, type, limit,
    )
    return {"items": items}


@router.patch("/content-library/{item_id}")
async def update_library_item(
    project_id: str,
    item_id: str,
    body: ContentLibraryItemUpdate,
    user: CurrentUser,
):
    """Update a content library item (status, content, tags, schedule)."""
    get_project_as_member(project_id, user["uid"])
    item = await asyncio.to_thread(
        firebase_service.update_content_library_item,
        project_id, item_id, body.model_dump(exclude_none=True),
    )
    return item


@router.delete("/content-library/{item_id}", status_code=204)
async def delete_library_item(
    project_id: str,
    item_id: str,
    user: CurrentUser,
):
    """Delete a content library item."""
    get_project_as_member(project_id, user["uid"])
    await asyncio.to_thread(firebase_service.delete_content_library_item, project_id, item_id)


# ---------------------------------------------------------------------------
# Bulk Content Generation (SSE)
# ---------------------------------------------------------------------------

@router.post("/content/bulk-generate")
async def bulk_generate(
    project_id: str,
    body: BulkGenerateRequest,
    user: CurrentUser,
):
    """
    Generate multiple pieces of content across platforms.
    Streams each generated item as an SSE event.
    Automatically saves approved items to the content library.
    """
    project = get_project_as_editor(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}
    total_items = len(body.platforms) * body.count_per_platform
    await asyncio.to_thread(check_and_deduct, user["uid"], "bulk_generate_item", total_items)

    async def event_stream():
        async for chunk in content_ops_service.stream_bulk_generate(
            project_name=project.get("name", ""),
            brand_core=brand_core,
            platforms=body.platforms,
            count_per_platform=body.count_per_platform,
            themes=body.themes,
            period=body.period,
            goal=body.goal,
        ):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Content Recycler
# ---------------------------------------------------------------------------

@router.post("/content/recycle")
async def recycle_content(
    project_id: str,
    body: RecycleRequest,
    user: CurrentUser,
):
    """Generate fresh variants of existing content."""
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    try:
        result = await content_ops_service.recycle_content(
            body.content, body.platform, brand_core, body.count
        )
        return result
    except Exception as exc:
        logger.error("Content recycle failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Platform Format Transformer
# ---------------------------------------------------------------------------

@router.post("/content/transform")
async def transform_content(
    project_id: str,
    body: TransformRequest,
    user: CurrentUser,
):
    """Transform one piece of content into platform-native versions for all target platforms."""
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    try:
        result = await content_ops_service.transform_to_all_platforms(
            body.content, body.target_platforms, brand_core
        )
        return result
    except Exception as exc:
        logger.error("Content transform failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------

@router.post("/calendar/generate")
async def generate_calendar(
    project_id: str,
    body: CalendarGenerateRequest,
    user: CurrentUser,
):
    """AI-generate a full content calendar and save entries to Firestore."""
    project = get_project_as_editor(project_id, user["uid"])
    brand_core = project.get("brandCore") or {}

    try:
        result = await content_ops_service.generate_calendar(
            project_name=project.get("name", ""),
            brand_core=brand_core,
            platforms=body.platforms,
            period=body.period,
            goals=body.goals,
            posts_per_week=body.posts_per_week,
        )

        # Persist all generated entries to Firestore
        entries = result.get("entries", [])
        saved = []
        for entry in entries:
            saved_entry = await asyncio.to_thread(
                firebase_service.save_calendar_entry, project_id, entry
            )
            saved.append(saved_entry)

        return {"entries": saved, "count": len(saved)}

    except Exception as exc:
        logger.error("Calendar generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/calendar")
async def get_calendar(
    project_id: str,
    user: CurrentUser,
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
):
    """Return calendar entries for the project, optionally filtered by date range."""
    get_project_as_member(project_id, user["uid"])
    entries = await asyncio.to_thread(
        firebase_service.list_calendar_entries, project_id, from_date, to_date
    )
    return {"entries": entries}


@router.post("/calendar/entries")
async def create_calendar_entry(
    project_id: str,
    body: CalendarEntryCreate,
    user: CurrentUser,
):
    """Manually add an entry to the calendar."""
    get_project_as_editor(project_id, user["uid"])
    entry = await asyncio.to_thread(
        firebase_service.save_calendar_entry, project_id, body.model_dump(exclude_none=True)
    )
    return entry


@router.patch("/calendar/entries/{entry_id}")
async def update_calendar_entry(
    project_id: str,
    entry_id: str,
    body: CalendarEntryUpdate,
    user: CurrentUser,
):
    """Update a calendar entry."""
    get_project_as_editor(project_id, user["uid"])
    entry = await asyncio.to_thread(
        firebase_service.update_calendar_entry,
        project_id, entry_id, body.model_dump(exclude_none=True),
    )
    return entry


@router.delete("/calendar/entries/{entry_id}", status_code=204)
async def delete_calendar_entry(
    project_id: str,
    entry_id: str,
    user: CurrentUser,
):
    """Delete a calendar entry."""
    get_project_as_editor(project_id, user["uid"])
    await asyncio.to_thread(firebase_service.delete_calendar_entry, project_id, entry_id)


# ---------------------------------------------------------------------------
# Bulk schedule library items to calendar
# ---------------------------------------------------------------------------

class BulkScheduleBody(BaseModel):
    item_ids: list[str]
    start_date: str  # YYYY-MM-DD - first date, one post/day


@router.post("/content-library/bulk-schedule")
async def bulk_schedule(
    project_id: str,
    body: BulkScheduleBody,
    user: CurrentUser,
):
    """Schedule multiple library items to the calendar, starting from start_date, 1 per day."""
    from datetime import datetime, timedelta
    get_project_as_editor(project_id, user["uid"])

    try:
        start = datetime.strptime(body.start_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="start_date must be YYYY-MM-DD")

    scheduled = 0
    errors = 0
    for i, item_id in enumerate(body.item_ids):
        try:
            item = await asyncio.to_thread(
                firebase_service.get_content_library_item, project_id, item_id
            )
            if not item:
                errors += 1
                continue
            date_str = (start + timedelta(days=i)).strftime("%Y-%m-%d")
            await asyncio.to_thread(firebase_service.save_calendar_entry, project_id, {
                "date": date_str,
                "platform": item.get("platform", "Instagram"),
                "content": item.get("content", ""),
                "hashtags": item.get("hashtags", []),
                "type": item.get("type", "caption"),
                "status": "scheduled",
                "libraryItemId": item_id,
            })
            await asyncio.to_thread(
                firebase_service.update_content_library_item,
                project_id, item_id, {"status": "scheduled", "scheduledAt": date_str}
            )
            scheduled += 1
        except Exception as exc:
            logging.warning("bulk_schedule: failed for item %s: %s", item_id, exc)
            errors += 1

    return {"scheduled": scheduled, "errors": errors}


# ---------------------------------------------------------------------------
# Project Analytics Dashboard
# ---------------------------------------------------------------------------

@router.get("/analytics")
async def get_analytics(
    project_id: str,
    user: CurrentUser,
):
    """Return aggregate analytics for the project dashboard."""
    get_project_as_member(project_id, user["uid"])
    data = await asyncio.to_thread(firebase_service.get_project_analytics, project_id)
    return data


# ---------------------------------------------------------------------------
# Content Performance Tracking
# ---------------------------------------------------------------------------

class PerformanceRecord(BaseModel):
    likes: Optional[int] = None
    comments: Optional[int] = None
    shares: Optional[int] = None
    reach: Optional[int] = None
    saves: Optional[int] = None
    engagement_rate: Optional[float] = None
    notes: Optional[str] = Field(None, max_length=500)
    platform_post_id: Optional[str] = Field(None, max_length=200)


@router.post("/content-library/{item_id}/performance")
async def record_performance(
    project_id: str,
    item_id: str,
    body: PerformanceRecord,
    user: CurrentUser,
):
    """
    Log real-world performance data for a posted content item.
    Automatically marks the item as 'posted' and saves metrics.
    High-performing items (engagement_rate > 3%) are auto-saved as positive brand memory.
    """
    get_project_as_member(project_id, user["uid"])

    record = await asyncio.to_thread(
        firebase_service.save_performance_record,
        project_id, item_id, body.model_dump(exclude_none=True),
    )

    # Auto-save to brand memory if engagement rate is strong
    er = body.engagement_rate or 0
    if er >= 3.0:
        try:
            item_doc = await asyncio.to_thread(
                firebase_service.update_content_library_item, project_id, item_id, {}
            )
            content_preview = (item_doc.get("content") or "")[:300]
            platform = item_doc.get("platform", "unknown")
            memory_data = {
                "type": "approve",
                "original": content_preview,
                "context": f"High performer on {platform} - {er:.1f}% engagement rate",
                "platform": platform,
                "userId": user["uid"],
            }
            await asyncio.to_thread(firebase_service.save_memory_feedback, project_id, memory_data)
        except Exception as exc:
            logger.warning("Failed to auto-save performance memory: %s", exc)

    return record


# ---------------------------------------------------------------------------
# Approval Workflow (Phase 6)
# ---------------------------------------------------------------------------

class SubmitReviewRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class ReviewDecisionRequest(BaseModel):
    decision: str = Field(..., pattern="^(approved|rejected|changes_requested)$")
    note: Optional[str] = Field(None, max_length=500)


@router.post("/content-library/{item_id}/submit-review")
async def submit_for_review(
    project_id: str,
    item_id: str,
    body: SubmitReviewRequest,
    user: CurrentUser,
):
    """Submit a content library item for team review (changes status to in_review)."""
    get_project_as_editor(project_id, user["uid"])
    try:
        item = await asyncio.to_thread(
            firebase_service.submit_for_review,
            project_id, item_id, user["uid"], body.note or "",
        )
        return item
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/content-library/{item_id}/review")
async def record_review(
    project_id: str,
    item_id: str,
    body: ReviewDecisionRequest,
    user: CurrentUser,
):
    """Record an approve / reject / changes_requested decision on an item."""
    get_project_as_editor(project_id, user["uid"])
    try:
        item = await asyncio.to_thread(
            firebase_service.record_review_decision,
            project_id, item_id, body.decision, user["uid"], body.note or "",
        )
        return item
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/review-queue")
async def get_review_queue(
    project_id: str,
    user: CurrentUser,
):
    """Return all content library items currently in review."""
    get_project_as_member(project_id, user["uid"])
    items = await asyncio.to_thread(firebase_service.list_review_queue, project_id)
    return {"items": items, "count": len(items)}


@router.get("/content-library/{item_id}/review-history")
async def get_review_history(
    project_id: str,
    item_id: str,
    user: CurrentUser,
):
    """Return the review history for a single library item."""
    get_project_as_member(project_id, user["uid"])
    history = await asyncio.to_thread(
        firebase_service.get_review_history, project_id, item_id
    )
    return {"history": history}


# ---------------------------------------------------------------------------
# Publishing Queue
# ---------------------------------------------------------------------------

@router.get("/publish-queue")
async def get_publish_queue(
    project_id: str,
    user: CurrentUser,
):
    """
    Return calendar entries for today and the next 7 days, grouped by day,
    with content formatted ready for copy-paste publishing.
    """
    get_project_as_member(project_id, user["uid"])

    from datetime import date, timedelta
    today = date.today().isoformat()
    end = (date.today() + timedelta(days=7)).isoformat()

    entries = await asyncio.to_thread(
        firebase_service.list_calendar_entries, project_id, today, end
    )

    # Group by date
    groups: dict[str, list] = {}
    for entry in entries:
        d = entry.get("date", "")
        if d not in groups:
            groups[d] = []
        groups[d].append(entry)

    days = []
    for i in range(8):
        d = (date.today() + timedelta(days=i)).isoformat()
        days.append({
            "date": d,
            "label": "Today" if i == 0 else "Tomorrow" if i == 1 else d,
            "entries": groups.get(d, []),
        })

    return {"days": days, "total": len(entries)}
