"""
Email service - wraps the Resend SDK for transactional and broadcast emails.

Resend docs: https://resend.com/docs/send-with-python

All functions are synchronous. Use asyncio.to_thread() for async callers.
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Sender address - use your verified Resend domain
_DEFAULT_FROM = "LEO <noreply@leoapp.ai>"


def _client():
    """Lazy-initialise the Resend client so missing keys don't crash startup."""
    from backend.config import settings
    if not settings.RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY is not configured.")
    import resend
    resend.api_key = settings.RESEND_API_KEY
    return resend


def send_broadcast(
    to_addresses: list[str],
    subject: str,
    html_body: str,
    from_address: str = _DEFAULT_FROM,
    batch_size: int = 50,
) -> dict:
    """
    Send a broadcast email to a list of addresses in batches.

    Resend's batch endpoint sends up to 100 emails per call. We use 50 to
    stay well within rate limits. Returns a summary dict.

    Returns:
        {"sent": int, "failed": int, "errors": list[str]}
    """
    resend = _client()
    sent = 0
    failed = 0
    errors: list[str] = []

    for i in range(0, len(to_addresses), batch_size):
        batch = to_addresses[i : i + batch_size]
        for address in batch:
            try:
                resend.Emails.send({
                    "from": from_address,
                    "to": address,
                    "subject": subject,
                    "html": html_body,
                })
                sent += 1
            except Exception as exc:
                failed += 1
                errors.append(f"{address}: {exc}")
                logger.warning("Failed to send email to %s: %s", address, exc)

    logger.info("Broadcast complete - sent: %d, failed: %d", sent, failed)
    return {"sent": sent, "failed": failed, "errors": errors[:20]}  # cap error list


def send_single(
    to: str,
    subject: str,
    html_body: str,
    from_address: str = _DEFAULT_FROM,
) -> None:
    """Send a single transactional email."""
    resend = _client()
    resend.Emails.send({
        "from": from_address,
        "to": to,
        "subject": subject,
        "html": html_body,
    })
    logger.info("Sent email to %s - subject: %s", to, subject)


def build_announcement_html(title: str, body: str, cta_url: str = "") -> str:
    """
    Minimal HTML template for announcement broadcast emails.
    Inline styles for maximum email client compatibility.
    """
    cta_block = (
        f'<p style="margin-top:24px;">'
        f'<a href="{cta_url}" style="background:#7c3aed;color:#fff;padding:10px 20px;'
        f'border-radius:6px;text-decoration:none;font-weight:600;">Open LEO</a>'
        f'</p>'
        if cta_url else ""
    )
    return f"""
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111;">
      <p style="font-size:22px;font-weight:700;margin:0 0 16px;">{title}</p>
      <div style="font-size:15px;line-height:1.6;color:#444;">{body}</div>
      {cta_block}
      <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb;">
      <p style="font-size:12px;color:#9ca3af;">
        You're receiving this because you have a LEO account.
        <a href="{{{{unsubscribe}}}}" style="color:#9ca3af;">Unsubscribe</a>
      </p>
    </div>
    """
