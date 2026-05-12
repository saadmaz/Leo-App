"""
Usage tracking and plan enforcement.

Reads usage counters from Firestore and compares them against plan limits
defined in stripe_service.PLANS.  All functions are synchronous - wrap with
asyncio.to_thread() where needed.
"""
from __future__ import annotations

import logging
import time
from fastapi import HTTPException, status

from backend.services import firebase_service
from backend.services.stripe_service import PLANS

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_limits(plan: str) -> dict:
    return PLANS.get(plan, PLANS["free"])


# ---------------------------------------------------------------------------
# Project limits
# ---------------------------------------------------------------------------

def assert_can_create_project(uid: str) -> None:
    """Raise HTTP 402 if the user has hit their project limit."""
    user = firebase_service.get_user(uid) or {}
    plan = user.get("tier", "free")
    limit = _get_limits(plan)["projects_limit"]

    projects = firebase_service.list_projects(uid)
    if len(projects) >= limit:
        plan_label = _get_limits(plan)["label"]
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "project_limit_reached",
                "message": f"You've reached the {plan_label} plan limit of {limit} project(s).",
                "limit": limit,
                "current": len(projects),
                "plan": plan,
            },
        )


# ---------------------------------------------------------------------------
# Message limits
# ---------------------------------------------------------------------------

def assert_can_send_message(uid: str) -> None:
    """Raise HTTP 402 if the user has hit their monthly message limit."""
    user = firebase_service.get_user(uid) or {}
    plan = user.get("tier", "free")
    limit = _get_limits(plan)["messages_limit"]

    billing = user.get("billing", {})

    # Auto-reset message counter when the billing period rolls over.
    reset_at = billing.get("messagesResetAt")

    if reset_at is None:
        # Free user never went through Stripe - bootstrap a 30-day reset window.
        next_reset = int(time.time()) + 30 * 24 * 3600
        try:
            firebase_service.update_user_billing(uid, {"messagesResetAt": next_reset})
            billing["messagesResetAt"] = next_reset
        except Exception as exc:
            logger.warning("Failed to bootstrap messagesResetAt for %s: %s", uid, exc)
    else:
        try:
            if int(reset_at) < int(time.time()):
                firebase_service.reset_messages_used(uid)
                billing["messagesUsed"] = 0
        except (ValueError, TypeError):
            # Legacy ISO string stored by old upsert_user - migrate to Unix timestamp.
            logger.info("Migrating messagesResetAt ISO→Unix for %s", uid)
            next_reset = int(time.time()) + 30 * 24 * 3600
            try:
                firebase_service.update_user_billing(uid, {
                    "messagesResetAt": next_reset,
                    "messagesUsed": 0,
                })
                billing["messagesUsed"] = 0
            except Exception as exc:
                logger.warning("Failed to migrate messagesResetAt for %s: %s", uid, exc)

    used = billing.get("messagesUsed", 0)

    if used >= limit:
        plan_label = _get_limits(plan)["label"]
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "message_limit_reached",
                "message": f"You've used all {limit} messages for this month on the {plan_label} plan.",
                "limit": limit,
                "current": used,
                "plan": plan,
            },
        )


def increment_message_count(uid: str) -> None:
    """Bump the user's message counter after a successful send."""
    try:
        firebase_service.increment_messages_used(uid)
    except Exception as exc:
        # Non-fatal - log and continue so the actual message isn't lost.
        logger.warning("Failed to increment message count for %s: %s", uid, exc)


# ---------------------------------------------------------------------------
# Ingestion limits
# ---------------------------------------------------------------------------

def assert_can_ingest(uid: str) -> None:
    """Raise HTTP 402 if the user has hit their ingestion limit."""
    user = firebase_service.get_user(uid) or {}
    plan = user.get("tier", "free")
    limit = _get_limits(plan)["ingestions_limit"]

    billing = user.get("billing", {})
    used = billing.get("ingestionsUsed", 0)

    if used >= limit:
        plan_label = _get_limits(plan)["label"]
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "ingestion_limit_reached",
                "message": f"You've reached the ingestion limit for the {plan_label} plan.",
                "limit": limit,
                "current": used,
                "plan": plan,
            },
        )


def increment_ingestion_count(uid: str) -> None:
    """Bump the user's ingestion counter after a successful run."""
    try:
        firebase_service.increment_ingestions_used(uid)
    except Exception as exc:
        logger.warning("Failed to increment ingestion count for %s: %s", uid, exc)


# ---------------------------------------------------------------------------
# Campaign limits
# ---------------------------------------------------------------------------

def assert_can_generate_campaign(uid: str, project_id: str) -> None:
    """Raise HTTP 402 if the user has hit their campaign limit."""
    user = firebase_service.get_user(uid) or {}
    plan = user.get("tier", "free")
    limit = _get_limits(plan).get("campaigns_limit", 3)

    campaigns = firebase_service.list_campaigns(project_id)
    if len(campaigns) >= limit:
        plan_label = _get_limits(plan)["label"]
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "campaign_limit_reached",
                "message": f"You've reached the {plan_label} plan campaign limit of {limit}.",
                "limit": limit,
                "current": len(campaigns),
                "plan": plan,
            },
        )


# ---------------------------------------------------------------------------
# Usage summary (for the billing page)
# ---------------------------------------------------------------------------

def get_usage_summary(uid: str) -> dict:
    """
    Return the user's current usage and limits as a single dict.
    Safe to call frequently - only reads Firestore once.
    """
    user = firebase_service.get_user(uid) or {}
    plan = user.get("tier", "free")
    limits = _get_limits(plan)
    billing = user.get("billing", {})

    projects = firebase_service.list_projects(uid)

    return {
        "plan": plan,
        "planLabel": limits["label"],
        "priceMonthly": limits["price_monthly"],
        "projects": {
            "used": len(projects),
            "limit": limits["projects_limit"],
        },
        "messages": {
            "used": billing.get("messagesUsed", 0),
            "limit": limits["messages_limit"],
            "resetAt": billing.get("messagesResetAt"),
        },
        "ingestions": {
            "used": billing.get("ingestionsUsed", 0),
            "limit": limits["ingestions_limit"],
        },
        "campaigns": {
            "limit": limits.get("campaigns_limit", 3),
        },
        "stripeCustomerId": billing.get("stripeCustomerId"),
        "subscriptionStatus": billing.get("subscriptionStatus"),
        "currentPeriodEnd": billing.get("currentPeriodEnd"),
    }
