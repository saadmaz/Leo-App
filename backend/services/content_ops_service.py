"""
Phase 2 Content Operations Services.

Provides:
  - Bulk Content Generation: stream N pieces of content across platforms
  - Content Recycler: generate fresh variants of top-performing content
  - Platform Format Transformer: one brief → all platform formats simultaneously
"""

import json
import logging
from typing import AsyncGenerator, Optional

from backend.config import settings
from backend.services.llm_service import get_client, build_brand_core_context

logger = logging.getLogger(__name__)

PLATFORM_FORMATS = {
    "instagram": "Instagram caption (max 150 chars hook, warm tone, 5-10 hashtags)",
    "facebook": "Facebook post (conversational, 80-150 words, 2-3 hashtags)",
    "tiktok": "TikTok script (hook 0-3s, content 3-45s, CTA, 3-5 hashtags)",
    "linkedin": "LinkedIn post (professional, 150-300 words, hook + insight + CTA, 3-5 hashtags)",
    "x": "X/Twitter post (punchy, under 280 chars, 1-2 hashtags)",
    "email": "Email (subject line, preview text, body, CTA button text)",
}


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


# ---------------------------------------------------------------------------
# Bulk Content Generation (SSE streaming)
# ---------------------------------------------------------------------------

async def stream_bulk_generate(
    project_name: str,
    brand_core: dict,
    platforms: list[str],
    count_per_platform: int,
    themes: list[str],
    period: str,
    goal: str,
) -> AsyncGenerator[str, None]:
    """
    Generate content pieces for multiple platforms and stream each item as an SSE event.

    Yields SSE events:
      data: {"type": "item", "item": {...}}
      data: {"type": "progress", "done": N, "total": N}
      data: {"type": "done", "total": N}
      data: {"type": "error", "error": "..."}
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    themes_str = ", ".join(themes) if themes else "general brand content"
    platforms_str = ", ".join(platforms)
    total = len(platforms) * count_per_platform

    yield f"data: {json.dumps({'type': 'progress', 'done': 0, 'total': total})}\n\n"

    done = 0

    for platform in platforms:
        platform_format = PLATFORM_FORMATS.get(platform.lower(), f"{platform} post")

        prompt = f"""You are a social media content creator for the brand '{project_name}'.

BRAND CORE:
{brand_context}

Generate {count_per_platform} unique, ready-to-post pieces of content for {platform}.

Format for {platform}: {platform_format}

Period / context: {period}
Goal: {goal}
Content themes to draw from: {themes_str}

Return ONLY a valid JSON array with exactly {count_per_platform} objects.
Each object must have this structure:
{{
  "platform": "{platform}",
  "content": "<the main post text / caption / script>",
  "hashtags": ["tag1", "tag2"],
  "type": "caption" | "video_script" | "email",
  "hook": "<first line or hook (optional, for TikTok/Instagram)>",
  "headline": "<email subject line or ad headline (optional)>",
  "cta": "<call to action text (optional)>"
}}

Make each piece distinct in angle and approach. Be specific, on-brand, and platform-native."""

        try:
            response = await client.messages.create(
                model=settings.LLM_CHAT_MODEL,
                max_tokens=1800,  # bulk content JSON per-platform chunk, rarely > 1200 tokens
                messages=[{"role": "user", "content": prompt}],
            )

            items = _parse_json(response.content[0].text)
            if not isinstance(items, list):
                items = [items]

            for item in items[:count_per_platform]:
                item["platform"] = platform
                item["status"] = "draft"
                done += 1
                yield f"data: {json.dumps({'type': 'item', 'item': item})}\n\n"
                yield f"data: {json.dumps({'type': 'progress', 'done': done, 'total': total})}\n\n"

        except Exception as exc:
            logger.error("Bulk generate failed for %s: %s", platform, exc)
            yield f"data: {json.dumps({'type': 'error', 'error': f'Failed to generate for {platform}: {exc}'})}\n\n"

    yield f"data: {json.dumps({'type': 'done', 'total': done})}\n\n"
    yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# Content Recycler
# ---------------------------------------------------------------------------

async def recycle_content(
    original_content: str,
    platform: str,
    brand_core: dict,
    count: int = 3,
) -> dict:
    """
    Take a piece of existing content and generate fresh variants.

    Returns: { variants: list[{ content, hashtags, angle, hook }] }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)
    platform_format = PLATFORM_FORMATS.get(platform.lower(), f"{platform} post")

    prompt = f"""You are a social media content strategist for the brand.

BRAND CORE:
{brand_context}

ORIGINAL CONTENT (this performed well):
{original_content}

Generate {count} fresh variants of this content for {platform}.
Each variant must:
- Keep the core message/value that made the original work
- Use a completely different hook, angle, or format
- Feel fresh and not like a rewrite

Format: {platform_format}

Return ONLY valid JSON:
{{
  "variants": [
    {{
      "content": "<the new post text>",
      "hashtags": ["tag1", "tag2"],
      "angle": "<what makes this version different from the original>",
      "hook": "<the opening hook>"
    }}
  ]
}}"""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        return _parse_json(response.content[0].text)
    except Exception:
        return {"variants": []}


# ---------------------------------------------------------------------------
# Platform Format Transformer
# ---------------------------------------------------------------------------

async def transform_to_all_platforms(
    content: str,
    target_platforms: list[str],
    brand_core: dict,
) -> dict:
    """
    Transform a single piece of content into platform-native versions simultaneously.

    Returns: { results: { platform: { content, hashtags, notes } } }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    platforms_spec = "\n".join(
        f'- {p}: {PLATFORM_FORMATS.get(p.lower(), p + " post")}'
        for p in target_platforms
    )

    prompt = f"""You are a social media content adapter for the brand.

BRAND CORE:
{brand_context}

ORIGINAL CONTENT (adapt this - don't just copy):
{content}

Transform this into a platform-native version for each of the following platforms.
Each version must feel native to that platform - not a copy-paste with hashtags changed.

Platforms to adapt for:
{platforms_spec}

Return ONLY valid JSON:
{{
  "results": {{
    "<platform>": {{
      "content": "<platform-native version>",
      "hashtags": ["tag1", "tag2"],
      "notes": "<one sentence on what you changed and why>"
    }}
  }}
}}

Use the exact platform names as keys (e.g. "instagram", "linkedin", etc.)."""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=1800,  # platform transform JSON for 6 platforms, rarely > 1500 tokens
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        return _parse_json(response.content[0].text)
    except Exception:
        return {"results": {}}


# ---------------------------------------------------------------------------
# Calendar Auto-Population
# ---------------------------------------------------------------------------

async def generate_calendar(
    project_name: str,
    brand_core: dict,
    platforms: list[str],
    period: str,
    goals: str,
    posts_per_week: int = 3,
) -> dict:
    """
    Generate a full content calendar for the given period.

    Returns: { entries: list[{ date, platform, content, hashtags, type, time }] }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)
    platforms_str = ", ".join(platforms)

    prompt = f"""You are a social media strategist creating a content calendar for '{project_name}'.

BRAND CORE:
{brand_context}

PERIOD: {period}
PLATFORMS: {platforms_str}
POSTS PER WEEK (across all platforms): {posts_per_week}
GOALS: {goals}

Create a complete, varied content calendar for this period. Mix:
- Educational / value-add posts (40%)
- Brand story / behind-the-scenes (20%)
- Product / service focused (20%)
- Engagement / community (20%)

Spread posts evenly. Use the best posting times for each platform.

Return ONLY valid JSON:
{{
  "entries": [
    {{
      "date": "YYYY-MM-DD",
      "platform": "<platform>",
      "type": "educational" | "brand_story" | "product" | "engagement",
      "time": "HH:MM",
      "content": "<ready-to-post content>",
      "hashtags": ["tag1", "tag2"],
      "content_format": "post" | "story" | "reel" | "carousel"
    }}
  ]
}}

Generate entries for the full {period} period. Today is 2026-03-22."""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=2500,  # content calendar JSON, rarely > 2000 tokens
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        return _parse_json(response.content[0].text)
    except Exception:
        return {"entries": []}
