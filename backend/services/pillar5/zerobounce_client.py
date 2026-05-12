"""
ZeroBounce email validation client.

Free tier: 100 validations/month.
Docs: https://www.zerobounce.net/docs/

Statuses returned:
  valid       - email exists and can receive mail
  invalid     - email does not exist
  catch-all   - domain accepts all email (inconclusive)
  unknown     - could not determine (timeout, etc.)
  spamtrap    - known spam trap
  abuse       - known abuse address
  do_not_mail - role address (noreply@, info@, etc.) or disposable
"""
from __future__ import annotations

import logging

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

_BASE = "https://api.zerobounce.net/v2"


async def validate_single(email: str) -> dict:
    """Validate a single email address. Returns ZeroBounce result dict."""
    if not settings.ZEROBOUNCE_API_KEY:
        raise RuntimeError("ZEROBOUNCE_API_KEY is not configured.")
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{_BASE}/validate",
            params={"api_key": settings.ZEROBOUNCE_API_KEY, "email": email, "ip_address": ""},
        )
        resp.raise_for_status()
        return resp.json()


async def validate_batch(emails: list[str]) -> list[dict]:
    """
    Validate up to 100 emails in a single batch call.
    Returns list of ZeroBounce result dicts in the same order.
    """
    if not settings.ZEROBOUNCE_API_KEY:
        raise RuntimeError("ZEROBOUNCE_API_KEY is not configured.")
    if len(emails) > 100:
        raise ValueError("ZeroBounce batch limit is 100 per call.")
    payload = {
        "api_key": settings.ZEROBOUNCE_API_KEY,
        "email_batch": [{"email_address": e} for e in emails],
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{_BASE}/validatebatch", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data.get("email_batch", [])


async def get_credits() -> int:
    """Return remaining validation credits."""
    if not settings.ZEROBOUNCE_API_KEY:
        return -1
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{_BASE}/getcredits",
            params={"api_key": settings.ZEROBOUNCE_API_KEY},
        )
        resp.raise_for_status()
        return resp.json().get("Credits", 0)
