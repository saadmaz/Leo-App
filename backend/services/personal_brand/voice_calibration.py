"""
Voice Calibration Service.

Re-analyses approved outputs and new writing samples to keep the Voice Profile
accurate as the user creates more content.

Endpoints:
  POST /projects/{id}/persona/voice/samples     – Add new writing samples (SSE)
  POST /projects/{id}/persona/voice/calibrate   – Re-calibrate from approved outputs (SSE)

SSE event format:
  { "type": "step",     "label": "...", "status": "running|done|error" }
  { "type": "progress", "pct": 0-100 }
  { "type": "done",     "voiceProfile": { ... } }
  { "type": "error",    "message": "..." }
"""

import json
import logging
from datetime import datetime, timezone
from typing import AsyncIterator

logger = logging.getLogger(__name__)


def _sse(event_type: str, data: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **data})}\n\n"


_CALIBRATION_SYSTEM = """
You are a voice analysis expert. Analyse writing samples and extract precise voice
characteristics. Return ONLY a valid JSON object - no markdown, no code fences.
""".strip()

_CALIBRATION_PROMPT = """
Analyse the following writing samples from one person and extract their voice profile.

WRITING SAMPLES:
{samples_text}

{approved_outputs_section}

Return this JSON:
{{
  "formalityLevel": 1-5,
  "sentenceLength": "short|medium|long|mixed",
  "emotionalRegister": "analytical|warm|direct|storytelling|provocative",
  "signaturePhrases": ["up to 8 phrases or constructions that appear repeatedly"],
  "avoidedPhrases": ["phrases or words they clearly never use"],
  "punctuationStyle": "brief notes e.g. 'uses em dashes, no oxford comma, rhetorical questions'",
  "writingPatterns": ["3-5 structural patterns e.g. 'starts paragraphs with a claim, then proof'"],
  "accuracyScore": 0-100
}}

Base the accuracyScore on how many samples you have and how consistent the voice is across them.
More samples = higher confidence = higher score. Fewer than 3 samples = max 65.
"""


async def add_samples_and_calibrate(
    project_id: str,
    new_samples: list[str],
) -> AsyncIterator[str]:
    """
    Add new writing samples to the voice profile and trigger a full re-calibration.
    """
    try:
        yield _sse("step", {"label": "Saving your writing samples…", "status": "running"})
        yield _sse("progress", {"pct": 10})

        from backend.services import firebase_service
        db = firebase_service.get_db()
        now = datetime.now(timezone.utc).isoformat()

        doc_ref = db.collection("personal_voice_profiles").document(project_id)
        doc = doc_ref.get()
        existing = doc.to_dict() if doc.exists else {}

        # Merge new samples with existing, deduplicate, keep last 20
        all_samples = list(existing.get("writingSamples") or [])
        for s in new_samples:
            s = s.strip()
            if s and s not in all_samples:
                all_samples.append(s)
        all_samples = all_samples[-20:]

        yield _sse("step", {"label": "Saving your writing samples…", "status": "done"})
        yield _sse("step", {"label": "Analysing your voice…", "status": "running"})
        yield _sse("progress", {"pct": 30})

        # Also pull approved outputs for richer calibration
        approved_outputs = existing.get("approvedOutputs") or []
        approved_texts = [o.get("content", "") for o in approved_outputs if o.get("content")]

        samples_text = "\n\n---\n\n".join(
            f"Sample {i + 1}:\n{s}" for i, s in enumerate(all_samples)
        )

        approved_section = ""
        if approved_texts:
            combined = "\n\n---\n\n".join(
                f"Approved output {i + 1}:\n{t[:400]}"
                for i, t in enumerate(approved_texts[-10:])
            )
            approved_section = f"\nAPPROVED CONTENT (posts the user kept or edited - high-signal voice data):\n{combined}"

        prompt = _CALIBRATION_PROMPT.format(
            samples_text=samples_text[:8000],
            approved_outputs_section=approved_section,
        )

        from backend.config import settings
        import anthropic
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=_CALIBRATION_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()

        yield _sse("step", {"label": "Analysing your voice…", "status": "done"})
        yield _sse("step", {"label": "Updating your Voice Profile…", "status": "running"})
        yield _sse("progress", {"pct": 80})

        try:
            extracted = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("Voice calibration JSON parse error: %s\nRaw: %s", e, raw[:500])
            yield _sse("error", {"message": "Failed to parse voice analysis. Please try again."})
            return

        updated_profile = {
            **existing,
            "projectId": project_id,
            "writingSamples": all_samples,
            "formalityLevel": extracted.get("formalityLevel", existing.get("formalityLevel", 3)),
            "sentenceLength": extracted.get("sentenceLength", existing.get("sentenceLength", "medium")),
            "emotionalRegister": extracted.get("emotionalRegister", existing.get("emotionalRegister", "direct")),
            "signaturePhrases": extracted.get("signaturePhrases", existing.get("signaturePhrases", [])),
            "avoidedPhrases": extracted.get("avoidedPhrases", existing.get("avoidedPhrases", [])),
            "punctuationStyle": extracted.get("punctuationStyle", existing.get("punctuationStyle", "")),
            "writingPatterns": extracted.get("writingPatterns", []),
            "accuracyScore": extracted.get("accuracyScore", 0),
            "lastCalibrated": now,
            "updatedAt": now,
        }

        doc_ref.set(updated_profile)

        yield _sse("step", {"label": "Updating your Voice Profile…", "status": "done"})
        yield _sse("progress", {"pct": 100})
        yield _sse("done", {"voiceProfile": updated_profile})

    except Exception as exc:
        logger.exception("Voice calibration failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})


async def recalibrate_from_outputs(project_id: str) -> AsyncIterator[str]:
    """
    Re-calibrate voice profile purely from existing approved outputs (no new samples).
    Used when the user has accumulated enough approved posts to refine accuracy.
    """
    try:
        yield _sse("step", {"label": "Loading your approved content…", "status": "running"})
        yield _sse("progress", {"pct": 15})

        from backend.services import firebase_service
        db = firebase_service.get_db()

        doc_ref = db.collection("personal_voice_profiles").document(project_id)
        doc = doc_ref.get()
        if not doc.exists:
            yield _sse("error", {"message": "Voice profile not found. Complete your interview first."})
            return

        existing = doc.to_dict()
        approved_outputs = existing.get("approvedOutputs") or []

        if len(approved_outputs) < 3:
            yield _sse("error", {"message": f"You need at least 3 approved posts to recalibrate (you have {len(approved_outputs)}). Approve more posts from the Content Engine."})
            return

        yield _sse("step", {"label": "Loading your approved content…", "status": "done"})
        yield _sse("step", {"label": f"Analysing {len(approved_outputs)} approved posts…", "status": "running"})
        yield _sse("progress", {"pct": 35})

        # Use writing samples + approved outputs together
        writing_samples = existing.get("writingSamples") or []
        approved_texts = [o.get("content", "") for o in approved_outputs if o.get("content")]

        # Build sample text: mix both sources
        all_texts = writing_samples + approved_texts
        samples_text = "\n\n---\n\n".join(
            f"Sample {i + 1}:\n{t[:500]}" for i, t in enumerate(all_texts[:15])
        )

        approved_section = (
            f"\nNote: {len(approved_texts)} of these are posts the user approved or edited - treat them as the highest-signal voice examples."
        )

        prompt = _CALIBRATION_PROMPT.format(
            samples_text=samples_text[:8000],
            approved_outputs_section=approved_section,
        )

        from backend.config import settings
        import anthropic
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=_CALIBRATION_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()

        yield _sse("step", {"label": f"Analysing {len(approved_outputs)} approved posts…", "status": "done"})
        yield _sse("step", {"label": "Updating your Voice Profile…", "status": "running"})
        yield _sse("progress", {"pct": 80})

        try:
            extracted = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("Recalibration JSON parse error: %s\nRaw: %s", e, raw[:500])
            yield _sse("error", {"message": "Failed to parse voice analysis. Please try again."})
            return

        now = datetime.now(timezone.utc).isoformat()
        updated_profile = {
            **existing,
            "formalityLevel": extracted.get("formalityLevel", existing.get("formalityLevel", 3)),
            "sentenceLength": extracted.get("sentenceLength", existing.get("sentenceLength", "medium")),
            "emotionalRegister": extracted.get("emotionalRegister", existing.get("emotionalRegister", "direct")),
            "signaturePhrases": extracted.get("signaturePhrases", existing.get("signaturePhrases", [])),
            "avoidedPhrases": extracted.get("avoidedPhrases", existing.get("avoidedPhrases", [])),
            "punctuationStyle": extracted.get("punctuationStyle", existing.get("punctuationStyle", "")),
            "writingPatterns": extracted.get("writingPatterns", []),
            "accuracyScore": extracted.get("accuracyScore", existing.get("accuracyScore", 0)),
            "lastCalibrated": now,
            "updatedAt": now,
        }

        doc_ref.set(updated_profile)

        yield _sse("step", {"label": "Updating your Voice Profile…", "status": "done"})
        yield _sse("progress", {"pct": 100})
        yield _sse("done", {"voiceProfile": updated_profile})

    except Exception as exc:
        logger.exception("Voice recalibration failed for project %s", project_id)
        yield _sse("error", {"message": str(exc)})
