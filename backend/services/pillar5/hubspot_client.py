"""
HubSpot CRM API client - free tier, private app access token.

Docs: https://developers.hubspot.com/docs/api/overview

Operations used by Pillar 5:
  - Search / get contacts
  - Update contact properties (write lead scores, lifecycle stage)
  - List recently created / modified contacts
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

_BASE = "https://api.hubapi.com"


def _headers() -> dict:
    if not settings.HUBSPOT_ACCESS_TOKEN:
        raise RuntimeError("HUBSPOT_ACCESS_TOKEN is not configured.")
    return {
        "Authorization": f"Bearer {settings.HUBSPOT_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }


async def search_contacts(
    query: str,
    limit: int = 20,
    properties: Optional[list[str]] = None,
) -> list[dict]:
    """Full-text search contacts. Returns list of contact property dicts."""
    props = properties or ["email", "firstname", "lastname", "company", "jobtitle", "lifecyclestage", "hs_lead_status"]
    payload = {
        "query": query,
        "limit": limit,
        "properties": props,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{_BASE}/crm/v3/objects/contacts/search",
            headers=_headers(),
            json=payload,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        return [{"id": r["id"], **r.get("properties", {})} for r in results]


async def get_contact(contact_id: str, properties: Optional[list[str]] = None) -> dict:
    """Fetch a single contact by HubSpot ID."""
    props = properties or ["email", "firstname", "lastname", "company", "jobtitle", "lifecyclestage"]
    params = {"properties": ",".join(props)}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{_BASE}/crm/v3/objects/contacts/{contact_id}",
            headers=_headers(),
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()
        return {"id": data["id"], **data.get("properties", {})}


async def update_contact(contact_id: str, properties: dict) -> dict:
    """Patch arbitrary properties on a HubSpot contact."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(
            f"{_BASE}/crm/v3/objects/contacts/{contact_id}",
            headers=_headers(),
            json={"properties": properties},
        )
        resp.raise_for_status()
        data = resp.json()
        return {"id": data["id"], **data.get("properties", {})}


async def batch_update_contacts(updates: list[dict]) -> dict:
    """
    Batch update contacts. Each item: {"id": str, "properties": dict}
    Returns summary {"updated": int, "errors": list}
    """
    payload = {"inputs": [{"id": u["id"], "properties": u["properties"]} for u in updates]}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{_BASE}/crm/v3/objects/contacts/batch/update",
            headers=_headers(),
            json=payload,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        return {"updated": len(results), "errors": []}


async def list_contacts(limit: int = 50, properties: Optional[list[str]] = None) -> list[dict]:
    """List recently created contacts (no filter)."""
    props = properties or ["email", "firstname", "lastname", "company", "createdate", "lifecyclestage"]
    params = {"limit": limit, "properties": ",".join(props)}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{_BASE}/crm/v3/objects/contacts",
            headers=_headers(),
            params=params,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        return [{"id": r["id"], **r.get("properties", {})} for r in results]
