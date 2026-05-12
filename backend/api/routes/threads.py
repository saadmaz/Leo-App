"""
Threads integration routes.

OAuth flow:
  GET  /auth/threads/connect            → returns { auth_url } for redirect
  GET  /auth/threads/callback           → exchanges code, stores token, redirects to frontend
  GET  /auth/threads/status             → { connected: bool, username?, expires_at? }
  POST /auth/threads/disconnect         → deletes stored token

Per-project publishing:
  POST /projects/{project_id}/publish/threads   → publish a post (text / image / carousel)
  GET  /projects/{project_id}/threads/profile   → return connected user's Threads profile
"""

import logging
import secrets
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel

from backend.config import settings
from backend.middleware.auth import CurrentUser
from backend.api.deps import get_project_or_404, assert_editor
from backend.services import firebase_service
from backend.services.integrations import threads_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["threads"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_REDIRECT_URI_PATH = "/auth/threads/callback"


def _redirect_uri() -> str:
    """Build the absolute redirect URI from FRONTEND_URL (or API_URL if set)."""
    base = getattr(settings, "API_URL", None) or settings.FRONTEND_URL
    base = base.rstrip("/")
    # The callback lives on the *backend* - use the backend base URL.
    # If API_URL is not set we fall back to constructing from FRONTEND_URL by
    # replacing port 3000 → 8000; this works for local dev.
    if "3000" in base and not getattr(settings, "API_URL", None):
        base = base.replace("3000", "8000")
    return f"{base}{_REDIRECT_URI_PATH}"


def _check_threads_configured() -> None:
    if not settings.THREADS_APP_ID or not settings.THREADS_APP_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Threads integration is not configured (THREADS_APP_ID / THREADS_APP_SECRET missing).",
        )


# ---------------------------------------------------------------------------
# OAuth - connect
# ---------------------------------------------------------------------------

@router.get("/auth/threads/connect")
async def threads_connect(user: CurrentUser):
    """
    Return the Threads OAuth authorization URL.
    The frontend should redirect the user's browser to this URL.
    """
    _check_threads_configured()
    state = secrets.token_urlsafe(24)
    # Store state token in Firestore keyed by uid so callback can verify it.
    firebase_service.get_db().collection("oauth_states").document(state).set({
        "uid": user["uid"],
        "provider": "threads",
    })
    auth_url = threads_client.get_authorization_url(
        app_id=settings.THREADS_APP_ID,
        redirect_uri=_redirect_uri(),
        state=state,
    )
    return {"auth_url": auth_url}


@router.get("/auth/threads/callback")
async def threads_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    """
    OAuth callback - called by Threads after user authorises the app.
    Exchanges the code for a long-lived token and stores it in Firestore.
    Redirects the user back to the frontend settings page.
    """
    frontend_base = settings.FRONTEND_URL.rstrip("/")

    if error:
        logger.warning("Threads OAuth error: %s", error)
        return RedirectResponse(f"{frontend_base}/settings?threads_error={error}")

    if not code or not state:
        return RedirectResponse(f"{frontend_base}/settings?threads_error=missing_params")

    _check_threads_configured()

    # Verify state and retrieve uid
    state_doc = firebase_service.get_db().collection("oauth_states").document(state).get()
    if not state_doc.exists:
        return RedirectResponse(f"{frontend_base}/settings?threads_error=invalid_state")

    state_data = state_doc.to_dict()
    uid = state_data.get("uid")
    # Clean up state document
    state_doc.reference.delete()

    if not uid:
        return RedirectResponse(f"{frontend_base}/settings?threads_error=invalid_state")

    try:
        token_data = await threads_client.exchange_code_for_token(
            code=code,
            app_id=settings.THREADS_APP_ID,
            app_secret=settings.THREADS_APP_SECRET,
            redirect_uri=_redirect_uri(),
        )
    except Exception as exc:
        logger.error("Threads token exchange failed for uid %s: %s", uid, exc)
        return RedirectResponse(f"{frontend_base}/settings?threads_error=token_exchange_failed")

    firebase_service.save_threads_token(uid, token_data)
    logger.info("Threads token stored for uid %s", uid)

    return RedirectResponse(f"{frontend_base}/settings?threads_connected=1")


# ---------------------------------------------------------------------------
# OAuth - status / disconnect
# ---------------------------------------------------------------------------

@router.get("/auth/threads/status")
async def threads_status(user: CurrentUser):
    """Return whether the current user has a connected Threads account."""
    token = firebase_service.get_threads_token(user["uid"])
    if not token:
        return {"connected": False}
    return {
        "connected": True,
        "threads_user_id": token.get("threads_user_id"),
        "expires_at": token.get("expires_at"),
    }


@router.post("/auth/threads/disconnect")
async def threads_disconnect(user: CurrentUser):
    """Remove the stored Threads token (disconnect the account)."""
    firebase_service.delete_threads_token(user["uid"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/threads/profile")
async def threads_profile(project_id: str, user: CurrentUser):
    """Return the connected user's Threads profile."""
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])

    token = firebase_service.get_threads_token(user["uid"])
    if not token:
        raise HTTPException(status_code=401, detail="Threads account not connected.")

    try:
        profile = await threads_client.get_profile(
            access_token=token["access_token"],
            user_id=token.get("threads_user_id", "me"),
        )
        return profile
    except Exception as exc:
        logger.error("Failed to fetch Threads profile for uid %s: %s", user["uid"], exc)
        raise HTTPException(status_code=502, detail=f"Threads API error: {exc}")


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

class PublishThreadsRequest(BaseModel):
    text: str
    image_url: Optional[str] = None          # single image post
    carousel_items: Optional[list[dict]] = None  # [{ media_type, image_url }]


@router.post("/projects/{project_id}/publish/threads")
async def publish_to_threads(
    project_id: str,
    body: PublishThreadsRequest,
    user: CurrentUser,
):
    """
    Publish a post to the authenticated user's Threads account.
    Supports text-only, single image, and carousel posts.
    """
    project = get_project_or_404(project_id)
    assert_editor(project, user["uid"])

    token = firebase_service.get_threads_token(user["uid"])
    if not token:
        raise HTTPException(status_code=401, detail="Threads account not connected.")

    access_token = token["access_token"]
    threads_user_id = token.get("threads_user_id", "me")

    try:
        if body.carousel_items:
            result = await threads_client.publish_carousel_post(
                access_token=access_token,
                user_id=threads_user_id,
                items=body.carousel_items,
                text=body.text,
            )
        elif body.image_url:
            result = await threads_client.publish_image_post(
                access_token=access_token,
                user_id=threads_user_id,
                image_url=body.image_url,
                text=body.text,
            )
        else:
            result = await threads_client.publish_text_post(
                access_token=access_token,
                user_id=threads_user_id,
                text=body.text,
            )
    except Exception as exc:
        logger.error("Threads publish failed for project %s uid %s: %s", project_id, user["uid"], exc)
        raise HTTPException(status_code=502, detail=f"Threads publish failed: {exc}")

    logger.info("Published to Threads for project %s uid %s - id %s", project_id, user["uid"], result.get("id"))
    return {"ok": True, "thread_id": result.get("id")}
