"""
In-process TTL cache for brand context and search results.

Why this exists: every chat message previously re-fetched brand core, memory
items, and search API results from Firestore / external APIs on every call.
This simple cache avoids redundant network round-trips within a sliding window.

Design:
- Thread-safe via threading.Lock (FastAPI runs in a threadpool for sync work;
  async code should use asyncio.to_thread when calling sync helpers here).
- LRU eviction: when the cache exceeds MAX_ENTRIES the oldest entry is dropped.
- Keys are arbitrary strings — callers namespace them (e.g. "brand:{project_id}").
- TTL is per-entry (seconds). Pass ttl=0 to skip caching (useful in tests).
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Optional

logger = logging.getLogger(__name__)

_MAX_ENTRIES = 500
_DEFAULT_TTL = 300  # 5 minutes

# (value, expires_at) pairs stored in insertion order for LRU eviction.
_store: OrderedDict[str, tuple[Any, float]] = OrderedDict()
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get(key: str) -> Optional[Any]:
    """Return cached value or None if missing / expired."""
    with _lock:
        entry = _store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            del _store[key]
            return None
        # Move to end to reflect recent use (LRU)
        _store.move_to_end(key)
        return value


def set(key: str, value: Any, ttl: int = _DEFAULT_TTL) -> None:
    """Store value under key with a TTL in seconds."""
    if ttl <= 0:
        return
    with _lock:
        expires_at = time.monotonic() + ttl
        _store[key] = (value, expires_at)
        _store.move_to_end(key)
        # Evict oldest if over limit
        while len(_store) > _MAX_ENTRIES:
            _store.popitem(last=False)


def delete(key: str) -> None:
    """Explicitly invalidate a cache entry (e.g. after a brand core update)."""
    with _lock:
        _store.pop(key, None)


def delete_prefix(prefix: str) -> int:
    """Delete all keys that start with prefix. Returns the number removed."""
    with _lock:
        to_remove = [k for k in _store if k.startswith(prefix)]
        for k in to_remove:
            del _store[k]
    if to_remove:
        logger.debug("Cache: evicted %d entries with prefix '%s'", len(to_remove), prefix)
    return len(to_remove)


def stats() -> dict:
    """Return cache statistics for the /debug/config endpoint."""
    with _lock:
        now = time.monotonic()
        alive = sum(1 for _, (_, exp) in _store.items() if exp > now)
        return {"total_entries": len(_store), "alive_entries": alive, "max_entries": _MAX_ENTRIES}


# ---------------------------------------------------------------------------
# TTL constants - import these at call sites for consistency
# ---------------------------------------------------------------------------

TTL_BRAND_CONTEXT = 300        # brand core + memory — 5 min
TTL_SEARCH_RESULTS = 3600      # Exa / Tavily results — 1 hour
TTL_COMPETITOR_PROFILE = 1800  # classified competitor profiles — 30 min
TTL_BILLING_STATUS = 60        # billing plan check — 1 min
