import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

# Resolve paths relative to this file's directory (backend/) so they work
# regardless of the CWD from which the server is launched.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV_FILE = os.path.join(_BACKEND_DIR, ".env")
_DEFAULT_SA_PATH = os.path.join(_BACKEND_DIR, "firebase-service-account.json")


class Settings(BaseSettings):
    # --- LLM Providers ---
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    OPENROUTER_API_KEY: Optional[str] = None
    NVIDIA_NIM_API_KEY: Optional[str] = None

    # --- Web Scraping & Crawling ---
    FIRECRAWL_API_KEY: Optional[str] = None
    APIFY_API_KEY: Optional[str] = None

    # --- Web Search & Research ---
    EXA_API_KEY: Optional[str] = None
    TAVILY_API_KEY: Optional[str] = None
    SERPAPI_API_KEY: Optional[str] = None

    # --- Pillar 2: Content Creation & Management ---
    DEEPL_API_KEY: Optional[str] = None          # Multilingual adaptation (free 500k/mo)
    DATAFORSEO_LOGIN: Optional[str] = None        # Content gap + Pillar 3 SEO
    DATAFORSEO_PASSWORD: Optional[str] = None     # Content gap + Pillar 3 SEO

    # --- Pillar 3: SEO & Organic Search ---
    GOOGLE_SEARCH_CONSOLE_CLIENT_ID: Optional[str] = None     # GSC API (free, OAuth2)
    GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: Optional[str] = None # GSC API (free, OAuth2)

    # --- Search Cost Controls ---
    EXA_DAILY_SEARCH_LIMIT: int = 100
    TAVILY_DAILY_SEARCH_LIMIT: int = 200
    EXA_RESEARCH_DAILY_LIMIT: int = 5
    SEARCH_CACHE_TTL_HOURS: int = 6

    # --- Social & Data APIs ---
    AYRSHARE_API_KEY: Optional[str] = None
    YOUTUBE_API_KEY: Optional[str] = None
    META_APP_ID: Optional[str] = None
    META_APP_SECRET: Optional[str] = None
    META_ACCESS_TOKEN: Optional[str] = None
    THREADS_APP_ID: Optional[str] = None
    THREADS_APP_SECRET: Optional[str] = None
    LINKEDIN_CLIENT_ID: Optional[str] = None
    LINKEDIN_CLIENT_SECRET: Optional[str] = None
    TIKTOK_CLIENT_KEY: Optional[str] = None
    TIKTOK_CLIENT_SECRET: Optional[str] = None
    X_BEARER_TOKEN: Optional[str] = None
    X_CLIENT_ID: Optional[str] = None
    X_CLIENT_SECRET: Optional[str] = None

    # --- PR & Communications ---
    HUNTER_API_KEY: Optional[str] = None   # Hunter.io - media list building & email verification ($49/mo)

    # --- CRM & Enrichment ---
    APOLLO_API_KEY: Optional[str] = None

    # --- Ad Platforms ---
    GOOGLE_ADS_DEVELOPER_TOKEN: Optional[str] = None
    GOOGLE_ADS_CUSTOMER_ID: Optional[str] = None

    # --- Pillar 4: Paid Advertising ---
    # GA4 Data API (free) - ads.google.com → Tools → API Centre for Ads keys
    # GA4: Google Cloud Console → Google Analytics Data API
    GA4_PROPERTY_ID: Optional[str] = None               # Numeric property ID (e.g. "123456789")
    GA4_SERVICE_ACCOUNT_KEY: Optional[str] = None       # Full service account JSON as a string

    # --- Pillar 5: Email Marketing & CRM ---
    # Loops.so - loops.so → Settings → API (free tier available)
    LOOPS_API_KEY: Optional[str] = None
    # ZeroBounce - zerobounce.net → Dashboard → API (100 free validations/mo)
    ZEROBOUNCE_API_KEY: Optional[str] = None
    # HubSpot - app.hubspot.com → Settings → Integrations → Private Apps (free CRM)
    HUBSPOT_ACCESS_TOKEN: Optional[str] = None

    # --- Brand Intelligence ---
    LOGO_DEV_API_KEY: Optional[str] = None
    BRANDFETCH_API_KEY: Optional[str] = None
    BRAND_DEV_API_KEY: Optional[str] = None

    # --- Storage (Cloudflare R2) ---
    CLOUDFLARE_R2_TOKEN: Optional[str] = None
    CLOUDFLARE_ACCOUNT_ID: Optional[str] = None
    CLOUDFLARE_R2_ACCESS_KEY_ID: Optional[str] = None
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: Optional[str] = None
    CLOUDFLARE_R2_BUCKET_NAME: Optional[str] = None
    CLOUDFLARE_R2_ENDPOINT: Optional[str] = None
    CLOUDFLARE_R2_PUBLIC_URL: Optional[str] = None  # Public bucket URL (pub-*.r2.dev)
    CLOUDFLARE_R2_CATALOG_URL: Optional[str] = None  # R2 Data Catalog endpoint
    CLOUDFLARE_R2_WAREHOUSE_NAME: Optional[str] = None  # R2 Data Catalog warehouse name

    # --- Email ---
    RESEND_API_KEY: Optional[str] = None

    # --- Payments ---
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_METER_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    STRIPE_PRO_PRICE_ID: Optional[str] = None
    STRIPE_AGENCY_PRICE_ID: Optional[str] = None

    # --- Firebase ---
    FIREBASE_PROJECT_ID: Optional[str] = None
    # Absolute path to the service account JSON - set via env var to override.
    FIREBASE_SERVICE_ACCOUNT_PATH: str = _DEFAULT_SA_PATH
    FIREBASE_PRIVATE_KEY: Optional[str] = None
    FIREBASE_CLIENT_EMAIL: Optional[str] = None

    # --- LLM Runtime Config ---
    # Model used for the conversational chat stream (streamed responses) - Claude.
    LLM_CHAT_MODEL: str = "claude-sonnet-4-6"
    # Model used for lightweight classification & scoring tasks - Haiku is 5× cheaper.
    LLM_CLASSIFICATION_MODEL: str = "claude-haiku-4-5-20251001"
    # Model used for one-shot brand extraction and campaign generation - Gemini.
    LLM_EXTRACTION_MODEL: str = "gemini-2.5-flash"
    # Imagen model used for image generation.
    GEMINI_IMAGE_MODEL: str = "imagen-3.0-generate-001"
    # Maximum tokens the LLM may generate in a single chat response.
    LLM_MAX_TOKENS: int = 4096
    # How many prior messages are included as context for each chat request.
    # Higher values improve coherence but increase cost. Cap at 40 for safety.
    LLM_CONTEXT_MESSAGES: int = 20

    # --- Pagination Limits ---
    # Hard caps on Firestore list queries. Raise these as the product scales
    # and after proper composite indexes are added.
    PROJECTS_LIMIT: int = 50
    CHATS_LIMIT: int = 50
    # How many messages are fetched when rendering a chat history page.
    MESSAGES_LOAD_LIMIT: int = 50

    # --- App Config ---
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"
    FRONTEND_URL: str = "http://localhost:3000"
    # Comma-separated list of additional allowed CORS origins (e.g. alias domains)
    EXTRA_FRONTEND_URLS: str = ""

    model_config = SettingsConfigDict(
        # Absolute path - works regardless of launch CWD.
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
