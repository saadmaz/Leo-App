"""
Feature flags service.

Flags are stored in the `featureFlags` Firestore collection and evaluated
at request time via is_enabled(). The admin portal manages them via CRUD
routes in admin.py.

Flag schema (Firestore doc):
  {
    "id":           str   - slug, e.g. "image_generation"
    "name":         str   - display name
    "description":  str
    "enabled":      bool  - global on/off master switch
    "allowedTiers": list[str] | null
                          - null = all tiers; ["pro","agency"] = paid only
    "userOverrides": {uid: bool}
                          - per-user force-enable / force-disable
    "createdAt":    str
    "updatedAt":    str
  }

Evaluation order (highest wins):
  1. userOverrides[uid]  - explicit per-user override
  2. enabled == False    - globally disabled → False for everyone
  3. allowedTiers        - if set, user tier must be in the list
  4. → True              - flag is on for this user

Built-in flags (seeded on first call to seed_defaults()):
  chat                  Always-on core chat feature
  brand_ingestion       Brand scraping pipeline
  campaign_generation   Campaign generator
  image_generation      Imagen / DALL-E calls
  maintenance_mode      Shows a maintenance banner in the UI (no tier gate)
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default flags - seeded into Firestore on first admin portal load
# ---------------------------------------------------------------------------

DEFAULT_FLAGS = [
    {
        "id": "chat",
        "name": "Chat",
        "description": "Core conversational chat feature. Disabling blocks all message streams.",
        "enabled": True,
        "allowedTiers": None,
        "userOverrides": {},
    },
    {
        "id": "brand_ingestion",
        "name": "Brand Ingestion",
        "description": "Website + social scraping pipeline for building Brand Core.",
        "enabled": True,
        "allowedTiers": None,
        "userOverrides": {},
    },
    {
        "id": "campaign_generation",
        "name": "Campaign Generation",
        "description": "AI-powered marketing campaign generator.",
        "enabled": True,
        "allowedTiers": None,
        "userOverrides": {},
    },
    {
        "id": "image_generation",
        "name": "Image Generation",
        "description": "Imagen 3 / DALL-E image generation. Disable during API outages.",
        "enabled": True,
        "allowedTiers": ["pro", "agency"],
        "userOverrides": {},
    },
    {
        "id": "maintenance_mode",
        "name": "Maintenance Mode",
        "description": "Shows a maintenance banner to all users. Does not block functionality.",
        "enabled": False,
        "allowedTiers": None,
        "userOverrides": {},
    },
]


def seed_defaults() -> None:
    """
    Write default flags to Firestore if they don't already exist.
    Safe to call on every startup - skips docs that already exist.
    """
    from backend.services import firebase_service
    db = firebase_service.get_db()
    col = db.collection("featureFlags")
    for flag in DEFAULT_FLAGS:
        ref = col.document(flag["id"])
        if not ref.get().exists:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat()
            ref.set({**flag, "createdAt": now, "updatedAt": now})
            logger.info("Seeded feature flag: %s", flag["id"])


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def is_enabled(flag_id: str, uid: str = "", tier: str = "free") -> bool:
    """
    Evaluate a feature flag for a given user.
    Returns True if the feature should be accessible.
    Falls back to True if the flag document doesn't exist (fail-open).
    """
    from backend.services import firebase_service
    flag = firebase_service.get_feature_flag(flag_id)
    if not flag:
        return True  # unknown flag → don't block

    # 1. Per-user override
    overrides: dict = flag.get("userOverrides") or {}
    if uid and uid in overrides:
        return bool(overrides[uid])

    # 2. Global master switch
    if not flag.get("enabled", True):
        return False

    # 3. Tier gate
    allowed_tiers = flag.get("allowedTiers")
    if allowed_tiers is not None and tier not in allowed_tiers:
        return False

    return True
