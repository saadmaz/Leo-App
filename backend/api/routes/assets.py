"""
Assets route - handles project asset uploads (logo, etc.).

Logos are stored as base64 data URLs directly in Firestore, consistent with
how generated images are handled throughout the codebase. If Cloudflare R2
is configured via environment variables, uploads are routed there instead.

Endpoints:
  POST /projects/{project_id}/assets/logo
    Accepts multipart/form-data with a 'file' field (image/*).
    Returns: { "url": "data:image/...;base64,..." }
"""

import base64
import logging
import uuid

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, HTTPException, UploadFile, File

from backend.api.deps import get_project_or_404, assert_editor
from backend.config import settings
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["assets"])

_ALLOWED_MIME_PREFIXES = ("image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/svg+xml")
_ALLOWED_MEDIA_PREFIXES = ("image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "video/mp4", "video/quicktime", "video/webm")
_MAX_LOGO_BYTES = 5 * 1024 * 1024   # 5 MB
_MAX_MEDIA_BYTES = 50 * 1024 * 1024  # 50 MB


def _get_r2_client():
    """Return a boto3 S3 client configured for Cloudflare R2, or None if unconfigured."""
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


@router.post("/{project_id}/assets/logo")
async def upload_logo(
    project_id: str,
    user: CurrentUser,
    file: UploadFile = File(...),
) -> dict:
    try:
        project = get_project_or_404(project_id)
        assert_editor(project, user["uid"])
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Project fetch failed for %s: %s", project_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load project.") from exc

    content_type = (file.content_type or "").lower()
    if not any(content_type.startswith(p) for p in _ALLOWED_MIME_PREFIXES):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}'. Upload a PNG, JPEG, GIF, WebP, or SVG.",
        )

    data = await file.read()
    if len(data) > _MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo must be ≤ 5 MB.")

    # --- Upload path: R2 if configured, auto-fallback to base64 on any failure ---
    logo_url: str | None = None

    r2 = None
    try:
        r2 = _get_r2_client()
    except Exception as exc:
        logger.warning("R2 client init failed, falling back to base64: %s", exc)

    if r2 is not None:
        _ext_map = {
            "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
            "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
        }
        ext = _ext_map.get(content_type, "png")
        object_key = f"logos/{project_id}/{uuid.uuid4().hex}.{ext}"
        bucket = settings.CLOUDFLARE_R2_BUCKET_NAME
        try:
            r2.put_object(
                Bucket=bucket,
                Key=object_key,
                Body=data,
                ContentType=content_type,
                CacheControl="public, max-age=31536000",
            )
            public_base = settings.CLOUDFLARE_R2_PUBLIC_URL
            if public_base:
                logo_url = f"{public_base.rstrip('/')}/{object_key}"
            else:
                logger.warning("CLOUDFLARE_R2_PUBLIC_URL not set - falling back to base64 for project %s", project_id)
        except Exception as exc:
            logger.error("R2 upload failed for project %s (%s), falling back to base64: %s", project_id, type(exc).__name__, exc, exc_info=True)

    if logo_url is None:
        # Fallback: store as base64 data URL directly in Firestore
        b64 = base64.b64encode(data).decode("utf-8")
        logo_url = f"data:{content_type};base64,{b64}"
        logger.info("Storing logo as base64 data URL for project %s", project_id)

    try:
        firebase_service.update_project(project_id, {"logoUrl": logo_url})
    except Exception as exc:
        logger.error("Firestore update failed for project %s logo: %s", project_id, exc, exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to save logo URL to project.") from exc

    logger.info("Logo saved for project %s", project_id)
    return {"url": logo_url}


@router.post("/{project_id}/assets/media")
async def upload_media(
    project_id: str,
    user: CurrentUser,
    file: UploadFile = File(...),
) -> dict:
    """Upload a media file (image or video) for a calendar entry. Returns { url, content_type }."""
    try:
        project = get_project_or_404(project_id)
        assert_editor(project, user["uid"])
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Project fetch failed for %s: %s", project_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load project.") from exc

    content_type = (file.content_type or "").lower()
    if not any(content_type.startswith(p) for p in _ALLOWED_MEDIA_PREFIXES):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}'. Upload an image (PNG, JPEG, GIF, WebP) or video (MP4, MOV, WebM).",
        )

    data = await file.read()
    if len(data) > _MAX_MEDIA_BYTES:
        raise HTTPException(status_code=413, detail="File must be ≤ 50 MB.")

    media_url: str | None = None

    r2 = None
    try:
        r2 = _get_r2_client()
    except Exception as exc:
        logger.warning("R2 client init failed, falling back to base64: %s", exc)

    if r2 is not None:
        _ext_map = {
            "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
            "image/gif": "gif", "image/webp": "webp",
            "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
        }
        ext = _ext_map.get(content_type, "bin")
        object_key = f"media/{project_id}/{uuid.uuid4().hex}.{ext}"
        bucket = settings.CLOUDFLARE_R2_BUCKET_NAME
        try:
            r2.put_object(
                Bucket=bucket,
                Key=object_key,
                Body=data,
                ContentType=content_type,
                CacheControl="public, max-age=31536000",
            )
            public_base = settings.CLOUDFLARE_R2_PUBLIC_URL
            if public_base:
                media_url = f"{public_base.rstrip('/')}/{object_key}"
            else:
                logger.warning("CLOUDFLARE_R2_PUBLIC_URL not set - falling back to base64 for project %s", project_id)
        except Exception as exc:
            logger.error("R2 upload failed for project %s: %s", project_id, exc, exc_info=True)

    if media_url is None:
        # Videos must not fall back to base64 - they would exceed Firestore's 1 MB document limit.
        if content_type.startswith("video/"):
            raise HTTPException(
                status_code=422,
                detail=(
                    "Video upload requires Cloudflare R2 storage to be configured. "
                    "Please set CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, "
                    "CLOUDFLARE_R2_ENDPOINT, CLOUDFLARE_R2_BUCKET_NAME, and CLOUDFLARE_R2_PUBLIC_URL."
                ),
            )
        # Images: fall back to base64 (safe for files up to ~700 KB)
        b64 = base64.b64encode(data).decode("utf-8")
        media_url = f"data:{content_type};base64,{b64}"
        logger.info("Storing media as base64 data URL for project %s", project_id)

    return {"url": media_url, "content_type": content_type}
