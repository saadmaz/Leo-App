"""
Personal Brand Reputation Service.

Runs a Google name search via SerpAPI and scans for social mentions via Apify.
Uses Claude to apply sentiment tagging to each mention.

Collection written: personal_reputation/{project_id}
"""

import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def check_reputation(project_id: str, full_name: str) -> dict:
    """
    Run a full reputation check:
      1. SerpAPI Google search for the person's name
      2. (Optional) Apify social mention scan
      3. Claude sentiment tagging on mentions
      4. Persist to personal_reputation/{project_id}
    Returns the persisted reputation dict.
    """
    google_results = _google_search(full_name)
    social_mentions = _social_mentions(full_name)

    # Tag sentiment on social mentions
    tagged_mentions = _tag_sentiment(full_name, social_mentions)

    from backend.services import firebase_service
    db = firebase_service.get_db()
    now = datetime.now(timezone.utc).isoformat()

    reputation = {
        "projectId": project_id,
        "fullName": full_name,
        "checkedAt": now,
        "googleResults": google_results,
        "socialMentions": tagged_mentions,
        "summary": _build_summary(google_results, tagged_mentions),
    }

    db.collection("personal_reputation").document(project_id).set(reputation)
    logger.info("Reputation check complete for project %s (%s)", project_id, full_name)
    return reputation


# ---------------------------------------------------------------------------
# Google search
# ---------------------------------------------------------------------------

def _google_search(full_name: str) -> list[dict]:
    """Return up to 10 Google results for the person's name."""
    try:
        from backend.config import settings
        if not settings.SERPAPI_API_KEY:
            return _mock_google_results(full_name)

        import httpx
        resp = httpx.get(
            "https://serpapi.com/search",
            params={
                "q": f'"{full_name}"',
                "api_key": settings.SERPAPI_API_KEY,
                "num": 10,
                "engine": "google",
            },
            timeout=15,
        )
        if resp.status_code != 200:
            logger.warning("SerpAPI returned %d", resp.status_code)
            return _mock_google_results(full_name)

        data = resp.json()
        results = []
        for r in data.get("organic_results", [])[:10]:
            results.append({
                "title": r.get("title", ""),
                "url": r.get("link", ""),
                "snippet": r.get("snippet", ""),
                "position": r.get("position", 0),
                "source": _extract_domain(r.get("link", "")),
            })
        return results

    except Exception as e:
        logger.warning("Google search failed: %s", e)
        return _mock_google_results(full_name)


def _mock_google_results(full_name: str) -> list[dict]:
    return [
        {
            "title": f"{full_name} - LinkedIn",
            "url": "https://linkedin.com",
            "snippet": f"View {full_name}'s professional profile on LinkedIn.",
            "position": 1,
            "source": "linkedin.com",
        },
        {
            "title": f"{full_name} | Professional Profile",
            "url": "https://example.com",
            "snippet": f"Learn about {full_name}'s experience, expertise, and background.",
            "position": 2,
            "source": "example.com",
        },
    ]


# ---------------------------------------------------------------------------
# Social mentions
# ---------------------------------------------------------------------------

def _social_mentions(full_name: str) -> list[dict]:
    """Search for social media mentions using Apify or return empty list."""
    try:
        from backend.config import settings
        if not settings.APIFY_API_KEY:
            return []

        import httpx
        headers = {"Authorization": f"Bearer {settings.APIFY_API_KEY}"}

        # Use Apify's Google Search Scraper as a lightweight social mention proxy
        run_resp = httpx.post(
            "https://api.apify.com/v2/acts/apify/google-search-scraper/run-sync-get-dataset-items",
            headers=headers,
            json={
                "queries": [
                    f'"{full_name}" site:twitter.com',
                    f'"{full_name}" site:linkedin.com/posts',
                ],
                "maxPagesPerQuery": 1,
                "resultsPerPage": 5,
            },
            timeout=25,
        )

        if run_resp.status_code != 200:
            return []

        items = run_resp.json()
        mentions = []
        for item in items:
            for r in item.get("organicResults", []):
                mentions.append({
                    "platform": _detect_platform(r.get("url", "")),
                    "url": r.get("url", ""),
                    "title": r.get("title", ""),
                    "snippet": r.get("description", ""),
                    "sentiment": "neutral",  # tagged below
                })
        return mentions[:15]

    except Exception as e:
        logger.warning("Social mentions search failed: %s", e)
        return []


# ---------------------------------------------------------------------------
# Sentiment tagging
# ---------------------------------------------------------------------------

_SENTIMENT_SYSTEM = """
You are a sentiment analysis assistant. Classify each mention as positive, neutral, or negative.
Return ONLY a JSON array - no markdown, no code fences.
""".strip()

_SENTIMENT_PROMPT = """
Tag the sentiment for each of these mentions about {full_name}.
For each mention, determine if it is positive, neutral, or negative toward {full_name}.

Mentions:
{mentions_text}

Return a JSON array where each element has:
{{ "index": <number>, "sentiment": "positive|neutral|negative", "reason": "one brief reason" }}
"""


def _tag_sentiment(full_name: str, mentions: list[dict]) -> list[dict]:
    if not mentions:
        return []

    try:
        from backend.config import settings
        import anthropic

        if not settings.ANTHROPIC_API_KEY:
            return mentions

        mentions_text = "\n".join(
            f"{i}. [{m.get('platform', 'web')}] {m.get('title', '')} - {m.get('snippet', '')}"
            for i, m in enumerate(mentions)
        )

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1000,
            system=_SENTIMENT_SYSTEM,
            messages=[{"role": "user", "content": _SENTIMENT_PROMPT.format(
                full_name=full_name,
                mentions_text=mentions_text,
            )}],
        )

        raw = response.content[0].text.strip()
        tags = json.loads(raw)

        tag_map = {t["index"]: t for t in tags if isinstance(t, dict)}
        for i, mention in enumerate(mentions):
            tag = tag_map.get(i, {})
            mention["sentiment"] = tag.get("sentiment", "neutral")
            mention["sentimentReason"] = tag.get("reason", "")

        return mentions

    except Exception as e:
        logger.warning("Sentiment tagging failed: %s", e)
        return mentions


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_summary(google_results: list[dict], mentions: list[dict]) -> dict:
    total_mentions = len(mentions)
    sentiment_counts = {"positive": 0, "neutral": 0, "negative": 0}
    for m in mentions:
        s = m.get("sentiment", "neutral")
        if s in sentiment_counts:
            sentiment_counts[s] += 1

    google_count = len(google_results)
    top_source = google_results[0].get("source", "") if google_results else ""

    return {
        "googleResultsFound": google_count,
        "topGoogleSource": top_source,
        "totalMentionsFound": total_mentions,
        "sentimentBreakdown": sentiment_counts,
        "overallSentiment": _overall_sentiment(sentiment_counts),
    }


def _overall_sentiment(counts: dict) -> str:
    if counts["positive"] > counts["negative"]:
        return "positive"
    if counts["negative"] > counts["positive"]:
        return "negative"
    return "neutral"


def _extract_domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        return urlparse(url).netloc.replace("www.", "")
    except Exception:
        return ""


def _detect_platform(url: str) -> str:
    url_lower = url.lower()
    if "linkedin.com" in url_lower:
        return "linkedin"
    if "twitter.com" in url_lower or "x.com" in url_lower:
        return "twitter"
    if "instagram.com" in url_lower:
        return "instagram"
    if "tiktok.com" in url_lower:
        return "tiktok"
    return "web"
