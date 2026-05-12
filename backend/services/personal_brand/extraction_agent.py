"""
Personal Core extraction agent.

Takes all collected interview answers and synthesises them into a structured
PersonalCore document using Claude. Streams progress events back to the caller
so the frontend can show live status.

SSE event format (same as ingestion pipeline):
  { "type": "step",     "label": "...", "status": "running|done|error" }
  { "type": "progress", "pct": 0-100 }
  { "type": "done",     "personalCore": { ... } }
  { "type": "error",    "message": "..." }
"""

import json
import logging
from typing import AsyncIterator

from backend.services import firebase_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """
You are a personal branding strategist. Your job is to synthesise interview answers
into a structured Personal Core - the identity intelligence layer that will power
all future content generation for this person.

You must return ONLY a valid JSON object with no markdown, no code fences, no commentary.
The JSON must match the schema provided. If a field cannot be determined from the answers,
use null for optional strings or [] for arrays.

Key rules:
- positioningStatement: a single, punchy sentence: "I help [audience] achieve [outcome] by [method]"
- uniqueAngle: the ONE thing that makes this person's perspective different. Be specific.
- contentPillars: exactly 3-5 pillars. Each must have a specific angle, not just a topic name.
  Bad: "Leadership". Good: "Leadership psychology for introverted founders".
- voiceSummary: a concrete description of how they write - sentence length, register, what they never say.
  This is used directly in every future generation prompt.
- avoidedLanguage: extract from both C_avoided_language AND C_writing_samples analysis.
""".strip()

_EXTRACTION_PROMPT_TEMPLATE = """
Here are all the interview answers for {full_name}:

{answers_text}

Based on these answers, generate the Personal Core JSON with exactly this structure:

{{
  "headline": "string - professional one-liner",
  "positioningStatement": "string - I help X achieve Y by Z",
  "uniqueAngle": "string - specific differentiating perspective",
  "originStory": "string - 3-paragraph narrative: start, turning point, now",
  "values": ["string"],
  "credentialHighlights": ["string - top 3-5 proof points"],
  "expertiseTopics": [
    {{ "topic": "string", "depth": 1-3, "differentiatingAngle": "string" }}
  ],
  "avoidedTopics": ["string"],
  "targetAudience": {{
    "role": "string",
    "industry": "string",
    "painPoints": ["string"],
    "goals": ["string"],
    "primaryPlatforms": ["string"]
  }},
  "contentPillars": [
    {{
      "name": "string - specific angle, not just topic",
      "description": "string",
      "contentAngles": ["string - 3 specific sub-angles"],
      "percentage": 20
    }}
  ],
  "platformStrategy": {{
    "linkedin": {{ "focusLevel": "primary|secondary|passive", "postsPerWeek": 3, "contentTypes": ["text", "carousel"] }},
    "instagram": {{ "focusLevel": "primary|secondary|passive", "postsPerWeek": 2, "contentTypes": ["carousel", "reels"] }}
  }},
  "brandGoals": ["string"],
  "goal90Day": "string - specific, measurable",
  "goal12Month": "string - specific, measurable",
  "admiredVoices": ["string"],
  "antiVoices": ["string"],
  "nicheTiredTopics": ["string"],
  "voiceSummary": {{
    "formalityLevel": 1-5,
    "sentenceLength": "short|medium|long|mixed",
    "emotionalRegister": "analytical|warm|direct|storytelling|provocative",
    "signaturePhrases": ["string"],
    "avoidedPhrases": ["string"],
    "punctuationStyle": "string",
    "writingSamples": ["string - excerpt from their samples if provided"]
  }}
}}

Return only the JSON. No markdown. No explanation.
"""


async def run(project_id: str, full_name: str, answers: dict) -> AsyncIterator[str]:
    """
    Synthesise interview answers into a PersonalCore document.
    Yields SSE-formatted strings.
    """
    try:
        yield _sse("step", {"label": "Analysing your answers…", "status": "running"})
        yield _sse("progress", {"pct": 10})

        # Build answers text for the prompt
        answers_text = _format_answers(answers)

        yield _sse("step", {"label": "Analysing your answers…", "status": "done"})
        yield _sse("step", {"label": "Building your Personal Core…", "status": "running"})
        yield _sse("progress", {"pct": 30})

        # Call Claude
        from backend.config import settings
        import anthropic
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        prompt = _EXTRACTION_PROMPT_TEMPLATE.format(
            full_name=full_name,
            answers_text=answers_text,
        )

        response = client.messages.create(
            model=settings.LLM_EXTRACTION_MODEL or "claude-sonnet-4-6",
            max_tokens=4096,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text.strip()

        yield _sse("step", {"label": "Building your Personal Core…", "status": "done"})
        yield _sse("step", {"label": "Saving your Personal Core…", "status": "running"})
        yield _sse("progress", {"pct": 80})

        # Parse the JSON
        try:
            extracted = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("Personal Core extraction - JSON parse error: %s\nRaw: %s", e, raw[:500])
            yield _sse("error", {"message": "Failed to parse extracted data. Please try again."})
            return

        # Persist to Firestore
        voice_summary = extracted.pop("voiceSummary", {})

        updates = {
            **{k: v for k, v in extracted.items() if v is not None},
            "interviewStatus": "complete",
            "interviewProgress": 100,
            "completenessScore": _calculate_completeness(extracted),
        }
        firebase_service.update_personal_core(project_id, updates)

        # Save voice profile as a separate document
        if voice_summary:
            _save_voice_profile(project_id, full_name, voice_summary, answers)

        yield _sse("step", {"label": "Saving your Personal Core…", "status": "done"})
        yield _sse("progress", {"pct": 100})

        personal_core = firebase_service.get_personal_core(project_id)
        yield _sse("done", {"personalCore": personal_core})

    except Exception as exc:
        logger.exception("Personal Core extraction failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sse(event_type: str, data: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **data})}\n\n"


def _format_answers(answers: dict) -> str:
    """Format answers dict as readable Q&A text for the prompt."""
    from backend.services.personal_brand.interview_questions import get_question_by_key
    lines = []
    for key, answer in answers.items():
        q = get_question_by_key(key)
        prompt = q["prompt"] if q else key
        lines.append(f"Q: {prompt}\nA: {answer}\n")
    return "\n".join(lines)


def _calculate_completeness(extracted: dict) -> int:
    """Return a 0-100 completeness score based on filled fields."""
    key_fields = [
        "headline", "positioningStatement", "uniqueAngle", "originStory",
        "values", "expertiseTopics", "targetAudience", "contentPillars",
        "brandGoals", "goal90Day", "goal12Month",
    ]
    filled = sum(1 for f in key_fields if extracted.get(f))
    return int((filled / len(key_fields)) * 100)


def _save_voice_profile(project_id: str, full_name: str, voice_summary: dict, answers: dict) -> None:
    """Save the extracted voice profile to the personal_voice_profiles collection."""
    from backend.services import firebase_service as fs
    from datetime import datetime, timezone

    writing_samples = []
    if answers.get("C_writing_samples"):
        writing_samples = [answers["C_writing_samples"]]

    db = fs.get_db()
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "projectId": project_id,
        "formalityLevel": voice_summary.get("formalityLevel", 3),
        "sentenceLength": voice_summary.get("sentenceLength", "mixed"),
        "emotionalRegister": voice_summary.get("emotionalRegister", "direct"),
        "signaturePhrases": voice_summary.get("signaturePhrases", []),
        "avoidedPhrases": voice_summary.get("avoidedPhrases", []),
        "punctuationStyle": voice_summary.get("punctuationStyle", ""),
        "writingSamples": writing_samples,
        "approvedOutputs": [],
        "accuracyScore": 0,
        "toneVariants": {},
        "lastCalibrated": now,
        "createdAt": now,
        "updatedAt": now,
    }
    db.collection("personal_voice_profiles").document(project_id).set(data)
