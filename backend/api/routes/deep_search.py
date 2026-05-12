"""
Deep Search routes - multi-source web intelligence.

POST /projects/{project_id}/deep-search          - run a search (SSE stream)
GET  /projects/{project_id}/deep-search/history  - list saved results
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.api.deps import get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.services import deep_search_service, firebase_service
from backend.services.credits_service import check_and_deduct

logger = logging.getLogger(__name__)
router = APIRouter(tags=["deep-search"])


class DeepSearchRequest(BaseModel):
    query: str
    scrape_top_n: int = 3


@router.post("/projects/{project_id}/deep-search")
async def run_deep_search(
    project_id: str,
    body: DeepSearchRequest,
    user: CurrentUser,
):
    """
    Stream deep search results as SSE events.
    Deducts 25 credits per search.
    """
    await get_project_as_member(project_id, user)
    await asyncio.to_thread(check_and_deduct, user["uid"], "deep_search")

    async def event_stream():
        loop = asyncio.get_event_loop()

        def run_search():
            return list(deep_search_service.deep_search(
                query=body.query,
                scrape_top_n=body.scrape_top_n,
            ))

        events = await loop.run_in_executor(None, run_search)

        # Save result to Firestore (fire-and-forget)
        result_data = {
            "query": body.query,
            "events": [e for e in events if e.get("type") in ("serp_results", "scraped_page")],
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "userId": user["uid"],
        }
        try:
            await asyncio.to_thread(
                firebase_service.save_deep_search_result,
                project_id,
                result_data,
            )
        except Exception as exc:
            logger.warning("Failed to save deep search result: %s", exc)

        for event in events:
            yield f"data: {json.dumps(event)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/projects/{project_id}/deep-search/history")
async def get_search_history(project_id: str, user: CurrentUser):
    """Return the last 20 deep search results for this project."""
    await get_project_as_member(project_id, user)
    results = await asyncio.to_thread(
        firebase_service.list_deep_search_results, project_id
    )
    return {"results": results}
