"""
Brand Audit route.

Lets users submit a batch of content pieces (up to 20) and get each one
scored against their Brand Core. Returns a heatmap-style audit report.

Endpoint:
  POST /projects/{id}/brand-audit   - Score batch content against Brand Core
  GET  /projects/{id}/brand-audit   - Get saved audit results
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.api.deps import get_project_as_member, get_project_as_editor
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service, intelligence_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/brand-audit", tags=["brand-audit"])


class AuditItem(BaseModel):
    id: Optional[str] = None        # caller-supplied id for correlation (e.g. post URL)
    label: Optional[str] = None     # display label (e.g. "Instagram post 14 May")
    content: str = Field(..., min_length=10, max_length=3000)


class BrandAuditRequest(BaseModel):
    items: list[AuditItem] = Field(..., min_length=1, max_length=20)


# ---------------------------------------------------------------------------
# Run audit
# ---------------------------------------------------------------------------

@router.post("")
async def run_brand_audit(
    project_id: str,
    body: BrandAuditRequest,
    user: CurrentUser,
):
    """
    Score each content item against the project's Brand Core.
    Runs up to 5 scoring requests in parallel to keep latency low.
    """
    project = get_project_as_member(project_id, user["uid"])
    brand_core = project.get("brandCore")
    if not brand_core:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Brand Core is not set up for this project. Run brand ingestion first.",
        )

    async def score_one(item: AuditItem) -> dict:
        try:
            result = await intelligence_service.score_brand_voice(item.content, brand_core)
            return {
                "id": item.id,
                "label": item.label or item.content[:60],
                "content": item.content,
                **result,
            }
        except Exception as exc:
            logger.warning("Brand audit scoring failed for item '%s': %s", item.label, exc)
            return {
                "id": item.id,
                "label": item.label or item.content[:60],
                "content": item.content,
                "error": str(exc),
                "score": None,
                "grade": None,
            }

    # Run in batches of 5 to avoid overwhelming the LLM
    results: list[dict] = []
    batch_size = 5
    for i in range(0, len(body.items), batch_size):
        batch = body.items[i : i + batch_size]
        batch_results = await asyncio.gather(*[score_one(item) for item in batch])
        results.extend(batch_results)

    # Compute aggregate statistics
    scored = [r for r in results if r.get("score") is not None]
    avg_score = round(sum(r["score"] for r in scored) / len(scored), 1) if scored else None
    grade_counts: dict[str, int] = {}
    for r in scored:
        g = r.get("grade", "?")
        grade_counts[g] = grade_counts.get(g, 0) + 1

    audit = {
        "projectId": project_id,
        "itemCount": len(body.items),
        "scoredCount": len(scored),
        "averageScore": avg_score,
        "gradeCounts": grade_counts,
        "results": results,
    }

    # Persist for history
    await asyncio.to_thread(firebase_service.save_brand_audit, project_id, audit)

    return audit


# ---------------------------------------------------------------------------
# Get saved audits
# ---------------------------------------------------------------------------

@router.get("/history")
async def get_audit_history(
    project_id: str,
    user: CurrentUser,
):
    """Return the last 10 saved brand audits for this project."""
    get_project_as_member(project_id, user["uid"])
    audits = await asyncio.to_thread(firebase_service.list_brand_audits, project_id)
    return {"audits": audits}
