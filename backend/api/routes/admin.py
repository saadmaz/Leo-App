"""
Super-admin routes - /admin/*

All endpoints require the `superAdmin: true` Firebase custom claim.
Never expose these routes publicly; they bypass all per-project ownership checks.

Endpoints:
  GET  /admin/dashboard                    - platform-wide stats
  GET  /admin/analytics                    - charts data (signups, usage histogram, top users)
  GET  /admin/audit-log                    - recent admin actions
  GET  /admin/users                        - user list with search + tier filter
  GET  /admin/users/{uid}                  - single user detail
  PATCH /admin/users/{uid}                 - update tier
  POST /admin/users/{uid}/reset-usage      - reset monthly message counter
  POST /admin/users/{uid}/suspend          - disable Firebase Auth account
  POST /admin/users/{uid}/unsuspend        - re-enable Firebase Auth account
  POST /admin/users/{uid}/override-limits  - set custom usage limits
  POST /admin/users/{uid}/grant-admin      - grant superAdmin claim
  POST /admin/users/{uid}/revoke-admin     - revoke superAdmin claim
  DELETE /admin/users/{uid}               - permanently delete user
  GET  /admin/projects                     - all projects across all users
  DELETE /admin/projects/{project_id}      - deep-delete a project
"""

import logging
import time
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from backend.middleware.admin_auth import SuperAdminUser
from backend.services import firebase_service, moderation_service, feature_flags_service, email_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class UpdateUserRequest(BaseModel):
    tier: Optional[str] = None          # "free" | "pro" | "agency"


class OverrideLimitsRequest(BaseModel):
    messagesLimit: Optional[int] = None
    projectsLimit: Optional[int] = None
    ingestionsLimit: Optional[int] = None
    campaignsLimit: Optional[int] = None


class ReviewFlagRequest(BaseModel):
    note: Optional[str] = None


class FeatureFlagUpsertRequest(BaseModel):
    name: str
    description: str = ""
    enabled: bool = True
    allowedTiers: Optional[list[str]] = None   # None = all tiers
    userOverrides: dict[str, bool] = {}


class FeatureFlagPatchRequest(BaseModel):
    enabled: Optional[bool] = None
    allowedTiers: Optional[Any] = None          # list[str] or null
    name: Optional[str] = None
    description: Optional[str] = None


class UserOverrideRequest(BaseModel):
    uid: str
    value: bool


class AnnouncementRequest(BaseModel):
    title: str
    body: str
    type: str = "info"            # "info" | "warning" | "success"
    targetTiers: Optional[list[str]] = None
    active: bool = True
    expiresAt: Optional[str] = None


class ChangelogRequest(BaseModel):
    title: str
    body: str
    version: str = ""
    publishedAt: Optional[str] = None
    tags: Optional[list[str]] = None


class BroadcastRequest(BaseModel):
    subject: str
    html_body: str
    segment: Optional[str] = None   # None = all users; "free"|"pro"|"agency" = segment


# ---------------------------------------------------------------------------
# API Key status
# ---------------------------------------------------------------------------

@router.get("/api-keys")
async def get_api_keys(_user: SuperAdminUser):
    """Return configured status + live usage for all API keys. Values are masked."""
    import asyncio
    import httpx
    from datetime import date
    from backend.config import settings
    from typing import Optional as Opt

    def mask(val: Opt[str]) -> Opt[str]:
        if not val:
            return None
        if len(val) <= 8:
            return "***"
        return f"{val[:4]}...{val[-4:]}"

    # ------------------------------------------------------------------
    # Gather live usage concurrently
    # ------------------------------------------------------------------

    async def exa_tavily_usage() -> dict:
        """Aggregate today's Exa + Tavily searches across all projects in Firestore."""
        try:
            from backend.services.firebase_service import get_db
            today = date.today().isoformat()
            db = get_db()
            totals: dict = {}
            docs = db.collection_group("search_usage").where("date", "==", today).stream()
            for doc in docs:
                data = doc.to_dict() or {}
                for k, v in data.items():
                    if k != "date" and isinstance(v, (int, float)):
                        totals[k] = totals.get(k, 0) + v
            return totals
        except Exception as exc:
            logger.warning("Search usage aggregation failed: %s", exc)
            return {}

    async def firecrawl_credits() -> Opt[dict]:
        """Fetch remaining credits from Firecrawl's billing API."""
        if not settings.FIRECRAWL_API_KEY:
            return None
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(
                    "https://api.firecrawl.dev/v1/team/credit-usage",
                    headers={"Authorization": f"Bearer {settings.FIRECRAWL_API_KEY}"},
                )
                if r.status_code == 200:
                    data = r.json().get("data", {})
                    return {
                        "used": data.get("credits_used", 0),
                        "total": data.get("total_credits", 0),
                        "remaining": data.get("remaining_credits", 0),
                    }
        except Exception as exc:
            logger.warning("Firecrawl credits fetch failed: %s", exc)
        return None

    async def apify_credits() -> Opt[dict]:
        """Fetch remaining compute units from Apify's user API."""
        if not settings.APIFY_API_KEY:
            return None
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(
                    "https://api.apify.com/v2/users/me",
                    headers={"Authorization": f"Bearer {settings.APIFY_API_KEY}"},
                )
                if r.status_code == 200:
                    data = r.json().get("data", {})
                    plan = data.get("plan", {})
                    usage = data.get("monthlyUsage", {})
                    monthly_limit = plan.get("monthlyUsageCreditsCents", 0)
                    monthly_used = usage.get("monthlyUsageCreditsCents", 0)
                    if monthly_limit:
                        return {
                            "used": monthly_used,
                            "total": monthly_limit,
                            "remaining": max(0, monthly_limit - monthly_used),
                            "unit": "cents",
                        }
        except Exception as exc:
            logger.warning("Apify credits fetch failed: %s", exc)
        return None

    search_totals, fc_credits, ap_credits = await asyncio.gather(
        exa_tavily_usage(),
        firecrawl_credits(),
        apify_credits(),
    )

    exa_used: int = search_totals.get("exa_searches", 0)
    tavily_used: int = search_totals.get("tavily_searches", 0)

    # ------------------------------------------------------------------
    # Build response
    # ------------------------------------------------------------------
    # Each entry: (id, name, category, value, usageData)
    # usageData = None | {"used": int, "total": int, "label": str}

    def search_usage(used: int, limit: int) -> dict:
        return {"used": used, "total": limit, "label": f"{used:,} / {limit:,} today"}

    def credits_usage(data: Opt[dict], label_fn) -> Opt[dict]:
        if not data:
            return None
        return {"used": data["used"], "total": data["total"], "label": label_fn(data)}

    entries = [
        # LLM
        ("anthropic",     "Anthropic (Claude)",  "LLM",         settings.ANTHROPIC_API_KEY,    None),
        ("gemini",        "Google Gemini",        "LLM",         settings.GEMINI_API_KEY,       None),
        ("groq",          "Groq",                 "LLM",         settings.GROQ_API_KEY,         None),
        ("openrouter",    "OpenRouter",           "LLM",         settings.OPENROUTER_API_KEY,   None),
        # Search — daily limits enforced in-app
        ("exa",           "Exa",                  "Search",      settings.EXA_API_KEY,          search_usage(exa_used, settings.EXA_DAILY_SEARCH_LIMIT)),
        ("tavily",        "Tavily",               "Search",      settings.TAVILY_API_KEY,       search_usage(tavily_used, settings.TAVILY_DAILY_SEARCH_LIMIT)),
        ("serpapi",       "SerpAPI",              "Search",      settings.SERPAPI_API_KEY,      None),
        # Scraping — credit-based
        ("firecrawl",     "Firecrawl",            "Scraping",    settings.FIRECRAWL_API_KEY,    credits_usage(fc_credits, lambda d: f"{d['remaining']:,} credits left")),
        ("apify",         "Apify",                "Scraping",    settings.APIFY_API_KEY,        credits_usage(ap_credits, lambda d: f"{d['remaining']:,} / {d['total']:,} ¢ left")),
        # Social
        ("ayrshare",      "Ayrshare",             "Social",      settings.AYRSHARE_API_KEY,     None),
        ("youtube",       "YouTube",              "Social",      settings.YOUTUBE_API_KEY,      None),
        # Brand
        ("logo_dev",      "Logo.dev",             "Brand",       settings.LOGO_DEV_API_KEY,     None),
        ("brandfetch",    "Brandfetch",           "Brand",       settings.BRANDFETCH_API_KEY,   None),
        ("brand_dev",     "Brand.dev",            "Brand",       settings.BRAND_DEV_API_KEY,    None),
        # Storage
        ("cloudflare_r2", "Cloudflare R2",        "Storage",     settings.CLOUDFLARE_R2_TOKEN,  None),
        # Email / Payments / CRM
        ("resend",        "Resend",               "Email",       settings.RESEND_API_KEY,       None),
        ("stripe",        "Stripe",               "Payments",    settings.STRIPE_SECRET_KEY,    None),
        ("apollo",        "Apollo.io",            "CRM",         settings.APOLLO_API_KEY,       None),
        ("hunter",        "Hunter.io",            "PR",          settings.HUNTER_API_KEY,       None),
        ("deepl",         "DeepL",                "Translation", settings.DEEPL_API_KEY,        None),
        ("loops",         "Loops.so",             "Email CRM",   settings.LOOPS_API_KEY,        None),
    ]

    return [
        {
            "id": e[0],
            "name": e[1],
            "category": e[2],
            "configured": bool(e[3]),
            "maskedKey": mask(e[3]),
            "usage": e[4],  # None or {"used", "total", "label"}
        }
        for e in entries
    ]


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@router.get("/dashboard")
def get_dashboard(_user: SuperAdminUser):
    """Return aggregate platform stats for the admin home page."""
    return firebase_service.get_platform_stats()


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

@router.get("/analytics")
def get_analytics(_user: SuperAdminUser):
    """
    Return analytics data:
    - Daily signup counts (last 30 days)
    - Top 10 users by messages used this month
    - Usage histogram (user count per message-volume bucket)
    """
    return firebase_service.get_analytics()


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

@router.get("/audit-log")
def get_audit_log(_user: SuperAdminUser, limit: int = Query(200, ge=1, le=500)):
    """Return the most recent admin audit log entries, newest first."""
    return firebase_service.list_audit_logs(limit=limit)


# ---------------------------------------------------------------------------
# Users list
# ---------------------------------------------------------------------------

@router.get("/users")
def list_users(
    _user: SuperAdminUser,
    search: Optional[str] = Query(None, description="Filter by email or display name"),
    tier: Optional[str] = Query(None, description="Filter by tier: free | pro | agency"),
    limit: int = Query(200, ge=1, le=500),
):
    """Return all users from Firestore with optional search and tier filter."""
    users = firebase_service.list_all_users(limit=limit)

    if tier:
        users = [u for u in users if u.get("tier") == tier]

    if search:
        q = search.lower()
        users = [
            u for u in users
            if q in (u.get("email") or "").lower()
            or q in (u.get("displayName") or "").lower()
        ]

    return [_safe_user(u) for u in users]


# ---------------------------------------------------------------------------
# Single user
# ---------------------------------------------------------------------------

@router.get("/users/{uid}")
def get_user(uid: str, _user: SuperAdminUser):
    """Return full user profile + project count for the admin detail view."""
    user = firebase_service.get_user(uid)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    project_count = firebase_service.get_user_project_count(uid)
    return {**_safe_user(user), "projectCount": project_count}


# ---------------------------------------------------------------------------
# Update tier
# ---------------------------------------------------------------------------

@router.patch("/users/{uid}")
def update_user(uid: str, body: UpdateUserRequest, user: SuperAdminUser):
    """Update a user's subscription tier."""
    target = firebase_service.get_user(uid)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if body.tier:
        valid_tiers = {"free", "pro", "agency"}
        if body.tier not in valid_tiers:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid tier. Must be one of: {', '.join(valid_tiers)}",
            )
        old_tier = target.get("tier", "free")
        firebase_service.set_user_tier(uid, body.tier)
        firebase_service.write_audit_log(
            admin_uid=user["uid"],
            action="change_tier",
            target_uid=uid,
            details={"from": old_tier, "to": body.tier},
        )
        logger.info("Admin %s changed tier for %s: %s → %s", user["uid"], uid, old_tier, body.tier)

    return _safe_user(firebase_service.get_user(uid) or {})


# ---------------------------------------------------------------------------
# Reset usage
# ---------------------------------------------------------------------------

@router.post("/users/{uid}/reset-usage")
def reset_usage(uid: str, user: SuperAdminUser):
    """Reset the user's monthly message counter to zero."""
    if not firebase_service.get_user(uid):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    firebase_service.reset_messages_used(uid)
    firebase_service.write_audit_log(
        admin_uid=user["uid"], action="reset_usage", target_uid=uid
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Suspend / unsuspend
# ---------------------------------------------------------------------------

@router.post("/users/{uid}/suspend")
def suspend_user(uid: str, user: SuperAdminUser):
    """Disable the Firebase Auth account - user can no longer sign in."""
    if not firebase_service.get_user(uid):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    firebase_service.suspend_user(uid)
    firebase_service.write_audit_log(
        admin_uid=user["uid"], action="suspend_user", target_uid=uid
    )
    return {"ok": True, "suspended": True}


@router.post("/users/{uid}/unsuspend")
def unsuspend_user(uid: str, user: SuperAdminUser):
    """Re-enable a previously suspended account."""
    if not firebase_service.get_user(uid):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    firebase_service.unsuspend_user(uid)
    firebase_service.write_audit_log(
        admin_uid=user["uid"], action="unsuspend_user", target_uid=uid
    )
    return {"ok": True, "suspended": False}


# ---------------------------------------------------------------------------
# Override limits
# ---------------------------------------------------------------------------

@router.post("/users/{uid}/override-limits")
def override_limits(uid: str, body: OverrideLimitsRequest, user: SuperAdminUser):
    """Persist custom usage limits for a user (bypasses plan defaults)."""
    if not firebase_service.get_user(uid):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    overrides = {k: v for k, v in body.model_dump().items() if v is not None}
    if overrides:
        firebase_service.override_user_limits(uid, overrides)
        firebase_service.write_audit_log(
            admin_uid=user["uid"],
            action="override_limits",
            target_uid=uid,
            details={"overrides": overrides},
        )

    return {"ok": True, "overrides": overrides}


# ---------------------------------------------------------------------------
# Delete user
# ---------------------------------------------------------------------------

@router.delete("/users/{uid}")
def delete_user(uid: str, user: SuperAdminUser):
    """Permanently delete the user's Firebase Auth account and Firestore profile."""
    target = firebase_service.get_user(uid)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="delete_user",
        target_uid=uid,
        details={"email": target.get("email", ""), "tier": target.get("tier", "free")},
    )
    firebase_service.delete_user_completely(uid)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Grant / revoke super admin
# ---------------------------------------------------------------------------

@router.post("/users/{uid}/grant-admin")
def grant_admin(uid: str, user: SuperAdminUser):
    """Grant the superAdmin custom claim to a user."""
    firebase_service.set_super_admin_claim(uid)
    firebase_service.write_audit_log(
        admin_uid=user["uid"], action="grant_admin", target_uid=uid
    )
    return {"ok": True}


@router.post("/users/{uid}/revoke-admin")
def revoke_admin(uid: str, user: SuperAdminUser):
    """Revoke the superAdmin custom claim from a user."""
    firebase_service.revoke_super_admin_claim(uid)
    firebase_service.write_audit_log(
        admin_uid=user["uid"], action="revoke_admin", target_uid=uid
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@router.get("/projects")
def list_projects(
    _user: SuperAdminUser,
    search: Optional[str] = Query(None, description="Filter by project name"),
    limit: int = Query(200, ge=1, le=500),
):
    """Return all projects across all users."""
    projects = firebase_service.list_all_projects(limit=limit)

    if search:
        q = search.lower()
        projects = [p for p in projects if q in (p.get("name") or "").lower()]

    return [_safe_project(p) for p in projects]


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, user: SuperAdminUser):
    """Deep-delete a project and all its chats/messages."""
    project = firebase_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="delete_project",
        target_uid=project.get("ownerId", ""),
        details={"projectId": project_id, "projectName": project.get("name", "")},
    )
    firebase_service.delete_project_deep(project_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Feature Flags
# ---------------------------------------------------------------------------

@router.get("/feature-flags")
def list_feature_flags(_user: SuperAdminUser):
    """Return all feature flag documents, sorted by ID."""
    feature_flags_service.seed_defaults()   # no-op after first call
    return firebase_service.list_feature_flags()


@router.get("/feature-flags/{flag_id}")
def get_feature_flag(flag_id: str, _user: SuperAdminUser):
    """Return a single feature flag."""
    flag = firebase_service.get_feature_flag(flag_id)
    if not flag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flag not found.")
    return flag


@router.put("/feature-flags/{flag_id}")
def upsert_feature_flag(flag_id: str, body: FeatureFlagUpsertRequest, user: SuperAdminUser):
    """Create or fully replace a feature flag."""
    existing = firebase_service.get_feature_flag(flag_id)
    result = firebase_service.upsert_feature_flag(flag_id, body.model_dump())
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="feature_flag_upsert",
        target_uid=flag_id,
        details={"enabled": body.enabled, "new": existing is None},
    )
    return result


@router.patch("/feature-flags/{flag_id}")
def patch_feature_flag(flag_id: str, body: FeatureFlagPatchRequest, user: SuperAdminUser):
    """Partially update a feature flag (e.g. just toggle enabled)."""
    if not firebase_service.get_feature_flag(flag_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flag not found.")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    # allowedTiers can legitimately be set to None (remove tier gate), so handle explicitly
    if body.allowedTiers is not None or "allowedTiers" in body.model_fields_set:
        updates["allowedTiers"] = body.allowedTiers

    result = firebase_service.patch_feature_flag(flag_id, updates)
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="feature_flag_patch",
        target_uid=flag_id,
        details=updates,
    )
    return result


@router.delete("/feature-flags/{flag_id}")
def delete_feature_flag(flag_id: str, user: SuperAdminUser):
    """Delete a feature flag document."""
    if not firebase_service.get_feature_flag(flag_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flag not found.")
    firebase_service.delete_feature_flag(flag_id)
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="feature_flag_delete",
        target_uid=flag_id,
    )
    return {"ok": True}


@router.post("/feature-flags/{flag_id}/overrides")
def set_user_override(flag_id: str, body: UserOverrideRequest, user: SuperAdminUser):
    """Set a per-user override on a feature flag."""
    if not firebase_service.get_feature_flag(flag_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flag not found.")
    firebase_service.set_feature_flag_user_override(flag_id, body.uid, body.value)
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="feature_flag_override",
        target_uid=body.uid,
        details={"flagId": flag_id, "value": body.value},
    )
    return {"ok": True}


@router.delete("/feature-flags/{flag_id}/overrides/{uid}")
def remove_user_override(flag_id: str, uid: str, user: SuperAdminUser):
    """Remove a per-user override from a feature flag."""
    if not firebase_service.get_feature_flag(flag_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flag not found.")
    firebase_service.remove_feature_flag_user_override(flag_id, uid)
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="feature_flag_override_remove",
        target_uid=uid,
        details={"flagId": flag_id},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# System Health
# ---------------------------------------------------------------------------

@router.get("/system/health")
def system_health(_user: SuperAdminUser):
    """
    Perform live health checks on every external service and return
    a structured status report. All checks are best-effort - a failed
    check is returned as a degraded status, not a 500.
    """
    from backend.config import settings

    checks = []

    # --- Firebase Firestore ---
    checks.append(_check("Firebase Firestore", _ping_firebase))

    # --- Anthropic (Claude) ---
    checks.append(_check("Anthropic (Claude)", lambda: _ping_anthropic(settings)))

    # --- Google Gemini ---
    checks.append(_check("Google Gemini", lambda: _ping_gemini(settings)))

    # --- Stripe ---
    checks.append(_check("Stripe", lambda: _ping_stripe(settings)))

    # --- Firecrawl ---
    checks.append(_check("Firecrawl", lambda: _ping_key("FIRECRAWL_API_KEY", settings.FIRECRAWL_API_KEY)))

    # --- Resend (Email) ---
    checks.append(_check("Resend (Email)", lambda: _ping_key("RESEND_API_KEY", settings.RESEND_API_KEY)))

    # --- Cloudflare R2 ---
    checks.append(_check("Cloudflare R2", lambda: _ping_key("CLOUDFLARE_R2_TOKEN", settings.CLOUDFLARE_R2_TOKEN)))

    overall = "healthy" if all(c["status"] == "ok" for c in checks) else \
              "degraded" if any(c["status"] == "ok" for c in checks) else "down"

    return {
        "overall": overall,
        "checks": checks,
        "checkedAt": firebase_service._utcnow(),
    }


def _check(name: str, fn) -> dict:
    """Run a health check function, catching all exceptions."""
    t0 = time.perf_counter()
    try:
        detail = fn()
        ms = round((time.perf_counter() - t0) * 1000)
        return {"name": name, "status": "ok", "detail": detail or "OK", "latencyMs": ms}
    except Exception as exc:
        ms = round((time.perf_counter() - t0) * 1000)
        return {"name": name, "status": "error", "detail": str(exc)[:200], "latencyMs": ms}


def _ping_firebase() -> str:
    db = firebase_service.get_db()
    # Lightweight read - fetch at most 1 doc
    list(db.collection("users").limit(1).stream())
    return "Firestore reachable"


def _ping_anthropic(settings) -> str:
    if not settings.ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not set")
    import anthropic
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    models = client.models.list(limit=1)
    return f"API reachable - {len(models.data)} model(s) returned"


def _ping_gemini(settings) -> str:
    if not settings.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not set")
    return f"Key present (live ping skipped to avoid cost)"


def _ping_stripe(settings) -> str:
    if not settings.STRIPE_SECRET_KEY:
        raise ValueError("STRIPE_SECRET_KEY not set")
    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY
    acct = stripe.Account.retrieve()
    return f"Account: {acct.get('email') or acct.get('id', 'ok')}"


def _ping_key(name: str, value: Optional[str]) -> str:
    if not value:
        raise ValueError(f"{name} not set")
    return "Key present"


# ---------------------------------------------------------------------------
# Announcements (admin CRUD)
# ---------------------------------------------------------------------------

@router.get("/communications/announcements")
def list_announcements(_user: SuperAdminUser):
    """Return all announcements (active and inactive), newest first."""
    return firebase_service.list_announcements(active_only=False)


@router.post("/communications/announcements")
def create_announcement(body: AnnouncementRequest, user: SuperAdminUser):
    """Create a new in-app announcement banner."""
    data = body.model_dump()
    data["createdBy"] = user["uid"]
    result = firebase_service.create_announcement(data)
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="announcement_create",
        details={"title": body.title, "active": body.active},
    )
    return result


@router.patch("/communications/announcements/{announcement_id}")
def update_announcement(announcement_id: str, body: dict, user: SuperAdminUser):
    """Toggle active status or update any field on an announcement."""
    result = firebase_service.update_announcement(announcement_id, body)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found.")
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="announcement_update",
        target_uid=announcement_id,
        details=body,
    )
    return result


@router.delete("/communications/announcements/{announcement_id}")
def delete_announcement(announcement_id: str, user: SuperAdminUser):
    """Delete an announcement."""
    firebase_service.delete_announcement(announcement_id)
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="announcement_delete",
        target_uid=announcement_id,
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Changelog (admin CRUD)
# ---------------------------------------------------------------------------

@router.get("/communications/changelog")
def list_changelog(_user: SuperAdminUser, limit: int = Query(50, ge=1, le=200)):
    """Return changelog entries newest first."""
    return firebase_service.list_changelog_entries(limit=limit)


@router.post("/communications/changelog")
def create_changelog(body: ChangelogRequest, user: SuperAdminUser):
    """Create a new What's New changelog entry."""
    data = body.model_dump()
    data["createdBy"] = user["uid"]
    result = firebase_service.create_changelog_entry(data)
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="changelog_create",
        details={"title": body.title, "version": body.version},
    )
    return result


@router.delete("/communications/changelog/{entry_id}")
def delete_changelog_entry(entry_id: str, user: SuperAdminUser):
    """Delete a changelog entry."""
    firebase_service.delete_changelog_entry(entry_id)
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="changelog_delete",
        target_uid=entry_id,
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Email broadcast
# ---------------------------------------------------------------------------

@router.post("/communications/broadcast")
async def send_broadcast(body: BroadcastRequest, user: SuperAdminUser):
    """
    Send a broadcast email to all users of a specific tier (or all users).
    Collects email addresses from Firestore, then sends via Resend in batches.
    """
    import asyncio

    all_users = firebase_service.list_all_users(limit=5000)

    if body.segment and body.segment != "all":
        recipients = [u["email"] for u in all_users if u.get("tier") == body.segment and u.get("email")]
    else:
        recipients = [u["email"] for u in all_users if u.get("email")]

    if not recipients:
        return {"sent": 0, "failed": 0, "errors": [], "recipientCount": 0}

    result = await asyncio.to_thread(
        email_service.send_broadcast,
        recipients,
        body.subject,
        body.html_body,
    )

    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="email_broadcast",
        details={
            "subject": body.subject,
            "targetTier": body.segment or "all",
            "recipientCount": len(recipients),
            "sent": result["sent"],
            "failed": result["failed"],
        },
    )
    return {**result, "recipientCount": len(recipients)}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _safe_user(user: dict) -> dict:
    billing = user.get("billing", {})
    credits = user.get("credits", {})
    return {
        "uid": user.get("uid") or user.get("id", ""),
        "email": user.get("email", ""),
        "displayName": user.get("displayName", ""),
        "tier": user.get("tier", "free"),
        "suspended": user.get("suspended", False),
        "createdAt": user.get("createdAt", ""),
        "updatedAt": user.get("updatedAt", ""),
        "billing": {
            "messagesUsed": billing.get("messagesUsed", 0),
            "messagesResetAt": billing.get("messagesResetAt"),
            "ingestionsUsed": billing.get("ingestionsUsed", 0),
            "stripeCustomerId": billing.get("stripeCustomerId"),
            "subscriptionStatus": billing.get("subscriptionStatus"),
            "currentPeriodEnd": billing.get("currentPeriodEnd"),
        },
        "adminOverrides": user.get("adminOverrides", {}),
        "credits": {
            "balance": credits.get("balance"),
            "lifetimeUsed": credits.get("lifetimeUsed", 0),
            "resetsAt": credits.get("resetsAt"),
        } if credits else None,
    }


# ---------------------------------------------------------------------------
# Moderation - queue
# ---------------------------------------------------------------------------

@router.get("/moderation/stats")
def get_moderation_stats(_user: SuperAdminUser):
    """Return counts of flagged content by status (pending / actioned / dismissed)."""
    return firebase_service.get_moderation_stats()


@router.get("/moderation")
def list_moderation(
    _user: SuperAdminUser,
    status_filter: Optional[str] = Query(None, alias="status",
                                          description="pending | dismissed | actioned"),
    limit: int = Query(200, ge=1, le=500),
):
    """List flagged content documents, newest first. Filter by status if provided."""
    return firebase_service.list_flagged_content(
        status_filter=status_filter, limit=limit
    )


@router.post("/moderation/{flag_id}/dismiss")
def dismiss_flag(flag_id: str, body: ReviewFlagRequest, user: SuperAdminUser):
    """Mark a flagged item as dismissed - content is acceptable, no action needed."""
    if not firebase_service.get_flagged_item(flag_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flag not found.")

    firebase_service.update_flag_status(
        flag_id=flag_id,
        status="dismissed",
        reviewed_by=user["uid"],
        note=body.note,
    )
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="moderation_dismiss",
        target_uid=flag_id,
        details={"note": body.note},
    )
    return {"ok": True}


@router.post("/moderation/{flag_id}/action")
def action_flag(flag_id: str, body: ReviewFlagRequest, user: SuperAdminUser):
    """
    Mark a flagged item as actioned and delete the original message from Firestore.
    The flag document is kept for the audit trail.
    """
    flag = firebase_service.get_flagged_item(flag_id)
    if not flag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flag not found.")

    firebase_service.delete_flagged_message_content(flag_id=flag_id, reviewed_by=user["uid"])
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="moderation_action",
        target_uid=flag.get("uid", ""),
        details={"flagId": flag_id, "note": body.note, "patterns": flag.get("patterns", [])},
    )
    return {"ok": True}


@router.post("/moderation/flag")
def manual_flag(
    body: dict,
    user: SuperAdminUser,
):
    """
    Manually flag a message for admin review.
    Body: { uid, email, projectId, chatId, content, reason, messageId? }
    """
    flag_id = firebase_service.flag_content(
        uid=body.get("uid", ""),
        email=body.get("email", ""),
        project_id=body.get("projectId", ""),
        chat_id=body.get("chatId", ""),
        content=body.get("content", ""),
        reason="manual",
        patterns=[body.get("reason", "Manual flag")],
        message_id=body.get("messageId"),
    )
    firebase_service.write_audit_log(
        admin_uid=user["uid"],
        action="moderation_manual_flag",
        target_uid=body.get("uid", ""),
        details={"flagId": flag_id},
    )
    return {"ok": True, "flagId": flag_id}


# ---------------------------------------------------------------------------
# Moderation - abuse patterns
# ---------------------------------------------------------------------------

@router.get("/moderation/abuse")
def get_abuse_suspects(_user: SuperAdminUser):
    """
    Return users whose message volume is ≥ 5× the platform average or ≥ 200 abs.
    Useful for spotting API abuse, prompt-farming, or compromised accounts.
    """
    users = firebase_service.list_all_users(limit=500)
    total_msgs = sum(
        (u.get("billing") or {}).get("messagesUsed", 0) for u in users
    )
    avg = total_msgs / max(len(users), 1)
    suspects = moderation_service.get_abuse_suspects(users, avg)
    return {"platformAvg": round(avg, 1), "suspects": suspects}


def _safe_project(project: dict) -> dict:
    return {
        "id": project.get("id", ""),
        "name": project.get("name", ""),
        "description": project.get("description", ""),
        "ownerId": project.get("ownerId", ""),
        "memberCount": len(project.get("members", {})),
        "ingestionStatus": project.get("ingestionStatus"),
        "websiteUrl": project.get("websiteUrl"),
        "hasBrandCore": project.get("brandCore") is not None,
        "createdAt": project.get("createdAt", ""),
        "updatedAt": project.get("updatedAt", ""),
    }
