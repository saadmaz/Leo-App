"""
Credits system - usage-based token economy for LEO.

Each action deducts credits from the user's balance.
Free users get 100 credits/day (resets at midnight UTC).
Pro users get 3,000 credits/month.
Agency users get 15,000 credits/month.
"""
from __future__ import annotations

import datetime
import logging
import time

from fastapi import HTTPException, status

from backend.services import firebase_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Credit costs per action
# ---------------------------------------------------------------------------

CREDIT_COSTS: dict[str, int] = {
    "chat_message":        2,
    "bulk_generate_item":  3,
    "campaign_generate":  20,
    "image_generate":     15,   # per variant (3 variants = 45)
    "deep_search":        25,
    "content_plan":       10,
    "brand_ingestion":    30,
    "competitor_report":  40,
    "weekly_digest":       8,
    "research_report":    50,
    "blog_post":          12,
    "email_sequence":     15,
    "email_single":        5,
    "style_guide":        10,
    "seo_analysis":        8,
    "website_copy":        6,
    # --- Pillar 1: Strategy & Planning ---
    "pillar1_icp":             40,
    "pillar1_gtm":             35,
    "pillar1_okr":             10,
    "pillar1_budget":          30,
    "pillar1_persona":         25,
    "pillar1_market_sizing":   40,
    "pillar1_positioning_msg":  5,
    "pillar1_comp_map":        35,
    "pillar1_launch":          20,
    "pillar1_risk_scan":       30,
    # --- Pillar 2: Content Creation & Management ---
    "pillar2_headline":         5,
    "pillar2_visual_brief":     5,
    "pillar2_video_script":    15,
    "pillar2_podcast":         20,
    "pillar2_quality":         10,
    "pillar2_translate":       15,
    "pillar2_case_study":      15,
    "pillar2_content_gap":     40,
    # --- Pillar 3: SEO & Organic Search ---
    "pillar3_keyword_research":  10,
    "pillar3_serp_intent":       10,
    "pillar3_on_page_seo":       15,
    "pillar3_featured_snippet":  10,
    "pillar3_content_freshness": 10,
    "pillar3_technical_seo":     20,
    # --- Pillar 4: Paid Advertising ---
    "pillar4_ad_brief":      15,
    "pillar4_ad_copy":       10,
    "pillar4_retargeting":   20,
    "pillar4_attribution":   20,
    # --- Pillar 5: Email Marketing & CRM ---
    "pillar5_email_sequence":     15,
    "pillar5_subject_lines":       5,
    "pillar5_send_time":           5,
    "pillar5_newsletter":         15,
    "pillar5_churn_risk":         20,
    "pillar5_lead_scoring":       20,
    "pillar5_winloss":            15,
    # --- Pillar 6: Social Media (gap features) ---
    "pillar6_community_management": 10,
    "pillar6_social_proof":         15,
    "pillar6_employee_advocacy":    10,
    # --- Pillar 7: Analytics & Reporting ---
    "pillar7_unified_dashboard":    15,
    "pillar7_cohort_analysis":      20,
    "pillar7_funnel_analysis":      15,
    "pillar7_anomaly_detection":    10,
    "pillar7_forecasting":          15,
    "pillar7_cac_ltv":              20,
    "pillar7_board_report":         25,
    # --- Pillar 8: PR & Communications ---
    "pillar8_press_release":        10,
    "pillar8_media_list":           20,
    "pillar8_pitch_email":          10,
    "pillar8_coverage_monitoring":  15,
    "pillar8_crisis_comms":         20,
    "pillar8_award_submission":     15,
    "pillar8_analyst_relations":    20,
    "pillar8_partnership_comms":    10,
    # --- Pillar 10: Experimentation & Optimisation ---
    "pillar10_ab_test_design":       10,
    "pillar10_landing_page_cro":     15,
    "pillar10_messaging_resonance":  15,
    "pillar10_email_ab_test":        10,
    "pillar10_learning_propagation": 20,
}

# ---------------------------------------------------------------------------
# Plan allotments
# ---------------------------------------------------------------------------

PLAN_CREDITS: dict[str, dict] = {
    "free":   {"amount": 100,   "period": "daily"},
    "pro":    {"amount": 3000,  "period": "monthly"},
    "agency": {"amount": 15000, "period": "monthly"},
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _next_reset_ts(period: str) -> int:
    """Return the next reset Unix timestamp for a given period."""
    if period == "daily":
        tomorrow = (
            datetime.datetime.now(datetime.timezone.utc)
            .replace(hour=0, minute=0, second=0, microsecond=0)
            + datetime.timedelta(days=1)
        )
        return int(tomorrow.timestamp())
    else:
        # Monthly - 30 days from now
        return int(time.time()) + 30 * 24 * 3600


def _bootstrap_credits(uid: str, plan: str) -> dict:
    """Initialise credits for a new user or after a reset."""
    config = PLAN_CREDITS.get(plan, PLAN_CREDITS["free"])
    data = {
        "balance": config["amount"],
        "resetsAt": _next_reset_ts(config["period"]),
        "lifetimeUsed": 0,
    }
    firebase_service.update_user_credits(uid, data)
    return data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_credits(uid: str) -> dict:
    """
    Return the current credit state for a user.
    Auto-bootstraps and auto-resets if the period has elapsed.
    """
    user = firebase_service.get_user(uid) or {}
    plan = user.get("tier", "free")
    config = PLAN_CREDITS.get(plan, PLAN_CREDITS["free"])
    credits = user.get("credits", {})

    # Bootstrap if never initialised
    if not credits or "balance" not in credits:
        credits = _bootstrap_credits(uid, plan)

    # Auto-reset if past the reset timestamp
    resets_at = credits.get("resetsAt", 0)
    try:
        if int(resets_at) < int(time.time()):
            new_balance = config["amount"]
            new_resets_at = _next_reset_ts(config["period"])
            firebase_service.update_user_credits(uid, {
                "balance": new_balance,
                "resetsAt": new_resets_at,
            })
            credits["balance"] = new_balance
            credits["resetsAt"] = new_resets_at
    except (ValueError, TypeError):
        pass

    return {
        "balance": credits.get("balance", config["amount"]),
        "resetsAt": credits.get("resetsAt", 0),
        "lifetimeUsed": credits.get("lifetimeUsed", 0),
        "plan": plan,
        "planAllotment": config["amount"],
        "period": config["period"],
        "costs": CREDIT_COSTS,
    }


def check_and_deduct(uid: str, action: str, quantity: int = 1) -> None:
    """
    Verify the user has enough credits for `action` × `quantity`, then deduct.
    Raises HTTP 402 if the balance is insufficient.
    Non-fatal errors (Firestore write failure) are logged but not raised.
    """
    cost_per = CREDIT_COSTS.get(action, 1)
    total_cost = cost_per * quantity

    user = firebase_service.get_user(uid) or {}
    plan = user.get("tier", "free")
    config = PLAN_CREDITS.get(plan, PLAN_CREDITS["free"])
    credits = user.get("credits", {})

    # Bootstrap or reset if needed
    balance = credits.get("balance")
    resets_at = credits.get("resetsAt", 0)

    if balance is None:
        credits = _bootstrap_credits(uid, plan)
        balance = credits["balance"]
    else:
        try:
            if int(resets_at) < int(time.time()):
                new_balance = config["amount"]
                new_resets_at = _next_reset_ts(config["period"])
                firebase_service.update_user_credits(uid, {
                    "balance": new_balance,
                    "resetsAt": new_resets_at,
                })
                balance = new_balance
        except (ValueError, TypeError):
            pass

    if balance < total_cost:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "insufficient_credits",
                "message": (
                    f"Not enough credits. This action costs {total_cost} credits "
                    f"but you only have {balance}."
                ),
                "needed": total_cost,
                "have": balance,
                "action": action,
                "plan": plan,
            },
        )

    try:
        firebase_service.deduct_user_credits(uid, total_cost, action=action)
    except Exception as exc:
        logger.warning("Failed to deduct %d credits for uid %s: %s", total_cost, uid, exc)


def add_credits(uid: str, amount: int, reason: str = "") -> None:
    """Add credits to a user's balance (admin override, top-up, promotional)."""
    try:
        firebase_service.add_user_credits(uid, amount, reason=reason)
        logger.info("Added %d credits to uid %s (reason: %s)", amount, uid, reason)
    except Exception as exc:
        logger.warning("Failed to add %d credits to uid %s: %s", amount, uid, exc)
