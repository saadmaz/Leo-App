"""
Threads API client - Meta Threads Graph API v1.0

Covers:
  - OAuth: authorization URL generation, code → long-lived token exchange
  - Read: profile, recent posts (threads), post insights
  - Write: publish text posts, image posts, carousel posts (up to 20 items)

Threads uses the same Meta Graph API infrastructure as Facebook/Instagram.
Base URL: https://graph.threads.net/v1.0/

Token lifecycle:
  - Short-lived token (1h) from OAuth code exchange
  - Exchange for long-lived token (60 days) via /access_token endpoint
  - Store long-lived token per user in Firestore - refresh before expiry
"""

from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

THREADS_BASE = "https://graph.threads.net/v1.0"
THREADS_AUTH_BASE = "https://threads.net/oauth/authorize"
THREADS_TOKEN_URL = "https://graph.threads.net/oauth/access_token"
THREADS_LONG_LIVED_URL = "https://graph.threads.net/access_token"

# Scopes needed for full read + publish access
THREADS_SCOPES = [
    "threads_basic",
    "threads_content_publish",
    "threads_read_replies",
    "threads_manage_insights",
]


# ---------------------------------------------------------------------------
# OAuth helpers
# ---------------------------------------------------------------------------

def get_authorization_url(app_id: str, redirect_uri: str, state: str) -> str:
    """
    Build the Threads OAuth authorization URL.
    Redirect the user's browser here to begin the OAuth flow.
    """
    params = {
        "client_id": app_id,
        "redirect_uri": redirect_uri,
        "scope": ",".join(THREADS_SCOPES),
        "response_type": "code",
        "state": state,
    }
    return f"{THREADS_AUTH_BASE}?{urlencode(params)}"


async def exchange_code_for_token(
    code: str,
    app_id: str,
    app_secret: str,
    redirect_uri: str,
) -> dict:
    """
    Exchange an authorization code for a short-lived access token,
    then immediately upgrade it to a long-lived token (60 days).
    Returns: { access_token, token_type, expires_in, user_id }
    """
    async with httpx.AsyncClient(timeout=15) as client:
        # Step 1: short-lived token
        resp = await client.post(
            THREADS_TOKEN_URL,
            data={
                "client_id": app_id,
                "client_secret": app_secret,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )
        resp.raise_for_status()
        short = resp.json()
        short_token = short.get("access_token", "")

        # Step 2: exchange for long-lived token (60 days)
        ll_resp = await client.get(
            THREADS_LONG_LIVED_URL,
            params={
                "grant_type": "th_exchange_token",
                "client_secret": app_secret,
                "access_token": short_token,
            },
        )
        ll_resp.raise_for_status()
        long = ll_resp.json()

        return {
            "access_token": long.get("access_token", short_token),
            "token_type": long.get("token_type", "bearer"),
            "expires_in": long.get("expires_in", 5183944),  # ~60 days in seconds
            "user_id": short.get("user_id", ""),
        }


async def refresh_long_lived_token(access_token: str) -> dict:
    """
    Refresh a long-lived token before it expires.
    Call this when token age > 50 days.
    Returns: { access_token, token_type, expires_in }
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            THREADS_LONG_LIVED_URL,
            params={
                "grant_type": "th_refresh_token",
                "access_token": access_token,
            },
        )
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Read: Profile
# ---------------------------------------------------------------------------

async def get_profile(access_token: str, user_id: str = "me") -> dict:
    """
    Fetch Threads profile for the authenticated user.
    Returns: { id, username, name, threads_profile_picture_url, threads_biography, followers_count }
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{THREADS_BASE}/{user_id}",
            params={
                "fields": "id,username,name,threads_profile_picture_url,threads_biography,followers_count",
                "access_token": access_token,
            },
        )
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Read: Posts (threads)
# ---------------------------------------------------------------------------

async def get_threads(
    access_token: str,
    user_id: str = "me",
    limit: int = 25,
) -> list[dict]:
    """
    Fetch recent Threads posts for the authenticated user.
    Returns list of: { id, text, media_type, timestamp, permalink, like_count, reply_count, repost_count }
    """
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{THREADS_BASE}/{user_id}/threads",
            params={
                "fields": "id,text,media_type,timestamp,permalink,like_count,reply_count,repost_count,quote_count",
                "limit": min(limit, 100),
                "access_token": access_token,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])


async def get_thread_insights(access_token: str, thread_id: str) -> dict:
    """
    Fetch engagement metrics for a single thread post.
    Returns: { views, likes, replies, reposts, quotes }
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{THREADS_BASE}/{thread_id}/insights",
            params={
                "metric": "views,likes,replies,reposts,quotes",
                "access_token": access_token,
            },
        )
        resp.raise_for_status()
        raw = resp.json().get("data", [])
        return {item["name"]: item.get("values", [{}])[0].get("value", 0) for item in raw}


# ---------------------------------------------------------------------------
# Write: Publish posts
# ---------------------------------------------------------------------------

async def publish_text_post(
    access_token: str,
    user_id: str,
    text: str,
    reply_to_id: Optional[str] = None,
) -> dict:
    """
    Publish a plain-text Threads post.
    Returns: { id } of the published thread.

    Two-step process: create container → publish.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        # Step 1: Create media container
        payload: dict = {
            "media_type": "TEXT",
            "text": text,
            "access_token": access_token,
        }
        if reply_to_id:
            payload["reply_to_id"] = reply_to_id

        container_resp = await client.post(
            f"{THREADS_BASE}/{user_id}/threads",
            data=payload,
        )
        container_resp.raise_for_status()
        creation_id = container_resp.json()["id"]

        # Step 2: Publish
        pub_resp = await client.post(
            f"{THREADS_BASE}/{user_id}/threads_publish",
            data={
                "creation_id": creation_id,
                "access_token": access_token,
            },
        )
        pub_resp.raise_for_status()
        return pub_resp.json()


async def publish_image_post(
    access_token: str,
    user_id: str,
    image_url: str,
    text: str = "",
) -> dict:
    """
    Publish a single-image Threads post.
    image_url must be a publicly accessible URL (e.g. from R2).
    """
    async with httpx.AsyncClient(timeout=30) as client:
        container_resp = await client.post(
            f"{THREADS_BASE}/{user_id}/threads",
            data={
                "media_type": "IMAGE",
                "image_url": image_url,
                "text": text,
                "access_token": access_token,
            },
        )
        container_resp.raise_for_status()
        creation_id = container_resp.json()["id"]

        pub_resp = await client.post(
            f"{THREADS_BASE}/{user_id}/threads_publish",
            data={
                "creation_id": creation_id,
                "access_token": access_token,
            },
        )
        pub_resp.raise_for_status()
        return pub_resp.json()


async def publish_carousel_post(
    access_token: str,
    user_id: str,
    items: list[dict],
    text: str = "",
) -> dict:
    """
    Publish a carousel (up to 20 items) Threads post.
    Each item in `items` must have: { media_type: "IMAGE"|"VIDEO", image_url|video_url }

    Three-step process:
      1. Create item containers for each media item
      2. Create carousel container referencing item IDs
      3. Publish carousel
    """
    async with httpx.AsyncClient(timeout=60) as client:
        # Step 1: Create item containers
        item_ids = []
        for item in items[:20]:
            item_payload: dict = {
                "media_type": item.get("media_type", "IMAGE"),
                "is_carousel_item": "true",
                "access_token": access_token,
            }
            if item.get("image_url"):
                item_payload["image_url"] = item["image_url"]
            if item.get("video_url"):
                item_payload["video_url"] = item["video_url"]

            item_resp = await client.post(
                f"{THREADS_BASE}/{user_id}/threads",
                data=item_payload,
            )
            item_resp.raise_for_status()
            item_ids.append(item_resp.json()["id"])

        # Step 2: Create carousel container
        carousel_resp = await client.post(
            f"{THREADS_BASE}/{user_id}/threads",
            data={
                "media_type": "CAROUSEL",
                "children": ",".join(item_ids),
                "text": text,
                "access_token": access_token,
            },
        )
        carousel_resp.raise_for_status()
        creation_id = carousel_resp.json()["id"]

        # Step 3: Publish
        pub_resp = await client.post(
            f"{THREADS_BASE}/{user_id}/threads_publish",
            data={
                "creation_id": creation_id,
                "access_token": access_token,
            },
        )
        pub_resp.raise_for_status()
        return pub_resp.json()


# ---------------------------------------------------------------------------
# Scrape competitor profile (public, no auth required via oEmbed)
# ---------------------------------------------------------------------------

async def scrape_public_profile(username: str) -> dict:
    """
    Scrape a public Threads profile via oEmbed (no auth needed).
    Returns normalised dict with source_type='threads' for brand extractor.
    Limited - only gets the embed preview. Use Apify for full post history.
    """
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://www.threads.net/oembed/",
                params={"url": f"https://www.threads.net/@{username}"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "source_type": "threads",
                    "handle": username,
                    "author_name": data.get("author_name", ""),
                    "posts": [],
                    "raw_text": data.get("title", "") or data.get("html", ""),
                }
    except Exception as exc:
        logger.debug("Threads oEmbed failed for @%s: %s", username, exc)
    return {"source_type": "threads", "handle": username, "posts": [], "raw_text": ""}
