"""
Personal Brand Content Engine.

Generates on-brand content in the user's personal voice using their Personal Core
and Voice Profile as context.

Endpoints powered by this service:
  POST /projects/{id}/persona/content/generate        – Quick post for any platform
  POST /projects/{id}/persona/content/story-to-post   – Story/event → structured post
  POST /projects/{id}/persona/content/opinion         – Opinion extractor → full post
  POST /projects/{id}/persona/content/bio             – Per-platform bio + headline writer
  POST /projects/{id}/persona/content/reformat        – One piece → all platforms
  POST /projects/{id}/persona/content/approve         – Mark output as approved (voice training)

SSE event format:
  { "type": "step",     "label": "...", "status": "running|done|error" }
  { "type": "progress", "pct": 0-100 }
  { "type": "done",     "result": { ... } }
  { "type": "error",    "message": "..." }
"""

import json
import logging
from datetime import datetime, timezone
from typing import AsyncIterator

logger = logging.getLogger(__name__)


def _sse(event_type: str, data: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **data})}\n\n"


# ---------------------------------------------------------------------------
# Shared: build voice context from Personal Core + Voice Profile
# ---------------------------------------------------------------------------

def _build_voice_context(personal_core: dict, voice_profile: dict | None) -> str:
    """Produce a compact voice brief for injection into every generation prompt."""
    name = personal_core.get("fullName", "this person")
    positioning = personal_core.get("positioningStatement", "")
    unique_angle = personal_core.get("uniqueAngle", "")
    pillars = personal_core.get("contentPillars") or []
    pillar_names = [p.get("name", p) if isinstance(p, dict) else p for p in pillars]

    vp = voice_profile or {}
    formality = vp.get("formalityLevel", 3)
    register = vp.get("emotionalRegister", "direct")
    sentence_len = vp.get("sentenceLength", "medium")
    sig_phrases = vp.get("signaturePhrases") or []
    avoided = vp.get("avoidedPhrases") or []
    samples = (vp.get("writingSamples") or [])[:2]  # first 2 samples for brevity

    formality_label = {1: "very casual", 2: "casual", 3: "conversational", 4: "professional", 5: "formal"}.get(formality, "conversational")

    lines = [
        f"PERSON: {name}",
        f"POSITIONING: {positioning}" if positioning else "",
        f"UNIQUE ANGLE: {unique_angle}" if unique_angle else "",
        f"CONTENT PILLARS: {', '.join(pillar_names)}" if pillar_names else "",
        f"VOICE: {formality_label} tone, {register} register, {sentence_len} sentences",
        f"SIGNATURE PHRASES (use naturally): {', '.join(sig_phrases)}" if sig_phrases else "",
        f"NEVER USE: {', '.join(avoided)}" if avoided else "",
    ]
    if samples:
        lines.append("WRITING SAMPLES (match this style):")
        for s in samples:
            lines.append(f'  "{s[:300]}"')

    return "\n".join(l for l in lines if l)


def _voice_accuracy_score(output: str, voice_profile: dict | None) -> int:
    """
    Heuristic voice accuracy score (0-100).
    A real implementation would call Claude to score - this is a fast approximation
    that checks for signature phrase usage and avoided phrase violations.
    """
    if not voice_profile:
        return 75

    score = 75
    sig_phrases = [p.lower() for p in (voice_profile.get("signaturePhrases") or [])]
    avoided = [p.lower() for p in (voice_profile.get("avoidedPhrases") or [])]
    text_lower = output.lower()

    for phrase in sig_phrases:
        if phrase in text_lower:
            score = min(100, score + 5)

    for phrase in avoided:
        if phrase in text_lower:
            score = max(0, score - 10)

    # Sentence length check
    sentences = [s.strip() for s in output.replace("!", ".").replace("?", ".").split(".") if s.strip()]
    if sentences:
        avg_words = sum(len(s.split()) for s in sentences) / len(sentences)
        target = voice_profile.get("sentenceLength", "medium")
        if target == "short" and avg_words <= 12:
            score = min(100, score + 5)
        elif target == "long" and avg_words >= 20:
            score = min(100, score + 5)
        elif target == "medium" and 10 <= avg_words <= 22:
            score = min(100, score + 5)

    return score


# ---------------------------------------------------------------------------
# 1. Quick Post Generator
# ---------------------------------------------------------------------------

_POST_SYSTEM = """
You are a personal brand content writer. You write posts that sound exactly like
the specific person described - not like generic AI content. Every post must reflect
their unique voice, positioning, and content pillars.
Return ONLY the post text - no commentary, no labels, no quotation marks around the post.
""".strip()

_POST_PROMPT = """
VOICE CONTEXT:
{voice_context}

TASK: Write a {platform} post about: {topic}

PLATFORM REQUIREMENTS:
{platform_requirements}

INSTRUCTIONS:
- Sound exactly like this person - use their natural voice, not corporate AI language
- The post must reflect their unique angle and positioning
- Include a hook in the first line that stops the scroll
- End with something that invites engagement (question, reflection, or soft CTA)
- Do NOT use generic phrases like "In today's world", "Game changer", "Dive deep", "Leverage"
- Do NOT start with "I" as the first word
- Write the complete post ready to publish
"""

_PLATFORM_REQUIREMENTS = {
    "linkedin": "Length: 150-300 words. Use line breaks every 1-2 sentences. Professional but human. No hashtags in the body - max 3 at the end if needed.",
    "instagram": "Length: 100-200 words. Conversational, warm. Use emojis naturally (2-4 max). End with 3-5 relevant hashtags.",
    "twitter": "Length: under 280 characters for a single tweet, OR a thread of 4-6 tweets each under 280 chars. Label threads as '1/', '2/' etc.",
    "tiktok": "Write a spoken script (not a caption). Length: 150-200 words for a 60-90 second video. Conversational, punchy, hook in first 3 seconds.",
    "threads": "Length: 100-200 words. Casual, opinion-driven. Like a voice note turned into text.",
    "youtube": "Write a video description. Length: 150-200 words. Include what the video covers, key takeaways, and a CTA to subscribe.",
}


async def generate_post(
    project_id: str,
    personal_core: dict,
    voice_profile: dict | None,
    platform: str,
    topic: str,
) -> AsyncIterator[str]:
    """Generate a single on-brand post. Yields SSE-formatted strings."""
    try:
        yield _sse("step", {"label": "Loading your voice profile…", "status": "running"})
        yield _sse("progress", {"pct": 15})

        voice_context = _build_voice_context(personal_core, voice_profile)
        platform_reqs = _PLATFORM_REQUIREMENTS.get(platform.lower(), _PLATFORM_REQUIREMENTS["linkedin"])

        prompt = _POST_PROMPT.format(
            voice_context=voice_context,
            platform=platform.capitalize(),
            topic=topic,
            platform_requirements=platform_reqs,
        )

        yield _sse("step", {"label": "Loading your voice profile…", "status": "done"})
        yield _sse("step", {"label": f"Writing your {platform.capitalize()} post…", "status": "running"})
        yield _sse("progress", {"pct": 40})

        from backend.config import settings
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=_POST_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        post_text = response.content[0].text.strip()

        yield _sse("step", {"label": f"Writing your {platform.capitalize()} post…", "status": "done"})
        yield _sse("step", {"label": "Scoring voice accuracy…", "status": "running"})
        yield _sse("progress", {"pct": 85})

        accuracy = _voice_accuracy_score(post_text, voice_profile)

        yield _sse("step", {"label": "Scoring voice accuracy…", "status": "done"})
        yield _sse("progress", {"pct": 100})
        yield _sse("done", {
            "result": {
                "type": "post",
                "platform": platform,
                "topic": topic,
                "content": post_text,
                "voiceAccuracyScore": accuracy,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
        })

    except Exception as exc:
        logger.exception("Post generation failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})


# ---------------------------------------------------------------------------
# 2. Story → Post Converter
# ---------------------------------------------------------------------------

_STORY_SYSTEM = """
You are a personal brand storyteller. You transform raw experiences into
compelling posts that feel authentic - not polished into oblivion. The story
must sound like the specific person, not like a template.
Return ONLY the post text - no commentary, no labels.
""".strip()

_STORY_PROMPT = """
VOICE CONTEXT:
{voice_context}

STORY: {story}

PLATFORM: {platform}
{platform_requirements}

Transform this experience into a {platform} post using the story arc:
1. Hook - what happened (make them stop scrolling)
2. The situation - enough context to feel the moment
3. The turn - the insight, mistake, or realisation
4. The takeaway - what others can learn
5. Soft close - question or reflection, not a hard sell

Rules:
- Keep the vulnerability real - don't sand it down
- Sound like this person, not a life coach
- Do NOT moralize or over-explain the lesson
- Do NOT use phrases like "At the end of the day", "This is why I...", "Let that sink in"
"""


async def story_to_post(
    project_id: str,
    personal_core: dict,
    voice_profile: dict | None,
    story: str,
    platform: str,
) -> AsyncIterator[str]:
    """Convert a personal story/experience into a platform-native post."""
    try:
        yield _sse("step", {"label": "Reading your story…", "status": "running"})
        yield _sse("progress", {"pct": 15})

        voice_context = _build_voice_context(personal_core, voice_profile)
        platform_reqs = _PLATFORM_REQUIREMENTS.get(platform.lower(), _PLATFORM_REQUIREMENTS["linkedin"])

        prompt = _STORY_PROMPT.format(
            voice_context=voice_context,
            story=story,
            platform=platform.capitalize(),
            platform_requirements=platform_reqs,
        )

        yield _sse("step", {"label": "Reading your story…", "status": "done"})
        yield _sse("step", {"label": "Shaping your story into a post…", "status": "running"})
        yield _sse("progress", {"pct": 45})

        from backend.config import settings
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=_STORY_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        post_text = response.content[0].text.strip()

        yield _sse("step", {"label": "Shaping your story into a post…", "status": "done"})
        yield _sse("progress", {"pct": 100})
        yield _sse("done", {
            "result": {
                "type": "story",
                "platform": platform,
                "originalStory": story,
                "content": post_text,
                "voiceAccuracyScore": _voice_accuracy_score(post_text, voice_profile),
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
        })

    except Exception as exc:
        logger.exception("Story-to-post failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})


# ---------------------------------------------------------------------------
# 3. Opinion Extractor → Full Post
# ---------------------------------------------------------------------------

_OPINION_PROBE_SYSTEM = """
You are an editorial coach helping someone articulate a strong opinion for a post.
Ask exactly 3 probing questions - short, sharp, no fluff.
Return ONLY a JSON array of 3 question strings.
""".strip()

_OPINION_PROBE_PROMPT = """
This person wants to write a post about this take: "{take}"

Their voice context:
{voice_context}

Generate 3 probing questions that will draw out the full argument - the evidence,
the nuance, and the counterargument they've already considered.
Return: ["question1", "question2", "question3"]
"""

_OPINION_POST_SYSTEM = """
You are a personal brand content writer. Turn a rough opinion + supporting answers
into a sharp, publishable post. Sound exactly like the person described.
Return ONLY the post text - no commentary, no labels.
""".strip()

_OPINION_POST_PROMPT = """
VOICE CONTEXT:
{voice_context}

PLATFORM: {platform}
{platform_requirements}

THE TAKE: {take}

SUPPORTING ANSWERS:
{answers}

Write a post with:
1. A polarising or surprising hook (first line stops the scroll)
2. The argument - clear, specific, backed by the person's experience
3. The "why most people get this wrong" angle
4. A clear, opinionated close - not a question, a statement

Rules:
- This should feel like a genuine opinion, not clickbait
- Use the person's actual voice and positioning
- Keep it tight - no padding, no filler
"""


async def opinion_extractor(
    project_id: str,
    personal_core: dict,
    voice_profile: dict | None,
    take: str,
    answers: list[str] | None,
    platform: str,
) -> AsyncIterator[str]:
    """
    Two-phase opinion flow:
    - If answers is None/empty → return 3 probing questions (type: 'questions')
    - If answers provided → generate the full post (type: 'post')
    """
    try:
        voice_context = _build_voice_context(personal_core, voice_profile)

        from backend.config import settings
        import anthropic
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        # Phase 1: Generate probing questions
        if not answers:
            yield _sse("step", {"label": "Crafting probing questions…", "status": "running"})
            yield _sse("progress", {"pct": 40})

            probe_prompt = _OPINION_PROBE_PROMPT.format(
                take=take,
                voice_context=voice_context,
            )
            resp = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=300,
                system=_OPINION_PROBE_SYSTEM,
                messages=[{"role": "user", "content": probe_prompt}],
            )
            raw = resp.content[0].text.strip()
            try:
                questions = json.loads(raw)
            except json.JSONDecodeError:
                questions = [raw]  # fallback

            yield _sse("step", {"label": "Crafting probing questions…", "status": "done"})
            yield _sse("progress", {"pct": 100})
            yield _sse("done", {"result": {"type": "questions", "take": take, "questions": questions}})
            return

        # Phase 2: Generate the post from take + answers
        yield _sse("step", {"label": "Analysing your argument…", "status": "running"})
        yield _sse("progress", {"pct": 20})

        platform_reqs = _PLATFORM_REQUIREMENTS.get(platform.lower(), _PLATFORM_REQUIREMENTS["linkedin"])
        answers_text = "\n".join(f"- {a}" for a in answers)

        post_prompt = _OPINION_POST_PROMPT.format(
            voice_context=voice_context,
            platform=platform.capitalize(),
            platform_requirements=platform_reqs,
            take=take,
            answers=answers_text,
        )

        yield _sse("step", {"label": "Analysing your argument…", "status": "done"})
        yield _sse("step", {"label": "Writing your opinion post…", "status": "running"})
        yield _sse("progress", {"pct": 55})

        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=_OPINION_POST_SYSTEM,
            messages=[{"role": "user", "content": post_prompt}],
        )
        post_text = resp.content[0].text.strip()

        yield _sse("step", {"label": "Writing your opinion post…", "status": "done"})
        yield _sse("progress", {"pct": 100})
        yield _sse("done", {
            "result": {
                "type": "opinion",
                "platform": platform,
                "take": take,
                "content": post_text,
                "voiceAccuracyScore": _voice_accuracy_score(post_text, voice_profile),
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
        })

    except Exception as exc:
        logger.exception("Opinion extractor failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})


# ---------------------------------------------------------------------------
# 4. Bio + Headline Writer
# ---------------------------------------------------------------------------

_BIO_SYSTEM = """
You are a personal branding copywriter. Write platform-optimised bios and headlines
that are specific, human, and reflect exactly this person's positioning.
Return ONLY a valid JSON object - no markdown, no code fences.
""".strip()

_BIO_PROMPT = """
VOICE CONTEXT:
{voice_context}

Write bios and headlines for this person across the following platforms.
Each version must be adapted for that platform's culture and character limits.

LinkedIn:
- Headline: max 220 chars - specific role + value + differentiator (not just job title)
- About (first 3 lines): max 300 chars - these are shown before "see more"
- Full About: 200-300 words - story-driven, first person, ends with CTA

Instagram:
- Bio: max 150 chars - punchy, personality, what you do, who you help
- Link in bio label: short CTA (max 30 chars)

Twitter/X:
- Bio: max 160 chars - voice-forward, opinion-signalling, not just a job description

TikTok:
- Bio: max 80 chars - casual, relatable, hooks potential followers

Return this JSON:
{{
  "linkedin": {{
    "headline": "string",
    "aboutPreview": "string - first 3 lines before see more",
    "aboutFull": "string - complete about section"
  }},
  "instagram": {{
    "bio": "string",
    "linkLabel": "string"
  }},
  "twitter": {{
    "bio": "string"
  }},
  "tiktok": {{
    "bio": "string"
  }}
}}
"""


async def bio_writer(
    project_id: str,
    personal_core: dict,
    voice_profile: dict | None,
) -> AsyncIterator[str]:
    """Generate per-platform bios and headlines from Personal Core positioning."""
    try:
        yield _sse("step", {"label": "Reading your positioning…", "status": "running"})
        yield _sse("progress", {"pct": 15})

        voice_context = _build_voice_context(personal_core, voice_profile)

        yield _sse("step", {"label": "Reading your positioning…", "status": "done"})
        yield _sse("step", {"label": "Writing your LinkedIn profile…", "status": "running"})
        yield _sse("progress", {"pct": 35})

        from backend.config import settings
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=_BIO_SYSTEM,
            messages=[{"role": "user", "content": _BIO_PROMPT.format(voice_context=voice_context)}],
        )
        raw = response.content[0].text.strip()

        yield _sse("step", {"label": "Writing your LinkedIn profile…", "status": "done"})
        yield _sse("step", {"label": "Writing Instagram, X, and TikTok bios…", "status": "running"})
        yield _sse("progress", {"pct": 80})

        try:
            bios = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("Bio JSON parse error: %s\nRaw: %s", e, raw[:500])
            yield _sse("error", {"message": "Failed to parse bio output. Please try again."})
            return

        yield _sse("step", {"label": "Writing Instagram, X, and TikTok bios…", "status": "done"})
        yield _sse("progress", {"pct": 100})
        yield _sse("done", {
            "result": {
                "type": "bios",
                "bios": bios,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
        })

    except Exception as exc:
        logger.exception("Bio writer failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})


# ---------------------------------------------------------------------------
# 5. Platform Reformatter
# ---------------------------------------------------------------------------

_REFORMAT_SYSTEM = """
You are a platform-native content strategist. Take one piece of content and reformat
it for multiple platforms simultaneously - preserving the core idea and the person's
voice while making each version feel native to its platform.
Return ONLY a valid JSON object - no markdown, no code fences.
""".strip()

_REFORMAT_PROMPT = """
VOICE CONTEXT:
{voice_context}

ORIGINAL CONTENT ({source_platform}):
{content}

Reformat this for each of these platforms: {target_platforms}

Platform requirements:
{all_requirements}

Return this JSON:
{{
  "platform_name": {{
    "content": "string - the reformatted post",
    "notes": "string - one sentence on what changed and why"
  }}
}}

Include only the requested platforms as keys.
"""


async def reformat_content(
    project_id: str,
    personal_core: dict,
    voice_profile: dict | None,
    content: str,
    source_platform: str,
    target_platforms: list[str],
) -> AsyncIterator[str]:
    """Reformat one piece of content for multiple platforms at once."""
    try:
        yield _sse("step", {"label": "Analysing your content…", "status": "running"})
        yield _sse("progress", {"pct": 15})

        voice_context = _build_voice_context(personal_core, voice_profile)
        platforms_str = ", ".join(target_platforms)
        all_reqs = "\n".join(
            f"{p.upper()}: {_PLATFORM_REQUIREMENTS.get(p.lower(), '')}"
            for p in target_platforms
        )

        prompt = _REFORMAT_PROMPT.format(
            voice_context=voice_context,
            source_platform=source_platform.capitalize(),
            content=content,
            target_platforms=platforms_str,
            all_requirements=all_reqs,
        )

        yield _sse("step", {"label": "Analysing your content…", "status": "done"})
        yield _sse("step", {"label": f"Reformatting for {platforms_str}…", "status": "running"})
        yield _sse("progress", {"pct": 45})

        from backend.config import settings
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=3000,
            system=_REFORMAT_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()

        yield _sse("step", {"label": f"Reformatting for {platforms_str}…", "status": "done"})
        yield _sse("progress", {"pct": 90})

        try:
            reformatted = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("Reformat JSON parse error: %s\nRaw: %s", e, raw[:500])
            yield _sse("error", {"message": "Failed to parse reformatted output. Please try again."})
            return

        yield _sse("progress", {"pct": 100})
        yield _sse("done", {
            "result": {
                "type": "reformat",
                "sourcePlatform": source_platform,
                "originalContent": content,
                "platforms": reformatted,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
        })

    except Exception as exc:
        logger.exception("Content reformat failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})


# ---------------------------------------------------------------------------
# 6. Approve output (voice training)
# ---------------------------------------------------------------------------

def approve_output(project_id: str, content: str, platform: str, edited: bool) -> dict:
    """
    Save an approved/edited output to the voice profile for future calibration.
    Synchronous - called via asyncio.to_thread in the route.
    """
    from backend.services import firebase_service
    db = firebase_service.get_db()
    now = datetime.now(timezone.utc).isoformat()

    doc_ref = db.collection("personal_voice_profiles").document(project_id)
    doc = doc_ref.get()

    entry = {"content": content, "platform": platform, "editedByUser": edited, "approvedAt": now}

    if doc.exists:
        data = doc.to_dict()
        outputs = data.get("approvedOutputs") or []
        outputs.append(entry)
        # Keep last 50 approved outputs
        outputs = outputs[-50:]
        doc_ref.update({"approvedOutputs": outputs, "updatedAt": now})
    else:
        doc_ref.set({"approvedOutputs": [entry], "updatedAt": now, "projectId": project_id})

    return {"saved": True, "approvedAt": now}


# ---------------------------------------------------------------------------
# 7. Thought Leadership Article Writer
# ---------------------------------------------------------------------------

_ARTICLE_SYSTEM = """
You are a ghostwriter specialising in thought leadership content for personal brands.
You write long-form articles that feel like genuine expertise - specific, opinionated,
and unmistakably written by the person described.
Return ONLY the article text - no commentary, no labels, no titles in markdown.
""".strip()

_ARTICLE_PROMPT = """
VOICE CONTEXT:
{voice_context}

TOPIC / ANGLE: {topic}
PLATFORM: {platform}
TARGET LENGTH: {length}
{outline_section}

Write a full {platform} {format_label} with this structure:
1. Opening hook - a specific claim, observation, or question that earns the read (2-3 sentences max)
2. Context - why this matters now, for the specific audience
3. Core argument - 3-5 sections, each with a clear subpoint supported by the person's direct experience or expertise
4. Counterargument acknowledgment - steel-man the opposing view, then address it
5. Close - a clear, opinionated summary and a single CTA (not "follow me", something of genuine value)

Writing rules:
- Write in the first person - this is their direct voice
- Use specific examples from their field, not generic placeholders
- Every section earns its place - no padding, no "in conclusion"
- Do NOT use these phrases: "In today's fast-paced world", "Game-changing", "Dive deep", "Let's explore", "At the end of the day"
- Subheadings are allowed - short and declarative, not questions
- Write to be read, not to impress
"""

_PLATFORM_ARTICLE_FORMATS = {
    "linkedin": ("article", "800-1200 words"),
    "substack": ("newsletter post", "800-1500 words"),
    "medium": ("article", "800-1400 words"),
    "blog": ("blog post", "700-1200 words"),
}


async def write_article(
    project_id: str,
    personal_core: dict,
    voice_profile: dict | None,
    topic: str,
    platform: str,
    outline: str | None = None,
) -> AsyncIterator[str]:
    """Write a full thought leadership article in the user's voice."""
    try:
        yield _sse("step", {"label": "Building your voice context…", "status": "running"})
        yield _sse("progress", {"pct": 10})

        voice_context = _build_voice_context(personal_core, voice_profile)
        fmt, length = _PLATFORM_ARTICLE_FORMATS.get(platform.lower(), ("article", "800-1200 words"))
        outline_section = f"OUTLINE / KEY POINTS TO COVER:\n{outline}" if outline else ""

        prompt = _ARTICLE_PROMPT.format(
            voice_context=voice_context,
            topic=topic,
            platform=platform.capitalize(),
            length=length,
            format_label=fmt,
            outline_section=outline_section,
        )

        yield _sse("step", {"label": "Building your voice context…", "status": "done"})
        yield _sse("step", {"label": f"Writing your {platform.capitalize()} {fmt}…", "status": "running"})
        yield _sse("progress", {"pct": 25})

        from backend.config import settings
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=_ARTICLE_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        article_text = response.content[0].text.strip()

        yield _sse("step", {"label": f"Writing your {platform.capitalize()} {fmt}…", "status": "done"})
        yield _sse("step", {"label": "Scoring voice accuracy…", "status": "running"})
        yield _sse("progress", {"pct": 90})

        accuracy = _voice_accuracy_score(article_text, voice_profile)

        yield _sse("step", {"label": "Scoring voice accuracy…", "status": "done"})
        yield _sse("progress", {"pct": 100})
        yield _sse("done", {
            "result": {
                "type": "article",
                "platform": platform,
                "topic": topic,
                "content": article_text,
                "voiceAccuracyScore": accuracy,
                "wordCount": len(article_text.split()),
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
        })

    except Exception as exc:
        logger.exception("Article writer failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})

    return {"saved": True, "approvedAt": now}
