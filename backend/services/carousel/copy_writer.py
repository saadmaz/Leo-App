"""
Carousel Studio - Copy Writer

Calls Claude to generate structured slide JSON using brand profile + intake answers.
Returns a list of slide dicts conforming to the CarouselSlide schema.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from backend.config import settings
from backend.services import llm_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Slide architecture per carousel type
# ---------------------------------------------------------------------------

CAROUSEL_ARCHITECTURES: dict[str, str] = {
    "educational": (
        "Slide 1: Hook - a compelling 'nobody tells you' opening\n"
        "Slide 2: Why it matters - problem/context\n"
        "Slide 3: Overview - 'Here's what you'll learn'\n"
        "Slides 4-N: One lesson per slide, numbered steps\n"
        "Second-to-last: Summary - key takeaways\n"
        "Last: CTA - follow for more / save this post"
    ),
    "stats": (
        "Slide 1: The most shocking stat, large and centred\n"
        "Slides 2-N: One stat per slide with context label\n"
        "Second-to-last: 'What this means for you'\n"
        "Last: CTA - link in bio / comment for resource"
    ),
    "product": (
        "Slide 1: Product hero - bold name, one-line promise\n"
        "Slide 2: The problem it solves\n"
        "Slide 3: Product in action\n"
        "Slides 4-5: Top features (feature list)\n"
        "Slide 6: Social proof / early results\n"
        "Last: CTA - get it now / link in bio"
    ),
    "story": (
        "Slide 1: The inciting moment - hook with stakes\n"
        "Slides 2-4: The journey (before/during/after)\n"
        "Slide 5: The turning point\n"
        "Slides 6-N: The lessons learned\n"
        "Last: CTA - follow the journey / share your story"
    ),
    "tips": (
        "Slide 1: 'N tips to [goal]' - hook with number\n"
        "Slides 2-N: One tip per slide (tip number + title + description)\n"
        "Second-to-last: Bonus tip or recap\n"
        "Last: CTA - save this / follow for more"
    ),
    "viral_hook": (
        "Slide 1: Controversial or counterintuitive statement\n"
        "Slide 2: 'Here's why...' - set up the tension\n"
        "Slides 3-5: Evidence and proof\n"
        "Slide 6: The nuance / hot take\n"
        "Last: CTA - comment your opinion / share this"
    ),
    "social_proof": (
        "Slide 1: Result or transformation headline\n"
        "Slides 2-4: Individual testimonials (quote box)\n"
        "Slide 5: Stats from real users\n"
        "Slide 6: Behind the scenes / process\n"
        "Last: CTA - join / get started / DM us"
    ),
    "lead_magnet": (
        "Slide 1: Freebie hook - 'Free [X] inside - save this'\n"
        "Slides 2-4: Preview of value\n"
        "Slide 5: Who it's for\n"
        "Slide 6: Urgency / scarcity if applicable\n"
        "Last: CTA - link in bio / DM 'FREE' to get it"
    ),
}

FONT_FALLBACKS: dict[str, tuple[str, str]] = {
    "bold":          ("Space Grotesk",         "Space Grotesk"),
    "professional":  ("Plus Jakarta Sans",      "Plus Jakarta Sans"),
    "warm":          ("Lora",                   "Nunito Sans"),
    "premium":       ("Playfair Display",       "DM Sans"),
    "energetic":     ("Fraunces",               "Outfit"),
    "technical":     ("Space Mono",             "Inter"),
    "friendly":      ("Bricolage Grotesque",    "Bricolage Grotesque"),
}


def _choose_font_fallback(tone: str) -> tuple[str, str]:
    tone_lower = tone.lower()
    if any(w in tone_lower for w in ["bold", "direct", "strong"]):
        return FONT_FALLBACKS["bold"]
    if any(w in tone_lower for w in ["professional", "clean", "corporate"]):
        return FONT_FALLBACKS["professional"]
    if any(w in tone_lower for w in ["warm", "friendly", "approachable"]):
        return FONT_FALLBACKS["warm"]
    if any(w in tone_lower for w in ["premium", "luxury", "editorial"]):
        return FONT_FALLBACKS["premium"]
    if any(w in tone_lower for w in ["energetic", "youthful", "playful"]):
        return FONT_FALLBACKS["energetic"]
    if any(w in tone_lower for w in ["technical", "startup", "developer"]):
        return FONT_FALLBACKS["technical"]
    return FONT_FALLBACKS["professional"]


# ---------------------------------------------------------------------------
# Main generation function
# ---------------------------------------------------------------------------

async def generate_slides(
    brand_profile: dict,
    intake_answers: dict,
    source_content: Optional[str] = None,
) -> list[dict]:
    """
    Generate structured slide JSON using Claude.
    Returns a list of slide dicts.
    """
    carousel_type = intake_answers.get("q1_type", "educational")
    orientation = intake_answers.get("q2_format", "portrait")
    slide_count = int(intake_answers.get("q3_slides", 7))
    design_style = intake_answers.get("q4_style", "dark_bold")
    topic = intake_answers.get("q5_topic", "")

    architecture = CAROUSEL_ARCHITECTURES.get(carousel_type, CAROUSEL_ARCHITECTURES["educational"])

    # Derive fonts
    heading_font = brand_profile.get("heading_font", "")
    body_font = brand_profile.get("body_font", "")
    if not heading_font or heading_font == "Plus Jakarta Sans":
        heading_font, body_font = _choose_font_fallback(brand_profile.get("tone", ""))

    system_prompt = """You are LEO's Instagram Carousel Copywriter. You write carousel copy that stops scrolls, drives saves, and grows accounts. You MUST return ONLY valid JSON - no markdown fences, no explanation text, nothing before or after the JSON."""

    user_prompt = f"""BRAND INTELLIGENCE:
Brand name: {brand_profile.get("domain", "the brand")}
Tone: {brand_profile.get("tone", "professional")}
Formality: {brand_profile.get("formality", "semi-formal")}
Personality traits: {", ".join(brand_profile.get("personality", ["modern"]))}
Words to AVOID: {", ".join(brand_profile.get("avoid_words", []))}
Audience: {brand_profile.get("audience_signal", "professionals")}
Instagram style: {brand_profile.get("instagram_aesthetic", "clean and minimal")}

CAROUSEL BRIEF:
Type: {carousel_type}
Topic: {topic}
Slide count: {slide_count}
Format: {orientation}
Design style: {design_style}
Heading font: {heading_font}
Body font: {body_font}

SLIDE ARCHITECTURE FOR THIS TYPE:
{architecture}

{f"SOURCE CONTENT:{chr(10)}{source_content[:3000]}" if source_content else ""}

RULES:
1. Slide 1 headline MUST stop the scroll. Use: '[Number] [things] that [result]', 'The truth about [topic]', 'Stop [doing X]. Do this instead.', or a shocking stat format.
2. Every headline: 8 words maximum. Hard limit.
3. Body copy: maximum 2 sentences per slide.
4. Write in the brand's tone - NOT generic AI voice.
5. Final slide CTA must be specific: not 'Follow us' - 'Save this and try tip 1 today.'
6. Tag labels are UPPERCASE, 1–3 words.
7. Background choices: LIGHT_BG (white/light), DARK_BG (dark), GRADIENT (brand gradient). Mix them for visual variety. Hero and CTA often use DARK_BG or GRADIENT.
8. Component types: stat_block, feature_list, numbered_steps, quote_box, cta_centred, none.
9. component_data for stat_block: {{"stats": [{{"number": "X%", "label": "description"}}]}}
10. component_data for feature_list: {{"features": [{{"icon": "✓", "title": "...", "desc": "..."}}]}}
11. component_data for numbered_steps: {{"steps": [{{"number": "01", "title": "...", "desc": "..."}}]}}
12. component_data for quote_box: {{"quote": "...", "author": "...", "role": ""}}
13. component_data for cta_centred: {{"cta_text": "...", "sub_text": "..."}}

Return EXACTLY {slide_count} slides. Return ONLY this JSON structure:
{{
  "slides": [
    {{
      "index": 0,
      "type": "hero",
      "background": "DARK_BG",
      "tag": "THE HOOK",
      "headline": "Your headline here",
      "body": "Two sentences of body copy.",
      "component": "none",
      "component_data": {{}}
    }}
  ],
  "heading_font": "{heading_font}",
  "body_font": "{body_font}",
  "title": "Auto-generated carousel title based on topic"
}}"""

    client = llm_service.get_client()
    msg = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=2000,  # carousel JSON rarely exceeds 1500 tokens
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = msg.content[0].text.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:].strip()

    result = json.loads(raw)
    return result


# ---------------------------------------------------------------------------
# Targeted slide edit
# ---------------------------------------------------------------------------

async def edit_slide(
    slide: dict,
    instruction: str,
    brand_profile: dict,
) -> dict:
    """
    Apply a targeted edit to a single slide. Returns the updated slide dict.
    """
    prompt = f"""You are editing a single Instagram carousel slide. Apply ONLY the requested change.
Return ONLY the updated slide JSON - no explanation, no markdown.

BRAND TONE: {brand_profile.get("tone", "professional")}
AVOID WORDS: {", ".join(brand_profile.get("avoid_words", []))}

CURRENT SLIDE:
{json.dumps(slide, indent=2)}

EDIT INSTRUCTION: {instruction}

Return the complete updated slide JSON (same structure, same fields, only changed values updated)."""

    client = llm_service.get_client()
    msg = await client.messages.create(
        model=settings.LLM_CHAT_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:].strip()
    return json.loads(raw)
