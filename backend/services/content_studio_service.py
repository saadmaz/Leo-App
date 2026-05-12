"""
Phase 5 Content Studio Services.

Provides:
  - SEO Content: blog posts (SSE stream), meta tags, website copy
  - Email Studio: full sequences + single emails
  - Brand Style Guide: AI-generated brand document
"""

import json
import logging
from typing import AsyncGenerator

from backend.config import settings
from backend.services.llm_service import get_client, build_brand_core_context

logger = logging.getLogger(__name__)


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


# ---------------------------------------------------------------------------
# SEO - Blog Post (SSE streaming)
# ---------------------------------------------------------------------------

async def stream_blog_post(
    project_name: str,
    brand_core: dict,
    topic: str,
    keywords: list[str],
    tone: str,
    word_count: int,
) -> AsyncGenerator[str, None]:
    """
    Stream a full SEO-optimised blog post in markdown.

    Yields:
      data: {"type": "meta",  "title": "...", "description": "...", "slug": "..."}
      data: {"type": "chunk", "text": "..."}   (raw markdown chunks)
      data: {"type": "done"}
      data: {"type": "error", "error": "..."}
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)
    keywords_str = ", ".join(keywords) if keywords else topic

    # First generate meta in one shot
    meta_prompt = f"""Generate SEO metadata for a blog post.

BRAND: {project_name}
TOPIC: {topic}
TARGET KEYWORDS: {keywords_str}

Return ONLY valid JSON:
{{
  "title": "<SEO title, 50-60 chars, include primary keyword>",
  "description": "<meta description, 150-160 chars, compelling CTA>",
  "slug": "<url-slug-like-this>",
  "outline": ["<heading 1>", "<heading 2>", "<heading 3>", "<heading 4>", "<heading 5>"]
}}"""

    try:
        meta_resp = await client.messages.create(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=500,
            messages=[{"role": "user", "content": meta_prompt}],
        )
        meta = _parse_json(meta_resp.content[0].text)
        yield f"data: {json.dumps({'type': 'meta', **meta})}\n\n"
    except Exception as exc:
        yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"
        return

    # Stream the full post
    outline_str = "\n".join(f"- {h}" for h in meta.get("outline", []))
    post_prompt = f"""You are a professional content writer for {project_name}.

BRAND VOICE:
{brand_context}

Write a complete, SEO-optimised blog post in markdown.

TITLE: {meta.get('title', topic)}
TARGET KEYWORDS: {keywords_str}
TONE: {tone}
WORD COUNT: approximately {word_count} words

OUTLINE TO FOLLOW:
{outline_str}

Requirements:
- Open with a compelling hook (no "Introduction" heading)
- Use the target keywords naturally (don't stuff)
- Include a clear CTA at the end
- Use subheadings (##, ###), short paragraphs, and bullet points where helpful
- Write in the brand voice - no generic filler
- End with a concise conclusion

Write only the post body (no title/meta). Start immediately."""

    try:
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=4096,
            messages=[{"role": "user", "content": post_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'type': 'chunk', 'text': text})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        yield "data: [DONE]\n\n"

    except Exception as exc:
        logger.error("Blog post streaming failed: %s", exc)
        yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"


# ---------------------------------------------------------------------------
# SEO - Meta Tags
# ---------------------------------------------------------------------------

async def generate_meta_tags(
    project_name: str,
    brand_core: dict,
    page_title: str,
    page_description: str,
    page_type: str,
) -> dict:
    """
    Generate a full set of SEO + Open Graph + Twitter meta tags.

    Returns: { tags: { title, description, og_title, og_description, og_type,
                        twitter_title, twitter_description, canonical_hint,
                        schema_type, focus_keyword } }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    prompt = f"""Generate complete SEO meta tags for a webpage.

BRAND: {project_name}
{brand_context}

PAGE TITLE: {page_title}
PAGE DESCRIPTION: {page_description}
PAGE TYPE: {page_type}  (e.g. homepage, product page, blog post, landing page)

Return ONLY valid JSON:
{{
  "title": "<SEO title tag, 50-60 chars>",
  "description": "<meta description, 150-160 chars>",
  "og_title": "<Open Graph title>",
  "og_description": "<Open Graph description, 2-3 sentences>",
  "og_type": "website" | "article" | "product",
  "twitter_title": "<Twitter card title>",
  "twitter_description": "<Twitter card description, under 200 chars>",
  "canonical_hint": "<suggested URL slug>",
  "schema_type": "<Schema.org type, e.g. Organization, Product, Article>",
  "focus_keyword": "<primary SEO keyword to target>"
}}"""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        return {"tags": _parse_json(response.content[0].text)}
    except Exception:
        return {"tags": {}}


# ---------------------------------------------------------------------------
# SEO - Website Copy
# ---------------------------------------------------------------------------

async def generate_website_copy(
    project_name: str,
    brand_core: dict,
    page_type: str,
    context: str,
) -> dict:
    """
    Generate website copy sections for a given page type.

    page_type: homepage | about | product | pricing | landing
    Returns: { sections: [ { name, headline, subheadline, body, cta } ] }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    sections_map = {
        "homepage": ["Hero", "Value Proposition", "Features/Benefits", "Social Proof", "CTA Section"],
        "about":    ["Brand Story", "Mission Statement", "Values", "Team Intro", "CTA"],
        "product":  ["Hero", "Problem/Solution", "Key Features", "Benefits", "Pricing Tease", "CTA"],
        "pricing":  ["Pricing Headline", "Plan Descriptions (x3)", "FAQ", "CTA"],
        "landing":  ["Hero", "Pain Point", "Solution", "Social Proof", "Urgency/CTA"],
    }
    sections = sections_map.get(page_type.lower(), sections_map["homepage"])
    sections_str = "\n".join(f"- {s}" for s in sections)

    prompt = f"""You are a conversion copywriter for {project_name}.

BRAND VOICE:
{brand_context}

PAGE TYPE: {page_type}
CONTEXT / NOTES: {context or 'None provided'}

Write compelling website copy for these sections:
{sections_str}

Return ONLY valid JSON:
{{
  "sections": [
    {{
      "name": "<section name>",
      "headline": "<main headline>",
      "subheadline": "<supporting line (optional)>",
      "body": "<body copy, 2-4 sentences or bullet points>",
      "cta": "<CTA button text>"
    }}
  ]
}}

Make every word earn its place. No filler. On-brand throughout."""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=2500,
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        return _parse_json(response.content[0].text)
    except Exception:
        return {"sections": []}


# ---------------------------------------------------------------------------
# Email Studio - Sequence
# ---------------------------------------------------------------------------

EMAIL_SEQUENCE_TYPES = {
    "welcome":  {"count": 4, "desc": "Onboard new subscribers: warm welcome, value delivery, story, first CTA"},
    "nurture":  {"count": 5, "desc": "Build trust over time: education, case study, objection handling, offer"},
    "launch":   {"count": 6, "desc": "Product/service launch: teaser, announcement, benefits, urgency, last chance, post-launch"},
    "re-engage": {"count": 3, "desc": "Win back cold subscribers: surprise, value, final offer"},
    "post-purchase": {"count": 4, "desc": "Delight customers: thank you, onboarding tips, upsell, review request"},
}

async def generate_email_sequence(
    project_name: str,
    brand_core: dict,
    sequence_type: str,
    goal: str,
    product_or_service: str,
) -> dict:
    """
    Generate a complete email sequence.

    Returns: { sequence: [ { number, subject, preview_text, body, cta_text, send_day } ] }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    config = EMAIL_SEQUENCE_TYPES.get(sequence_type.lower(), EMAIL_SEQUENCE_TYPES["welcome"])
    count = config["count"]
    desc = config["desc"]

    prompt = f"""You are an email marketing strategist for {project_name}.

BRAND VOICE:
{brand_context}

SEQUENCE TYPE: {sequence_type} ({count} emails)
SEQUENCE PURPOSE: {desc}
GOAL: {goal}
PRODUCT/SERVICE: {product_or_service}

Write all {count} emails. Each should feel personal, on-brand, and progress logically.

Return ONLY valid JSON:
{{
  "sequence": [
    {{
      "number": 1,
      "send_day": 0,
      "subject": "<subject line, compelling, under 50 chars>",
      "preview_text": "<preview text, under 90 chars>",
      "body": "<full email body in plain text - warm, human, conversational. 150-300 words>",
      "cta_text": "<CTA button text>"
    }}
  ]
}}

Send days: email 1 = day 0, space subsequent emails 1-4 days apart based on the sequence type."""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=2200,  # email sequence JSON (up to 7 emails × ~300 words) rarely exceeds 2000 tokens
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        return _parse_json(response.content[0].text)
    except Exception:
        return {"sequence": []}


async def generate_single_email(
    project_name: str,
    brand_core: dict,
    email_type: str,
    context: str,
) -> dict:
    """
    Generate a single one-off email.

    Returns: { subject, preview_text, body, cta_text }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    prompt = f"""Write a single marketing email for {project_name}.

BRAND VOICE:
{brand_context}

EMAIL TYPE: {email_type}
CONTEXT / GOAL: {context}

Return ONLY valid JSON:
{{
  "subject": "<subject line>",
  "preview_text": "<preview text, under 90 chars>",
  "body": "<full email body, plain text, 150-300 words>",
  "cta_text": "<CTA button text>"
}}"""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        return _parse_json(response.content[0].text)
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Brand Style Guide
# ---------------------------------------------------------------------------

async def generate_style_guide(
    project_name: str,
    brand_core: dict,
) -> dict:
    """
    Generate a comprehensive brand style guide document.

    Returns: { sections: [ { title, content } ], summary }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    prompt = f"""You are a brand strategist creating a comprehensive brand style guide for {project_name}.

BRAND CORE DATA:
{brand_context}

Generate a complete, practical brand style guide. Be specific - extract real values, personality traits, and voice rules from the brand core data above.

Return ONLY valid JSON:
{{
  "summary": "<one paragraph elevator pitch of the brand identity>",
  "sections": [
    {{
      "title": "Brand Personality",
      "content": "<3-5 core personality traits with a one-sentence description of each>"
    }},
    {{
      "title": "Voice & Tone",
      "content": "<how the brand sounds, what emotions it evokes, how tone shifts by context>"
    }},
    {{
      "title": "Writing Do's",
      "content": "<5-7 specific writing rules to follow - concrete, actionable>"
    }},
    {{
      "title": "Writing Don'ts",
      "content": "<5-7 things to never write or say - include examples of bad vs good>"
    }},
    {{
      "title": "Power Words",
      "content": "<15-20 words and phrases that are quintessentially on-brand>"
    }},
    {{
      "title": "Words to Avoid",
      "content": "<10-15 words and phrases that feel off-brand>"
    }},
    {{
      "title": "Example Headlines",
      "content": "<5-6 on-brand headline examples across different contexts: social, email, ad, web>"
    }},
    {{
      "title": "Audience Persona",
      "content": "<who the ideal customer is - values, challenges, what they respond to>"
    }},
    {{
      "title": "Content Pillars",
      "content": "<4-5 core content themes with a brief description of each>"
    }}
  ]
}}"""

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=2200,  # brand playbook JSON with 5 sections, rarely exceeds 2000 tokens
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        return _parse_json(response.content[0].text)
    except Exception:
        return {"summary": "", "sections": []}


# ---------------------------------------------------------------------------
# Phase 7 - AI Content Planner
# ---------------------------------------------------------------------------

async def generate_content_plan(
    project_name: str,
    brand_core: dict,
    duration: str,
    platforms: list[str],
    goal: str,
    posts_per_week: int = 5,
) -> list[dict]:
    """
    Generate a structured content plan as a list of post blueprints.

    Each item: { date, platform, contentType, topic, contentAngle,
                 suggestedContent, hashtags, postingTime }
    """
    client = get_client()
    brand_context = build_brand_core_context(brand_core)

    duration_label = {
        "1_week": "1 week (7 days)",
        "2_weeks": "2 weeks (14 days)",
        "1_month": "4 weeks (28 days)",
    }.get(duration, "2 weeks (14 days)")

    platforms_str = ", ".join(platforms)
    goal_line = f"CAMPAIGN GOAL: {goal}" if goal else ""

    prompt = f"""You are a social media strategist. Create a detailed content calendar.

BRAND: {project_name}
{brand_context}
PLATFORMS: {platforms_str}
DURATION: {duration_label}
POSTS PER WEEK: {posts_per_week}
{goal_line}

Generate a content plan. Return a JSON array where each item is:
{{
  "date": "YYYY-MM-DD",          // start from tomorrow, spread across duration
  "platform": "<platform>",
  "contentType": "caption|video_script|ad_copy|email|image_prompt",
  "topic": "<short topic title>",
  "contentAngle": "<hook/angle for this specific post>",
  "suggestedContent": "<50-120 word draft of the post content>",
  "hashtags": ["tag1", "tag2", "tag3"],
  "postingTime": "HH:MM"         // optimal posting time for the platform
}}

Balance content types across: educational, behind-the-scenes, product/service spotlight, engagement questions, user-generated content prompts, and promotional.
Return ONLY the JSON array, no other text."""

    from datetime import date, timedelta
    today = date.today()
    # Inject today's date so the model can use real dates
    prompt = prompt.replace(
        "// start from tomorrow, spread across duration",
        f"// today is {today.isoformat()}, start from tomorrow",
    )

    response = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=3500,  # content plan JSON for 30 days; 6000 was 2x overprovisioned
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception:
        return []
