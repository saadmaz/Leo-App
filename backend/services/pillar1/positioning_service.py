"""
Positioning Workshop service - guided multi-turn Claude conversation, SSE streaming.

Leads the user through 7 structured stages to develop a brand positioning statement.
Stage advancement is detected via a <stage_complete/> tag in Claude's response.
Messages are persisted to a Firestore sub-collection for session continuity.
"""

from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import anthropic

from backend.config import settings
from backend.schemas.pillar1 import PositioningMessageRequest, PositioningStartRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ---------------------------------------------------------------------------
# Workshop stages
# ---------------------------------------------------------------------------

WORKSHOP_STAGES = [
    {
        "stage": 0,
        "label": "Who are you for?",
        "system_goal": (
            "Ask the user to describe their ideal customer. Extract: who they are, "
            "what they do, what stage they're at. Ask one focused question. "
            "When you have a clear customer definition, end your reply with <stage_complete/>"
        ),
    },
    {
        "stage": 1,
        "label": "What problem do you solve?",
        "system_goal": (
            "Ask the user to describe the primary problem they solve for that customer. "
            "Push for specificity - avoid vague pain points. "
            "When you have a clear, specific problem statement, end your reply with <stage_complete/>"
        ),
    },
    {
        "stage": 2,
        "label": "How are you different?",
        "system_goal": (
            "Ask the user how they differ from alternatives (competitors, workarounds, doing nothing). "
            "Extract the unique differentiation. "
            "When you have a clear differentiator, end your reply with <stage_complete/>"
        ),
    },
    {
        "stage": 3,
        "label": "What's your proof?",
        "system_goal": (
            "Ask the user for evidence of their claims - customer results, case studies, "
            "metrics, testimonials, awards. "
            "When you have at least one proof point, end your reply with <stage_complete/>"
        ),
    },
    {
        "stage": 4,
        "label": "Draft statement",
        "system_goal": (
            "Using everything gathered in stages 0-3, write a draft positioning statement "
            "in the classic format: 'For [customer] who [problem], [brand] is the [category] "
            "that [differentiation], unlike [alternatives], because [proof].' "
            "Present it clearly and ask for feedback. End with <stage_complete/>"
        ),
    },
    {
        "stage": 5,
        "label": "Refinement",
        "system_goal": (
            "Take the user's feedback on the draft and refine the positioning statement. "
            "You may iterate up to 3 times. Once the user approves or signals they're happy, "
            "end your reply with <stage_complete/>"
        ),
    },
    {
        "stage": 6,
        "label": "Final statement",
        "system_goal": (
            "Present the final positioning statement. Then generate 3 tagline variants "
            "that distil the positioning into a memorable phrase. "
            "Save the final outputs in a JSON block: "
            '<artifact type="positioning_final">{"final_statement": "...", "taglines": ["...", "...", "..."]}</artifact>'
            " End with <stage_complete/>"
        ),
    },
]

_STAGE_COMPLETE_RE = re.compile(r"<stage_complete\s*/>", re.IGNORECASE)
_ARTIFACT_RE = re.compile(r'<artifact type="positioning_final">(.*?)</artifact>', re.DOTALL)


def _build_system(stage_meta: dict, brand_core: dict, brand_name: str) -> str:
    tone = brand_core.get("tone") or {}
    audience = brand_core.get("audience") or {}
    messaging = brand_core.get("messaging") or {}

    brand_ctx = f"Brand: {brand_name}\n"
    if tone:
        brand_ctx += f"Brand tone: {tone.get('style', '')} / {tone.get('formality', '')}\n"
    if audience.get("demographics"):
        brand_ctx += f"Known audience: {audience['demographics']}\n"
    if messaging.get("valueProp"):
        brand_ctx += f"Existing value prop: {messaging['valueProp']}\n"

    return f"""\
You are LEO, a brand positioning expert running a structured Positioning Workshop.
You are guiding the user through a 7-stage process to craft a precise brand positioning statement.

{brand_ctx}
Current stage {stage_meta['stage'] + 1}/7: {stage_meta['label']}
Your goal this stage: {stage_meta['system_goal']}

RULES:
- Ask one focused question at a time. Do not overwhelm the user.
- Be warm, collaborative, and encouraging.
- Match the brand's tone in your responses.
- When the stage goal is met, end your message with <stage_complete/> (this is hidden from the user).
- Never reveal the stage tags to the user.
"""


def start_session(project_id: str, owner_uid: str, body: PositioningStartRequest) -> dict:
    """Create a new Positioning Workshop session and return the doc."""
    title = "Positioning Workshop"
    doc = firebase_service.create_pillar1_doc(project_id, "positioning", owner_uid, title)
    firebase_service.update_pillar1_doc(project_id, doc["id"], {
        "payload": {
            "workshop_stage": 0,
            "draft_statement": None,
            "final_statement": None,
            "taglines": [],
            "context": body.context or "",
        },
    })
    doc["payload"] = {
        "workshop_stage": 0,
        "draft_statement": None,
        "final_statement": None,
        "taglines": [],
        "context": body.context or "",
    }
    return doc


async def send_message(
    project: dict,
    doc_id: str,
    body: PositioningMessageRequest,
    project_id: str,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for a single positioning workshop message exchange."""

    async def _stream() -> AsyncGenerator[str, None]:
        brand_core = project.get("brandCore") or {}
        brand_name = project.get("name", "the brand")

        # Load doc and history
        doc = firebase_service.get_pillar1_doc(project_id, doc_id)
        if not doc:
            yield _sse({"type": "error", "message": "Positioning session not found"})
            return

        payload = doc.get("payload") or {}
        stage = min(int(payload.get("workshop_stage", 0)), 6)
        stage_meta = WORKSHOP_STAGES[stage]
        history = firebase_service.list_pillar1_messages(project_id, doc_id)

        # Build Claude messages from history + new user message
        claude_messages = [{"role": m["role"], "content": m["content"]} for m in history]
        claude_messages.append({"role": "user", "content": body.message})

        system = _build_system(stage_meta, brand_core, brand_name)
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

        assembled: list[str] = []
        async with client.messages.stream(
            model=settings.LLM_CHAT_MODEL,
            max_tokens=1500,
            system=system,
            messages=claude_messages,
        ) as stream:
            async for text in stream.text_stream:
                assembled.append(text)
                # Strip stage_complete tag from streamed output before sending to client
                visible = _STAGE_COMPLETE_RE.sub("", text)
                if visible:
                    yield _sse({"type": "delta", "content": visible})

        full_response = "".join(assembled)
        visible_response = _STAGE_COMPLETE_RE.sub("", full_response).strip()

        # Save messages to Firestore
        firebase_service.save_pillar1_message(project_id, doc_id, "user", body.message)
        firebase_service.save_pillar1_message(project_id, doc_id, "assistant", visible_response)

        # Detect stage advancement
        updates: dict = {}
        if _STAGE_COMPLETE_RE.search(full_response):
            new_stage = stage + 1

            # Extract final positioning artifact at stage 6
            if stage == 6:
                artifact_match = _ARTIFACT_RE.search(full_response)
                if artifact_match:
                    try:
                        artifact_data = json.loads(artifact_match.group(1))
                        updates["payload.final_statement"] = artifact_data.get("final_statement", "")
                        updates["payload.taglines"] = artifact_data.get("taglines", [])
                        updates["status"] = "complete"
                    except json.JSONDecodeError:
                        pass
            elif stage == 4:
                # Store draft statement from stage 4 response
                updates["payload.draft_statement"] = visible_response[:500]

            updates["payload.workshop_stage"] = min(new_stage, 6)
            firebase_service.update_pillar1_doc(project_id, doc_id, updates)

            next_label = WORKSHOP_STAGES[min(new_stage, 6)]["label"] if new_stage <= 6 else "Complete"
            yield _sse({"type": "stage_advance", "new_stage": new_stage, "label": next_label})

            if new_stage > 6:
                yield _sse({"type": "positioning_saved", "doc_id": doc_id})
        elif updates:
            firebase_service.update_pillar1_doc(project_id, doc_id, updates)

        yield "data: [DONE]\n\n"

    return _stream()
