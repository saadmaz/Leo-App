"""
Competitor Alerts Digest route.

Generates a weekly email digest of competitor activity for a project,
then sends it to the project owner via Resend.

Endpoints:
  POST /projects/{id}/competitors/digest         - Generate + send digest now
  GET  /projects/{id}/competitors/digest/preview - Preview digest HTML (no send)
"""

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status

from backend.api.deps import get_project_as_member
from backend.middleware.auth import CurrentUser
from backend.services import firebase_service
from backend.services.llm_service import call_claude_raw
from backend.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/competitors", tags=["competitor-digest"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _build_digest(project: dict, project_id: str) -> tuple[str, str]:
    """
    Return (subject, html) for the competitor digest email.

    Pulls the latest competitor snapshots and monitoring alerts,
    synthesises with Claude, and renders as HTML.
    """
    brand_name = project.get("name", "Your Brand")

    # Gather latest competitor data
    snapshots = await asyncio.to_thread(firebase_service.get_competitor_snapshots, project_id)
    alerts: list[dict] = []
    try:
        monitors = await asyncio.to_thread(firebase_service.list_competitor_monitors, project_id)
        for monitor in monitors[:3]:
            monitor_id = monitor.get("id", "")
            if monitor_id:
                monitor_alerts = await asyncio.to_thread(
                    firebase_service.list_monitor_alerts, project_id, monitor_id, limit=5
                )
                alerts.extend(monitor_alerts)
    except Exception:
        pass

    # Build Claude prompt
    snapshots_text = "\n".join(
        f"- {s.get('name', 'Unknown')}: {s.get('summary', 'No summary')}"
        for s in snapshots[:5]
    ) or "No competitor data collected yet."

    alerts_text = "\n".join(
        f"- [{a.get('detected_at', '')[:10]}] {a.get('competitor', 'Competitor')}: {a.get('summary', a.get('change_type', ''))}"
        for a in alerts[:10]
    ) or "No new alerts this week."

    prompt = f"""You are a senior marketing analyst writing a weekly competitor intelligence digest for {brand_name}.

COMPETITOR SNAPSHOTS:
{snapshots_text}

RECENT ALERTS (last 7 days):
{alerts_text}

Write a concise weekly digest with:
1. HEADLINE: One punchy sentence summarising the week's biggest competitive development (or "quiet week" if nothing significant)
2. KEY MOVES: 3-5 bullet points of notable competitor actions this week
3. OPPORTUNITY: One specific opportunity {brand_name} should consider based on the competitive landscape
4. COUNTER-MOVES: 2-3 actionable responses {brand_name} could take this week

Keep it tight. Each bullet should be one sentence. Marketing director audience — they're busy."""

    digest_text = await call_claude_raw(prompt, max_tokens=600)

    # Parse sections
    def _extract(header: str, text: str) -> str:
        import re
        pattern = rf"(?:{re.escape(header)}:?)\s*(.*?)(?=\n\n|\n[A-Z]{{2,}}|\Z)"
        m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
        return m.group(1).strip() if m else ""

    headline = _extract("HEADLINE", digest_text) or "This week in competitive intelligence"
    key_moves_raw = _extract("KEY MOVES", digest_text) or ""
    opportunity = _extract("OPPORTUNITY", digest_text) or ""
    counter_moves_raw = _extract("COUNTER-MOVES", digest_text) or ""

    def _bullets_to_html(raw: str) -> str:
        lines = [l.lstrip("-• ").strip() for l in raw.strip().split("\n") if l.strip()]
        items = "".join(f'<li style="margin-bottom:8px;">{l}</li>' for l in lines)
        return f'<ul style="padding-left:20px;margin:0;">{items}</ul>'

    week_str = datetime.now(timezone.utc).strftime("%B %-d, %Y")
    subject = f"LEO Weekly Digest: {brand_name} competitive intel — {week_str}"

    html = f"""
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111;">

  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
    <div style="width:32px;height:32px;background:#7c3aed;border-radius:8px;display:flex;align-items:center;justify-content:center;">
      <span style="color:#fff;font-weight:700;font-size:14px;">L</span>
    </div>
    <div>
      <p style="margin:0;font-size:12px;color:#6b7280;font-weight:500;">WEEKLY COMPETITOR DIGEST</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">{week_str} · {brand_name}</p>
    </div>
  </div>

  <div style="background:#f9f5ff;border-left:4px solid #7c3aed;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px;">
    <p style="margin:0;font-size:16px;font-weight:600;color:#4c1d95;">{headline}</p>
  </div>

  <div style="margin-bottom:24px;">
    <p style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 12px;">
      Key Moves This Week
    </p>
    <div style="font-size:14px;line-height:1.6;color:#374151;">
      {_bullets_to_html(key_moves_raw)}
    </div>
  </div>

  {f'''
  <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px;margin-bottom:24px;">
    <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#065f46;margin:0 0 8px;">
      Opportunity Spotted
    </p>
    <p style="margin:0;font-size:14px;color:#065f46;line-height:1.6;">{opportunity}</p>
  </div>
  ''' if opportunity else ''}

  <div style="margin-bottom:32px;">
    <p style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 12px;">
      Your Counter-Moves
    </p>
    <div style="font-size:14px;line-height:1.6;color:#374151;">
      {_bullets_to_html(counter_moves_raw)}
    </div>
  </div>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;">
    Sent by <a href="https://leoapp.ai" style="color:#7c3aed;text-decoration:none;">LEO</a> ·
    You're receiving this because you're a member of the {brand_name} project.
  </p>
</div>
"""

    return subject, html


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/digest")
async def send_digest(
    project_id: str,
    user: CurrentUser,
):
    """Generate and email the weekly competitor digest to the project owner."""
    project = get_project_as_member(project_id, user["uid"])

    if not settings.RESEND_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email service is not configured (RESEND_API_KEY missing).",
        )

    user_email = user.get("email")
    if not user_email:
        raise HTTPException(status_code=400, detail="User email not available.")

    subject, html = await _build_digest(project, project_id)

    from backend.services import email_service
    await asyncio.to_thread(email_service.send_single, to=user_email, subject=subject, html_body=html)

    logger.info("Competitor digest sent to %s for project %s", user_email, project_id)
    return {"sent": True, "email": user_email, "subject": subject}


@router.get("/digest/preview")
async def preview_digest(
    project_id: str,
    user: CurrentUser,
):
    """Return the digest HTML without sending it — useful for the settings/test UI."""
    project = get_project_as_member(project_id, user["uid"])
    subject, html = await _build_digest(project, project_id)
    return {"subject": subject, "html": html}
