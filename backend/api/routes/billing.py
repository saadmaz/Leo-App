"""
Billing routes - Stripe checkout, portal, webhooks, and usage summary.

Endpoints:
  GET  /billing/status          - current plan + usage for the logged-in user
  POST /billing/checkout        - create Stripe Checkout session
  POST /billing/portal          - create Stripe Customer Portal session
  POST /billing/webhook         - Stripe webhook receiver (no auth)
"""
from __future__ import annotations

import logging

import stripe
from fastapi import APIRouter, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.config import settings
from backend.middleware.auth import CurrentUser
from backend.services import billing_service, firebase_service, stripe_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["billing"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CheckoutRequest(BaseModel):
    plan: str  # "pro" | "agency"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/status")
async def get_billing_status(user: CurrentUser):
    """Return the authenticated user's current plan, usage, and limits."""
    import asyncio
    summary = await asyncio.to_thread(billing_service.get_usage_summary, user["uid"])
    return summary


@router.post("/checkout")
async def create_checkout(body: CheckoutRequest, user: CurrentUser, request: Request):
    """Create a Stripe Checkout session and return the redirect URL."""
    if body.plan not in ("pro", "agency"):
        raise HTTPException(status_code=400, detail="Invalid plan. Must be 'pro' or 'agency'.")

    origin = settings.FRONTEND_URL
    success_url = f"{origin}/billing?success=1"
    cancel_url = f"{origin}/billing?cancelled=1"

    import asyncio
    try:
        url = await asyncio.to_thread(
            stripe_service.create_checkout_session,
            user["uid"],
            user.get("email", ""),
            body.plan,
            success_url,
            cancel_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except stripe.error.StripeError as exc:
        logger.error("Stripe checkout error: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider error. Please try again.")

    return {"url": url}


@router.post("/portal")
async def create_portal(user: CurrentUser):
    """Create a Stripe Customer Portal session for subscription management."""
    return_url = f"{settings.FRONTEND_URL}/billing"

    import asyncio
    try:
        url = await asyncio.to_thread(
            stripe_service.create_portal_session,
            user["uid"],
            user.get("email", ""),
            return_url,
        )
    except stripe.error.StripeError as exc:
        logger.error("Stripe portal error: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider error. Please try again.")

    return {"url": url}


@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, stripe_signature: str = Header(None)):
    """
    Receive and process Stripe webhook events.
    Handles: checkout.session.completed, customer.subscription.updated/deleted
    """
    payload = await request.body()

    try:
        event = await __import__("asyncio").to_thread(
            stripe_service.construct_webhook_event,
            payload,
            stripe_signature or "",
        )
    except stripe.error.SignatureVerificationError:
        logger.warning("Stripe webhook: invalid signature")
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")
    except RuntimeError as exc:
        # STRIPE_WEBHOOK_SECRET not configured - log but don't crash
        logger.warning("Stripe webhook not verified: %s", exc)
        # In development, parse the event without verification
        import json
        event = stripe.Event.construct_from(json.loads(payload), stripe.api_key)

    await _handle_event(event)
    return {"received": True}


async def _handle_event(event: stripe.Event) -> None:
    import asyncio

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        uid = data.get("metadata", {}).get("firebase_uid")
        plan = data.get("metadata", {}).get("plan")
        customer_id = data.get("customer")
        subscription_id = data.get("subscription")

        if uid and plan:
            await asyncio.to_thread(
                firebase_service.update_user_billing,
                uid,
                {
                    "stripeCustomerId": customer_id,
                    "stripeSubscriptionId": subscription_id,
                    "subscriptionStatus": "active",
                },
            )
            await asyncio.to_thread(firebase_service.set_user_tier, uid, plan)
            logger.info("Upgraded uid %s to plan %s", uid, plan)

    elif event_type in ("customer.subscription.updated", "customer.subscription.deleted"):
        uid = data.get("metadata", {}).get("firebase_uid")
        if not uid:
            # Try to resolve uid from customer metadata
            try:
                import stripe as _stripe
                customer = _stripe.Customer.retrieve(data["customer"])
                uid = customer.get("metadata", {}).get("firebase_uid")
            except Exception:
                pass

        if uid:
            if event_type == "customer.subscription.deleted":
                await asyncio.to_thread(firebase_service.set_user_tier, uid, "free")
                await asyncio.to_thread(
                    firebase_service.update_user_billing,
                    uid,
                    {"subscriptionStatus": "cancelled"},
                )
                logger.info("Downgraded uid %s to free (subscription cancelled)", uid)
            else:
                status_val = data.get("status", "active")
                plan = stripe_service.plan_from_subscription(data)
                updates: dict = {"subscriptionStatus": status_val}
                if data.get("current_period_end"):
                    updates["currentPeriodEnd"] = data["current_period_end"]
                    # Persist the period-end as the reset timestamp so the billing
                    # service can auto-reset the message counter on the next request
                    # after the period rolls over.
                    updates["messagesResetAt"] = data["current_period_end"]
                await asyncio.to_thread(firebase_service.update_user_billing, uid, updates)
                if plan:
                    await asyncio.to_thread(firebase_service.set_user_tier, uid, plan)
                logger.info("Updated subscription for uid %s: status=%s plan=%s", uid, status_val, plan)
