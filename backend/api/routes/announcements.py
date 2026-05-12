"""
Public announcement and changelog routes - no auth required.

These are consumed by the main app (not the admin portal) to show banners
and the What's New feed to logged-in users.

Endpoints:
  GET /announcements/active   - active, non-expired banners (any user)
  GET /changelog              - recent changelog entries
"""

from fastapi import APIRouter, Query
from backend.services import firebase_service

router = APIRouter(tags=["announcements"])


@router.get("/announcements/active")
def get_active_announcements():
    """
    Return banners that are currently active and not expired.
    Called by the frontend on every page load to display dismissible banners.
    """
    return firebase_service.list_announcements(active_only=True)


@router.get("/changelog")
def get_changelog(limit: int = Query(10, ge=1, le=50)):
    """Return the most recent changelog / What's New entries."""
    return firebase_service.list_changelog_entries(limit=limit)
