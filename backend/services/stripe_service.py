"""
Stripe integration - checkout sessions, customer portal, webhook handling.

All public functions are synchronous (Stripe SDK is sync). Wrap with
asyncio.to_thread() if you need them inside async route handlers.
"""
from __future__ import annotations

import logging
from typing import Optional

import stripe

from backend.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Plan definitions
# ---------------------------------------------------------------------------

PLANS = {
    "free": {
        "label": "Free",
        "price_monthly": 0,
        "projects_limit": 2,
        "messages_limit": 50,
        "ingestions_limit": 2,
        "campaigns_limit": 3,
        "credits_daily": 100,
        "seats": 1,
        "features": ["chat", "brand_ingestion", "bulk_generate", "content_planner"],
    },
    "pro": {
        "label": "Pro",
        "price_monthly": 49,
        "projects_limit": 5,
        "messages_limit": 9999,   # credits-gated instead
        "ingestions_limit": 999,
        "campaigns_limit": 999,
        "credits_monthly": 3000,
        "seats": 3,
        "features": [
            "chat", "brand_ingestion", "bulk_generate", "content_planner",
            "image_generation", "deep_search", "analytics", "posts",
        ],
    },
    "agency": {
        "label": "Agency",
        "price_monthly": 149,
        "projects_limit": 25,
        "messages_limit": 9999,
        "ingestions_limit": 9999,
        "campaigns_limit": 9999,
        "credits_monthly": 15000,
        "seats": 5,
        "features": [
            "chat", "brand_ingestion", "bulk_generate", "content_planner",
            "image_generation", "deep_search", "analytics", "posts",
            "white_label", "client_portal", "pdf_export", "api_access",
            "priority_support",
        ],
    },
}


def _init() -> None:
    """Set the Stripe API key. Called lazily before every SDK call."""
    if settings.STRIPE_SECRET_KEY:
        stripe.api_key = settings.STRIPE_SECRET_KEY


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------

def get_or_create_customer(uid: str, email: str) -> str:
    """
    Return the Stripe customer ID for this user, creating one if needed.
    We tag the customer with firebase_uid so webhooks can resolve back to a user.
    """
    _init()
    existing = stripe.Customer.search(query=f'metadata["firebase_uid"]:"{uid}"', limit=1)
    if existing.data:
        return existing.data[0].id

    customer = stripe.Customer.create(
        email=email,
        metadata={"firebase_uid": uid},
    )
    logger.info("Created Stripe customer %s for uid %s", customer.id, uid)
    return customer.id


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------

def create_checkout_session(
    uid: str,
    email: str,
    plan: str,
    success_url: str,
    cancel_url: str,
) -> str:
    """
    Create a Stripe Checkout session for the given plan.
    Returns the checkout URL to redirect the user to.
    """
    _init()

    price_id = (
        settings.STRIPE_PRO_PRICE_ID
        if plan == "pro"
        else settings.STRIPE_AGENCY_PRICE_ID
    )
    if not price_id:
        raise ValueError(
            f"Price ID for plan '{plan}' not configured. "
            "Set STRIPE_PRO_PRICE_ID / STRIPE_AGENCY_PRICE_ID in backend/.env"
        )

    customer_id = get_or_create_customer(uid, email)

    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"firebase_uid": uid, "plan": plan},
        subscription_data={"metadata": {"firebase_uid": uid, "plan": plan}},
    )
    return session.url


# ---------------------------------------------------------------------------
# Customer Portal
# ---------------------------------------------------------------------------

def create_portal_session(uid: str, email: str, return_url: str) -> str:
    """
    Create a Stripe Customer Portal session so the user can manage their subscription.
    Returns the portal URL.
    """
    _init()
    customer_id = get_or_create_customer(uid, email)
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return session.url


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------

def construct_webhook_event(payload: bytes, sig_header: str) -> stripe.Event:
    """
    Verify and parse an incoming Stripe webhook event.
    Raises stripe.error.SignatureVerificationError on tampered payloads.
    """
    _init()
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise RuntimeError(
            "STRIPE_WEBHOOK_SECRET not configured. "
            "Set it in backend/.env after registering the webhook endpoint."
        )
    return stripe.Webhook.construct_event(
        payload=payload,
        sig_header=sig_header,
        secret=settings.STRIPE_WEBHOOK_SECRET,
    )


def plan_from_subscription(subscription: stripe.Subscription) -> Optional[str]:
    """
    Derive the Leo plan name from a Stripe subscription object
    by matching the price ID against known config values.
    """
    for item in subscription["items"]["data"]:
        price_id = item["price"]["id"]
        if price_id == settings.STRIPE_PRO_PRICE_ID:
            return "pro"
        if price_id == settings.STRIPE_AGENCY_PRICE_ID:
            return "agency"
    return None
