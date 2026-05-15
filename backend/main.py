import logging
import os
import sys
import traceback
from contextlib import asynccontextmanager

# Ensure the repo root is on the path so `backend.xxx` imports resolve
# regardless of the working directory from which the server is launched.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# ---------------------------------------------------------------------------
# Sentry - initialise before anything else so every error is captured,
# including those that happen during module import and startup.
# ---------------------------------------------------------------------------
def _init_sentry() -> None:
    from backend.config import settings
    if not settings.SENTRY_DSN:
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.ENVIRONMENT,
            traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
            integrations=[
                FastApiIntegration(transaction_style="endpoint"),
                LoggingIntegration(level=logging.WARNING, event_level=logging.ERROR),
            ],
            # Strip PII from breadcrumbs
            send_default_pii=False,
        )
        logging.getLogger(__name__).info("Sentry initialised (environment: %s)", settings.ENVIRONMENT)
    except Exception as exc:
        logging.getLogger(__name__).warning("Sentry initialisation failed: %s", exc)

_init_sentry()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from backend.config import settings
from backend.services import firebase_service
from backend.api.routes import projects, chats, stream, ingestion, brand_core, billing, assets, campaigns, generate, members, admin, announcements, intelligence, content_ops, content_studio, templates, planner, analytics, reports, monitoring, seo, posts, credits, deep_search, strategy, carousel, threads, competitors, personal_brand, knowledge, brand_audit, competitor_digest
from backend.middleware.rate_limit import limiter
from backend.middleware.request_id import RequestIdFilter, RequestIdMiddleware

# ---------------------------------------------------------------------------
# Logging - include request ID in every log line.
# Format: "2024-01-01 12:00:00 [req_id=abc123] INFO backend.foo - message"
# Outside a request context, req_id shows as '-'.
# ---------------------------------------------------------------------------
_log_handler = logging.StreamHandler()
_log_handler.setFormatter(logging.Formatter(
    fmt="%(asctime)s [req_id=%(request_id)s] %(levelname)s %(name)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
))
# Filter must be on the handler (not the logger) so it runs for records
# propagated up from uvicorn's child loggers too.
_log_handler.addFilter(RequestIdFilter())

logging.basicConfig(handlers=[_log_handler], level=settings.LOG_LEVEL, force=True)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan - runs once on startup and once on shutdown.
# Replaces the deprecated @app.on_event("startup") pattern.
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup ---
    try:
        firebase_service.initialize()
    except Exception as exc:
        # Log but don't crash - the /health endpoint must stay reachable
        # even if Firebase credentials are missing or misconfigured.
        logger.error("Firebase initialisation failed: %s", exc, exc_info=True)

    if not settings.ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY is not set - chat and ingestion will not work.")
    else:
        logger.info("Anthropic API key loaded (model: %s).", settings.LLM_CHAT_MODEL)

    if not settings.OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY is not set - image generation will return 503.")
    else:
        logger.info("OpenAI API key loaded - image generation enabled.")

    if not settings.EXA_API_KEY:
        logger.warning("EXA_API_KEY is not set - semantic search and research features disabled.")
    else:
        logger.info("Exa API key loaded - semantic search, competitor discovery, research enabled.")

    if not settings.TAVILY_API_KEY:
        logger.warning("TAVILY_API_KEY is not set - real-time web search and news monitoring disabled.")
    else:
        logger.info("Tavily API key loaded - web search, news monitoring, content enrichment enabled.")

    if not settings.SERPAPI_API_KEY:
        logger.warning("SERPAPI_API_KEY is not set - SEO layer 4 and competitor discovery degraded.")
    else:
        logger.info("SerpAPI key loaded - SEO intelligence and competitor discovery enabled.")

    if not settings.APIFY_API_KEY:
        logger.warning("APIFY_API_KEY is not set - social scraping (Instagram/TikTok/YouTube/Meta Ads) disabled.")
    else:
        from backend.services.ingestion.apify_client import (
            INSTAGRAM_ACTOR, TIKTOK_ACTOR, YOUTUBE_ACTOR,
            FACEBOOK_ACTOR, LINKEDIN_ACTOR, THREADS_ACTOR,
        )
        logger.info(
            "Apify API key loaded - actor IDs in use: instagram=%s tiktok=%s youtube=%s "
            "facebook=%s linkedin=%s threads=%s",
            INSTAGRAM_ACTOR, TIKTOK_ACTOR, YOUTUBE_ACTOR,
            FACEBOOK_ACTOR, LINKEDIN_ACTOR, THREADS_ACTOR,
        )

    if not settings.FIRECRAWL_API_KEY:
        logger.warning("FIRECRAWL_API_KEY is not set - website scraping during competitor discovery disabled.")
    else:
        logger.info("Firecrawl API key loaded - website scraping enabled.")

    if not settings.LOGO_DEV_API_KEY:
        logger.warning("LOGO_DEV_API_KEY is not set - competitor logo images will not be fetched.")
    else:
        logger.info("Logo.dev API key loaded - competitor logo fetching enabled.")

    if not settings.BRANDFETCH_API_KEY:
        logger.warning("BRANDFETCH_API_KEY is not set - Carousel Studio brand logo/colour extraction disabled.")
    else:
        logger.info("Brandfetch API key loaded - carousel brand scraping enabled.")

    if not settings.BRAND_DEV_API_KEY:
        logger.warning("BRAND_DEV_API_KEY is not set - Carousel Studio font detection disabled.")
    else:
        logger.info("Brand.dev API key loaded - carousel typography detection enabled.")

    yield  # server is running

    # --- Shutdown (add cleanup here if needed, e.g. close DB pools) ---
    logger.info("LEO API shutting down.")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="LEO - Brand Marketing Co-pilot",
    description="API for LEO: brand ingestion, conversational chat, and campaign generation.",
    version="0.1.0",
    lifespan=lifespan,
)

# Rate limiting - 60 req/min global, 10/min on AI routes (set per-route).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    logger.error("Unhandled exception on %s %s: %s\n%s", request.method, request.url.path, exc, tb)
    return JSONResponse(status_code=500, content={"detail": str(exc) or "Internal Server Error"})

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

# Allow the configured frontend origin plus any extra alias domains.
# In production, FRONTEND_URL should be the exact deployed origin.
_origins = [settings.FRONTEND_URL]
if settings.EXTRA_FRONTEND_URLS:
    _origins += [u.strip() for u in settings.EXTRA_FRONTEND_URLS.split(",") if u.strip()]
if settings.ENVIRONMENT == "development":
    _origins += ["http://localhost:3000", "http://127.0.0.1:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Stamp every request with a unique ID for log correlation.
# Must be added AFTER CORSMiddleware so it runs on the inner request.
app.add_middleware(RequestIdMiddleware)

# ---------------------------------------------------------------------------
# Routes - each router is scoped to its own prefix/tag set
# ---------------------------------------------------------------------------

app.include_router(projects.router)
app.include_router(chats.router)
app.include_router(stream.router)
app.include_router(ingestion.router)
app.include_router(brand_core.router)
app.include_router(billing.router)
app.include_router(assets.router)
app.include_router(campaigns.router)
app.include_router(generate.router)
app.include_router(members.router)
app.include_router(admin.router)
app.include_router(announcements.router)
app.include_router(intelligence.router)
app.include_router(content_ops.router)
app.include_router(content_studio.router)
app.include_router(templates.router)
app.include_router(planner.router)
app.include_router(analytics.router)
app.include_router(reports.router)
app.include_router(monitoring.router)
app.include_router(seo.router)
app.include_router(posts.router)
app.include_router(credits.router)
app.include_router(deep_search.router)
app.include_router(strategy.router)
app.include_router(carousel.router)
app.include_router(threads.router)
app.include_router(competitors.router)
app.include_router(personal_brand.router)
app.include_router(knowledge.router)
app.include_router(brand_audit.router)
app.include_router(competitor_digest.router)
app.include_router(templates.router_community)

# ---------------------------------------------------------------------------
# Health endpoints
# ---------------------------------------------------------------------------

@app.get("/", tags=["health"])
def root():
    """Liveness probe - returns service identity."""
    return {"status": "online", "service": "LEO API", "version": "0.1.0"}


@app.get("/health", tags=["health"])
def health():
    """Simple liveness check used by load balancers and uptime monitors."""
    return {"status": "ok"}


@app.get("/debug/config", tags=["health"])
def debug_config():
    """Shows which API keys are present (dev only). Values are NEVER exposed."""
    if settings.ENVIRONMENT == "production":
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=404, detail="Not found")

    def _status(val: str | None) -> str:
        return "SET" if val else "MISSING"

    return {
        "ANTHROPIC_API_KEY": _status(settings.ANTHROPIC_API_KEY),
        "OPENAI_API_KEY": _status(settings.OPENAI_API_KEY),
        "FIREBASE_PROJECT_ID": _status(settings.FIREBASE_PROJECT_ID),
        "EXA_API_KEY": _status(settings.EXA_API_KEY),
        "TAVILY_API_KEY": _status(settings.TAVILY_API_KEY),
        "SERPAPI_API_KEY": _status(settings.SERPAPI_API_KEY),
        "APIFY_API_KEY": _status(settings.APIFY_API_KEY),
        "FIRECRAWL_API_KEY": _status(settings.FIRECRAWL_API_KEY),
        "LOGO_DEV_API_KEY": _status(settings.LOGO_DEV_API_KEY),
        "YOUTUBE_API_KEY": _status(settings.YOUTUBE_API_KEY),
        "RESEND_API_KEY": _status(settings.RESEND_API_KEY),
        "STRIPE_SECRET_KEY": _status(settings.STRIPE_SECRET_KEY),
        "LLM_CHAT_MODEL": settings.LLM_CHAT_MODEL,
        "LLM_CLASSIFICATION_MODEL": settings.LLM_CLASSIFICATION_MODEL,
        "LLM_EXTRACTION_MODEL": settings.LLM_EXTRACTION_MODEL,
        "ENVIRONMENT": settings.ENVIRONMENT,
        "SENTRY_DSN": _status(settings.SENTRY_DSN),
    }


@app.get("/debug/cache", tags=["health"])
def debug_cache():
    """Shows in-process cache statistics (dev only)."""
    if settings.ENVIRONMENT == "production":
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=404, detail="Not found")
    from backend.services import cache_service
    return cache_service.stats()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
