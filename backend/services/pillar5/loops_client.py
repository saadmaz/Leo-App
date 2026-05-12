"""
Loops.so API client - thin async wrapper around the REST API.

Docs: https://loops.so/docs/api-reference

Operations used by Pillar 5:
  - Create / update a contact
  - Trigger an event (fires automations)
  - Send a transactional email
  - Create campaigns (used for newsletter production)
"""
from __future__ import annotations

import json
import logging
from typing import Optional

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

_BASE = "https://app.loops.so/api/v1"


def _headers() -> dict:
    if not settings.LOOPS_API_KEY:
        raise RuntimeError("LOOPS_API_KEY is not configured.")
    return {
        "Authorization": f"Bearer {settings.LOOPS_API_KEY}",
        "Content-Type": "application/json",
    }


async def upsert_contact(
    email: str,
    properties: Optional[dict] = None,
    list_id: Optional[str] = None,
) -> dict:
    """Create or update a contact. Returns the API response."""
    payload: dict = {"email": email, **(properties or {})}
    if list_id:
        payload["mailingLists"] = {list_id: True}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.put(f"{_BASE}/contacts/update", headers=_headers(), json=payload)
        resp.raise_for_status()
        return resp.json()


async def trigger_event(email: str, event_name: str, properties: Optional[dict] = None) -> dict:
    """Trigger a Loops event for a contact (fires automations)."""
    payload = {"email": email, "eventName": event_name, **(properties or {})}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(f"{_BASE}/events/send", headers=_headers(), json=payload)
        resp.raise_for_status()
        return resp.json()


async def send_transactional(
    to_email: str,
    transactional_id: str,
    data_variables: Optional[dict] = None,
) -> dict:
    """Send a transactional email via a Loops template."""
    payload = {
        "email": to_email,
        "transactionalId": transactional_id,
        "dataVariables": data_variables or {},
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(f"{_BASE}/transactional", headers=_headers(), json=payload)
        resp.raise_for_status()
        return resp.json()


async def create_campaign(
    name: str,
    subject: str,
    html_body: str,
    from_name: Optional[str] = None,
    from_email: Optional[str] = None,
) -> dict:
    """
    Create a draft campaign in Loops.
    Note: Loops campaigns API is in beta; final send still requires manual review
    in the Loops dashboard - so we create it as a draft only.
    """
    payload: dict = {
        "name": name,
        "subject": subject,
        "body": html_body,
    }
    if from_name:
        payload["fromName"] = from_name
    if from_email:
        payload["fromEmail"] = from_email
    async with httpx.AsyncClient(timeout=15.0) as client:
        # Loops doesn't yet have a public campaign creation endpoint in all plans;
        # fall back gracefully with a descriptive error.
        try:
            resp = await client.post(f"{_BASE}/campaigns", headers=_headers(), json=payload)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning("Loops campaign creation failed (may need Pro plan): %s", exc)
            return {"error": str(exc), "note": "Campaign draft saved in LEO only - push manually in Loops dashboard"}
