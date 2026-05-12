"""
Brand ingestion route - streams real-time progress over SSE while the
pipeline scrapes and analyses brand content.

Flow:
  1. Client POSTs social link fields to /projects/{id}/ingest
  2. Server merges request fields with stored project social links (request wins).
  3. Response is a streaming SSE connection that emits step/progress/done/error events.
  4. On receiving a 'done' event the client updates its local brand core state.

SSE event shapes (JSON inside `data: ...` lines):
  { "type": "step",     "label": "...", "status": "running|done|error|skipped", "detail": "..." }
  { "type": "progress", "pct": 0-100 }
  { "type": "done",     "brandCore": { ... } }
  { "type": "error",    "message": "..." }
"""

import json
import logging
from typing import AsyncIterator, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from backend.api.deps import get_project_or_404, assert_editor
from backend.middleware.auth import CurrentUser
from backend.services.ingestion import pipeline
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["ingestion"])


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

def _normalise_url(v: Optional[str]) -> Optional[str]:
    """Strip whitespace; prepend https:// if the user omits the scheme."""
    if not v:
        return None
    v = v.strip()
    if v and not v.startswith(("http://", "https://")):
        v = "https://" + v
    return v or None


class IngestRequest(BaseModel):
    websiteUrl: Optional[str] = None
    instagramHandle: Optional[str] = None
    facebookUrl: Optional[str] = None
    tiktokUrl: Optional[str] = None
    linkedinUrl: Optional[str] = None
    xUrl: Optional[str] = None
    youtubeUrl: Optional[str] = None
    threadsUrl: Optional[str] = None

    @field_validator("websiteUrl", "facebookUrl", "tiktokUrl", "linkedinUrl", "xUrl", "youtubeUrl", "threadsUrl", mode="before")
    @classmethod
    def normalise_url(cls, v: Optional[str]) -> Optional[str]:
        return _normalise_url(v)

    @field_validator("instagramHandle", mode="before")
    @classmethod
    def normalise_handle(cls, v: Optional[str]) -> Optional[str]:
        """Strip leading @, whitespace, and trailing slashes."""
        if v is None:
            return v
        return v.strip().lstrip("@").rstrip("/") or None


# ---------------------------------------------------------------------------
# SSE helper
# ---------------------------------------------------------------------------

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("/{project_id}/ingest")
async def ingest_brand(
    project_id: str,
    body: IngestRequest,
    user: CurrentUser,
) -> StreamingResponse:
    """
    Start brand ingestion for a project. Returns an SSE stream.
    Requires editor or admin role.

    Request fields override stored project social links. If a field is omitted,
    the value stored on the project document is used as a fallback so the client
    doesn't have to re-send every link each time.
    """
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])

    import asyncio
    await asyncio.to_thread(check_and_deduct, user["uid"], "brand_ingestion")

    # Merge: explicit request values override stored project values
    def _pick(request_val: Optional[str], project_key: str) -> Optional[str]:
        return request_val or _normalise_url(project.get(project_key)) or None

    def _pick_handle(request_val: Optional[str], project_key: str) -> Optional[str]:
        stored = project.get(project_key, "")
        if stored:
            # stored value may be a full URL - extract the handle
            stored = stored.rstrip("/").split("/")[-1].lstrip("@")
        return request_val or stored or None

    website_url      = _pick(body.websiteUrl,     "websiteUrl")
    instagram_handle = _pick_handle(body.instagramHandle, "instagramUrl")
    facebook_url     = _pick(body.facebookUrl,    "facebookUrl")
    tiktok_url       = _pick(body.tiktokUrl,      "tiktokUrl")
    linkedin_url     = _pick(body.linkedinUrl,    "linkedinUrl")
    x_url            = _pick(body.xUrl,           "xUrl")
    youtube_url      = _pick(body.youtubeUrl,     "youtubeUrl")
    threads_url      = _pick(body.threadsUrl,     "threadsUrl")

    has_any = any([website_url, instagram_handle, facebook_url, tiktok_url, linkedin_url, x_url, youtube_url, threads_url])
    if not has_any:
        raise HTTPException(
            status_code=422,
            detail="Provide at least one social link or store one on the project.",
        )

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in pipeline.run(
                project_id=project_id,
                website_url=website_url,
                instagram_handle=instagram_handle,
                facebook_url=facebook_url,
                tiktok_url=tiktok_url,
                linkedin_url=linkedin_url,
                x_url=x_url,
                youtube_url=youtube_url,
                threads_url=threads_url,
            ):
                yield _sse(event)
        except Exception as exc:
            logger.exception("Ingestion stream error for project %s: %s", project_id, exc)
            yield _sse({"type": "error", "message": str(exc)})
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
