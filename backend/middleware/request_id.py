"""
Request ID middleware - stamps every HTTP request with a unique ID and
propagates it through all log lines for that request.

How it works:
  1. If the client sends an X-Request-ID header, we re-use its value (useful
     for tracing across services or from a front-end that generates IDs).
  2. Otherwise we generate a fresh UUID4.
  3. The ID is stored in a contextvars.ContextVar so any logger.xxx() call
     within the same async task automatically picks it up via the
     RequestIdFilter below.
  4. The ID is echoed back in the response as X-Request-ID so the client
     can correlate its own logs.

Usage - add to main.py:
    from backend.middleware.request_id import RequestIdMiddleware, RequestIdFilter

    logging.getLogger().addFilter(RequestIdFilter())
    app.add_middleware(RequestIdMiddleware)

Then every log line emitted during a request will have [req_id=<uuid>] at
the start of the message.
"""

import logging
import uuid
from contextvars import ContextVar
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Module-level ContextVar - holds the request ID for the current async task.
# Defaults to '-' so log lines outside a request context are still valid.
_request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


def get_request_id() -> str:
    """Return the request ID for the currently executing async task."""
    return _request_id_var.get()


class RequestIdMiddleware(BaseHTTPMiddleware):
    """
    Starlette middleware that assigns a unique ID to each incoming request.

    The ID is sourced from (in priority order):
      1. The incoming X-Request-ID header (client-supplied).
      2. A freshly generated UUID4.

    The ID is:
      - Stored in a ContextVar for the duration of the request.
      - Echoed back in the X-Request-ID response header.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Honour a client-supplied request ID if present and non-empty.
        req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

        # Set the ContextVar for this async task (and all awaited coroutines).
        token = _request_id_var.set(req_id)
        try:
            response = await call_next(request)
        finally:
            # Always reset so the ContextVar doesn't bleed into other tasks.
            _request_id_var.reset(token)

        response.headers["X-Request-ID"] = req_id
        return response


class RequestIdFilter(logging.Filter):
    """
    Logging filter that injects the current request ID into every LogRecord.

    Attach this to the root logger (or any handler) so all log lines
    produced during a request include the request ID.

    Example log format string:
        "%(asctime)s [%(request_id)s] %(levelname)s %(name)s - %(message)s"
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()  # type: ignore[attr-defined]
        return True
