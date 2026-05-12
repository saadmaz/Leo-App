"""
Personal Brand Analytics Service.

Computes consistency scores and growth metrics from platform data,
and generates weekly briefs using Claude.

Collections written:
  personal_brand_analytics/{auto_id}  - per-platform snapshot
  personal_weekly_briefs/{project_id} - latest weekly brief
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Analytics snapshot
# ---------------------------------------------------------------------------

def take_snapshot(project_id: str, personal_core: dict) -> dict:
    """
    Capture an analytics snapshot for all configured platforms.
    Computes consistency score from posting cadence vs. planned cadence.
    Saves each platform as a document in personal_brand_analytics.
    Returns a summary dict with a generated snapshot ID.
    """
    from backend.services import firebase_service
    db = firebase_service.get_db()

    platform_strategy = personal_core.get("platformStrategy") or {}
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    snapshot_id = f"{project_id}_{now.strftime('%Y%m%d%H%M%S')}"
    snapshots = []

    for platform, config in platform_strategy.items():
        if not isinstance(config, dict):
            continue

        posts_per_week_planned = config.get("postsPerWeek", 3)

        # Attempt Apify scrape; fall back to zeros if unavailable
        scraped = _scrape_platform(platform, personal_core)

        posts_published = scraped.get("postsThisWeek", 0)
        followers = scraped.get("followers", 0)
        followers_prev = scraped.get("followersPrev", 0)

        consistency = _calc_consistency(posts_published, posts_per_week_planned)

        snap = {
            "projectId": project_id,
            "platform": platform,
            "snapshotDate": now_iso,
            "followers": followers,
            "followersDelta": followers - followers_prev,
            "postsThisWeek": posts_published,
            "postsPlanned": posts_per_week_planned,
            "avgEngagementRate": scraped.get("avgEngagementRate", 0.0),
            "consistencyScore": consistency,
            "topPostUrl": scraped.get("topPostUrl"),
            "topPostEngagement": scraped.get("topPostEngagement", 0),
            "profileViews": scraped.get("profileViews"),
            "createdAt": now_iso,
        }
        doc_ref = db.collection("personal_brand_analytics").document(f"{snapshot_id}_{platform}")
        doc_ref.set(snap)
        snapshots.append(snap)

    logger.info("Analytics snapshot taken for project %s: %d platforms", project_id, len(snapshots))
    return {"id": snapshot_id, "platforms": len(snapshots), "snapshots": snapshots}


def _calc_consistency(published: int, planned: int) -> int:
    if planned <= 0:
        return 100
    score = min(100, round((published / planned) * 100))
    return score


def _scrape_platform(platform: str, personal_core: dict) -> dict:
    """
    Attempt an Apify scrape for the given platform.
    Returns a dict of scraped metrics; falls back to empty metrics on failure.
    """
    try:
        from backend.config import settings
        if not settings.APIFY_API_KEY:
            return {}

        # Platform-specific Apify actor IDs
        actors = {
            "linkedin": "apify/linkedin-profile-scraper",
            "instagram": "apify/instagram-profile-scraper",
            "twitter": "apify/twitter-user-scraper",
        }
        actor = actors.get(platform.lower())
        if not actor:
            return {}

        # Run actor synchronously (short timeout)
        import httpx, time
        headers = {"Authorization": f"Bearer {settings.APIFY_API_KEY}"}

        run_resp = httpx.post(
            f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items",
            headers=headers,
            json={"maxItems": 1},
            timeout=20,
        )
        if run_resp.status_code != 200:
            return {}

        items = run_resp.json()
        if not items:
            return {}

        item = items[0]
        return {
            "followers": item.get("followersCount", 0),
            "followersPrev": item.get("followersCount", 0),  # delta requires historical data
            "postsThisWeek": item.get("postsCount", 0),
            "avgEngagementRate": item.get("engagementRate", 0.0),
            "topPostUrl": item.get("topPostUrl"),
            "topPostEngagement": item.get("topPostEngagements", 0),
            "profileViews": item.get("profileViews"),
        }

    except Exception as e:
        logger.warning("Platform scrape failed for %s: %s", platform, e)
        return {}


# ---------------------------------------------------------------------------
# Weekly brief generation
# ---------------------------------------------------------------------------

_BRIEF_SYSTEM = """
You are a personal brand coach. Write an encouraging, specific, actionable weekly brief.
Return ONLY a valid JSON object - no markdown, no code fences, no commentary.
""".strip()

_BRIEF_PROMPT = """
Generate a weekly brief for {full_name} based on their personal brand strategy and recent performance.

POSITIONING: {positioning}
CONTENT PILLARS: {pillars}
90-DAY GOAL: {goal_90}
RECENT ANALYTICS:
{analytics_summary}

Return this JSON:
{{
  "focusThisWeek": "string - one clear priority sentence",
  "performanceSummary": "string - 2-3 sentence recap of last week",
  "postIdeas": [
    "string - specific post idea with hook",
    "string - specific post idea with hook",
    "string - specific post idea with hook"
  ],
  "engagementTip": "string - one tactical tip for this week",
  "motivationalNote": "string - brief, genuine encouragement (1 sentence)"
}}
"""


def generate_weekly_brief(project_id: str, personal_core: dict) -> dict:
    """
    Generate and persist a weekly brief. Returns the brief dict.
    """
    from backend.config import settings
    from backend.services import firebase_service
    import anthropic

    db = firebase_service.get_db()
    now = datetime.now(timezone.utc).isoformat()

    # Pull last 7 days of snapshots for context
    snaps = (
        db.collection("personal_brand_analytics")
        .where("projectId", "==", project_id)
        .order_by("snapshotDate", direction="DESCENDING")
        .limit(10)
        .stream()
    )
    snap_list = [s.to_dict() for s in snaps]
    analytics_summary = _summarise_analytics(snap_list)

    pillars = personal_core.get("contentPillars") or []
    pillar_names = [p.get("name", p) if isinstance(p, dict) else p for p in pillars]

    prompt = _BRIEF_PROMPT.format(
        full_name=personal_core.get("fullName", ""),
        positioning=personal_core.get("positioningStatement", ""),
        pillars=", ".join(pillar_names[:5]),
        goal_90=personal_core.get("goal90Day", ""),
        analytics_summary=analytics_summary,
    )

    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1000,
            system=_BRIEF_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        brief_data = json.loads(raw)
    except Exception as e:
        logger.warning("Weekly brief generation failed: %s - using placeholder", e)
        brief_data = {
            "focusThisWeek": "Keep showing up consistently this week.",
            "performanceSummary": "Analytics data is being collected for your connected platforms.",
            "postIdeas": [
                "Share one lesson you've learned this week",
                "Write about a challenge you overcame recently",
                "Post your take on a trending topic in your niche",
            ],
            "engagementTip": "Reply to every comment within 2 hours of posting.",
            "motivationalNote": "Consistency compounds - every post builds your brand.",
        }

    brief = {
        "projectId": project_id,
        "generatedAt": now,
        "updatedAt": now,
        **brief_data,
    }
    db.collection("personal_weekly_briefs").document(project_id).set(brief)
    logger.info("Weekly brief saved for project %s", project_id)
    return brief


def _summarise_analytics(snaps: list[dict]) -> str:
    if not snaps:
        return "No analytics data available yet."
    lines = []
    for s in snaps[:5]:
        lines.append(
            f"- {s.get('platform', 'unknown')}: {s.get('followers', 0)} followers, "
            f"{s.get('postsThisWeek', 0)} posts, "
            f"{s.get('consistencyScore', 0)}% consistency"
        )
    return "\n".join(lines)
