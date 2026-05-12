"""
Apollo.io REST API client for Pillar 1 - ICP Builder & Persona Generation.

Uses Apollo v1 API (https://api.apollo.io/v1).
All functions return empty results on failure so SSE streams stay alive.
Results should be cached in Firestore pillar1_docs.research_cache to avoid
re-hitting the API (Apollo basic plan: 50 enrichment credits/day, 300 search/month).
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

APOLLO_BASE = "https://api.apollo.io/v1"
_TIMEOUT = 20.0


async def search_companies(
    industry_tags: list[str],
    employee_ranges: list[str],
    locations: list[str],
    api_key: str,
    per_page: int = 10,
) -> list[dict]:
    """
    Search Apollo for companies matching industry, size, and location criteria.

    employee_ranges: list of strings like ["1,10", "11,50", "51,200"]
    Returns list of company dicts (name, domain, industry, employee_count, etc.)
    """
    if not api_key:
        logger.warning("APOLLO_API_KEY not set - skipping company search")
        return []

    payload: dict = {
        "api_key": api_key,
        "page": 1,
        "per_page": per_page,
    }
    if industry_tags:
        payload["q_organization_industry_tag_ids"] = industry_tags
    if employee_ranges:
        payload["num_employees_ranges"] = employee_ranges
    if locations:
        payload["organization_locations"] = locations

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{APOLLO_BASE}/mixed_companies/search",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("organizations") or data.get("accounts") or []
    except Exception as exc:
        logger.warning("Apollo company search failed: %s", exc)
        return []


async def search_people(
    domains: list[str],
    titles: list[str],
    api_key: str,
    per_page: int = 10,
) -> list[dict]:
    """
    Search Apollo for people (decision-makers) at given domains with given titles.

    Returns list of person dicts (name, title, email, seniority, etc.)
    """
    if not api_key:
        logger.warning("APOLLO_API_KEY not set - skipping people search")
        return []

    payload: dict = {
        "api_key": api_key,
        "page": 1,
        "per_page": per_page,
    }
    if domains:
        payload["q_organization_domains"] = domains
    if titles:
        payload["person_titles"] = titles

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{APOLLO_BASE}/mixed_people/search",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("people") or []
    except Exception as exc:
        logger.warning("Apollo people search failed: %s", exc)
        return []


async def enrich_company(domain: str, api_key: str) -> dict:
    """
    Enrich a company by domain - returns funding, revenue, employee count, industry, etc.
    """
    if not api_key:
        logger.warning("APOLLO_API_KEY not set - skipping company enrichment")
        return {}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{APOLLO_BASE}/organizations/enrich",
                json={"api_key": api_key, "domain": domain},
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("organization") or {}
    except Exception as exc:
        logger.warning("Apollo company enrichment failed for %s: %s", domain, exc)
        return {}


async def enrich_person(email: str, api_key: str, organization_name: Optional[str] = None) -> dict:
    """
    Enrich a person by email - returns title, seniority, department, social links.
    """
    if not api_key:
        logger.warning("APOLLO_API_KEY not set - skipping person enrichment")
        return {}

    payload: dict = {"api_key": api_key, "email": email, "reveal_personal_emails": False}
    if organization_name:
        payload["organization_name"] = organization_name

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{APOLLO_BASE}/people/match",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("person") or {}
    except Exception as exc:
        logger.warning("Apollo person enrichment failed for %s: %s", email, exc)
        return {}
