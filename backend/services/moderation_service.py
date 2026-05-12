"""
Content moderation service.

Responsibilities:
  1. Scan user messages for prompt-injection and abuse patterns.
  2. Persist flags to the `flaggedContent` Firestore collection for admin review.
  3. Detect anomalous usage (high message volume relative to platform average).

Design:
  - check_and_flag() is non-blocking - callers use asyncio.create_task() so the
    user's chat stream is never delayed by moderation work.
  - Flagging is additive: the user's message is always saved and delivered; the
    admin queue is purely for review, not for real-time blocking (add that later
    if the platform needs it).
"""

from __future__ import annotations

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Injection / abuse pattern library
# ---------------------------------------------------------------------------

# Each entry: (pattern_id, compiled_regex, human label)
_INJECTION_PATTERNS: list[tuple[str, re.Pattern, str]] = [
    ("ignore_instructions",
     re.compile(r"ignore\s+(all\s+)?(previous\s+)?(prior\s+)?instructions", re.I),
     "Ignore instructions"),

    ("forget_previous",
     re.compile(r"forget\s+(everything|all|your)", re.I),
     "Forget previous context"),

    ("you_are_now",
     re.compile(r"(you\s+are\s+now|act\s+as\s+(a\s+)?|pretend\s+you\s+are)\s*(an?\s+)?(evil|unrestricted|jailbreak)", re.I),
     "Role-play jailbreak"),

    ("jailbreak",
     re.compile(r"\bjailbreak\b", re.I),
     "Jailbreak keyword"),

    ("dan_mode",
     re.compile(r"\b(DAN\s*mode|do\s+anything\s+now)\b", re.I),
     "DAN mode"),

    ("developer_mode",
     re.compile(r"\bdeveloper\s+mode\b", re.I),
     "Developer mode"),

    ("system_override",
     re.compile(r"(override|bypass|disregard)\s+(your\s+)?(system\s+)?(prompt|instructions|guidelines|rules|constraints)", re.I),
     "System override attempt"),

    ("prompt_leak",
     re.compile(r"(repeat|print|show|reveal|output|tell me)\s+(your\s+)?(system\s+prompt|initial\s+instructions|original\s+prompt)", re.I),
     "Prompt extraction attempt"),

    ("token_smuggling",
     re.compile(r"(<\|im_start\|>|<\|endoftext\|>|\[INST\]|\[\/INST\]|###\s*(Human|Assistant|System):)", re.I),
     "Token smuggling"),
]

# High-volume threshold: flag if a single message is unusually long
_MAX_SAFE_CHARS = 8_000


def _scan(text: str) -> list[str]:
    """
    Return a list of matched pattern IDs for the given text.
    Empty list means no patterns triggered.
    """
    hits: list[str] = []
    for pattern_id, regex, _ in _INJECTION_PATTERNS:
        if regex.search(text):
            hits.append(pattern_id)
    if len(text) > _MAX_SAFE_CHARS:
        hits.append("oversized_message")
    return hits


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def check_and_flag(
    content: str,
    uid: str,
    email: str,
    project_id: str,
    chat_id: str,
    message_id: Optional[str] = None,
) -> None:
    """
    Scan `content` for suspicious patterns and, if any are found, persist a
    flag document to the `flaggedContent` collection.

    This function is synchronous and designed to be called from an
    asyncio.to_thread() task so it never blocks the event loop.
    """
    hits = _scan(content)
    if not hits:
        return

    # Avoid circular import - import at call-time only
    from backend.services import firebase_service

    hit_labels = [label for pid, _, label in _INJECTION_PATTERNS if pid in hits]
    if "oversized_message" in hits:
        hit_labels.append(f"Message too long ({len(content):,} chars)")

    firebase_service.flag_content(
        uid=uid,
        email=email,
        project_id=project_id,
        chat_id=chat_id,
        content=content[:2000],   # cap stored snippet to keep Firestore docs small
        reason="auto_detected",
        patterns=hit_labels,
        message_id=message_id,
    )
    logger.info(
        "Flagged message from uid=%s in project=%s - patterns: %s",
        uid, project_id, hit_labels,
    )


def get_abuse_suspects(users: list[dict], platform_avg_messages: float) -> list[dict]:
    """
    Given a list of user dicts and the platform-wide average messages used,
    return users whose message count is ≥ 5× the average (or ≥ 200 absolute),
    sorted by messagesUsed descending.

    This is a heuristic - not a hard block. The admin can review and act.
    """
    threshold = max(200, platform_avg_messages * 5)
    suspects = []
    for u in users:
        billing = u.get("billing", {})
        used = billing.get("messagesUsed", 0)
        if used >= threshold:
            suspects.append({
                "uid": u.get("uid") or u.get("id", ""),
                "email": u.get("email", ""),
                "displayName": u.get("displayName", ""),
                "tier": u.get("tier", "free"),
                "messagesUsed": used,
                "threshold": threshold,
            })
    return sorted(suspects, key=lambda x: x["messagesUsed"], reverse=True)
