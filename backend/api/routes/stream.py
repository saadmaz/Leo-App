"""
Chat streaming route - POST a user message and receive an SSE stream of
Claude's response deltas.

SSE event format (each line):
    data: {"type": "delta", "content": "..."}
    data: {"type": "error", "error": "..."}
    data: [DONE]

The assistant's full response is reconstructed server-side from the delta
stream and persisted to Firestore once the stream completes.
"""

import json
import logging

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from backend.api.deps import get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.middleware.rate_limit import limiter
from backend.schemas.message import MessageCreate
from backend.services import billing_service, firebase_service, llm_service, moderation_service, intelligence_service
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/chats/{chat_id}", tags=["stream"])


@router.post("/messages")
@limiter.limit("10/minute")
async def send_message(
    request: Request,
    project_id: str,
    chat_id: str,
    body: MessageCreate,
    user: CurrentUser,
):
    """
    Persist a user message then stream the assistant's response as SSE.

    Auth: any project member may send messages.

    Side effects:
      - Saves the user message to Firestore before streaming begins.
      - Auto-renames the chat using the first 40 chars of the first message.
      - Saves the assembled assistant response after the stream completes.
    """
    # Verify project membership (raises 404/403 via deps).
    project = get_project_as_member(project_id, user["uid"])

    # Check message quota and deduct credits before doing anything else.
    import asyncio
    await asyncio.to_thread(billing_service.assert_can_send_message, user["uid"])
    await asyncio.to_thread(check_and_deduct, user["uid"], "chat_message")

    chat = firebase_service.get_chat(project_id, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found.")

    # Persist user message before streaming so it's saved even if stream fails.
    saved_msg = firebase_service.save_message(project_id, chat_id, "user", body.content)

    # Run moderation check as a non-blocking background task - never delays the stream.
    import asyncio
    user_profile = firebase_service.get_user(user["uid"]) or {}
    asyncio.create_task(
        asyncio.to_thread(
            moderation_service.check_and_flag,
            body.content,
            user["uid"],
            user_profile.get("email", user.get("email", "")),
            project_id,
            chat_id,
            saved_msg.get("id"),
        )
    )

    # Auto-name the chat on the first real message.
    if chat.get("name") == "New Chat":
        short_name = body.content[:40].strip()
        if short_name:
            firebase_service.rename_chat(project_id, chat_id, short_name)

    # Load message history. stream_chat() trims further to LLM_CONTEXT_MESSAGES.
    from backend.config import settings
    all_messages = firebase_service.list_messages(
        project_id, chat_id, limit=settings.MESSAGES_LOAD_LIMIT
    )
    # Exclude the last entry (the user message we just saved) since
    # stream_chat() appends it separately as the final user turn.
    history = all_messages[:-1]

    # Load brand memory (last 15 items) to inject learnings into system prompt.
    memory_items = firebase_service.get_memory_feedback(project_id, limit=15)
    memory_context = intelligence_service.build_memory_context(memory_items)

    async def event_stream():
        assembled_parts: list[str] = []

        # Convert Pydantic ImageAttachment objects to plain dicts for llm_service.
        images = (
            [{"base64": img.base64, "mediaType": img.mediaType} for img in body.images]
            if body.images
            else None
        )

        try:
            import json as _json
            yield f"data: {_json.dumps({'type': 'status', 'message': 'Analyzing your request'})}\n\n"
            yield f"data: {_json.dumps({'type': 'status', 'message': 'Loading brand context'})}\n\n"

            # Use tool-enabled streaming when search keys are configured.
            # Falls back gracefully if neither key is set (tools simply won't fire).
            from backend.config import settings as _settings
            _use_tools = bool(_settings.EXA_API_KEY or _settings.TAVILY_API_KEY)
            _stream_fn = llm_service.stream_chat_with_tools if _use_tools else llm_service.stream_chat

            # For personal brand projects, fetch and inject Personal Core context
            # instead of the business Brand Core.
            is_personal = project.get("projectType") == "personal"
            effective_brand_core = project.get("brandCore")
            if is_personal:
                try:
                    personal_core_doc = firebase_service.get_personal_core(project_id)
                    if personal_core_doc:
                        # Fetch voice profile and nest it for context building
                        from backend.services.firebase_service import db as _db
                        _voice_snap = _db.collection("personal_voice_profiles").document(project_id).get()
                        voice_doc = _voice_snap.to_dict() if _voice_snap.exists else None
                        if voice_doc:
                            personal_core_doc["voiceProfile"] = voice_doc
                        # Use a sentinel value so stream_chat knows to call the
                        # personal context builder instead of brand_core builder.
                        effective_brand_core = {"__personal_core__": personal_core_doc}
                except Exception:
                    pass  # Fall back to no brand context rather than crashing

            _kwargs = dict(
                project_name=project.get("name", ""),
                brand_core=effective_brand_core,
                history=history,
                user_message=body.content,
                channel=body.channel,
                images=images,
                model=project.get("contentModel") or None,
                memory_context=memory_context or None,
            )
            if _use_tools:
                _kwargs["project_id"] = project_id
            yield f"data: {_json.dumps({'type': 'status', 'message': 'Thinking'})}\n\n"
            async for chunk in _stream_fn(**_kwargs):
                yield chunk

                # Accumulate delta text to reconstruct the full response.
                if not chunk.startswith("data: "):
                    continue
                raw = chunk[6:].strip()
                if raw == "[DONE]":
                    continue
                try:
                    payload = json.loads(raw)
                    if payload.get("type") == "delta" and "content" in payload:
                        assembled_parts.append(payload["content"])
                except json.JSONDecodeError:
                    pass

        except Exception as exc:
            logger.exception("Streaming error in send_message: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"
            return

        # Persist the complete assistant response and count the message.
        full_response = "".join(assembled_parts)
        if full_response:
            firebase_service.save_message(project_id, chat_id, "assistant", full_response)
            billing_service.increment_message_count(user["uid"])
        else:
            logger.warning(
                "Stream completed for chat %s but no assistant content was collected.", chat_id
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
