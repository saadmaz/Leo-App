"""
Firebase Admin SDK wrapper - Firestore CRUD for all domain objects.

Design notes:
- All public functions are synchronous. Firestore's Python Admin SDK is
  synchronous; wrap with asyncio.to_thread() if you need true async I/O.
- Timestamps are ISO 8601 UTC strings so they sort lexicographically and
  remain human-readable in the Firestore console.
- Pagination limits are read from settings so they can be tuned without
  a code deploy.
"""

import os
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import firebase_admin
from firebase_admin import auth, credentials, firestore

logger = logging.getLogger(__name__)

# Module-level Firestore client. Initialised once by initialize() at startup.
_db: Any = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> str:
    """Return the current UTC time as an ISO 8601 string (timezone-aware)."""
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------

def initialize() -> None:
    """
    Bootstrap the Firebase Admin SDK and obtain a Firestore client.

    Called once from the FastAPI lifespan handler. Safe to call multiple
    times - subsequent calls are no-ops if the SDK is already initialised.

    Credential resolution order:
      1. Service account JSON file on disk (FIREBASE_SERVICE_ACCOUNT_PATH)
      2. Inline env vars (FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL)
    """
    global _db
    if firebase_admin._apps:
        # Already initialised (e.g. hot-reload in development).
        _db = firestore.client()
        return

    from backend.config import settings

    cred: Optional[credentials.Base] = None

    # Option 1: service account JSON file on disk.
    sa_path = settings.FIREBASE_SERVICE_ACCOUNT_PATH
    if os.path.exists(sa_path):
        cred = credentials.Certificate(sa_path)
        logger.info("Firebase: loaded service account from %s", sa_path)

    # Option 2: individual env vars - useful in container/cloud deployments
    # where mounting a file is inconvenient.
    elif settings.FIREBASE_PRIVATE_KEY and settings.FIREBASE_CLIENT_EMAIL:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": settings.FIREBASE_PROJECT_ID,
            # Cloud providers sometimes escape newlines as literal \n in env vars.
            "private_key": settings.FIREBASE_PRIVATE_KEY.replace("\\n", "\n"),
            "client_email": settings.FIREBASE_CLIENT_EMAIL,
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        logger.info("Firebase: loaded service account from environment variables")

    if cred is None:
        logger.warning(
            "Firebase Admin SDK NOT initialised - no valid credentials found. "
            "Drop firebase-service-account.json into backend/ or set "
            "FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL env vars."
        )
        return

    firebase_admin.initialize_app(cred)
    _db = firestore.client()
    logger.info("Firebase initialised (project: %s)", settings.FIREBASE_PROJECT_ID)


def get_db() -> Any:
    """
    Return the Firestore client. Raises RuntimeError if initialize() was
    never called (indicates a startup misconfiguration).
    """
    if _db is None:
        raise RuntimeError(
            "Firebase not initialised. Ensure initialize() is called during app startup."
        )
    return _db


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def verify_token(id_token: str) -> dict:
    """
    Verify a Firebase ID token and return the decoded claims dict.
    Raises firebase_admin.auth.InvalidIdTokenError on failure.
    """
    return auth.verify_id_token(id_token)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def upsert_user(uid: str, email: str, display_name: str = "") -> None:
    """
    Create the user profile document if it doesn't already exist.
    Uses a get-then-set pattern to avoid overwriting existing data (e.g. tier).
    """
    db = get_db()
    ref = db.collection("users").document(uid)
    if not ref.get().exists:
        import time as _time
        ref.set({
            "uid": uid,
            "email": email,
            "displayName": display_name,
            "tier": "free",
            "billing": {
                "messagesUsed": 0,
                "ingestionsUsed": 0,
                # Unix timestamp 30 days from now so billing_service auto-reset works
                # for free users who never go through Stripe.
                "messagesResetAt": int(_time.time()) + 30 * 24 * 3600,
            },
            "createdAt": _utcnow(),
        })


def set_user_tier(uid: str, tier: str) -> None:
    """Update the user's subscription tier ('free', 'pro', 'agency')."""
    db = get_db()
    db.collection("users").document(uid).update({"tier": tier})


def update_user_billing(uid: str, data: dict) -> None:
    """
    Merge billing metadata into the user's `billing` sub-map.
    Accepts keys like stripeCustomerId, subscriptionStatus, currentPeriodEnd.
    """
    db = get_db()
    updates = {f"billing.{k}": v for k, v in data.items()}
    db.collection("users").document(uid).update(updates)


def increment_messages_used(uid: str) -> None:
    """Atomically increment the user's monthly message counter."""
    db = get_db()
    db.collection("users").document(uid).update(
        {"billing.messagesUsed": firestore.Increment(1)}
    )


def increment_ingestions_used(uid: str) -> None:
    """Atomically increment the user's ingestion counter."""
    db = get_db()
    db.collection("users").document(uid).update(
        {"billing.ingestionsUsed": firestore.Increment(1)}
    )


def reset_messages_used(uid: str) -> None:
    """
    Reset the monthly message counter and schedule the next reset 30 days out.
    Used by billing_service when a free-user reset period expires.
    (Paid users get their next period from the Stripe webhook instead.)
    """
    import time as _time
    db = get_db()
    db.collection("users").document(uid).update({
        "billing.messagesUsed": 0,
        "billing.messagesResetAt": int(_time.time()) + 30 * 24 * 3600,
    })


def reset_monthly_usage(uid: str) -> None:
    """Reset message counter at the start of a new billing period."""
    db = get_db()
    db.collection("users").document(uid).update({
        "billing.messagesUsed": 0,
        "billing.messagesResetAt": _utcnow(),
    })


# ---------------------------------------------------------------------------
# Credits
# ---------------------------------------------------------------------------

def update_user_credits(uid: str, data: dict) -> None:
    """Merge credit fields into the user's `credits` sub-map."""
    db = get_db()
    updates = {f"credits.{k}": v for k, v in data.items()}
    db.collection("users").document(uid).update(updates)


def deduct_user_credits(uid: str, amount: int, action: str = "") -> None:
    """Atomically deduct credits from a user's balance and log the transaction."""
    import datetime as _dt
    db = get_db()
    db.collection("users").document(uid).update({
        "credits.balance": firestore.Increment(-amount),
        "credits.lifetimeUsed": firestore.Increment(amount),
    })
    # Log transaction (best-effort, non-fatal)
    try:
        db.collection("users").document(uid).collection("creditTransactions").add({
            "type": "debit",
            "amount": amount,
            "action": action,
            "createdAt": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        })
    except Exception:
        pass


def add_user_credits(uid: str, amount: int, reason: str = "") -> None:
    """Atomically add credits to a user's balance and log the transaction."""
    import datetime as _dt
    db = get_db()
    db.collection("users").document(uid).update({
        "credits.balance": firestore.Increment(amount),
    })
    # Log transaction (best-effort, non-fatal)
    try:
        db.collection("users").document(uid).collection("creditTransactions").add({
            "type": "credit",
            "amount": amount,
            "action": reason or "topup",
            "createdAt": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        })
    except Exception:
        pass


def list_credit_transactions(uid: str, limit: int = 20) -> list[dict]:
    """Return the most recent credit transactions for a user."""
    db = get_db()
    docs = (
        db.collection("users").document(uid)
        .collection("creditTransactions")
        .order_by("createdAt", direction="DESCENDING")
        .limit(limit)
        .stream()
    )
    return [{**d.to_dict(), "id": d.id} for d in docs]


# ---------------------------------------------------------------------------
# Deep Search
# ---------------------------------------------------------------------------

def save_deep_search_result(project_id: str, data: dict) -> str:
    """Save a deep search result under projects/{project_id}/deepSearchResults."""
    db = get_db()
    ref = db.collection("projects").document(project_id).collection("deepSearchResults").document()
    data["id"] = ref.id
    ref.set(data)
    return ref.id


def list_deep_search_results(project_id: str, limit: int = 20) -> list:
    """Return the most recent deep search results for a project."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("deepSearchResults")
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .limit(limit)
        .stream()
    )
    return [d.to_dict() for d in docs]


def get_user(uid: str) -> Optional[dict]:
    """Return the user profile dict, or None if the document does not exist."""
    db = get_db()
    doc = db.collection("users").document(uid).get()
    return doc.to_dict() if doc.exists else None


def get_user_profile(uid: str) -> Optional[dict]:
    """
    Return {uid, email, displayName} from Firebase Auth for the given uid.
    Returns None if the Auth record does not exist.
    """
    try:
        user = auth.get_user(uid)
        return {
            "uid": uid,
            "email": user.email or "",
            "displayName": user.display_name or user.email or uid,
        }
    except auth.UserNotFoundError:
        return None


def get_user_by_email(email: str) -> Optional[dict]:
    """
    Look up a Firebase Auth user by email address.
    Returns {uid, email, displayName} or None if no account exists.
    """
    try:
        user = auth.get_user_by_email(email)
        return {
            "uid": user.uid,
            "email": user.email or "",
            "displayName": user.display_name or user.email or user.uid,
        }
    except auth.UserNotFoundError:
        return None


# ---------------------------------------------------------------------------
# Admin - user management
# ---------------------------------------------------------------------------

def set_super_admin_claim(uid: str) -> None:
    """
    Grant the superAdmin custom claim to a Firebase Auth user.
    Call this once per admin account (from a secure script or the Firebase console).
    """
    auth.set_custom_user_claims(uid, {"superAdmin": True})
    logger.info("Granted superAdmin claim to uid %s", uid)


def revoke_super_admin_claim(uid: str) -> None:
    """Remove the superAdmin custom claim from a Firebase Auth user."""
    auth.set_custom_user_claims(uid, {"superAdmin": False})
    logger.info("Revoked superAdmin claim from uid %s", uid)


def list_all_users(limit: int = 500) -> list[dict]:
    """
    Return up to `limit` user profile documents from the Firestore users collection,
    sorted by createdAt descending (most recent first).

    NOTE: This performs a full collection scan. Acceptable at current scale;
    add server-side pagination if the user base exceeds ~10,000.
    """
    db = get_db()
    docs = db.collection("users").limit(limit).stream()
    results = [{"id": d.id, **d.to_dict()} for d in docs]
    return sorted(results, key=lambda u: u.get("createdAt", ""), reverse=True)


def get_user_project_count(uid: str) -> int:
    """Return the number of projects the user owns."""
    from google.cloud.firestore_v1.base_query import FieldFilter
    db = get_db()
    docs = (
        db.collection("projects")
        .where(filter=FieldFilter(f"members.{uid}", "in", ["admin", "editor", "viewer"]))
        .stream()
    )
    return sum(1 for _ in docs)


def suspend_user(uid: str) -> None:
    """
    Disable a Firebase Auth account (the user can no longer sign in).
    The Firestore profile is preserved; set a `suspended` flag for UI.
    """
    auth.update_user(uid, disabled=True)
    db = get_db()
    db.collection("users").document(uid).update({
        "suspended": True,
        "updatedAt": _utcnow(),
    })
    logger.info("Suspended user %s", uid)


def unsuspend_user(uid: str) -> None:
    """Re-enable a previously suspended Firebase Auth account."""
    auth.update_user(uid, disabled=False)
    db = get_db()
    db.collection("users").document(uid).update({
        "suspended": False,
        "updatedAt": _utcnow(),
    })
    logger.info("Unsuspended user %s", uid)


def delete_user_completely(uid: str) -> None:
    """
    Delete the Firebase Auth record AND the Firestore user profile.
    Projects owned by the user are NOT deleted (they become orphaned).
    For a full cascade, call delete_project_deep() for each of their projects first.
    """
    try:
        auth.delete_user(uid)
    except auth.UserNotFoundError:
        logger.warning("delete_user_completely: Firebase Auth user %s not found", uid)

    db = get_db()
    db.collection("users").document(uid).delete()
    logger.info("Deleted user %s from Auth and Firestore", uid)


def override_user_limits(uid: str, overrides: dict) -> None:
    """
    Persist admin-defined usage limit overrides to the user's Firestore profile.
    Keys in `overrides` are stored under a top-level `adminOverrides` map so
    billing_service can check them before applying plan defaults.

    Example overrides: {"messagesLimit": 9999, "projectsLimit": 50}
    """
    db = get_db()
    updates = {f"adminOverrides.{k}": v for k, v in overrides.items()}
    updates["updatedAt"] = _utcnow()
    db.collection("users").document(uid).update(updates)


# ---------------------------------------------------------------------------
# Admin - content moderation
# ---------------------------------------------------------------------------

def flag_content(
    uid: str,
    email: str,
    project_id: str,
    chat_id: str,
    content: str,
    reason: str,
    patterns: list[str],
    message_id: Optional[str] = None,
) -> str:
    """
    Persist a flagged-content document to the `flaggedContent` collection.
    Returns the new document ID.
    """
    db = get_db()
    now = _utcnow()
    data = {
        "uid": uid,
        "email": email,
        "projectId": project_id,
        "chatId": chat_id,
        "messageId": message_id,
        "content": content,
        "reason": reason,         # "auto_detected" | "manual"
        "patterns": patterns,
        "status": "pending",      # "pending" | "dismissed" | "actioned"
        "flaggedAt": now,
        "reviewedAt": None,
        "reviewedBy": None,
        "note": None,
    }
    ref = db.collection("flaggedContent").document()
    ref.set(data)
    logger.info("Flagged content from uid=%s, patterns=%s", uid, patterns)
    return ref.id


def list_flagged_content(status_filter: Optional[str] = None, limit: int = 200) -> list[dict]:
    """
    Return flagged content documents, newest first.
    If status_filter is provided (e.g. "pending"), only matching docs are returned.
    """
    db = get_db()
    query = db.collection("flaggedContent").order_by("flaggedAt", direction="DESCENDING").limit(limit)
    if status_filter:
        query = db.collection("flaggedContent").where("status", "==", status_filter).limit(limit)
    return [{"id": d.id, **d.to_dict()} for d in query.stream()]


def get_flagged_item(flag_id: str) -> Optional[dict]:
    """Return a single flagged content document or None."""
    db = get_db()
    doc = db.collection("flaggedContent").document(flag_id).get()
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def update_flag_status(
    flag_id: str,
    status: str,
    reviewed_by: str,
    note: Optional[str] = None,
) -> None:
    """Update the review status of a flagged content document."""
    db = get_db()
    db.collection("flaggedContent").document(flag_id).update({
        "status": status,
        "reviewedAt": _utcnow(),
        "reviewedBy": reviewed_by,
        "note": note,
    })


def delete_flagged_message_content(flag_id: str, reviewed_by: str) -> None:
    """
    Mark a flag as actioned and delete the original message from Firestore.
    The flag document is kept (with status=actioned) for the audit trail.
    """
    db = get_db()
    flag_doc = db.collection("flaggedContent").document(flag_id).get()
    if not flag_doc.exists:
        return

    flag = flag_doc.to_dict() or {}
    project_id = flag.get("projectId", "")
    chat_id = flag.get("chatId", "")
    message_id = flag.get("messageId")

    # Delete the original message if we have coordinates
    if project_id and chat_id and message_id:
        try:
            (
                db.collection("projects").document(project_id)
                .collection("chats").document(chat_id)
                .collection("messages").document(message_id)
                .delete()
            )
        except Exception as exc:
            logger.warning("Could not delete flagged message %s: %s", message_id, exc)

    # Update flag status
    db.collection("flaggedContent").document(flag_id).update({
        "status": "actioned",
        "reviewedAt": _utcnow(),
        "reviewedBy": reviewed_by,
    })


def get_moderation_stats() -> dict:
    """Return counts of flagged content by status."""
    db = get_db()
    pending = actioned = dismissed = 0
    for doc in db.collection("flaggedContent").stream():
        s = (doc.to_dict() or {}).get("status", "pending")
        if s == "pending":
            pending += 1
        elif s == "actioned":
            actioned += 1
        elif s == "dismissed":
            dismissed += 1
    return {"pending": pending, "actioned": actioned, "dismissed": dismissed, "total": pending + actioned + dismissed}


# ---------------------------------------------------------------------------
# Announcements
# ---------------------------------------------------------------------------

def create_announcement(data: dict) -> dict:
    """Create an in-app announcement banner. Returns the doc with its ID."""
    db = get_db()
    now = _utcnow()
    payload = {**data, "createdAt": now, "updatedAt": now}
    ref = db.collection("announcements").document()
    ref.set(payload)
    return {"id": ref.id, **payload}


def list_announcements(active_only: bool = False) -> list[dict]:
    """Return all announcements, newest first. Pass active_only=True for public endpoint."""
    db = get_db()
    query = db.collection("announcements")
    if active_only:
        query = query.where("active", "==", True)
    docs = list(query.stream())
    results = [{"id": d.id, **d.to_dict()} for d in docs]

    if active_only:
        # Filter out expired ones (expiresAt is an ISO string or None)
        now_iso = _utcnow()
        results = [
            a for a in results
            if not a.get("expiresAt") or a["expiresAt"] > now_iso
        ]

    return sorted(results, key=lambda a: a.get("createdAt", ""), reverse=True)


def update_announcement(announcement_id: str, data: dict) -> Optional[dict]:
    """Partially update an announcement."""
    db = get_db()
    data["updatedAt"] = _utcnow()
    ref = db.collection("announcements").document(announcement_id)
    if not ref.get().exists:
        return None
    ref.update(data)
    doc = ref.get()
    return {"id": doc.id, **doc.to_dict()}


def delete_announcement(announcement_id: str) -> None:
    """Delete an announcement."""
    db = get_db()
    db.collection("announcements").document(announcement_id).delete()


# ---------------------------------------------------------------------------
# Changelog
# ---------------------------------------------------------------------------

def create_changelog_entry(data: dict) -> dict:
    """Create a changelog/What's New entry."""
    db = get_db()
    now = _utcnow()
    payload = {**data, "publishedAt": data.get("publishedAt") or now, "createdAt": now}
    ref = db.collection("changelog").document()
    ref.set(payload)
    return {"id": ref.id, **payload}


def list_changelog_entries(limit: int = 20) -> list[dict]:
    """Return changelog entries newest first."""
    db = get_db()
    docs = (
        db.collection("changelog")
        .order_by("publishedAt", direction="DESCENDING")
        .limit(limit)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def delete_changelog_entry(entry_id: str) -> None:
    """Delete a changelog entry."""
    db = get_db()
    db.collection("changelog").document(entry_id).delete()


# ---------------------------------------------------------------------------
# Admin - feature flags
# ---------------------------------------------------------------------------

def list_feature_flags() -> list[dict]:
    """Return all feature flag documents sorted by id."""
    db = get_db()
    docs = db.collection("featureFlags").stream()
    return sorted([{"id": d.id, **d.to_dict()} for d in docs], key=lambda f: f["id"])


def get_feature_flag(flag_id: str) -> Optional[dict]:
    """Return a single feature flag document or None."""
    db = get_db()
    doc = db.collection("featureFlags").document(flag_id).get()
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def upsert_feature_flag(flag_id: str, data: dict) -> dict:
    """
    Create or fully replace a feature flag document.
    Always stamps updatedAt; sets createdAt only on creation.
    """
    db = get_db()
    now = _utcnow()
    ref = db.collection("featureFlags").document(flag_id)
    existing = ref.get()
    if existing.exists:
        ref.update({**data, "updatedAt": now})
    else:
        ref.set({**data, "createdAt": now, "updatedAt": now})
    return get_feature_flag(flag_id) or {}


def patch_feature_flag(flag_id: str, updates: dict) -> Optional[dict]:
    """Partially update a feature flag (e.g. just toggle `enabled`)."""
    db = get_db()
    updates["updatedAt"] = _utcnow()
    db.collection("featureFlags").document(flag_id).update(updates)
    return get_feature_flag(flag_id)


def delete_feature_flag(flag_id: str) -> None:
    """Delete a feature flag document."""
    db = get_db()
    db.collection("featureFlags").document(flag_id).delete()


def set_feature_flag_user_override(flag_id: str, uid: str, value: bool) -> None:
    """Set a per-user override for a feature flag."""
    db = get_db()
    db.collection("featureFlags").document(flag_id).update({
        f"userOverrides.{uid}": value,
        "updatedAt": _utcnow(),
    })


def remove_feature_flag_user_override(flag_id: str, uid: str) -> None:
    """Remove a per-user override for a feature flag."""
    db = get_db()
    db.collection("featureFlags").document(flag_id).update({
        f"userOverrides.{uid}": firestore.DELETE_FIELD,
        "updatedAt": _utcnow(),
    })


# ---------------------------------------------------------------------------
# Admin - projects
# ---------------------------------------------------------------------------

def list_all_projects(limit: int = 500) -> list[dict]:
    """Return up to `limit` projects across all users, sorted by createdAt desc."""
    db = get_db()
    docs = db.collection("projects").limit(limit).stream()
    results = [{"id": d.id, **d.to_dict()} for d in docs]
    return sorted(results, key=lambda p: p.get("createdAt", ""), reverse=True)


# ---------------------------------------------------------------------------
# Admin - audit log
# ---------------------------------------------------------------------------

def write_audit_log(admin_uid: str, action: str, target_uid: str = "", details: dict | None = None) -> None:
    """
    Persist an admin action to the `adminAuditLogs` collection.
    Non-fatal - errors are logged but never re-raised so they don't block the action.
    """
    try:
        db = get_db()
        db.collection("adminAuditLogs").document().set({
            "adminUid": admin_uid,
            "action": action,
            "targetUid": target_uid,
            "details": details or {},
            "timestamp": _utcnow(),
        })
    except Exception as exc:
        logger.warning("Failed to write audit log: %s", exc)


def list_audit_logs(limit: int = 200) -> list[dict]:
    """Return the most recent audit log entries, newest first."""
    db = get_db()
    docs = (
        db.collection("adminAuditLogs")
        .order_by("timestamp", direction="DESCENDING")
        .limit(limit)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ---------------------------------------------------------------------------
# Admin - analytics
# ---------------------------------------------------------------------------

def get_analytics() -> dict:
    """
    Return analytics data for the admin analytics page.
    - User signups grouped by day (last 30 days)
    - Top 10 users by messages_used this month
    - Usage histogram (how many users in each message-count bucket)
    """
    from datetime import timedelta

    db = get_db()
    now = datetime.now(timezone.utc)
    cutoff_30d = (now - timedelta(days=30)).isoformat()

    # Buckets for signup chart: one entry per day for last 30 days
    day_buckets: dict[str, int] = {}
    for i in range(30):
        day = (now - timedelta(days=29 - i)).strftime("%Y-%m-%d")
        day_buckets[day] = 0

    top_users: list[dict] = []
    usage_buckets = {"0": 0, "1-10": 0, "11-50": 0, "51-200": 0, "201+": 0}
    total_messages = 0

    for doc in db.collection("users").stream():
        data = doc.to_dict() or {}
        uid = doc.id

        # Signup chart
        created = data.get("createdAt", "")
        if created >= cutoff_30d:
            day = created[:10]  # "YYYY-MM-DD"
            if day in day_buckets:
                day_buckets[day] += 1

        # Messages
        billing = data.get("billing", {})
        msgs = billing.get("messagesUsed", 0)
        total_messages += msgs

        top_users.append({
            "uid": uid,
            "email": data.get("email", ""),
            "displayName": data.get("displayName", ""),
            "tier": data.get("tier", "free"),
            "messagesUsed": msgs,
        })

        # Usage histogram
        if msgs == 0:
            usage_buckets["0"] += 1
        elif msgs <= 10:
            usage_buckets["1-10"] += 1
        elif msgs <= 50:
            usage_buckets["11-50"] += 1
        elif msgs <= 200:
            usage_buckets["51-200"] += 1
        else:
            usage_buckets["201+"] += 1

    # Top 10 by messages
    top_users.sort(key=lambda u: u["messagesUsed"], reverse=True)
    top_users = top_users[:10]

    # Signups chart as a list
    signups_chart = [{"date": d, "signups": c} for d, c in day_buckets.items()]

    return {
        "signupsLast30d": signups_chart,
        "topUsersByMessages": top_users,
        "usageHistogram": [{"bucket": k, "users": v} for k, v in usage_buckets.items()],
        "totalMessagesThisMonth": total_messages,
    }


def get_platform_stats() -> dict:
    """
    Return aggregate platform statistics for the admin dashboard.
    Performs multiple Firestore scans - call infrequently (cache if needed).
    """
    import time as _time

    db = get_db()

    # Count users by tier
    tier_counts: dict[str, int] = {"free": 0, "pro": 0, "agency": 0}
    total_messages = 0
    new_signups_7d = 0
    suspended_count = 0

    cutoff_7d = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    from datetime import timedelta
    cutoff_7d = cutoff_7d - timedelta(days=7)
    cutoff_7d_iso = cutoff_7d.isoformat()

    for doc in db.collection("users").stream():
        data = doc.to_dict() or {}
        tier = data.get("tier", "free")
        tier_counts[tier] = tier_counts.get(tier, 0) + 1
        billing = data.get("billing", {})
        total_messages += billing.get("messagesUsed", 0)
        if data.get("createdAt", "") >= cutoff_7d_iso:
            new_signups_7d += 1
        if data.get("suspended"):
            suspended_count += 1

    # Count total projects
    total_projects = sum(1 for _ in db.collection("projects").stream())

    total_users = sum(tier_counts.values())

    # Estimated MRR (based on tier counts × plan price)
    mrr = (tier_counts.get("pro", 0) * 49) + (tier_counts.get("agency", 0) * 149)

    return {
        "totalUsers": total_users,
        "usersByTier": tier_counts,
        "newSignups7d": new_signups_7d,
        "suspendedUsers": suspended_count,
        "totalProjects": total_projects,
        "totalMessagesThisMonth": total_messages,
        "estimatedMrr": mrr,
    }


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

def create_project(
    owner_uid: str,
    name: str,
    description: str = "",
    *,
    project_type: str = "business",
    website_url: Optional[str] = None,
    instagram_url: Optional[str] = None,
    facebook_url: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    tiktok_url: Optional[str] = None,
    x_url: Optional[str] = None,
    youtube_url: Optional[str] = None,
    threads_url: Optional[str] = None,
    pinterest_url: Optional[str] = None,
    snapchat_url: Optional[str] = None,
    content_model: str = "claude-sonnet-4-6",
    image_model: str = "dall-e-3",
    video_model: str = "gemini-flash",
    prompt_model: str = "claude-opus-4-6",
) -> dict:
    """
    Create a new project owned by owner_uid.
    The owner is automatically added as an 'admin' member.
    Returns the full project dict including the generated Firestore ID.
    """
    db = get_db()
    now = _utcnow()
    data = {
        "name": name,
        "description": description,
        "ownerId": owner_uid,
        "projectType": project_type,
        # members is a map of uid → role so membership queries stay O(1).
        "members": {owner_uid: "admin"},
        "brandCore": None,
        "ingestionStatus": None,
        # Social links
        "websiteUrl": website_url,
        "instagramUrl": instagram_url,
        "facebookUrl": facebook_url,
        "linkedinUrl": linkedin_url,
        "tiktokUrl": tiktok_url,
        "xUrl": x_url,
        "youtubeUrl": youtube_url,
        "threadsUrl": threads_url,
        "pinterestUrl": pinterest_url,
        "snapchatUrl": snapchat_url,
        # Model settings
        "contentModel": content_model,
        "imageModel": image_model,
        "videoModel": video_model,
        "promptModel": prompt_model,
        "createdAt": now,
        "updatedAt": now,
    }
    ref = db.collection("projects").document()
    ref.set(data)
    return {"id": ref.id, **data}


def get_project(project_id: str) -> Optional[dict]:
    """Return the project dict (with 'id' key), or None if it doesn't exist."""
    db = get_db()
    doc = db.collection("projects").document(project_id).get()
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def list_projects(uid: str) -> list[dict]:
    """
    Return all projects where uid is a member, sorted by updatedAt descending.

    NOTE: Firestore cannot order_by on a field that isn't in the where clause
    when the where clause uses a dynamic key (members.{uid}). We fetch up to
    PROJECTS_LIMIT docs and sort in Python. This is acceptable at current scale;
    revisit with a denormalised index if the limit needs to rise significantly.
    """
    from backend.config import settings

    from google.cloud.firestore_v1.base_query import FieldFilter
    db = get_db()
    docs = (
        db.collection("projects")
        .where(filter=FieldFilter(f"members.{uid}", "in", ["admin", "editor", "viewer"]))
        .limit(settings.PROJECTS_LIMIT)
        .stream()
    )
    results = [{"id": d.id, **d.to_dict()} for d in docs]
    return sorted(results, key=lambda p: p.get("updatedAt", ""), reverse=True)


def update_project(project_id: str, data: dict) -> None:
    """
    Partially update a project document.
    Always stamps updatedAt so sort order stays correct.
    """
    db = get_db()
    data["updatedAt"] = _utcnow()
    db.collection("projects").document(project_id).update(data)


def delete_project(project_id: str) -> None:
    """
    Delete a project document.

    WARNING - Firestore does NOT automatically delete subcollections. This
    deletes the top-level document only; chats and messages become orphaned.
    For production, call delete_project_deep() or run a Cloud Function trigger.
    In development, orphaned data is harmless but clutters the console.
    """
    db = get_db()
    db.collection("projects").document(project_id).delete()
    logger.warning(
        "Deleted project %s. Subcollections (chats/messages) were NOT deleted "
        "and remain in Firestore as orphans.", project_id
    )


def delete_project_deep(project_id: str) -> None:
    """
    Delete a project AND all its chats (messages within each chat are still
    orphaned at the messages subcollection level - see NOTE below).

    This is a best-effort client-side cascade. For a true atomic delete,
    use a Firebase Cloud Function with the 'delete-user-data' extension or
    the Admin SDK batch-delete approach.

    NOTE: Recursively deleting deeply nested subcollections (messages inside
    chats) requires iterating each chat, then each message. At scale, prefer
    a server-side solution to avoid timeout issues.
    """
    db = get_db()
    project_ref = db.collection("projects").document(project_id)

    # Delete all chats (and their message subcollections) first.
    chats_ref = project_ref.collection("chats")
    for chat_doc in chats_ref.stream():
        _delete_chat_deep(project_ref, chat_doc.id)

    # Finally delete the project document itself.
    project_ref.delete()
    logger.info("Deep-deleted project %s with all chats.", project_id)


def _delete_chat_deep(project_ref: Any, chat_id: str) -> None:
    """Delete a chat document and all its message documents."""
    chat_ref = project_ref.collection("chats").document(chat_id)
    for msg_doc in chat_ref.collection("messages").stream():
        msg_doc.reference.delete()
    chat_ref.delete()


# ---------------------------------------------------------------------------
# Chats
# ---------------------------------------------------------------------------

def create_chat(project_id: str, name: str = "New Chat") -> dict:
    """Create a chat under a project. Returns the full chat dict with 'id'."""
    db = get_db()
    now = _utcnow()
    data = {
        "projectId": project_id,
        "name": name,
        "createdAt": now,
        "updatedAt": now,
    }
    ref = (
        db.collection("projects").document(project_id)
        .collection("chats").document()
    )
    ref.set(data)
    return {"id": ref.id, **data}


def get_chat(project_id: str, chat_id: str) -> Optional[dict]:
    """Return a chat dict (with 'id'), or None if not found."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("chats").document(chat_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def list_chats(project_id: str) -> list[dict]:
    """
    Return all chats for a project, sorted by updatedAt descending.
    Limited to CHATS_LIMIT to avoid runaway reads.
    """
    from backend.config import settings

    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("chats")
        .limit(settings.CHATS_LIMIT)
        .stream()
    )
    results = [{"id": d.id, **d.to_dict()} for d in docs]
    return sorted(results, key=lambda c: c.get("updatedAt", ""), reverse=True)


def rename_chat(project_id: str, chat_id: str, name: str) -> None:
    """Rename a chat and bump its updatedAt timestamp."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("chats").document(chat_id)
        .update({"name": name, "updatedAt": _utcnow()})
    )


def delete_chat(project_id: str, chat_id: str) -> None:
    """
    Delete a chat document.
    Messages inside the chat are orphaned - see delete_project_deep() for
    a full recursive delete strategy.
    """
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("chats").document(chat_id)
        .delete()
    )


# ---------------------------------------------------------------------------
# Campaigns   (subcollection: projects/{pid}/campaigns/{cid})
# ---------------------------------------------------------------------------

def create_campaign(project_id: str, data: dict) -> dict:
    """Create a campaign document. Returns the full dict with 'id'."""
    db = get_db()
    now = _utcnow()
    payload = {
        **data,
        "projectId": project_id,
        "status": "generating",
        "contentPacks": {},
        "createdAt": now,
        "updatedAt": now,
    }
    ref = (
        db.collection("projects").document(project_id)
        .collection("campaigns").document()
    )
    ref.set(payload)
    return {"id": ref.id, **payload}


def get_campaign(project_id: str, campaign_id: str) -> Optional[dict]:
    """Return a campaign dict (with 'id'), or None if not found."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("campaigns").document(campaign_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def list_campaigns(project_id: str, limit: int = 50) -> list[dict]:
    """Return all campaigns for a project sorted by createdAt descending."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("campaigns")
        .order_by("createdAt", direction="DESCENDING")
        .limit(limit)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def update_campaign(project_id: str, campaign_id: str, data: dict) -> None:
    """Partially update a campaign document. Bumps updatedAt."""
    db = get_db()
    data["updatedAt"] = _utcnow()
    (
        db.collection("projects").document(project_id)
        .collection("campaigns").document(campaign_id)
        .update(data)
    )


def delete_campaign(project_id: str, campaign_id: str) -> None:
    """Delete a campaign document."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("campaigns").document(campaign_id)
        .delete()
    )


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

# Valid roles accepted by save_message. Validated explicitly to prevent
# arbitrary strings being persisted to Firestore and passed to the LLM.
_VALID_ROLES = frozenset({"user", "assistant"})


def save_message(project_id: str, chat_id: str, role: str, content: str) -> dict:
    """
    Persist a chat message and bump the parent chat's updatedAt.

    role must be 'user' or 'assistant'. Raises ValueError for anything else
    so callers don't accidentally store invalid data.
    """
    if role not in _VALID_ROLES:
        raise ValueError(
            f"Invalid message role {role!r}. Must be one of: {sorted(_VALID_ROLES)}"
        )

    db = get_db()
    now = _utcnow()
    data = {
        "projectId": project_id,
        "chatId": chat_id,
        "role": role,
        "content": content,
        "createdAt": now,
    }
    ref = (
        db.collection("projects").document(project_id)
        .collection("chats").document(chat_id)
        .collection("messages").document()
    )
    ref.set(data)

    # Bump chat updatedAt so it floats to the top of the chat list.
    (
        db.collection("projects").document(project_id)
        .collection("chats").document(chat_id)
        .update({"updatedAt": now})
    )
    return {"id": ref.id, **data}


def list_messages(
    project_id: str,
    chat_id: str,
    limit: int = 50,
    before: Optional[str] = None,
) -> list[dict]:
    """
    Return the most recent `limit` messages for a chat in chronological order.

    If `before` is supplied (an ISO 8601 createdAt timestamp), only messages
    older than that timestamp are returned - used for "Load earlier" pagination.

    The query fetches the newest `limit` docs descending, then reverses them
    so callers always receive messages in chronological (oldest-first) order.
    """
    db = get_db()
    query = (
        db.collection("projects").document(project_id)
        .collection("chats").document(chat_id)
        .collection("messages")
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )
    if before:
        query = query.where("createdAt", "<", before)

    docs = list(query.stream())
    docs.reverse()  # Back to chronological order for display and LLM context
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ---------------------------------------------------------------------------
# Brand Memory
# ---------------------------------------------------------------------------

def save_memory_feedback(project_id: str, feedback_data: dict) -> dict:
    """
    Persist a brand memory feedback item under projects/{id}/brand_memory.

    feedback_data must include: type (edit|approve|reject|instruction)
    Optional fields: original, edited, reason, instruction, platform, context, userId
    """
    db = get_db()
    now = _utcnow()
    data = {**feedback_data, "createdAt": now}
    ref = (
        db.collection("projects").document(project_id)
        .collection("brand_memory").document()
    )
    ref.set(data)
    return {"id": ref.id, **data}


def get_memory_feedback(project_id: str, limit: int = 20) -> list[dict]:
    """
    Return the most recent `limit` brand memory items, newest first.
    """
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("brand_memory")
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .limit(limit)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ---------------------------------------------------------------------------
# Competitive Intelligence Snapshots
# ---------------------------------------------------------------------------

def save_competitor_snapshot(project_id: str, snapshot: dict) -> dict:
    """
    Persist or overwrite a competitor snapshot keyed by competitor name.
    Stores under projects/{id}/competitor_snapshots/{name_slug}.
    """
    db = get_db()
    now = _utcnow()
    name = snapshot.get("name", "unknown")
    doc_id = name.lower().replace(" ", "_").replace("/", "_")[:64]
    data = {**snapshot, "scrapedAt": now}
    ref = (
        db.collection("projects").document(project_id)
        .collection("competitor_snapshots").document(doc_id)
    )
    ref.set(data)
    return {"id": ref.id, **data}


def get_competitor_snapshot(project_id: str, name: str) -> Optional[dict]:
    """Return a single competitor snapshot by name, or None if not found."""
    db = get_db()
    doc_id = name.lower().replace(" ", "_").replace("/", "_")[:64]
    doc = (
        db.collection("projects").document(project_id)
        .collection("competitor_snapshots").document(doc_id)
        .get()
    )
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def get_competitor_snapshots(project_id: str) -> list[dict]:
    """
    Return all stored competitor snapshots for a project.
    """
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("competitor_snapshots")
        .order_by("scrapedAt", direction=firestore.Query.DESCENDING)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ---------------------------------------------------------------------------
# Competitor Profiles (5-dimension classification)
# ---------------------------------------------------------------------------

def save_competitor_profile(project_id: str, profile: dict) -> dict:
    """
    Persist or update a competitor profile (5-dimension classification).
    Stored under projects/{id}/competitor_profiles/{profile_id}.
    If profile has no 'id', a new document is created.
    """
    db = get_db()
    now = _utcnow()
    col = (
        db.collection("projects").document(project_id)
        .collection("competitor_profiles")
    )
    if profile.get("id"):
        ref = col.document(profile["id"])
        data = {**profile, "updatedAt": now}
        ref.set(data, merge=True)
        return {"id": ref.id, **data}
    else:
        data = {**profile, "createdAt": now, "updatedAt": now}
        ref = col.document()
        ref.set(data)
        return {"id": ref.id, **data}


def get_competitor_profile(project_id: str, profile_id: str) -> Optional[dict]:
    """Return a single competitor profile by ID, or None."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("competitor_profiles").document(profile_id)
        .get()
    )
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def get_competitor_profiles(project_id: str) -> list[dict]:
    """Return all classified competitor profiles for a project, newest first."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("competitor_profiles")
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def delete_competitor_profile(project_id: str, profile_id: str) -> None:
    """Permanently delete a competitor profile."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("competitor_profiles").document(profile_id)
        .delete()
    )


def update_competitor_profile_status(project_id: str, profile_id: str, status: str, error: Optional[str] = None) -> None:
    """Update the processing status of a competitor profile."""
    db = get_db()
    updates: dict = {"status": status, "updatedAt": _utcnow()}
    if error:
        updates["error"] = error
    (
        db.collection("projects").document(project_id)
        .collection("competitor_profiles").document(profile_id)
        .update(updates)
    )


# ---------------------------------------------------------------------------
# Content Library
# ---------------------------------------------------------------------------

def save_content_library_item(project_id: str, data: dict) -> dict:
    """
    Save a content item to the project's content library.
    data: platform, type, content, hashtags, metadata, status, tags
    """
    db = get_db()
    now = _utcnow()
    item = {**data, "projectId": project_id, "createdAt": now, "updatedAt": now}
    ref = (
        db.collection("projects").document(project_id)
        .collection("content_library").document()
    )
    ref.set(item)
    return {"id": ref.id, **item}


def list_content_library_items(
    project_id: str,
    platform: Optional[str] = None,
    status: Optional[str] = None,
    item_type: Optional[str] = None,
    limit: int = 50,
) -> list[dict]:
    """
    List content library items with optional filters.
    """
    db = get_db()
    query = (
        db.collection("projects").document(project_id)
        .collection("content_library")
        .limit(limit)
    )
    if platform:
        query = query.where("platform", "==", platform)
    if status:
        query = query.where("status", "==", status)
    if item_type:
        query = query.where("type", "==", item_type)

    docs = list(query.stream())
    items = [{"id": d.id, **d.to_dict()} for d in docs]
    items.sort(key=lambda x: x.get("createdAt") or "", reverse=True)
    return items


def update_content_library_item(project_id: str, item_id: str, updates: dict) -> dict:
    """Update fields on a content library item."""
    db = get_db()
    ref = (
        db.collection("projects").document(project_id)
        .collection("content_library").document(item_id)
    )
    updates["updatedAt"] = _utcnow()
    ref.update(updates)
    doc = ref.get()
    if not doc.exists:
        raise ValueError(f"Content library item {item_id} not found.")
    return {"id": doc.id, **doc.to_dict()}


def delete_content_library_item(project_id: str, item_id: str) -> None:
    """Delete a content library item."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("content_library").document(item_id)
        .delete()
    )


def get_content_library_item(project_id: str, item_id: str) -> dict | None:
    """Fetch a single content library item by ID."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("content_library").document(item_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------

def save_calendar_entry(project_id: str, data: dict) -> dict:
    """
    Save a calendar entry under projects/{id}/calendar_entries.
    data: date (YYYY-MM-DD), platform, content, time, hashtags, type, status
    """
    db = get_db()
    now = _utcnow()
    entry = {**data, "projectId": project_id, "createdAt": now, "updatedAt": now}
    ref = (
        db.collection("projects").document(project_id)
        .collection("calendar_entries").document()
    )
    ref.set(entry)
    return {"id": ref.id, **entry}


def list_calendar_entries(
    project_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> list[dict]:
    """
    Return calendar entries ordered by date ascending.
    Optionally filter by from_date and to_date (YYYY-MM-DD strings).
    """
    db = get_db()
    query = (
        db.collection("projects").document(project_id)
        .collection("calendar_entries")
        .order_by("date", direction=firestore.Query.ASCENDING)
    )
    if from_date:
        query = query.where("date", ">=", from_date)
    if to_date:
        query = query.where("date", "<=", to_date)

    docs = list(query.stream())
    return [{"id": d.id, **d.to_dict()} for d in docs]


def update_calendar_entry(project_id: str, entry_id: str, updates: dict) -> dict:
    """Update a calendar entry."""
    db = get_db()
    ref = (
        db.collection("projects").document(project_id)
        .collection("calendar_entries").document(entry_id)
    )
    updates["updatedAt"] = _utcnow()
    ref.update(updates)
    doc = ref.get()
    if not doc.exists:
        raise ValueError(f"Calendar entry {entry_id} not found.")
    return {"id": doc.id, **doc.to_dict()}


def delete_calendar_entry(project_id: str, entry_id: str) -> None:
    """Delete a calendar entry."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("calendar_entries").document(entry_id)
        .delete()
    )


# ---------------------------------------------------------------------------
# Performance Tracking
# ---------------------------------------------------------------------------

def save_performance_record(project_id: str, item_id: str, data: dict) -> dict:
    """
    Save a performance record for a content library item.
    Also marks the item status as 'posted' and persists the performance data on the item.
    """
    db = get_db()
    now = _utcnow()
    record = {**data, "projectId": project_id, "itemId": item_id, "createdAt": now}
    # Write to subcollection for history
    ref = (
        db.collection("projects").document(project_id)
        .collection("content_library").document(item_id)
        .collection("performance").document()
    )
    ref.set(record)
    # Update the library item with latest performance snapshot + mark as posted
    item_ref = (
        db.collection("projects").document(project_id)
        .collection("content_library").document(item_id)
    )
    item_ref.update({
        "status": "posted",
        "performance": data,
        "updatedAt": now,
    })
    return {"id": ref.id, **record}


def get_project_analytics(project_id: str) -> dict:
    """
    Aggregate analytics for the project dashboard.
    Returns library stats, calendar stats, memory count, competitor count,
    and top-performing content.
    """
    db = get_db()

    # Content library counts
    library_docs = list(
        db.collection("projects").document(project_id)
        .collection("content_library").stream()
    )
    library_total = len(library_docs)
    by_status: dict[str, int] = {"draft": 0, "approved": 0, "scheduled": 0, "posted": 0}
    by_platform: dict[str, int] = {}
    top_performers: list[dict] = []

    for doc in library_docs:
        d = doc.to_dict() or {}
        s = d.get("status", "draft")
        by_status[s] = by_status.get(s, 0) + 1
        p = d.get("platform", "unknown")
        by_platform[p] = by_platform.get(p, 0) + 1
        # Collect items that have performance data
        perf = d.get("performance")
        if perf:
            er = perf.get("engagement_rate", 0) or 0
            top_performers.append({
                "id": doc.id,
                "platform": p,
                "content": (d.get("content") or "")[:120],
                "engagement_rate": er,
                "likes": perf.get("likes", 0),
                "reach": perf.get("reach", 0),
            })

    top_performers.sort(key=lambda x: x["engagement_rate"], reverse=True)

    # Calendar: upcoming entries (next 30 days)
    today = _utcnow()[:10]
    from datetime import date, timedelta
    in_30 = (date.today() + timedelta(days=30)).isoformat()

    calendar_docs = list(
        db.collection("projects").document(project_id)
        .collection("calendar_entries")
        .where("date", ">=", today)
        .where("date", "<=", in_30)
        .order_by("date")
        .limit(10)
        .stream()
    )
    upcoming = [{"id": d.id, **d.to_dict()} for d in calendar_docs]

    # Memory count
    memory_docs = list(
        db.collection("projects").document(project_id)
        .collection("brand_memory").stream()
    )
    memory_count = len(memory_docs)

    # Competitor snapshot count
    competitor_docs = list(
        db.collection("projects").document(project_id)
        .collection("competitor_snapshots").stream()
    )
    competitor_count = len(competitor_docs)
    # Most recent competitor analysis date
    last_analysis: Optional[str] = None
    for doc in competitor_docs:
        sa = (doc.to_dict() or {}).get("scrapedAt")
        if sa and (last_analysis is None or sa > last_analysis):
            last_analysis = sa

    return {
        "library": {
            "total": library_total,
            "by_status": by_status,
            "by_platform": by_platform,
        },
        "calendar": {
            "upcoming_count": len(upcoming),
            "upcoming": upcoming,
        },
        "memory": {
            "count": memory_count,
        },
        "competitors": {
            "count": competitor_count,
            "last_analysis": last_analysis,
        },
        "top_performers": top_performers[:5],
    }


# ---------------------------------------------------------------------------
# Content Templates (Phase 6)
# ---------------------------------------------------------------------------

def save_template(project_id: str, data: dict) -> dict:
    """Save a content template under projects/{id}/templates."""
    db = get_db()
    now = _utcnow()
    payload = {**data, "projectId": project_id, "createdAt": now, "updatedAt": now}
    ref = (
        db.collection("projects").document(project_id)
        .collection("templates").document()
    )
    ref.set(payload)
    return {"id": ref.id, **payload}


def list_templates(project_id: str, category: Optional[str] = None) -> list[dict]:
    """Return templates for a project, newest first. Optionally filter by category."""
    db = get_db()
    query = (
        db.collection("projects").document(project_id)
        .collection("templates")
        .order_by("createdAt", direction="DESCENDING")
    )
    if category:
        query = query.where("category", "==", category)
    return [{"id": d.id, **d.to_dict()} for d in query.stream()]


def get_template(project_id: str, template_id: str) -> Optional[dict]:
    """Return a single template or None."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("templates").document(template_id)
        .get()
    )
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def update_template(project_id: str, template_id: str, updates: dict) -> dict:
    """Update a template."""
    db = get_db()
    ref = (
        db.collection("projects").document(project_id)
        .collection("templates").document(template_id)
    )
    updates["updatedAt"] = _utcnow()
    ref.update(updates)
    doc = ref.get()
    if not doc.exists:
        raise ValueError(f"Template {template_id} not found.")
    return {"id": doc.id, **doc.to_dict()}


def delete_template(project_id: str, template_id: str) -> None:
    """Delete a template."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("templates").document(template_id)
        .delete()
    )


# ---------------------------------------------------------------------------
# Approval Workflow (Phase 6)
# ---------------------------------------------------------------------------

def submit_for_review(project_id: str, item_id: str, submitted_by: str, note: str = "") -> dict:
    """Change a library item status to in_review and record the submission."""
    db = get_db()
    now = _utcnow()
    ref = (
        db.collection("projects").document(project_id)
        .collection("content_library").document(item_id)
    )
    ref.update({"status": "in_review", "submittedAt": now, "submittedBy": submitted_by, "updatedAt": now})

    # Record in review_history subcollection
    ref.collection("review_history").document().set({
        "action": "submitted",
        "by": submitted_by,
        "note": note,
        "timestamp": now,
    })

    doc = ref.get()
    return {"id": doc.id, **doc.to_dict()}


def record_review_decision(
    project_id: str,
    item_id: str,
    decision: str,          # "approved" | "rejected" | "changes_requested"
    reviewed_by: str,
    note: str = "",
) -> dict:
    """Apply a review decision to a library item and record it in history."""
    db = get_db()
    now = _utcnow()

    new_status = {
        "approved": "approved",
        "rejected": "rejected",
        "changes_requested": "draft",   # send back to draft for editing
    }.get(decision, "draft")

    ref = (
        db.collection("projects").document(project_id)
        .collection("content_library").document(item_id)
    )
    ref.update({
        "status": new_status,
        "reviewedAt": now,
        "reviewedBy": reviewed_by,
        "reviewNote": note,
        "updatedAt": now,
    })

    ref.collection("review_history").document().set({
        "action": decision,
        "by": reviewed_by,
        "note": note,
        "timestamp": now,
    })

    doc = ref.get()
    return {"id": doc.id, **doc.to_dict()}


def list_review_queue(project_id: str) -> list[dict]:
    """Return all content library items with status = in_review, newest first."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("content_library")
        .where("status", "==", "in_review")
        .order_by("submittedAt", direction="DESCENDING")
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def get_review_history(project_id: str, item_id: str) -> list[dict]:
    """Return review history for a single library item, newest first."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("content_library").document(item_id)
        .collection("review_history")
        .order_by("timestamp", direction="DESCENDING")
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ---------------------------------------------------------------------------
# Phase 7 - Generated Images
# ---------------------------------------------------------------------------

def save_generated_image(project_id: str, data: dict) -> dict:
    """Save a generated image record to Firestore."""
    db = get_db()
    now = _utcnow()
    ref = (
        db.collection("projects").document(project_id)
        .collection("generated_images").document()
    )
    payload = {**data, "createdAt": now}
    ref.set(payload)
    return {"id": ref.id, **payload}


def list_generated_images(project_id: str) -> list[dict]:
    """Return all saved generated images, newest first."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("generated_images")
        .order_by("createdAt", direction="DESCENDING")
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def delete_generated_image(project_id: str, image_id: str) -> None:
    """Delete a saved generated image."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("generated_images").document(image_id)
        .delete()
    )



# ---------------------------------------------------------------------------
# Web Search Cache - TTL-based cache for Exa/Tavily results
# ---------------------------------------------------------------------------

def get_cached_search(project_id: str, query_hash: str) -> Optional[list]:
    """
    Return cached search results if they exist and haven't expired.
    Returns None if cache miss or expired.
    """
    from datetime import datetime, timezone
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("web_search_cache").document(query_hash)
        .get()
    )
    if not doc.exists:
        return None
    data = doc.to_dict()
    expires_at = data.get("expires_at", "")
    if expires_at and expires_at < datetime.now(timezone.utc).isoformat():
        return None  # expired
    return data.get("results")


def save_search_cache(
    project_id: str,
    query_hash: str,
    results: list,
    source: str,
    ttl_hours: int = 6,
) -> None:
    """Persist search results to cache with TTL."""
    from datetime import datetime, timedelta, timezone
    db = get_db()
    now = datetime.now(timezone.utc)
    db.collection("projects").document(project_id).collection("web_search_cache").document(query_hash).set({
        "results": results,
        "source": source,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=ttl_hours)).isoformat(),
    })


# ---------------------------------------------------------------------------
# Search Usage - daily quota tracking per project
# ---------------------------------------------------------------------------

def get_search_usage(project_id: str, source: str) -> dict:
    """
    Return today's search usage counters for a project.
    source: "exa" | "tavily"
    Returns dict with keys: exa_searches, exa_research_ops, tavily_searches (all defaulting to 0)
    """
    from datetime import date
    db = get_db()
    today = date.today().isoformat()
    doc = (
        db.collection("projects").document(project_id)
        .collection("search_usage").document(today)
        .get()
    )
    if not doc.exists:
        return {}
    return doc.to_dict() or {}


def increment_search_usage(
    project_id: str,
    source: str,
    operation: str,
    count: int = 1,
) -> None:
    """
    Atomically increment today's usage counter.
    source: "exa" | "tavily"
    operation: "search" | "contents" | "answer" | "research"
    """
    from datetime import date
    db = get_db()
    today = date.today().isoformat()
    ref = (
        db.collection("projects").document(project_id)
        .collection("search_usage").document(today)
    )
    field = f"{source}_research_ops" if operation == "research" else f"{source}_searches"
    ref.set(
        {field: firestore.Increment(count), "date": today},
        merge=True,
    )


# ---------------------------------------------------------------------------
# Monitor Alerts - brand & competitor news monitoring
# ---------------------------------------------------------------------------

def save_monitor_alert(project_id: str, data: dict) -> dict:
    """
    Save a brand monitoring alert. Returns the saved doc with id.
    data keys: alert_type, keyword, title, url, snippet, published_date, sentiment
    """
    db = get_db()
    doc_ref = (
        db.collection("projects").document(project_id)
        .collection("monitor_alerts").document()
    )
    payload = {
        **data,
        "read": False,
        "created_at": _utcnow(),
    }
    doc_ref.set(payload)
    return {"id": doc_ref.id, **payload}


def list_monitor_alerts(
    project_id: str,
    unread_only: bool = False,
    limit: int = 50,
    days: int = 30,
) -> list[dict]:
    """List monitor alerts for a project, ordered by newest first."""
    from datetime import datetime, timedelta, timezone
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    query = (
        db.collection("projects").document(project_id)
        .collection("monitor_alerts")
        .where("created_at", ">=", cutoff)
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )
    if unread_only:
        query = query.where("read", "==", False)
    docs = query.stream()
    return [{"id": d.id, **d.to_dict()} for d in docs]


def mark_alert_read(project_id: str, alert_id: str) -> None:
    """Mark a single monitor alert as read."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("monitor_alerts").document(alert_id)
        .update({"read": True})
    )


def alert_url_exists(project_id: str, url: str) -> bool:
    """Check if an alert with the given URL already exists (dedup check)."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("monitor_alerts")
        .where("url", "==", url)
        .limit(1)
        .stream()
    )
    return any(True for _ in docs)


# ---------------------------------------------------------------------------
# Research Reports - async deep research tasks
# ---------------------------------------------------------------------------

def save_research_report(project_id: str, data: dict) -> dict:
    """
    Create a new research report document (status: pending).
    Returns the doc dict with id.
    """
    db = get_db()
    doc_ref = (
        db.collection("projects").document(project_id)
        .collection("research_reports").document()
    )
    payload = {
        "status": "pending",
        "created_at": _utcnow(),
        "completed_at": None,
        **data,
    }
    doc_ref.set(payload)
    return {"id": doc_ref.id, **payload}


def update_research_report(project_id: str, report_id: str, data: dict) -> None:
    """Update fields on an existing research report (e.g. status → complete)."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("research_reports").document(report_id)
        .update(data)
    )


def get_research_report(project_id: str, report_id: str) -> Optional[dict]:
    """Return a single research report dict, or None."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("research_reports").document(report_id)
        .get()
    )
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def list_research_reports(project_id: str, limit: int = 20) -> list[dict]:
    """List research reports for a project, newest first."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("research_reports")
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(limit)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def delete_research_report(project_id: str, report_id: str) -> None:
    """Delete a research report."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("research_reports").document(report_id)
        .delete()
    )


# ---------------------------------------------------------------------------
# Posts
# ---------------------------------------------------------------------------

def create_post(
    project_id: str,
    author_uid: str,
    author_email: str,
    author_name: str,
    title: str,
    body: str = "",
    status: str = "open",
    priority: str = "medium",
    tags: Optional[list] = None,
    due_date: Optional[str] = None,
    assignees: Optional[list] = None,
) -> dict:
    """Create a post under a project. Returns the full post dict with 'id'."""
    db = get_db()
    now = _utcnow()
    data = {
        "projectId": project_id,
        "title": title,
        "body": body,
        "status": status,
        "priority": priority,
        "authorId": author_uid,
        "authorEmail": author_email,
        "authorName": author_name,
        "tags": tags or [],
        "dueDate": due_date,
        "assignees": assignees or [],
        "createdAt": now,
        "updatedAt": now,
    }
    ref = (
        db.collection("projects").document(project_id)
        .collection("posts").document()
    )
    ref.set(data)
    return {"id": ref.id, **data}


def get_post(project_id: str, post_id: str) -> Optional[dict]:
    """Return a post dict (with 'id'), or None if not found."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("posts").document(post_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def list_posts(project_id: str, limit: int = 200) -> list[dict]:
    """Return all posts for a project, sorted by createdAt descending."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("posts")
        .limit(limit)
        .stream()
    )
    results = [{"id": d.id, **d.to_dict()} for d in docs]
    return sorted(results, key=lambda p: p.get("createdAt", ""), reverse=True)


def update_post(project_id: str, post_id: str, data: dict) -> None:
    """Partially update a post document. Always stamps updatedAt."""
    db = get_db()
    data["updatedAt"] = _utcnow()
    (
        db.collection("projects").document(project_id)
        .collection("posts").document(post_id)
        .update(data)
    )


def delete_post(project_id: str, post_id: str) -> None:
    """Delete a post document."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("posts").document(post_id)
        .delete()
    )


# ---------------------------------------------------------------------------
# Funnel Strategy Engine - sessions, research cache, saved strategies
# ---------------------------------------------------------------------------

def create_strategy_session(project_id: str, data: dict) -> dict:
    """Create a new strategy session document and return it with its id."""
    db = get_db()
    now = _utcnow()
    data = {**data, "createdAt": now, "updatedAt": now}
    ref = (
        db.collection("projects").document(project_id)
        .collection("strategy_sessions").document()
    )
    ref.set(data)
    return {"id": ref.id, **data}


def get_strategy_session(project_id: str, session_id: str) -> Optional[dict]:
    """Fetch a strategy session by ID, or None if not found."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("strategy_sessions").document(session_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def update_strategy_session(project_id: str, session_id: str, data: dict) -> None:
    """Partially update a strategy session document."""
    db = get_db()
    data["updatedAt"] = _utcnow()
    (
        db.collection("projects").document(project_id)
        .collection("strategy_sessions").document(session_id)
        .update(data)
    )


def save_strategy_research_cache(
    project_id: str,
    session_id: str,
    source: str,
    query_used: str,
    raw_response: Any,
    parsed_insights: Any,
) -> dict:
    """Persist a research cache entry for a session."""
    db = get_db()
    now = _utcnow()
    data = {
        "source": source,
        "query_used": query_used,
        "raw_response": raw_response,
        "parsed_insights": parsed_insights,
        "fetched_at": now,
    }
    ref = (
        db.collection("projects").document(project_id)
        .collection("strategy_sessions").document(session_id)
        .collection("research_cache").document()
    )
    ref.set(data)
    return {"id": ref.id, **data}


def list_strategy_research_cache(project_id: str, session_id: str) -> list[dict]:
    """Return all research cache entries for a session."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("strategy_sessions").document(session_id)
        .collection("research_cache")
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def save_marketing_strategy(project_id: str, data: dict) -> dict:
    """Persist a completed marketing strategy document."""
    db = get_db()
    now = _utcnow()
    data = {**data, "createdAt": now, "updatedAt": now}
    ref = (
        db.collection("projects").document(project_id)
        .collection("marketing_strategies").document()
    )
    ref.set(data)
    return {"id": ref.id, **data}


def get_marketing_strategy(project_id: str, strategy_id: str) -> Optional[dict]:
    """Fetch a saved strategy by ID, or None."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("marketing_strategies").document(strategy_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def list_marketing_strategies(project_id: str) -> list[dict]:
    """Return all saved strategies for a project, newest first."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("marketing_strategies")
        .order_by("createdAt", direction="DESCENDING")
        .limit(20)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ---------------------------------------------------------------------------
# Carousel Studio - scrape cache, sessions, carousels
# ---------------------------------------------------------------------------

def get_brand_scrape_cache(project_id: str) -> Optional[dict]:
    """Return a fresh (non-expired) scrape cache for this project, or None."""
    db = get_db()
    docs = list(
        db.collection("projects").document(project_id)
        .collection("brand_scrape_cache")
        .order_by("fetchedAt", direction="DESCENDING")
        .limit(1)
        .stream()
    )
    if not docs:
        return None
    data = {"id": docs[0].id, **docs[0].to_dict()}
    expires_at = data.get("expiresAt", "")
    if expires_at > _utcnow():
        return data
    return None


def save_brand_scrape_cache(project_id: str, data: dict) -> dict:
    """Persist a brand scrape cache entry. TTL = 24 hours."""
    from datetime import datetime, timezone, timedelta
    now = _utcnow()
    expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    payload = {**data, "fetchedAt": now, "expiresAt": expires}
    db = get_db()
    ref = (
        db.collection("projects").document(project_id)
        .collection("brand_scrape_cache").document()
    )
    ref.set(payload)
    return {"id": ref.id, **payload}


def create_carousel_session(project_id: str, data: dict) -> dict:
    """Create a new carousel session. Returns the doc with its id."""
    db = get_db()
    now = _utcnow()
    payload = {**data, "createdAt": now, "updatedAt": now}
    ref = (
        db.collection("projects").document(project_id)
        .collection("carousel_sessions").document()
    )
    ref.set(payload)
    return {"id": ref.id, **payload}


def get_carousel_session(project_id: str, session_id: str) -> Optional[dict]:
    """Fetch a carousel session by ID, or None."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("carousel_sessions").document(session_id)
        .get()
    )
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def update_carousel_session(project_id: str, session_id: str, data: dict) -> None:
    """Partially update a carousel session."""
    db = get_db()
    data["updatedAt"] = _utcnow()
    (
        db.collection("projects").document(project_id)
        .collection("carousel_sessions").document(session_id)
        .update(data)
    )


def create_carousel(project_id: str, data: dict) -> dict:
    """Persist a new carousel document and return it with its id."""
    db = get_db()
    now = _utcnow()
    payload = {**data, "version": 1, "createdAt": now, "updatedAt": now}
    ref = (
        db.collection("projects").document(project_id)
        .collection("carousels").document()
    )
    ref.set(payload)
    return {"id": ref.id, **payload}


def get_carousel(project_id: str, carousel_id: str) -> Optional[dict]:
    """Fetch a carousel by ID, or None."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("carousels").document(carousel_id)
        .get()
    )
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def update_carousel(project_id: str, carousel_id: str, data: dict) -> None:
    """Partially update a carousel (increments version automatically)."""
    db = get_db()
    data["updatedAt"] = _utcnow()
    data["version"] = firestore.Increment(1)
    (
        db.collection("projects").document(project_id)
        .collection("carousels").document(carousel_id)
        .update(data)
    )


def list_carousels(project_id: str) -> list[dict]:
    """Return all carousels for a project, newest first."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("carousels")
        .order_by("createdAt", direction="DESCENDING")
        .limit(50)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ---------------------------------------------------------------------------
# Threads OAuth token storage  (user_integrations/{uid}/threads)
# ---------------------------------------------------------------------------

def save_threads_token(uid: str, token_data: dict) -> None:
    """
    Persist a Threads long-lived token for a user.
    token_data must contain: access_token, user_id, expires_in (seconds).
    expires_at is computed and stored as a UTC timestamp string.
    """
    import datetime as _dt
    db = get_db()
    expires_in = int(token_data.get("expires_in", 5183944))  # ~60 days
    expires_at = _dt.datetime.utcnow() + _dt.timedelta(seconds=expires_in)
    payload = {
        "access_token": token_data.get("access_token", ""),
        "threads_user_id": token_data.get("user_id", ""),
        "expires_at": expires_at.isoformat() + "Z",
        "token_type": token_data.get("token_type", "bearer"),
        "connected_at": _utcnow(),
    }
    (
        db.collection("user_integrations").document(uid)
        .collection("threads").document("token")
        .set(payload)
    )


def get_threads_token(uid: str) -> dict | None:
    """
    Retrieve the stored Threads token for a user.
    Returns None if no token exists.
    """
    db = get_db()
    doc = (
        db.collection("user_integrations").document(uid)
        .collection("threads").document("token")
        .get()
    )
    return doc.to_dict() if doc.exists else None


def delete_threads_token(uid: str) -> None:
    """Remove stored Threads token (disconnect)."""
    db = get_db()
    (
        db.collection("user_integrations").document(uid)
        .collection("threads").document("token")
        .delete()
    )


# ---------------------------------------------------------------------------
# Competitor Deep Research - Reports
# ---------------------------------------------------------------------------

def save_competitor_report(project_id: str, report: dict) -> dict:
    """
    Persist a completed 7-layer competitor research report.
    Stored under projects/{id}/competitor_reports/{report_id}.
    """
    db = get_db()
    report_id = report.get("id") or db.collection("projects").document(project_id).collection("competitor_reports").document().id
    payload = {**report, "id": report_id, "project_id": project_id}
    (
        db.collection("projects").document(project_id)
        .collection("competitor_reports").document(report_id)
        .set(payload)
    )
    return payload


def get_competitor_report(project_id: str, report_id: str) -> Optional[dict]:
    """Return a single competitor report or None."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("competitor_reports").document(report_id)
        .get()
    )
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def list_competitor_reports(project_id: str) -> list[dict]:
    """Return all competitor reports for a project, newest first."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("competitor_reports")
        .order_by("created_at", direction="DESCENDING")
        .limit(50)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ---------------------------------------------------------------------------
# Competitor Deep Research - Monitors
# ---------------------------------------------------------------------------

def save_competitor_monitor(project_id: str, monitor: dict) -> dict:
    """Create a new competitor monitor record."""
    db = get_db()
    now = _utcnow()
    ref = (
        db.collection("projects").document(project_id)
        .collection("competitor_monitors").document()
    )
    payload = {
        **monitor,
        "id": ref.id,
        "project_id": project_id,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    ref.set(payload)
    return payload


def get_competitor_monitor(project_id: str, monitor_id: str) -> Optional[dict]:
    """Return a single competitor monitor or None."""
    db = get_db()
    doc = (
        db.collection("projects").document(project_id)
        .collection("competitor_monitors").document(monitor_id)
        .get()
    )
    return {"id": doc.id, **doc.to_dict()} if doc.exists else None


def list_competitor_monitors(project_id: str) -> list[dict]:
    """Return all active competitor monitors for a project."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("competitor_monitors")
        .where("is_active", "==", True)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def update_competitor_monitor(project_id: str, monitor_id: str, updates: dict) -> None:
    """Update fields on an existing monitor."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("competitor_monitors").document(monitor_id)
        .update({**updates, "updated_at": _utcnow()})
    )


def delete_competitor_monitor(project_id: str, monitor_id: str) -> None:
    """Soft-delete (deactivate) a monitor."""
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("competitor_monitors").document(monitor_id)
        .update({"is_active": False, "updated_at": _utcnow()})
    )


# ---------------------------------------------------------------------------
# Competitor Deep Research - Monitor Alerts (per-competitor-monitor subcollection)
# NOTE: This is DIFFERENT from the brand monitoring alerts (projects/{id}/monitor_alerts).
#       Renamed to avoid overriding the brand monitoring list_monitor_alerts above.
# ---------------------------------------------------------------------------

def save_competitor_monitor_alert(project_id: str, monitor_id: str, alert: dict) -> dict:
    """Save a change alert for a specific competitor monitor."""
    db = get_db()
    now = _utcnow()
    ref = (
        db.collection("projects").document(project_id)
        .collection("competitor_monitors").document(monitor_id)
        .collection("alerts").document()
    )
    payload = {**alert, "id": ref.id, "monitor_id": monitor_id, "created_at": now}
    ref.set(payload)
    return payload


def list_competitor_monitor_alerts(project_id: str, monitor_id: str) -> list[dict]:
    """Return all alerts for a specific competitor monitor, newest first."""
    db = get_db()
    docs = (
        db.collection("projects").document(project_id)
        .collection("competitor_monitors").document(monitor_id)
        .collection("alerts")
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(30)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


# ---------------------------------------------------------------------------
# Personal Brand - Personal Core
# ---------------------------------------------------------------------------

def get_personal_core(project_id: str) -> Optional[dict]:
    """Return the Personal Core for a personal brand project, or None."""
    db = get_db()
    doc = db.collection("personal_cores").document(project_id).get()
    if not doc.exists:
        return None
    return {"projectId": project_id, **doc.to_dict()}


def create_personal_core(project_id: str, full_name: str, linkedin_url: Optional[str] = None) -> dict:
    """Create the initial Personal Core document for a personal brand project."""
    db = get_db()
    now = _utcnow()
    data = {
        "fullName": full_name,
        "linkedinUrl": linkedin_url,
        "headline": None,
        "positioningStatement": None,
        "uniqueAngle": None,
        "originStory": None,
        "values": [],
        "credentialHighlights": [],
        "expertiseTopics": [],
        "avoidedTopics": [],
        "targetAudience": None,
        "secondaryAudiences": [],
        "contentPillars": [],
        "platformStrategy": {},
        "brandGoals": [],
        "goal90Day": None,
        "goal12Month": None,
        "admiredVoices": [],
        "antiVoices": [],
        "nicheTiredTopics": [],
        "interviewStatus": "not_started",
        "interviewAnswers": {},
        "interviewProgress": 0,
        "enrichmentStatus": "pending",
        "completenessScore": 0,
        "version": 1,
        "createdAt": now,
        "updatedAt": now,
    }
    db.collection("personal_cores").document(project_id).set(data)
    return {"projectId": project_id, **data}


def update_personal_core(project_id: str, updates: dict) -> dict:
    """Merge updates into an existing Personal Core document."""
    db = get_db()
    updates["updatedAt"] = _utcnow()
    db.collection("personal_cores").document(project_id).update(updates)
    return get_personal_core(project_id)


def save_interview_answer(project_id: str, question_key: str, answer: str) -> dict:
    """
    Persist a single interview answer and update interview progress.
    Answers are stored as interviewAnswers.{question_key} = answer.
    """
    db = get_db()
    now = _utcnow()

    # Count total questions across all 5 modules (A=6, B=5, C=5, D=5, E=3 = 24)
    TOTAL_QUESTIONS = 24

    core = get_personal_core(project_id)
    existing_answers: dict = core.get("interviewAnswers", {}) if core else {}
    existing_answers[question_key] = answer

    answered = len(existing_answers)
    progress = min(int((answered / TOTAL_QUESTIONS) * 100), 99)
    status = "in_progress" if answered < TOTAL_QUESTIONS else "in_progress"

    db.collection("personal_cores").document(project_id).update({
        f"interviewAnswers.{question_key}": answer,
        "interviewProgress": progress,
        "interviewStatus": status,
        "updatedAt": now,
    })
    return get_personal_core(project_id)


# ---------------------------------------------------------------------------
# Pillar 1 - Strategy & Planning documents
# ---------------------------------------------------------------------------

def create_pillar1_doc(
    project_id: str,
    doc_type: str,
    owner_uid: str,
    title: str,
) -> dict:
    """Create a new Pillar 1 strategy document and return it with its generated id."""
    db = get_db()
    now = _utcnow()
    ref = db.collection("projects").document(project_id).collection("pillar1_docs").document()
    data = {
        "id": ref.id,
        "doc_type": doc_type,
        "title": title,
        "status": "draft",
        "owner_uid": owner_uid,
        "created_at": now,
        "updated_at": now,
        "credits_spent": 0,
        "payload": {},
        "research_cache": {},
    }
    ref.set(data)
    return data


def get_pillar1_doc(project_id: str, doc_id: str) -> dict | None:
    """Fetch a single Pillar 1 document by id."""
    db = get_db()
    snap = (
        db.collection("projects")
        .document(project_id)
        .collection("pillar1_docs")
        .document(doc_id)
        .get()
    )
    return snap.to_dict() if snap.exists else None


def update_pillar1_doc(project_id: str, doc_id: str, updates: dict) -> None:
    """Partial-update a Pillar 1 document. Always stamps updated_at."""
    db = get_db()
    updates["updated_at"] = _utcnow()
    (
        db.collection("projects")
        .document(project_id)
        .collection("pillar1_docs")
        .document(doc_id)
        .update(updates)
    )


def list_pillar1_docs(
    project_id: str,
    doc_type: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """
    List Pillar 1 documents for a project, newest first.
    Optionally filter by doc_type (icp, gtm, okr, etc.).
    """
    db = get_db()
    query = db.collection("projects").document(project_id).collection("pillar1_docs")
    if doc_type:
        query = query.where("doc_type", "==", doc_type)
    query = query.order_by("created_at", direction=firestore.Query.DESCENDING).limit(limit)
    return [snap.to_dict() for snap in query.stream()]


def save_pillar1_message(
    project_id: str,
    doc_id: str,
    role: str,
    content: str,
) -> dict:
    """Save a chat message to a Positioning Workshop document's messages sub-collection."""
    db = get_db()
    now = _utcnow()
    ref = (
        db.collection("projects")
        .document(project_id)
        .collection("pillar1_docs")
        .document(doc_id)
        .collection("messages")
        .document()
    )
    data = {"id": ref.id, "role": role, "content": content, "created_at": now}
    ref.set(data)
    return data


def list_pillar1_messages(project_id: str, doc_id: str) -> list[dict]:
    """Return all messages for a Positioning Workshop session, oldest first."""
    db = get_db()
    snaps = (
        db.collection("projects")
        .document(project_id)
        .collection("pillar1_docs")
        .document(doc_id)
        .collection("messages")
        .order_by("created_at", direction=firestore.Query.ASCENDING)
        .stream()
    )
    return [snap.to_dict() for snap in snaps]


def dismiss_risk_alert(project_id: str, doc_id: str, risk_id: str) -> None:
    """
    Mark a specific risk alert as dismissed within a risk_flag document.
    Updates the risks list element matching risk_id.
    """
    db = get_db()
    doc_ref = (
        db.collection("projects")
        .document(project_id)
        .collection("pillar1_docs")
        .document(doc_id)
    )
    snap = doc_ref.get()
    if not snap.exists:
        return
    doc_data = snap.to_dict()
    risks: list = doc_data.get("payload", {}).get("risks", [])
    for risk in risks:
        if risk.get("risk_id") == risk_id:
            risk["dismissed"] = True
            break
    doc_ref.update({"payload.risks": risks, "updated_at": _utcnow()})


# ===========================================================================
# Pillar 10 - Experiment Log (native Firestore table)
# ===========================================================================

def create_experiment(project_id: str, owner_uid: str, data: dict) -> dict:
    """Create a new experiment log entry."""
    db = get_db()
    now = _utcnow()
    ref = db.collection("projects").document(project_id).collection("experiments").document()
    entry = {
        "id": ref.id,
        "owner_uid": owner_uid,
        "created_at": now,
        "updated_at": now,
        **data,
    }
    ref.set(entry)
    return entry


def get_experiment(project_id: str, experiment_id: str) -> dict | None:
    """Fetch a single experiment by ID."""
    db = get_db()
    snap = (
        db.collection("projects")
        .document(project_id)
        .collection("experiments")
        .document(experiment_id)
        .get()
    )
    return snap.to_dict() if snap.exists else None


def update_experiment(project_id: str, experiment_id: str, updates: dict) -> None:
    """Partial-update an experiment. Stamps updated_at."""
    db = get_db()
    updates["updated_at"] = _utcnow()
    (
        db.collection("projects")
        .document(project_id)
        .collection("experiments")
        .document(experiment_id)
        .update(updates)
    )


def delete_experiment(project_id: str, experiment_id: str) -> None:
    """Delete an experiment log entry."""
    db = get_db()
    (
        db.collection("projects")
        .document(project_id)
        .collection("experiments")
        .document(experiment_id)
        .delete()
    )


def list_experiments(
    project_id: str,
    status: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """List experiments for a project, newest first. Optionally filter by status."""
    db = get_db()
    query = db.collection("projects").document(project_id).collection("experiments")
    if status:
        query = query.where("status", "==", status)
    query = query.order_by("created_at", direction=firestore.Query.DESCENDING).limit(limit)
    return [snap.to_dict() for snap in query.stream()]


# ---------------------------------------------------------------------------
# Brand Knowledge Base
# ---------------------------------------------------------------------------

def save_knowledge_doc(project_id: str, doc_id: str, data: dict) -> None:
    db = get_db()
    db.collection("projects").document(project_id).collection("knowledgeDocs").document(doc_id).set(data)


def save_knowledge_chunk(project_id: str, doc_id: str, chunk_index: str, data: dict) -> None:
    db = get_db()
    (
        db.collection("projects").document(project_id)
        .collection("knowledgeDocs").document(doc_id)
        .collection("chunks").document(chunk_index)
        .set(data)
    )


def list_knowledge_docs(project_id: str) -> list[dict]:
    db = get_db()
    snaps = (
        db.collection("projects").document(project_id)
        .collection("knowledgeDocs")
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .stream()
    )
    return [{"id": s.id, **s.to_dict()} for s in snaps]


def list_knowledge_chunks(project_id: str) -> list[dict]:
    """Return all chunks across all knowledge docs for a project (used for retrieval)."""
    db = get_db()
    docs_ref = db.collection("projects").document(project_id).collection("knowledgeDocs").stream()
    chunks: list[dict] = []
    for doc_snap in docs_ref:
        chunk_snaps = (
            db.collection("projects").document(project_id)
            .collection("knowledgeDocs").document(doc_snap.id)
            .collection("chunks").stream()
        )
        for cs in chunk_snaps:
            chunks.append(cs.to_dict())
    return chunks


def publish_community_template(template_id: str, project_id: str, template_data: dict) -> None:
    """Write a template to the global community collection."""
    db = get_db()
    db.collection("communityTemplates").document(template_id).set({
        **template_data,
        "projectId": project_id,
        "usageCount": 0,
        "publishedAt": _utcnow(),
    })


def unpublish_community_template(template_id: str) -> None:
    db = get_db()
    db.collection("communityTemplates").document(template_id).delete()


def get_community_template(template_id: str) -> Optional[dict]:
    db = get_db()
    doc = db.collection("communityTemplates").document(template_id).get()
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def list_community_templates(category: Optional[str] = None, limit: int = 50) -> list[dict]:
    db = get_db()
    query = db.collection("communityTemplates")
    if category:
        query = query.where("category", "==", category)
    query = query.order_by("usageCount", direction=firestore.Query.DESCENDING).limit(limit)
    return [{"id": s.id, **s.to_dict()} for s in query.stream()]


def increment_community_template_uses(template_id: str) -> None:
    db = get_db()
    ref = db.collection("communityTemplates").document(template_id)
    ref.update({"usageCount": firestore.Increment(1)})


def save_brand_audit(project_id: str, audit: dict) -> str:
    db = get_db()
    audit_with_ts = {**audit, "createdAt": _utcnow()}
    ref = db.collection("projects").document(project_id).collection("brandAudits").document()
    ref.set(audit_with_ts)
    return ref.id


def list_brand_audits(project_id: str, limit: int = 10) -> list[dict]:
    db = get_db()
    snaps = (
        db.collection("projects").document(project_id)
        .collection("brandAudits")
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .limit(limit)
        .stream()
    )
    return [{"id": s.id, **s.to_dict()} for s in snaps]


def delete_knowledge_doc(project_id: str, doc_id: str) -> None:
    db = get_db()
    doc_ref = (
        db.collection("projects").document(project_id)
        .collection("knowledgeDocs").document(doc_id)
    )
    # Delete all chunks first
    for chunk_snap in doc_ref.collection("chunks").stream():
        chunk_snap.reference.delete()
    doc_ref.delete()
