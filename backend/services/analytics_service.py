"""
Analytics service - Phase 7.

Provides content performance tracking, trend analysis, activity feed,
and AI-powered performance summaries.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.services import firebase_service
from backend.services.llm_service import get_client
from backend.config import settings

# ---------------------------------------------------------------------------
# Metrics logging
# ---------------------------------------------------------------------------

async def log_metrics(project_id: str, item_id: str, metrics: dict) -> dict:
    db = firebase_service.get_db()
    doc = {
        "item_id": item_id,
        "platform": metrics.get("platform", ""),
        "impressions": metrics.get("impressions", 0),
        "reach": metrics.get("reach", 0),
        "clicks": metrics.get("clicks", 0),
        "likes": metrics.get("likes", 0),
        "comments": metrics.get("comments", 0),
        "shares": metrics.get("shares", 0),
        "logged_at": datetime.now(timezone.utc).isoformat(),
    }
    (
        db.collection("projects").document(project_id)
          .collection("analytics").document(item_id)
          .set(doc, merge=True)
    )
    await log_activity(
        project_id, "metrics_logged", "",
        "Performance metrics logged",
        {"item_id": item_id, "impressions": doc["impressions"]},
    )
    return doc


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

async def get_overview(project_id: str) -> dict:
    db = firebase_service.get_db()
    analytics_docs = (
        db.collection("projects").document(project_id)
          .collection("analytics").stream()
    )
    metrics_by_id: dict[str, dict] = {d.id: d.to_dict() for d in analytics_docs}

    library_docs = (
        db.collection("projects").document(project_id)
          .collection("content_library").stream()
    )
    library_items: list[dict[str, Any]] = []
    for doc in library_docs:
        data = doc.to_dict()
        data["_id"] = doc.id
        library_items.append(data)

    total_content = len(library_items)
    total_posted = sum(1 for i in library_items if i.get("status") == "posted")

    platform_counts: dict[str, int] = defaultdict(int)
    for item in library_items:
        platform_counts[item.get("platform", "unknown")] += 1

    if metrics_by_id:
        metrics_list = list(metrics_by_id.values())
        total_impressions = sum(m.get("impressions", 0) for m in metrics_list)
        total_engagement = sum(
            m.get("likes", 0) + m.get("comments", 0) + m.get("shares", 0)
            for m in metrics_list
        )
        avg_engagement = round(total_engagement / len(metrics_list), 1)

        platform_eng: dict[str, list[int]] = defaultdict(list)
        for m in metrics_list:
            eng = m.get("likes", 0) + m.get("comments", 0) + m.get("shares", 0)
            platform_eng[m.get("platform", "unknown")].append(eng)
        best_platform = max(
            platform_eng,
            key=lambda p: sum(platform_eng[p]) / max(len(platform_eng[p]), 1),
            default="",
        )

        top_ids = sorted(
            metrics_by_id.keys(),
            key=lambda k: (
                metrics_by_id[k].get("likes", 0)
                + metrics_by_id[k].get("comments", 0)
                + metrics_by_id[k].get("shares", 0)
            ),
            reverse=True,
        )[:5]
        top_content = [
            {
                "id": k,
                "platform": metrics_by_id[k].get("platform", ""),
                "engagement": (
                    metrics_by_id[k].get("likes", 0)
                    + metrics_by_id[k].get("comments", 0)
                    + metrics_by_id[k].get("shares", 0)
                ),
                "impressions": metrics_by_id[k].get("impressions", 0),
            }
            for k in top_ids
        ]
    else:
        total_impressions = 0
        avg_engagement = 0.0
        best_platform = ""
        top_content = []

    return {
        "total_content": total_content,
        "total_posted": total_posted,
        "avg_engagement": avg_engagement,
        "total_impressions": total_impressions,
        "best_platform": best_platform,
        "platform_breakdown": dict(platform_counts),
        "top_content": top_content,
        "has_metrics": len(metrics_by_id) > 0,
    }


# ---------------------------------------------------------------------------
# Content performance table
# ---------------------------------------------------------------------------

async def get_content_performance(project_id: str) -> list[dict]:
    db = firebase_service.get_db()
    analytics_docs = (
        db.collection("projects").document(project_id)
          .collection("analytics").stream()
    )
    metrics_by_id: dict[str, dict] = {d.id: d.to_dict() for d in analytics_docs}

    library_docs = (
        db.collection("projects").document(project_id)
          .collection("content_library").stream()
    )
    results = []
    for doc in library_docs:
        item = doc.to_dict()
        m = metrics_by_id.get(doc.id, {})
        results.append({
            "id": doc.id,
            "platform": item.get("platform", ""),
            "status": item.get("status", ""),
            "created_at": item.get("created_at", ""),
            "impressions": m.get("impressions", 0),
            "reach": m.get("reach", 0),
            "clicks": m.get("clicks", 0),
            "likes": m.get("likes", 0),
            "comments": m.get("comments", 0),
            "shares": m.get("shares", 0),
            "engagement": (
                m.get("likes", 0) + m.get("comments", 0) + m.get("shares", 0)
            ),
            "has_metrics": doc.id in metrics_by_id,
        })

    results.sort(key=lambda x: x["engagement"], reverse=True)
    return results


# ---------------------------------------------------------------------------
# Trend data
# ---------------------------------------------------------------------------

async def get_trends(project_id: str) -> dict:
    db = firebase_service.get_db()
    library_docs = (
        db.collection("projects").document(project_id)
          .collection("content_library").stream()
    )
    items = [doc.to_dict() for doc in library_docs]

    daily_counts: dict[str, int] = defaultdict(int)
    platform_counts: dict[str, int] = defaultdict(int)
    status_counts: dict[str, int] = defaultdict(int)

    for item in items:
        created = item.get("created_at", "")
        if created:
            day = str(created)[:10]
            daily_counts[day] += 1
        platform_counts[item.get("platform", "unknown")] += 1
        status_counts[item.get("status", "draft")] += 1

    sorted_days = sorted(daily_counts.keys())[-30:]

    return {
        "daily_creation": [
            {"date": d, "count": daily_counts[d]} for d in sorted_days
        ],
        "platform_breakdown": [
            {"platform": p, "count": c} for p, c in platform_counts.items()
        ],
        "status_breakdown": [
            {"status": s, "count": c} for s, c in status_counts.items()
        ],
    }


# ---------------------------------------------------------------------------
# Activity feed
# ---------------------------------------------------------------------------

async def get_activity_feed(project_id: str, limit: int = 60) -> list[dict]:
    try:
        db = firebase_service.get_db()
        docs = (
            db.collection("projects").document(project_id)
              .collection("activity")
              .order_by("timestamp", direction="DESCENDING")
              .limit(limit)
              .stream()
        )
        return [{"id": doc.id, **doc.to_dict()} for doc in docs]
    except Exception:
        return []


async def log_activity(
    project_id: str,
    event_type: str,
    user_email: str,
    description: str,
    metadata: dict | None = None,
) -> None:
    if not project_id:
        return
    try:
        db = firebase_service.get_db()
        event = {
            "event_type": event_type,
            "user_email": user_email,
            "description": description,
            "metadata": metadata or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        db.collection("projects").document(project_id).collection("activity").add(event)
    except Exception:
        pass  # Non-critical - never fail the main operation


# ---------------------------------------------------------------------------
# AI performance summary
# ---------------------------------------------------------------------------

async def generate_performance_summary(project_id: str) -> str:
    overview = await get_overview(project_id)
    trends = await get_trends(project_id)

    prompt = f"""You are a marketing analytics expert. Provide a concise performance summary (3-4 sentences) with actionable insights.

Content stats:
- Total content items: {overview['total_content']}
- Total posted: {overview['total_posted']}
- Average engagement per tracked post: {overview['avg_engagement']}
- Best performing platform: {overview['best_platform'] or 'not enough data yet'}
- Total impressions tracked: {overview['total_impressions']}
- Platform breakdown: {overview['platform_breakdown']}
- Content status breakdown: {trends['status_breakdown']}

Be direct. Identify what's working, flag any concerns, and give 1-2 specific actions the marketer should take.
"""
    client = get_client()
    response = await client.messages.create(
        model=settings.LLM_MODEL,
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


# ---------------------------------------------------------------------------
# Period comparison
# ---------------------------------------------------------------------------

def _pct_change(current: int, previous: int) -> float | None:
    """Return percentage change, or None if there's no previous data."""
    if previous == 0:
        return None
    return round(((current - previous) / previous) * 100, 1)


async def get_comparison(project_id: str, days: int = 7) -> dict:
    """Compare item counts in the current period vs the same-length previous period."""
    now = datetime.now(timezone.utc)
    period_start = now - timedelta(days=days)
    prev_start = period_start - timedelta(days=days)

    db = firebase_service.get_db()

    def _count_in_range(docs, start: datetime, end: datetime) -> int:
        count = 0
        for d in docs:
            data = d.to_dict()
            ts = data.get("createdAt") or data.get("updatedAt")
            if ts is None:
                continue
            if isinstance(ts, str):
                try:
                    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except ValueError:
                    continue
            else:
                dt = ts
            if not dt.tzinfo:
                dt = dt.replace(tzinfo=timezone.utc)
            if start <= dt < end:
                count += 1
        return count

    lib_docs = list(
        db.collection("projects").document(project_id)
          .collection("content_library").stream()
    )
    cal_docs = list(
        db.collection("projects").document(project_id)
          .collection("calendar_entries").stream()
    )

    lib_curr = _count_in_range(lib_docs, period_start, now)
    lib_prev = _count_in_range(lib_docs, prev_start, period_start)
    cal_curr = _count_in_range(cal_docs, period_start, now)
    cal_prev = _count_in_range(cal_docs, prev_start, period_start)

    return {
        "period_days": days,
        "library": {"current": lib_curr, "previous": lib_prev, "pct_change": _pct_change(lib_curr, lib_prev)},
        "calendar": {"current": cal_curr, "previous": cal_prev, "pct_change": _pct_change(cal_curr, cal_prev)},
    }
