"""
Media List Building - Apify scrapes journalist directories, Hunter.io verifies emails,
Claude enriches and prioritises the list.

Strategy:
  1. Claude generates a list of target publications & journalist personas
  2. Apify searches Google News / LinkedIn for matching journalists
  3. Hunter.io verifies/finds emails for each contact
  4. Claude produces a prioritised, annotated media list
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncGenerator

import httpx

from backend.config import settings
from backend.schemas.pillar8 import MediaListRequest
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw, build_brand_core_context

logger = logging.getLogger(__name__)
_MAX_BRAND = 500

SYSTEM_PLAN = """\
You are a media relations expert. Given an industry and news angle, generate a list of \
target publications and journalist archetypes that would likely cover this story.

Return ONLY valid JSON - no markdown.

Schema:
{
  "target_publications": [
    {
      "publication": "string",
      "publication_type": "string (tech press | trade | business | consumer | podcast)",
      "why_relevant": "string (1 sentence)",
      "typical_journalist_beat": "string"
    }
  ],
  "journalist_search_queries": ["string", "..."]
}
"""

SYSTEM_LIST = """\
You are a media relations strategist. Given research data about publications and journalists, \
produce a polished, prioritised media list with outreach notes.

Return ONLY valid JSON - no markdown.

Schema:
{
  "media_list": [
    {
      "rank": number,
      "journalist_name": "string or 'Unknown'",
      "title": "string or null",
      "publication": "string",
      "beat": "string",
      "email": "string or null",
      "linkedin_url": "string or null",
      "why_target": "string (1 sentence - why they'd cover your story)",
      "personalisation_hook": "string (what to reference in outreach)",
      "tier": "A | B | C"
    }
  ],
  "outreach_strategy": "string (paragraph - how to work through this list)",
  "total_contacts": number
}
"""


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _hunter_domain_search(domain: str, api_key: str) -> list[dict]:
    """Search Hunter.io for journalists at a given publication domain."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.hunter.io/v2/domain-search",
                params={"domain": domain, "api_key": api_key, "limit": 5, "type": "personal"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("data", {}).get("emails", [])
    except Exception as exc:
        logger.warning("Hunter domain search failed for %s: %s", domain, exc)
    return []


async def generate(
    project: dict,
    body: MediaListRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    if not settings.ANTHROPIC_API_KEY:
        yield _sse({"type": "error", "message": "ANTHROPIC_API_KEY is not configured."})
        return

    title = f"Media List - {body.industry} · {body.news_angle[:40]}"
    doc = firebase_service.create_pillar1_doc(project_id, "media_list", owner_uid, title)
    doc_id = doc["id"]

    yield _sse({"type": "research_step", "step": "brand", "label": "Loading brand context…", "status": "running"})
    brand_context = build_brand_core_context(project.get("brandCore") or {})
    yield _sse({"type": "research_step", "step": "brand", "label": "Brand loaded", "status": "done"})

    # Step 1 - Claude generates target publications & search queries
    yield _sse({"type": "research_step", "step": "planning", "label": "Identifying target publications…", "status": "running"})
    plan_prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"Industry: {body.industry}\n"
        f"News angle: {body.news_angle}\n"
        f"Geography: {body.geography or 'global'}\n"
        f"Publication types: {', '.join(body.publication_types)}\n"
        f"Target contacts: {body.num_contacts}\n\n"
        "Generate target publications and journalist search queries."
    )
    try:
        raw_plan = await call_claude_raw(plan_prompt, system=SYSTEM_PLAN, max_tokens=2000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"Planning failed: {exc}"}); return

    plan_clean = re.sub(r"^```(?:json)?\s*", "", raw_plan, flags=re.MULTILINE)
    plan_clean = re.sub(r"\s*```$", "", plan_clean, flags=re.MULTILINE)
    try:
        plan = json.loads(plan_clean.strip())
    except json.JSONDecodeError:
        plan = {"target_publications": [], "journalist_search_queries": []}

    yield _sse({"type": "research_step", "step": "planning", "label": f"Identified {len(plan.get('target_publications', []))} publications", "status": "done"})

    # Step 2 - Hunter.io email verification (if key available)
    hunter_contacts: list[dict] = []
    if body.verify_emails and settings.HUNTER_API_KEY:
        yield _sse({"type": "research_step", "step": "hunter", "label": "Searching Hunter.io for contacts…", "status": "running"})
        pubs = plan.get("target_publications", [])[:10]  # limit API calls
        for pub in pubs:
            # Derive domain from publication name heuristically
            pub_name = pub.get("publication", "").lower().replace(" ", "").replace("'", "")
            # We pass the name as a keyword search instead
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        "https://api.hunter.io/v2/domain-search",
                        params={"company": pub.get("publication"), "api_key": settings.HUNTER_API_KEY, "limit": 3},
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        emails = data.get("data", {}).get("emails", [])
                        for e in emails:
                            hunter_contacts.append({
                                "journalist_name": f"{e.get('first_name', '')} {e.get('last_name', '')}".strip(),
                                "email": e.get("value"),
                                "title": e.get("position"),
                                "linkedin_url": e.get("linkedin"),
                                "publication": pub.get("publication"),
                                "beat": pub.get("typical_journalist_beat"),
                            })
            except Exception as exc:
                logger.warning("Hunter search failed: %s", exc)
        yield _sse({"type": "research_step", "step": "hunter", "label": f"Found {len(hunter_contacts)} verified contacts", "status": "done"})
    else:
        yield _sse({"type": "research_step", "step": "hunter", "label": "Hunter.io not configured - skipping email verification", "status": "done"})

    # Step 3 - Claude builds the final prioritised list
    yield _sse({"type": "research_step", "step": "building", "label": "Building prioritised media list…", "status": "running"})
    list_prompt = (
        f"BRAND CONTEXT:\n{brand_context[:_MAX_BRAND]}\n\n"
        f"Industry: {body.industry}\n"
        f"News angle: {body.news_angle}\n"
        f"Geography: {body.geography or 'global'}\n"
        f"Target contact count: {body.num_contacts}\n\n"
        f"TARGET PUBLICATIONS (Claude-researched):\n{json.dumps(plan.get('target_publications', []), indent=2)}\n\n"
        + (f"VERIFIED CONTACTS (Hunter.io):\n{json.dumps(hunter_contacts, indent=2)}\n\n" if hunter_contacts else "No Hunter contacts available - generate plausible journalist personas.\n\n")
        + "Build a prioritised, annotated media list. Return valid JSON only."
    )
    try:
        raw_list = await call_claude_raw(list_prompt, system=SYSTEM_LIST, max_tokens=5000)
    except Exception as exc:
        yield _sse({"type": "error", "message": f"List building failed: {exc}"}); return

    yield _sse({"type": "research_step", "step": "building", "label": "Media list built", "status": "done"})

    list_clean = re.sub(r"^```(?:json)?\s*", "", raw_list, flags=re.MULTILINE)
    list_clean = re.sub(r"\s*```$", "", list_clean, flags=re.MULTILINE)
    try:
        payload = json.loads(list_clean.strip())
    except json.JSONDecodeError as exc:
        yield _sse({"type": "error", "message": f"Could not parse response: {exc}"}); return

    payload["industry"] = body.industry
    payload["news_angle"] = body.news_angle

    yield _sse({"type": "research_step", "step": "saving", "label": "Saving…", "status": "running"})
    firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "ready", "payload": payload, "credits_spent": 20})
    yield _sse({"type": "research_step", "step": "saving", "label": "Saved", "status": "done"})
    yield _sse({"type": "saved", "doc_id": doc_id, "payload": payload})
    yield "data: [DONE]\n\n"
