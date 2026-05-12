"""
Apify client - scrapes social media profiles via Apify actors.

Supported platforms:
  - Instagram  (apify/instagram-scraper)
  - Facebook   (apify/facebook-pages-scraper)
  - TikTok     (clockworks/tiktok-scraper)
  - LinkedIn   (voyager/linkedin-company-scraper)
  - X/Twitter  (quacker/twitter-scraper)
  - YouTube    (streamers/youtube-scraper)

All functions are async, return a normalised dict with a 'source_type' key
so brand_extractor._build_combined_content() can label each section correctly.
"""

import asyncio
import logging
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

APIFY_BASE = "https://api.apify.com/v2"

# Actor IDs per platform
INSTAGRAM_ACTOR = "apify/instagram-scraper"
FACEBOOK_ACTOR  = "apify/facebook-pages-scraper"
TIKTOK_ACTOR    = "clockworks/tiktok-scraper"
LINKEDIN_ACTOR  = "voyager/linkedin-company-scraper"
X_ACTOR         = "quacker/twitter-scraper"
YOUTUBE_ACTOR   = "streamers/youtube-scraper"
THREADS_ACTOR   = "apidojo/threads-scraper"


# ---------------------------------------------------------------------------
# Shared Apify runner
# ---------------------------------------------------------------------------

async def _run_actor(actor: str, run_input: dict, api_key: str, timeout: int = 90) -> list[dict]:
    """
    Run an Apify actor synchronously and return its dataset items.
    Raises httpx.HTTPStatusError on non-2xx responses.
    """
    async with httpx.AsyncClient(timeout=timeout + 30) as client:
        resp = await client.post(
            f"{APIFY_BASE}/acts/{actor}/run-sync-get-dataset-items",
            params={"token": api_key, "timeout": timeout, "memory": 256},
            json=run_input,
        )
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Instagram
# ---------------------------------------------------------------------------

async def scrape_instagram(handle: str, api_key: str, max_posts: int = 30) -> dict:
    """
    Scrape an Instagram profile using the instagram-scraper actor.
    Returns profile info, posts, and joined captions for LLM analysis.
    """
    clean_handle = handle.lstrip("@").strip("/").split("/")[-1]
    logger.info("Apify: scraping Instagram @%s (max %d posts)", clean_handle, max_posts)

    run_input = {
        "directUrls": [f"https://www.instagram.com/{clean_handle}/"],
        "resultsType": "posts",
        "resultsLimit": max_posts,
        "addParentData": True,
    }

    items = await _run_actor(INSTAGRAM_ACTOR, run_input, api_key)

    if not items:
        logger.warning("Apify: 0 items for Instagram @%s", clean_handle)
        return _empty("instagram", handle=clean_handle)

    first = items[0]
    profile = {
        "username": clean_handle,
        "full_name": first.get("ownerFullName", ""),
        "biography": first.get("biography", ""),
        "followers": first.get("followersCount", 0),
        "following": first.get("followingCount", 0),
        "website": first.get("externalUrl", ""),
        "category": first.get("businessCategoryName", ""),
        "profile_pic_url": first.get("profilePicUrl", ""),
    }

    posts = [
        {
            "caption": item.get("caption", "") or "",
            "hashtags": item.get("hashtags", []),
            "likes": item.get("likesCount", 0),
            "comments": item.get("commentsCount", 0),
            "timestamp": item.get("timestamp", ""),
            "image_url": item.get("displayUrl", ""),
            "type": item.get("type", ""),
        }
        for item in items
    ]

    raw_captions = "\n\n---\n\n".join(p["caption"] for p in posts if p["caption"])

    return {
        "source_type": "instagram",
        "handle": clean_handle,
        "profile": profile,
        "posts": posts,
        "raw_captions": raw_captions,
    }


# ---------------------------------------------------------------------------
# Facebook
# ---------------------------------------------------------------------------

async def scrape_facebook(page_url: str, api_key: str) -> dict:
    """
    Scrape a Facebook Page using the facebook-pages-scraper actor.
    Returns page info, recent posts, and joined post text.
    """
    logger.info("Apify: scraping Facebook page %s", page_url)

    run_input = {
        "startUrls": [{"url": page_url}],
        "maxPosts": 20,
        "maxReviews": 0,
        "maxPostComments": 0,
    }

    try:
        items = await _run_actor(FACEBOOK_ACTOR, run_input, api_key)
    except Exception as exc:
        logger.warning("Facebook scrape failed for %s: %s", page_url, exc)
        return _empty("facebook", url=page_url)

    if not items:
        return _empty("facebook", url=page_url)

    page = items[0] if items else {}
    posts_raw = page.get("posts", []) or []

    posts = [
        {
            "text": p.get("text", "") or "",
            "likes": p.get("likes", 0),
            "comments": p.get("comments", 0),
            "timestamp": p.get("time", ""),
        }
        for p in posts_raw[:20]
    ]

    raw_text = "\n\n---\n\n".join(p["text"] for p in posts if p["text"])

    return {
        "source_type": "facebook",
        "url": page_url,
        "name": page.get("title", "") or page.get("name", ""),
        "about": page.get("about", "") or page.get("description", ""),
        "likes": page.get("likes", 0),
        "category": page.get("categories", []),
        "posts": posts,
        "raw_text": raw_text,
    }


# ---------------------------------------------------------------------------
# TikTok
# ---------------------------------------------------------------------------

async def scrape_tiktok(profile_url: str, api_key: str, max_videos: int = 20) -> dict:
    """
    Scrape a TikTok profile using the tiktok-scraper actor.
    Returns profile info, video descriptions, and hashtags.
    """
    logger.info("Apify: scraping TikTok %s", profile_url)

    run_input = {
        "profiles": [profile_url],
        "resultsPerPage": max_videos,
        "proxyConfiguration": {"useApifyProxy": True},
    }

    try:
        items = await _run_actor(TIKTOK_ACTOR, run_input, api_key)
    except Exception as exc:
        logger.warning("TikTok scrape failed for %s: %s", profile_url, exc)
        return _empty("tiktok", url=profile_url)

    if not items:
        return _empty("tiktok", url=profile_url)

    videos = [
        {
            "description": item.get("text", "") or "",
            "hashtags": [tag.get("name", "") for tag in (item.get("hashtags") or [])],
            "plays": item.get("playCount", 0),
            "likes": item.get("diggCount", 0),
            "shares": item.get("shareCount", 0),
        }
        for item in items
    ]

    raw_text = "\n\n---\n\n".join(v["description"] for v in videos if v["description"])
    all_hashtags = list({tag for v in videos for tag in v["hashtags"]})

    first = items[0] if items else {}
    return {
        "source_type": "tiktok",
        "url": profile_url,
        "author": first.get("authorMeta", {}).get("name", ""),
        "bio": first.get("authorMeta", {}).get("signature", ""),
        "followers": first.get("authorMeta", {}).get("fans", 0),
        "videos": videos,
        "raw_text": raw_text,
        "top_hashtags": all_hashtags[:20],
    }


# ---------------------------------------------------------------------------
# LinkedIn
# ---------------------------------------------------------------------------

async def scrape_linkedin(company_url: str, api_key: str) -> dict:
    """
    Scrape a LinkedIn Company page using the linkedin-company-scraper actor.
    Returns company info and recent posts.
    """
    logger.info("Apify: scraping LinkedIn %s", company_url)

    run_input = {
        "startUrls": [{"url": company_url}],
        "count": 20,
    }

    try:
        items = await _run_actor(LINKEDIN_ACTOR, run_input, api_key)
    except Exception as exc:
        logger.warning("LinkedIn scrape failed for %s: %s", company_url, exc)
        return _empty("linkedin", url=company_url)

    if not items:
        return _empty("linkedin", url=company_url)

    company = items[0] if items else {}
    posts_raw = company.get("posts", []) or []

    posts = [
        {
            "text": p.get("text", "") or p.get("commentary", "") or "",
            "likes": p.get("numLikes", 0),
            "comments": p.get("numComments", 0),
        }
        for p in posts_raw[:20]
    ]

    raw_text = "\n\n---\n\n".join(p["text"] for p in posts if p["text"])

    return {
        "source_type": "linkedin",
        "url": company_url,
        "name": company.get("name", ""),
        "tagline": company.get("tagline", "") or company.get("headline", ""),
        "description": company.get("description", ""),
        "industry": company.get("industry", ""),
        "followers": company.get("followersCount", 0),
        "employees": company.get("staffCount", 0),
        "posts": posts,
        "raw_text": raw_text,
    }


# ---------------------------------------------------------------------------
# X / Twitter
# ---------------------------------------------------------------------------

async def scrape_x(profile_url: str, api_key: str, max_tweets: int = 30) -> dict:
    """
    Scrape an X/Twitter profile using the twitter-scraper actor.
    Returns profile info, tweets, and joined tweet text.
    """
    logger.info("Apify: scraping X/Twitter %s", profile_url)

    run_input = {
        "startUrls": [{"url": profile_url}],
        "maxTweets": max_tweets,
        "addUserInfo": True,
    }

    try:
        items = await _run_actor(X_ACTOR, run_input, api_key)
    except Exception as exc:
        logger.warning("X/Twitter scrape failed for %s: %s", profile_url, exc)
        return _empty("x", url=profile_url)

    if not items:
        return _empty("x", url=profile_url)

    tweets = [
        {
            "text": item.get("full_text", "") or item.get("text", "") or "",
            "likes": item.get("favorite_count", 0),
            "retweets": item.get("retweet_count", 0),
            "timestamp": item.get("created_at", ""),
        }
        for item in items
        if not item.get("in_reply_to_status_id")  # skip replies
    ]

    raw_text = "\n\n---\n\n".join(t["text"] for t in tweets if t["text"])

    user = (items[0].get("user") or {}) if items else {}
    return {
        "source_type": "x",
        "url": profile_url,
        "username": user.get("screen_name", ""),
        "display_name": user.get("name", ""),
        "bio": user.get("description", ""),
        "followers": user.get("followers_count", 0),
        "tweets": tweets,
        "raw_text": raw_text,
    }


# ---------------------------------------------------------------------------
# YouTube
# ---------------------------------------------------------------------------

async def scrape_youtube(channel_url: str, api_key: str, max_videos: int = 20) -> dict:
    """
    Scrape a YouTube channel using the youtube-scraper actor.
    Returns channel info, video titles, descriptions, and joined text.
    """
    logger.info("Apify: scraping YouTube %s", channel_url)

    run_input = {
        "startUrls": [{"url": channel_url}],
        "maxResults": max_videos,
    }

    try:
        items = await _run_actor(YOUTUBE_ACTOR, run_input, api_key)
    except Exception as exc:
        logger.warning("YouTube scrape failed for %s: %s", channel_url, exc)
        return _empty("youtube", url=channel_url)

    if not items:
        return _empty("youtube", url=channel_url)

    videos = [
        {
            "title": item.get("title", ""),
            "description": (item.get("description", "") or "")[:500],
            "views": item.get("viewCount", 0),
            "likes": item.get("likes", 0),
            "duration": item.get("duration", ""),
        }
        for item in items
    ]

    channel = items[0] if items else {}
    raw_text = "\n\n---\n\n".join(
        f"{v['title']}\n{v['description']}" for v in videos if v["title"]
    )

    return {
        "source_type": "youtube",
        "url": channel_url,
        "channel_name": channel.get("channelName", "") or channel.get("author", ""),
        "description": channel.get("channelDescription", ""),
        "subscribers": channel.get("numberOfSubscribers", 0),
        "videos": videos,
        "raw_text": raw_text,
    }


# ---------------------------------------------------------------------------
# Threads
# ---------------------------------------------------------------------------

async def scrape_threads(profile_url: str, api_key: str, max_posts: int = 20) -> dict:
    """
    Scrape a public Threads profile using the apidojo/threads-scraper actor.
    Returns profile info, recent posts, and joined captions for brand analysis.
    Used for competitor intelligence (no OAuth needed for public profiles).
    """
    logger.info("Apify: scraping Threads %s", profile_url)

    # Normalise: accept @handle or full URL
    if not profile_url.startswith("http"):
        handle = profile_url.lstrip("@")
        profile_url = f"https://www.threads.net/@{handle}"

    run_input = {
        "startUrls": [{"url": profile_url}],
        "maxPosts": max_posts,
        "proxyConfiguration": {"useApifyProxy": True},
    }

    try:
        items = await _run_actor(THREADS_ACTOR, run_input, api_key, timeout=60)
    except Exception as exc:
        logger.warning("Threads scrape failed for %s: %s", profile_url, exc)
        return _empty("threads", url=profile_url)

    if not items:
        return _empty("threads", url=profile_url)

    posts = [
        {
            "text": item.get("text", "") or "",
            "likes": item.get("likeCount", 0),
            "replies": item.get("replyCount", 0),
            "reposts": item.get("repostCount", 0),
            "timestamp": item.get("timestamp", ""),
        }
        for item in items
    ]

    raw_text = "\n\n---\n\n".join(p["text"] for p in posts if p["text"])

    first = items[0] if items else {}
    author = first.get("author") or {}

    return {
        "source_type": "threads",
        "url": profile_url,
        "username": author.get("username", ""),
        "display_name": author.get("fullName", ""),
        "bio": author.get("bio", ""),
        "followers": author.get("followerCount", 0),
        "posts": posts,
        "raw_text": raw_text,
    }


# ---------------------------------------------------------------------------
# Fallback empty result
# ---------------------------------------------------------------------------

def _empty(source_type: str, **kwargs) -> dict:
    """Return a minimal valid result when scraping yields nothing."""
    return {
        "source_type": source_type,
        "raw_text": "",
        "posts": [],
        **kwargs,
    }
