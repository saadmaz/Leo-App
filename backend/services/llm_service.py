"""
LLM service - wraps the Anthropic SDK for conversational streaming.

Responsibilities:
  - Singleton AsyncAnthropic client (one per process, thread-safe).
  - Building the system prompt from Brand Core data.
  - Streaming Claude responses as SSE-formatted chunks.
  - Defining the artifact output format Claude is expected to follow.

All model names, token limits, and context window sizes come from
backend.config.settings so they can be changed without a code deploy.
"""

import json
import logging
from typing import AsyncGenerator, Optional

import anthropic
from google import genai as google_genai

from backend.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Channel presets - platform-specific constraints injected into system prompt
# ---------------------------------------------------------------------------

CHANNEL_PRESETS: dict[str, dict] = {
    "instagram": {
        "label": "Instagram",
        "constraints": (
            "CHANNEL: Instagram.\n"
            "- Captions: ideally under 150 chars for feed; up to 2,200 for carousel/educational posts.\n"
            "- Use 5–10 focused hashtags. Place them after two blank lines or in the first comment.\n"
            "- Lead with a strong hook in the first line (shown before 'more').\n"
            "- Tone: warm, aspirational, story-driven. Emojis used sparingly.\n"
            "- Reels scripts: hook (0–3 s), value (3–45 s), CTA.\n"
            "- Output captions using the 'captions' artifact type."
        ),
    },
    "linkedin": {
        "label": "LinkedIn",
        "constraints": (
            "CHANNEL: LinkedIn.\n"
            "- Posts: 150–300 words; first 3 lines shown before 'see more' - hook immediately.\n"
            "- Tone: professional, insightful, thought-leadership. First-person works well.\n"
            "- Structure: hook → insight → evidence → CTA.\n"
            "- Limit hashtags to 3–5 relevant ones.\n"
            "- Output posts using the 'captions' artifact type with platform='LinkedIn'."
        ),
    },
    "twitter": {
        "label": "X / Twitter",
        "constraints": (
            "CHANNEL: X (Twitter).\n"
            "- Single tweets: 280 chars max. Be punchy and direct.\n"
            "- Threads: number each tweet (1/, 2/, …). Ideal length: 5–10 tweets.\n"
            "- Tone: conversational, confident. First tweet must stand alone.\n"
            "- Hashtags: 1–2 max.\n"
            "- Output tweets using the 'captions' artifact type with platform='X'."
        ),
    },
    "tiktok": {
        "label": "TikTok",
        "constraints": (
            "CHANNEL: TikTok.\n"
            "- Scripts: hook (0–3 s), content (3–45 s), CTA.\n"
            "- Tone: authentic, energetic, trend-aware. Speak directly to camera.\n"
            "- Captions: short (1–3 lines), 3–5 hashtags.\n"
            "- Output video scripts using the 'video_script' artifact type with platform='TikTok'.\n"
            "- Output post captions using the 'captions' artifact type."
        ),
    },
    "meta_ads": {
        "label": "Meta Ads",
        "constraints": (
            "CHANNEL: Meta Ads (Facebook + Instagram).\n"
            "- Primary text: ≤125 chars without truncation.\n"
            "- Headline: ≤27 chars. Description: ≤27 chars.\n"
            "- Always produce 3+ variants for A/B testing.\n"
            "- Output using the 'ad_copy' artifact type with platform='Meta'."
        ),
    },
    "google_ads": {
        "label": "Google Ads",
        "constraints": (
            "CHANNEL: Google Ads (Search).\n"
            "- RSA: up to 15 headlines (30 chars), 4 descriptions (90 chars).\n"
            "- Headlines must be keyword-relevant. Descriptions highlight USP + CTA.\n"
            "- Output using the 'ad_copy' artifact type with platform='Google'."
        ),
    },
    "email": {
        "label": "Email",
        "constraints": (
            "CHANNEL: Email marketing.\n"
            "- Subject line: 30–50 chars. Preview text: 40–130 chars.\n"
            "- Structure: hook → value → proof → CTA.\n"
            "- One clear primary CTA per email.\n"
            "- Output using the 'email_content' artifact type (subject, previewText, body, cta)."
        ),
    },
}

# ---------------------------------------------------------------------------
# Client singleton
# ---------------------------------------------------------------------------

# Module-level clients; lazily initialised on first use.
_client: Optional[anthropic.AsyncAnthropic] = None
_gemini_client: Optional[google_genai.Client] = None


def get_client() -> anthropic.AsyncAnthropic:
    """
    Return the shared AsyncAnthropic client, creating it on first call.
    Raises RuntimeError if ANTHROPIC_API_KEY is not configured.
    """
    global _client
    if _client is None:
        if not settings.ANTHROPIC_API_KEY:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. "
                "Add it to backend/.env or set it as an environment variable."
            )
        _client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def get_gemini_client() -> google_genai.Client:
    """
    Return the shared google-genai Client, creating it on first call.
    Used by campaign generation, brand extraction, and image generation.
    Raises RuntimeError if GEMINI_API_KEY is not configured.
    """
    global _gemini_client
    if _gemini_client is None:
        if not settings.GEMINI_API_KEY:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. "
                "Add it to backend/.env to enable Gemini features."
            )
        _gemini_client = google_genai.Client(api_key=settings.GEMINI_API_KEY)
    return _gemini_client


# ---------------------------------------------------------------------------
# Brand Core → system prompt
# ---------------------------------------------------------------------------

def build_brand_core_context(brand_core: Optional[dict]) -> str:
    """
    Serialize a Brand Core dict into a concise system-prompt section.

    If brand_core contains the sentinel key '__personal_core__', delegates to
    build_personal_core_context() for personal brand projects.

    If brand_core is None or empty, returns a guidance string that nudges
    the user towards setting one up rather than silently ignoring it.
    """
    # Personal brand sentinel - delegate to personal core builder
    if brand_core and "__personal_core__" in brand_core:
        return build_personal_core_context(brand_core["__personal_core__"])

    if not brand_core:
        return (
            "No Brand Core has been set up for this project yet. "
            "When the user asks you to analyse their brand, guide them to provide "
            "their website URL or social media links so you can build one."
        )

    sections: list[str] = []

    tone = brand_core.get("tone") or {}
    if tone:
        sections.append(
            f"TONE & VOICE: style={tone.get('style', '')}, "
            f"formality={tone.get('formality', '')}, "
            f"key phrases={tone.get('keyPhrases', [])}, "
            f"avoided language={tone.get('avoidedLanguage', [])}."
        )

    visual = brand_core.get("visual") or {}
    if visual:
        sections.append(
            f"VISUAL IDENTITY: primary colour={visual.get('primaryColour', '')}, "
            f"secondary colours={visual.get('secondaryColours', [])}, "
            f"fonts={visual.get('fonts', [])}, "
            f"image style={visual.get('imageStyle', '')}."
        )

    if brand_core.get("themes"):
        sections.append(f"CONTENT THEMES: {', '.join(brand_core['themes'])}.")

    if brand_core.get("tagline"):
        sections.append(f"TAGLINE: {brand_core['tagline']}.")

    messaging = brand_core.get("messaging") or {}
    if messaging.get("valueProp"):
        sections.append(f"VALUE PROPOSITION: {messaging['valueProp']}.")
    if messaging.get("keyClaims"):
        sections.append(f"KEY CLAIMS: {', '.join(messaging['keyClaims'])}.")

    audience = brand_core.get("audience") or {}
    if audience.get("demographics"):
        sections.append(f"AUDIENCE: {audience['demographics']}.")

    if brand_core.get("competitors"):
        sections.append(f"COMPETITORS: {', '.join(brand_core['competitors'])}.")

    return "\n".join(sections) if sections else "Brand Core is incomplete - treat as a general brand."


def build_personal_core_context(personal_core: Optional[dict]) -> str:
    """
    Serialize a Personal Core dict into a system-prompt section for personal
    brand projects. Replaces build_brand_core_context() for personal projects.
    """
    if not personal_core:
        return (
            "No Personal Core has been set up yet. "
            "Guide the user to complete their discovery interview so LEO can learn their voice, "
            "positioning, and content strategy."
        )

    sections: list[str] = []

    full_name = personal_core.get("fullName", "")
    if full_name:
        sections.append(f"PERSON: {full_name}.")

    positioning = personal_core.get("positioningStatement", "")
    if positioning:
        sections.append(f"POSITIONING: {positioning}")

    unique_angle = personal_core.get("uniqueAngle", "")
    if unique_angle:
        sections.append(f"UNIQUE ANGLE: {unique_angle}")

    values = personal_core.get("values", [])
    if values:
        sections.append(f"CORE VALUES: {', '.join(values)}.")

    avoided_topics = personal_core.get("avoidedTopics", [])
    if avoided_topics:
        sections.append(f"AVOID THESE TOPICS: {', '.join(avoided_topics)}.")

    target_audience = personal_core.get("targetAudience", {})
    if target_audience:
        role = target_audience.get("role", "")
        industry = target_audience.get("industry", "")
        if role or industry:
            sections.append(f"TARGET AUDIENCE: {role} in {industry}.")

    content_pillars = personal_core.get("contentPillars", [])
    if content_pillars:
        pillar_names = [p.get("name", p) if isinstance(p, dict) else str(p) for p in content_pillars]
        sections.append(f"CONTENT PILLARS: {', '.join(pillar_names)}.")

    goal_90 = personal_core.get("goal90Day", "")
    if goal_90:
        sections.append(f"90-DAY GOAL: {goal_90}")

    # Voice profile context (if nested in the personal_core or passed separately)
    voice = personal_core.get("voiceProfile", {})
    if voice:
        formality_labels = {1: "very casual", 2: "casual", 3: "balanced", 4: "formal", 5: "very formal"}
        formality = voice.get("formalityLevel")
        register = voice.get("emotionalRegister", "")
        sig_phrases = voice.get("signaturePhrases", [])
        avoided_phrases = voice.get("avoidedPhrases", [])

        voice_parts = []
        if formality:
            voice_parts.append(f"tone={formality_labels.get(formality, 'balanced')}")
        if register:
            voice_parts.append(f"register={register}")
        if sig_phrases:
            voice_parts.append(f"signature phrases: {', '.join(sig_phrases[:4])}")
        if avoided_phrases:
            voice_parts.append(f"never use: {', '.join(avoided_phrases[:5])}")
        if voice_parts:
            sections.append(f"VOICE: {'; '.join(voice_parts)}.")

    instruction = (
        f"\n\nYou are writing content FOR {full_name or 'this person'}, not about them. "
        "Match their voice precisely. Do not sound like generic AI content. "
        "Every output must feel like they wrote it themselves."
    )

    return ("\n".join(sections) if sections else "Personal Core is incomplete.") + instruction


# ---------------------------------------------------------------------------
# Artifact output instructions (injected into every system prompt)
# ---------------------------------------------------------------------------

# This constant defines the structured output format Leo uses for renderable
# UI cards (captions, ad copy, campaign briefs, colour palettes).
# Keep in sync with frontend/src/components/chat/artifact-cards.tsx.
ARTIFACT_INSTRUCTIONS = """\

STRUCTURED OUTPUT - ARTIFACTS:
When you produce structured content (captions, ad copy, campaign briefs, colour palettes),
wrap it in an artifact block so the UI can render it as an interactive card.

Format:
<artifact type="TYPE">
{JSON}
</artifact>

Supported artifact types and their JSON shapes:

type="captions"
{
  "platform": "Instagram" | "LinkedIn" | "Twitter" | "TikTok" | "Facebook",
  "captions": [
    { "text": "...", "hashtags": ["tag1", "tag2"] }
  ]
}

type="ad_copy"
{
  "platform": "Meta" | "Google" | "TikTok" | "LinkedIn" | "X",
  "variants": [
    { "headline": "...", "body": "...", "cta": "..." }
  ]
}

type="campaign_brief"
{
  "name": "...",
  "objective": "...",
  "audience": "...",
  "channels": ["..."],
  "timeline": "...",
  "kpis": ["..."],
  "budget_guidance": "...",
  "key_messages": ["..."]
}

type="colour_palette"
{
  "colours": [
    { "hex": "#XXXXXX", "name": "...", "usage": "..." }
  ]
}

type="content_calendar"
{
  "period": "Week of March 24" | "April 2026" | "...",
  "entries": [
    {
      "day": "Monday",
      "platform": "Instagram" | "LinkedIn" | "X" | "TikTok" | "Facebook" | "Email",
      "content": "...",
      "time": "9:00 AM",
      "hashtags": ["tag1", "tag2"]
    }
  ]
}

type="video_script"
{
  "platform": "TikTok" | "Instagram Reels" | "YouTube Shorts" | "YouTube",
  "duration": "30s" | "60s" | "3–5 min" | "...",
  "scenes": [
    {
      "timestamp": "0:00–0:03",
      "visual": "Description of what to show on screen",
      "audio": "Voiceover / dialogue / music note",
      "caption": "On-screen text overlay (optional)"
    }
  ],
  "hashtags": ["tag1", "tag2"]
}

type="email_content"
{
  "subject": "30–50 char subject line",
  "previewText": "40–130 char preview shown in inbox",
  "body": "Full email body in plain text or light markdown",
  "cta": "Button / link text"
}

type="image_prompt"
{
  "prompt": "Detailed image generation prompt optimised for Imagen 3",
  "style": "vivid" | "natural",
  "aspectRatio": "square" | "landscape" | "portrait",
  "context": "Brief explanation of how this image fits the brand or campaign"
}

type="research_report"
{
  "title": "Short descriptive title for the report",
  "report_id": "Firestore report ID (if available, else omit)",
  "executive_summary": "2-3 sentence summary of key findings",
  "report_type": "market" | "competitor" | "audience" | "trend",
  "sections": [
    { "heading": "...", "content": "..." }
  ],
  "key_insights": ["...", "..."],
  "sources": [{ "title": "...", "url": "..." }]
}

type="competitor_landscape"
{
  "competitors": [
    {
      "name": "...",
      "url": "...",
      "positioning": "...",
      "strengths": ["..."],
      "weaknesses": ["..."],
      "content_gaps": ["..."]
    }
  ],
  "market_summary": "...",
  "opportunities": ["..."]
}

type="influencer_list"
{
  "topic": "...",
  "platform": "...",
  "influencers": [
    {
      "name": "...",
      "url": "...",
      "bio": "...",
      "estimated_reach": "...",
      "relevance_score": 0.0,
      "brand_alignment": "..."
    }
  ]
}

type="strategy_brief"
{
  "title": "...",
  "summary": "...",
  "sections": [{ "title": "...", "content": "..." }],
  "key_actions": ["..."],
  "timeline": "...",
  "success_metrics": ["..."]
}

type="seo_brief"
{
  "topic": "...",
  "target_keywords": [{ "keyword": "...", "intent": "informational|transactional|navigational", "difficulty": "low|medium|high", "opportunity": "..." }],
  "title_suggestions": ["..."],
  "meta_description": "...",
  "outline": ["..."],
  "quick_wins": ["..."]
}

type="brand_audit_result"
{
  "average_score": 72,
  "overall_grade": "B",
  "summary": "...",
  "items": [{ "label": "...", "score": 80, "grade": "B", "summary": "...", "top_issue": "..." }],
  "top_recommendations": ["..."]
}

Rules:
- Always use an artifact for captions (3+ items), ad copy, campaign briefs, colour palettes, content calendars, video scripts, email content, and image prompts.
- Use strategy_brief when generating a marketing strategy, GTM plan, or strategic recommendation.
- Use seo_brief when providing SEO keyword research or content optimization guidance.
- Use brand_audit_result when scoring content against brand voice inline in chat.
- Place the artifact after a short conversational intro - never instead of it.
- Put ONLY JSON inside the artifact block. No markdown inside the block.
- You may include multiple artifacts in one response if appropriate.
- For everything else (strategy, analysis, explanations), use normal markdown.
- When the user asks for an image or visual content, output an image_prompt artifact instead of describing the image - the UI will generate it.
"""


# ---------------------------------------------------------------------------
# Simple non-streaming call (used by competitor research, batch analysis)
# ---------------------------------------------------------------------------

async def call_claude_raw(
    prompt: str,
    system: str = "",
    max_tokens: int = 2048,
    model: Optional[str] = None,
) -> str:
    """
    Single-turn, non-streaming Claude call. Returns the full text response.
    Used for batch analysis tasks (competitor research, SWOT synthesis, etc.).
    """
    client = get_client()
    chosen_model = model or settings.LLM_CHAT_MODEL
    messages = [{"role": "user", "content": prompt}]
    kwargs: dict = {"model": chosen_model, "max_tokens": max_tokens, "messages": messages}
    if system:
        kwargs["system"] = system
    response = await client.messages.create(**kwargs)
    return response.content[0].text if response.content else ""


# ---------------------------------------------------------------------------
# Streaming chat
# ---------------------------------------------------------------------------

async def stream_chat(
    project_name: str,
    brand_core: Optional[dict],
    history: list[dict],
    user_message: str,
    channel: Optional[str] = None,
    images: Optional[list] = None,
    model: Optional[str] = None,
    memory_context: Optional[str] = None,
    knowledge_context: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Stream a Claude response as SSE-formatted text chunks.

    Each yielded string is a complete SSE line:
        data: {"type": "delta", "content": "..."}\n\n
    The final sentinel is:
        data: [DONE]\n\n

    Args:
        project_name:  Used in the system prompt to keep Leo on-brand.
        brand_core:    Brand Core dict from Firestore (may be None).
        history:       Prior messages in [{"role": ..., "content": ...}] format.
                       Should NOT include the current user_message - it is
                       appended here.
        user_message:  The user's latest message text.

    Yields:
        SSE data lines (strings). Callers should yield them directly into
        a FastAPI StreamingResponse.
    """
    client = get_client()

    channel_section = ""
    if channel and channel in CHANNEL_PRESETS:
        preset = CHANNEL_PRESETS[channel]
        channel_section = f"\n\nCHANNEL CONSTRAINTS:\n{preset['constraints']}"

    memory_section = f"\n\n{memory_context}" if memory_context else ""
    knowledge_section = f"\n\n{knowledge_context}" if knowledge_context else ""

    # Dynamic portion (changes per project/channel/memory - not cached)
    dynamic_text = (
        f"You are LEO, a brand-aware marketing co-pilot for the brand '{project_name}'. "
        "You help marketers create on-brand campaigns, content, copy, and strategy "
        "through natural conversation. Always stay on-brand. Be concise, strategic, "
        "and actionable.\n\n"
        "BRAND CORE:\n"
        + build_brand_core_context(brand_core)
        + knowledge_section
        + memory_section
        + channel_section
    )

    # System prompt as multi-block list so Anthropic can cache ARTIFACT_INSTRUCTIONS.
    # The static block (artifact format) is marked with cache_control - Claude caches
    # it for 5 minutes, costing only 10% of normal input tokens on cache hits.
    system_prompt = [
        {"type": "text", "text": dynamic_text},
        {
            "type": "text",
            "text": ARTIFACT_INSTRUCTIONS,
            "cache_control": {"type": "ephemeral"},
        },
    ]

    # Trim history to the configured context window to control token cost.
    # LLM_CONTEXT_MESSAGES is the number of *prior* turns to include.
    context_window = history[-settings.LLM_CONTEXT_MESSAGES:]

    messages = [
        {"role": m["role"], "content": m["content"]}
        for m in context_window
    ]

    # Build the final user turn - plain text, or a multi-part content block
    # when image attachments are present (Anthropic vision API).
    if images:
        user_content: list[dict] = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img["mediaType"],
                    "data": img["base64"],
                },
            }
            for img in images
        ]
        user_content.append({"type": "text", "text": user_message})
    else:
        user_content = user_message  # type: ignore[assignment]

    messages.append({"role": "user", "content": user_content})

    try:
        async with client.messages.stream(
            model=model or settings.LLM_CHAT_MODEL,
            max_tokens=settings.LLM_MAX_TOKENS,
            system=system_prompt,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'type': 'delta', 'content': text})}\n\n"

        yield "data: [DONE]\n\n"

    except anthropic.APIError as exc:
        logger.error("Anthropic API error during chat stream: %s", exc)
        yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"


# ---------------------------------------------------------------------------
# Trend context builder (for content generation enrichment)
# ---------------------------------------------------------------------------

# Keywords that indicate content-generation intent
_CONTENT_INTENT_KEYWORDS = frozenset([
    "write", "create", "generate", "draft", "caption", "post", "copy",
    "email", "ad", "script", "blog", "article", "campaign",
])

# In-process trend cache: key = "topic||platform", value = (result_str, expiry_epoch)
import time as _time
_trend_cache: dict[str, tuple[str, float]] = {}
_TREND_CACHE_TTL = 1800  # 30 minutes - trends don't change faster than this


async def build_trend_context(
    topic: str,
    platform: str,
    brand_core: Optional[dict] = None,
) -> str:
    """
    Fetch current trending content signals for a topic + platform combo.
    Results are cached in-process for 30 minutes to avoid burning Tavily
    credits on repeated messages about the same topic in the same session.
    Uses ~2 Tavily credits on a cache miss; 0 on a cache hit.
    """
    cache_key = f"{topic[:60]}||{platform}"
    now = _time.monotonic()
    cached = _trend_cache.get(cache_key)
    if cached and now < cached[1]:
        return cached[0]

    try:
        from backend.services.integrations import tavily_client
        query = f"trending {topic} content {platform} 2025 strategy"
        resp = await tavily_client.search_basic(
            query=query,
            max_results=3,
            include_answer=True,
        )
        snippets = []
        if resp.get("answer"):
            snippets.append(resp["answer"])
        for r in resp.get("results", [])[:3]:
            content = r.get("content", "")[:200]
            if content:
                snippets.append(f"- {content}")
        if snippets:
            result = "CURRENT TRENDS (live data):\n" + "\n".join(snippets)
            _trend_cache[cache_key] = (result, now + _TREND_CACHE_TTL)
            return result
    except Exception as exc:
        logger.debug("build_trend_context failed (non-fatal): %s", exc)
    return ""


# ---------------------------------------------------------------------------
# Agentic streaming chat with tool use
# ---------------------------------------------------------------------------

# Maximum tool-use iterations per response to prevent infinite loops
_MAX_TOOL_ITERATIONS = 3


async def stream_chat_with_tools(
    project_name: str,
    brand_core: Optional[dict],
    history: list[dict],
    user_message: str,
    channel: Optional[str] = None,
    images: Optional[list] = None,
    model: Optional[str] = None,
    memory_context: Optional[str] = None,
    project_id: Optional[str] = None,
    knowledge_context: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Agentic streaming chat that can invoke web search tools mid-conversation.

    Implements the tool-use loop:
      1. Send message to Claude with SEARCH_TOOLS defined.
      2. If Claude returns tool_use blocks → execute via tool_dispatcher.
      3. Stream SSE tool_call / tool_result events to frontend.
      4. Feed tool results back as tool_result blocks.
      5. Stream final text response.
      6. Repeat up to _MAX_TOOL_ITERATIONS.

    Falls back to plain stream_chat if tool use is unavailable (no API keys).

    New SSE event types emitted (frontend should handle gracefully):
      {"type": "tool_call",   "tool": "web_search", "query": "..."}
      {"type": "tool_result", "tool": "web_search",  "result_count": 5}
    """
    from backend.services.tool_dispatcher import SEARCH_TOOLS, dispatch_tool

    client = get_client()

    # Check if content-generation intent detected → inject trend context
    trend_context = ""
    msg_lower = user_message.lower()
    if any(kw in msg_lower for kw in _CONTENT_INTENT_KEYWORDS):
        # Extract a rough topic from the message (first 5 words after intent keyword)
        topic_hint = " ".join(user_message.split()[:8])
        channel_label = CHANNEL_PRESETS.get(channel or "", {}).get("label", "social media")
        try:
            trend_context = await build_trend_context(topic_hint, channel_label, brand_core)
        except Exception:
            pass

    channel_section = ""
    if channel and channel in CHANNEL_PRESETS:
        preset = CHANNEL_PRESETS[channel]
        channel_section = f"\n\nCHANNEL CONSTRAINTS:\n{preset['constraints']}"

    memory_section = f"\n\n{memory_context}" if memory_context else ""
    trend_section = f"\n\n{trend_context}" if trend_context else ""
    knowledge_section = f"\n\n{knowledge_context}" if knowledge_context else ""

    dynamic_text = (
        f"You are LEO, a brand-aware marketing co-pilot for the brand '{project_name}'. "
        "You help marketers create on-brand campaigns, content, copy, and strategy "
        "through natural conversation. Always stay on-brand. Be concise, strategic, "
        "and actionable.\n\n"
        "You have access to web search tools. Use them proactively when the user asks "
        "about competitors, market trends, recent news, or anything requiring current data. "
        "Always cite your sources.\n\n"
        "BRAND CORE:\n"
        + build_brand_core_context(brand_core)
        + knowledge_section
        + memory_section
        + trend_section
        + channel_section
    )

    system_prompt = [
        {"type": "text", "text": dynamic_text},
        {
            "type": "text",
            "text": ARTIFACT_INSTRUCTIONS,
            "cache_control": {"type": "ephemeral"},
        },
    ]

    context_window = history[-settings.LLM_CONTEXT_MESSAGES:]
    messages = [
        {"role": m["role"], "content": m["content"]}
        for m in context_window
    ]

    if images:
        user_content: list[dict] = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img["mediaType"],
                    "data": img["base64"],
                },
            }
            for img in images
        ]
        user_content.append({"type": "text", "text": user_message})
    else:
        user_content = user_message  # type: ignore[assignment]

    messages.append({"role": "user", "content": user_content})

    chosen_model = model or settings.LLM_CHAT_MODEL

    try:
        for _iteration in range(_MAX_TOOL_ITERATIONS):
            # Non-streaming call when tool use is in play (tools require non-stream for reliability)
            response = await client.messages.create(
                model=chosen_model,
                max_tokens=settings.LLM_MAX_TOKENS,
                system=system_prompt,
                messages=messages,
                tools=SEARCH_TOOLS,
                tool_choice={"type": "auto"},
            )

            # Collect any text blocks to stream immediately
            text_blocks = [b for b in response.content if b.type == "text"]
            tool_blocks = [b for b in response.content if b.type == "tool_use"]

            # Stream text content if present
            for block in text_blocks:
                if block.text:
                    # Chunk it to feel like streaming
                    chunk_size = 40
                    for i in range(0, len(block.text), chunk_size):
                        chunk = block.text[i:i + chunk_size]
                        yield f"data: {json.dumps({'type': 'delta', 'content': chunk})}\n\n"

            # If no tool calls, we're done
            if not tool_blocks or response.stop_reason == "end_turn":
                break

            # Execute tool calls
            tool_results = []
            for tool_block in tool_blocks:
                tool_name = tool_block.name
                tool_input = tool_block.input or {}

                # Signal to frontend that a tool call is happening
                query_hint = (
                    tool_input.get("query")
                    or tool_input.get("brand_name")
                    or tool_input.get("url", "")
                )
                yield f"data: {json.dumps({'type': 'tool_call', 'tool': tool_name, 'query': query_hint})}\n\n"

                # Execute the tool
                result_text = await dispatch_tool(tool_name, tool_input, project_id)

                # Signal result back to frontend
                result_preview = result_text[:100].replace("\n", " ")
                yield f"data: {json.dumps({'type': 'tool_result', 'tool': tool_name, 'preview': result_preview})}\n\n"

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_block.id,
                    "content": result_text,
                })

            # Add assistant turn + tool results to message history for next iteration
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})

        yield "data: [DONE]\n\n"

    except anthropic.APIError as exc:
        logger.error("Anthropic API error during tool-use chat stream: %s", exc)
        yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"
