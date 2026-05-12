# Leo - Technical Overview
## Everything Built, Every API Used, and Upgrade Recommendations

> Last updated: March 2026

---

## Table of Contents

1. [Product Summary](#1-product-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Full Feature Inventory](#3-full-feature-inventory)
4. [Everything Built in This Session](#4-everything-built-in-this-session)
5. [All APIs & Services Used](#5-all-apis--services-used)
6. [Database Schema](#6-database-schema)
7. [API Upgrade Recommendations](#7-api-upgrade-recommendations)
8. [Missing Infrastructure Recommendations](#8-missing-infrastructure-recommendations)

---

## 1. Product Summary

**Leo** is an AI-powered brand marketing co-pilot. It combines a real-time streaming chat interface with a full suite of brand intelligence tools: competitor classification, content generation, brand voice scoring, campaign planning, SEO, and more.

The architecture is a **FastAPI (Python) backend** + **Next.js 15 (TypeScript/React) frontend**, with **Firebase/Firestore** as the primary database and **Claude** as the core LLM.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js 15 Frontend                      │
│  App Router · Zustand · shadcn/ui · Tailwind · Framer Motion   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ /api/backend proxy (rewrites)
┌───────────────────────────▼─────────────────────────────────────┐
│                       FastAPI Backend                           │
│  24 route modules · 20+ services · SlowAPI rate limiting       │
└──┬────────────┬────────────┬───────────┬────────────┬──────────┘
   │            │            │           │            │
Firebase   Anthropic     Exa.ai      Tavily      Stripe
Firestore  Claude API    Search      Search      Billing
Auth
   │            │            │           │            │
Apify      Firecrawl     Gemini      Resend    Cloudflare R2
Social     Web crawl     LLM/Image   Email     Asset storage
Scraping   Extraction    Generation
```

---

## 3. Full Feature Inventory

### Chat & Streaming
| Feature | Description |
|---|---|
| **Streaming chat** | Real-time SSE streaming via Claude with tool use (Exa + Tavily) |
| **Tool calling** | Web search, similar companies, topic research, brand news |
| **Thinking indicator** | Live status cards showing exactly what Leo is doing per step |
| **Status phases** | Pre-tool phases: "Analyzing request", "Loading brand context", "Thinking" |
| **Image attachments** | Upload images to chat (base64, max 5MB, JPEG/PNG/GIF/WebP) |
| **Channel selector** | Platform-aware prompting (Instagram, LinkedIn, X, TikTok, Meta Ads, Google Ads, Email) |
| **Message history** | Last 50 messages loaded per chat, last 20 used as LLM context |
| **Brand memory injection** | Last 15 feedback items injected into every system prompt |
| **Stop generation** | AbortController cancels mid-stream |
| **Regenerate** | Re-sends last user message for a fresh response |

### Brand Core
| Feature | Description |
|---|---|
| **Brand ingestion** | Multi-stage pipeline: Apify (social scraping) → Firecrawl (website crawl) → Gemini (NLP extraction) |
| **Brand Core editor** | Manual edit of tone, visuals, audience, messaging, themes, competitors |
| **Ingestion progress** | Live SSE stream of ingestion steps with % progress |
| **Brand voice scorer** | Scores any text A–F against Brand Core using Claude |
| **Brand drift detection** | Checks recent content for drift from Brand Core |

### Intelligence
| Feature | Description |
|---|---|
| **Competitor snapshots** | Scrape social + web presence, Claude analysis of tone/strategy/gaps |
| **Competitive strategy** | Full strategy plan: battlegrounds, action plan, quick wins |
| **Competitor deep report** | Per-competitor deep-dive report |
| **Competitor Profiles** | 5-dimension classification engine (built this session - see §4) |
| **Brand monitoring** | Real-time brand mention monitoring via Exa + Tavily |
| **AI insights** | Proactive 3–5 insights from memory + analytics + competitors |
| **Hashtag research** | Tiered hashtag strategy (mega/large/medium/niche) with Exa enrichment |

### Content Operations
| Feature | Description |
|---|---|
| **Content library** | Store, filter, tag, schedule, and manage generated content |
| **Content recycling** | Generate variants from existing content |
| **Content transformation** | Reframe same content from different angles |
| **Bulk generation** | Generate many content pieces at once |
| **Performance prediction** | Score content for hook strength, clarity, CTA, brand alignment |
| **Voice scoring** | Score library items against Brand Core, sort by score |

### Calendar & Publishing
| Feature | Description |
|---|---|
| **Content calendar** | Monthly/weekly calendar view, schedule content to dates |
| **Publish queue** | View and manage scheduled posts by day |

### Campaigns
| Feature | Description |
|---|---|
| **Campaign briefs** | AI-generated campaign brief from objective + audience + channels |
| **Content packs** | Per-platform captions + ad copy generated from brief |
| **Campaign status** | Track campaigns through draft → active → complete |

### Content Studio
| Feature | Description |
|---|---|
| **Email sequences** | Multi-email drip sequence generation |
| **Website copy** | Landing page sections, hero copy, CTAs |
| **Brand style guide** | Full style guide document generation |
| **SEO studio** | Keyword research, meta tags, blog post generation with SEO schema |
| **Image generation** | DALL-E 3 / Gemini Imagen 3 image generation |

### Analytics & Reports
| Feature | Description |
|---|---|
| **Content analytics** | Performance aggregation, platform breakdowns, trend charts |
| **Research reports** | Deep multi-source research reports with sections + citations |
| **Weekly digest** | Automated weekly intelligence digest |

### Teams & Admin
| Feature | Description |
|---|---|
| **Project members** | Invite members with roles: admin / editor / viewer |
| **Posts workstream** | Task-board for content work (Kanban-style with assignees) |
| **Templates** | Reusable prompt templates with placeholders |
| **Review workflow** | Approve/reject content with decision history |

### Billing & Auth
| Feature | Description |
|---|---|
| **Stripe billing** | Free / Pro / Agency tiers, subscription management |
| **Credit system** | Per-operation credit deduction (chat messages, ingestions, reports) |
| **Firebase Auth** | Email/password signup, JWT token verification on every request |
| **Rate limiting** | 60 req/min global, 10/min on AI routes |
| **Content moderation** | Auto-flag problematic content, admin review queue |

---

## 4. Everything Built in This Session

### 4a. Pre-tool Streaming Status Updates

**Problem:** The chat had no feedback between message send and first token - just silence.

**What was built:**
- Backend (`stream.py`) now emits 3 SSE status events before calling Claude:
  1. `{"type": "status", "message": "Analyzing your request"}`
  2. `{"type": "status", "message": "Loading brand context"}`
  3. `{"type": "status", "message": "Thinking"}`
- Added `StreamStatus` type to `types/index.ts`
- Added `onStatus` callback to `api.streamMessage()`
- `streamStatus` state in chat page drives the indicator

**Files changed:**
- `backend/api/routes/stream.py`
- `frontend/src/types/index.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/app/projects/[projectId]/chats/[chatId]/page.tsx`

---

### 4b. Competitor Profiles - 5-Dimension Classification Engine

**What was built:** A full end-to-end system to classify any competitor across 5 strategic dimensions using live web data + Claude.

#### The 5 Dimensions:
| Dimension | Output |
|---|---|
| **Geographic Scope** | Local / Regional / National / Global + detected locations |
| **Size & Revenue** | Micro / SMB / Mid-Market / Enterprise + employee count + revenue range |
| **Directness** | Direct / Indirect / Substitute + overlap score (Low/Medium/High) + reasoning |
| **Market Position** | Market Leader / Challenger / Niche Player / New Entrant + signals |
| **Customer Segment** | Tags: B2B, B2C, Enterprise, SMB, Premium, Budget, SaaS, FinTech, etc. |

#### How it works:
```
User inputs: name + website (optional)
     │
     ▼
6 parallel web searches (Exa + Tavily):
  ├── Website scrape (about, pricing, team)
  ├── Company firmographics (employees, funding, revenue)
  ├── Pricing & target customer signals
  ├── G2/Capterra reviews & alternatives
  ├── Market position (analyst reports, rankings)
  └── Recent news (90 days)
     │
     ▼
Claude (claude-sonnet-4-6)
  Input: all gathered data + brand core context
  Output: structured JSON classification
     │
     ▼
Saved to Firestore: competitor_profiles/{id}
     │
     ▼
SSE events stream to frontend in real-time
```

#### Backend files:
- `backend/services/competitor_classifier_service.py` - NEW: core classification engine
- `backend/services/firebase_service.py` - 5 new Firestore CRUD functions
- `backend/api/routes/intelligence.py` - 5 new endpoints

#### API endpoints added:
| Method | Path | Description |
|---|---|---|
| `POST` | `/projects/{id}/competitors/profiles/classify` | SSE streaming classification |
| `GET` | `/projects/{id}/competitors/profiles` | List all profiles |
| `GET` | `/projects/{id}/competitors/profiles/{profile_id}` | Get single profile |
| `DELETE` | `/projects/{id}/competitors/profiles/{profile_id}` | Delete profile |
| `POST` | `/projects/{id}/competitors/profiles/{profile_id}/refresh` | Re-classify |

#### Frontend files:
- `frontend/src/types/index.ts` - `CompetitorProfile`, `ClassifyStreamEvent`, dimension union types
- `frontend/src/lib/api.ts` - `api.competitorProfiles.{list, get, delete, classify, refresh}`
- `frontend/src/components/layout/sidebar.tsx` - "Competitor Profiles" nav item
- `frontend/src/app/projects/[projectId]/intelligence/profiles/page.tsx` - NEW premium page

#### Frontend page features:
- 3-column responsive card grid
- **Live "Analyzing" card** appears immediately while classification runs (skeleton with pulse)
- **Per-card action buttons**: refresh (re-classify) + delete (hover to reveal)
- **Slide-out detail panel** with full dimension breakdowns, evidence notes, signals, sources
- **Add Competitor modal** with live step-by-step SSE progress stream
- **Stats bar** in header: # profiled, # direct threats, # enterprise-scale competitors
- **Search** across competitor names
- Empty state with CTA

---

### 4c. ThinkingIndicator - Premium Tool/Status UI

**What was built:** `frontend/src/components/chat/thinking-indicator.tsx`

Replaced the old single-line pill with two distinct card designs:

**Tool-call card** (web_search, find_similar_companies, research_topic, get_brand_news):
- Leo avatar with tool-specific icon overlaid as a badge (colour-coded per tool)
- Actual search query shown in quotes
- Shimmer sweep animation bar at the bottom
- Each tool has its own accent colour (blue/violet/emerald/amber)

**Status card** (pre-tool phases):
- Leo avatar with pulsing orbit ring
- Icon changes based on message: brain (thinking), database (brand context), sparkles (default)
- Animated pulsing dots

---

### 4d. Premium MessageCard UI

**What was rebuilt:** `frontend/src/components/chat/message-card.tsx`

| Element | Before | After |
|---|---|---|
| User bubble | Grey secondary bg | `bg-primary` with `rounded-br-sm` tail, avatar right-aligned |
| Code blocks | Plain `bg-muted` block | Dark `#0d0d0d` bg, language badge, per-block copy button with green ✓ |
| Inline code | Basic styling | Subtle border + muted bg |
| Tables | Unstyled | Full borders, hover rows, uppercase tracking headers, rounded container |
| Lists (ul) | `list-disc list-inside` | Custom `bg-primary/60` dot marker, flex layout |
| Lists (ol) | Same as ul | Native counter preserved, proper `list-outside` |
| Blockquotes | Simple left border | Tinted bg + border, italic, rounded right |
| Links | Unstyled | `text-primary` + underline-offset + hover transition |
| Streaming cursor | Blinking block | Slim `3px` vertical bar with smooth opacity blink |
| Action bar | Small grey buttons | Polished `ActionButton` component, hover colour-coded, smooth transition |

---

## 5. All APIs & Services Used

### Core LLM

| Service | Purpose | Model Used | Docs |
|---|---|---|---|
| **Anthropic Claude** | Chat streaming, all AI generation, classification | `claude-sonnet-4-6` (chat/classify), `claude-opus-4-6` (complex tasks) | [docs.anthropic.com](https://docs.anthropic.com) |
| **Google Gemini** | Brand Core extraction from websites/social, image gen | `gemini-2.5-flash` (extraction), `imagen-3.0-generate-001` (images) | [ai.google.dev](https://ai.google.dev) |
| **OpenAI** | Image generation fallback | `dall-e-3` | [platform.openai.com](https://platform.openai.com) |

### Search & Research

| Service | Purpose | Notes |
|---|---|---|
| **Exa.ai** | Semantic search, similar company finding, news, RAG-style answers | Primary for company/semantic queries. Rate-limited: 100 searches/day, 5 research ops/day |
| **Tavily** | Web search + scrape + extract in one call | Primary for general queries. 200 searches/day limit. Returns LLM-ready content |
| **SerpAPI** | Raw SERP results for Deep Search feature | Used in `deep_search_service.py` |

### Data & Scraping

| Service | Purpose | Notes |
|---|---|---|
| **Apify** | Scrape Instagram, TikTok, Facebook, LinkedIn, YouTube | Used in brand ingestion pipeline for social profile extraction |
| **Firecrawl** | Website crawling + markdown extraction + LLM-based data extraction | Used for website Brand Core extraction |

### Database & Auth

| Service | Purpose | Notes |
|---|---|---|
| **Firebase Firestore** | Primary database for all domain objects | All sync Python SDK, wrapped in `asyncio.to_thread()` |
| **Firebase Auth** | User authentication, JWT token verification | Every request verifies an ID token |
| **Firebase Admin SDK** | Server-side Firestore and Auth operations | |

### Storage

| Service | Purpose | Notes |
|---|---|---|
| **Cloudflare R2** | Asset storage (uploaded images, generated images) | S3-compatible API. Includes R2 Data Catalog endpoint |

### Payments

| Service | Purpose | Notes |
|---|---|---|
| **Stripe** | Subscription management, metered billing | Free / Pro / Agency plans. Webhook-driven |

### Email

| Service | Purpose | Notes |
|---|---|---|
| **Resend** | Transactional emails | Used for invite emails, notifications |

### Social & Data APIs (configured, partially implemented)

| Service | Purpose |
|---|---|
| **YouTube Data API** | Channel analytics, video data |
| **Meta Graph API** | Facebook + Instagram business data |
| **Threads API** | Threads post data |
| **LinkedIn API** | Company + personal profile data |
| **TikTok API** | TikTok business account data |
| **X (Twitter) API v2** | Tweet data, engagement |

### Brand Intelligence

| Service | Purpose |
|---|---|
| **Logo.dev** | Company logo fetching by domain |

---

## 6. Database Schema

All stored in **Firebase Firestore**. Main collections:

```
users/{uid}
  └── billing, credits, adminOverrides, tier, suspended

projects/{projectId}
  ├── brandCore { tone, visual, themes, audience, tagline, messaging, competitors }
  ├── social URLs (instagram, facebook, tiktok, linkedin, youtube, x, threads, pinterest, snapchat)
  ├── model selections (contentModel, imageModel, videoModel, promptModel)
  └── members { uid → role }
  │
  ├── chats/{chatId}
  │   └── messages/{messageId}  { role, content, createdAt }
  │
  ├── competitor_snapshots/{slug}       ← social scrape + Claude analysis
  ├── competitor_profiles/{profileId}   ← 5-dimension classification (NEW)
  ├── memory/{feedbackId}               ← brand memory (edit/approve/reject/instruction)
  │
  ├── contentLibrary/{itemId}           { platform, type, content, status, tags, voice_score }
  ├── calendar/{entryId}                { date, time, platform, content, status }
  ├── templates/{templateId}
  ├── campaigns/{campaignId}            { brief, contentPacks, status }
  ├── performanceRecords/{recordId}
  ├── generatedImages/{imageId}
  ├── posts/{postId}                    ← workstream tasks
  ├── researchReports/{reportId}
  ├── monitorAlerts/{alertId}
  └── deepSearchResults/{resultId}

flaggedContent/{flagId}
announcements/{announcementId}
featureFlags/{flagId}
adminAuditLogs/{logId}
```

---

## 7. API Upgrade Recommendations

### 7a. Search & Research - HIGH PRIORITY

**Current:** Exa + Tavily with hard daily quotas (100 + 200 searches/day)

| Upgrade | Why | Cost |
|---|---|---|
| **Perplexity API** (sonar-pro) | Returns cited, LLM-synthesized answers. Better for competitor research questions where you want a direct answer, not raw results. Much cheaper per query than running a full Exa RAG call | ~$1/1000 searches |
| **Brave Search API** | No per-project quota. 2,000 free calls/month then very cheap. Good for general web search fallback | Free tier available |
| **You.com Research API** | Multi-step AI research with citations. Better structured output for the research_topic tool | ~$0.05/query |

**Recommendation:** Add Perplexity as a third search option for the `research_topic` tool. It's specifically designed for this use case and produces far better synthesised answers.

---

### 7b. Competitor Intelligence Data - HIGH PRIORITY

**Current:** Generic web search via Exa/Tavily for firmographic data (often inaccurate)

| Upgrade | Why | Cost |
|---|---|---|
| **Proxycurl API** | Real LinkedIn data: employee count, funding, HQ, founded year, specialities - all live from LinkedIn profiles. Single API call gives you most of Dimension 2 (Size & Revenue) with high confidence | ~$0.01/profile |
| **Clearbit / Apollo.io API** | Firmographic data: revenue estimates, tech stack, employee count, funding - from a curated B2B database. Much more reliable than inferring from web search | $99–$499/month |
| **Crunchbase API** | Funding rounds, investor data, valuation estimates, founding year, HQ | $299/month (basic) |
| **SimilarWeb API** | Traffic rank, monthly visits, bounce rate, audience demographics - the exact signals described in the 5-dimension spec | Enterprise pricing |
| **G2 API / Trustpilot API** | Review count and rating as a proxy for market penetration (Market Position dimension) | Contact for pricing |

**Recommendation:** Add Proxycurl for LinkedIn data. Even 1 call per competitor profile gives you verified employee count and founding year - two key classification signals that currently come from unreliable web search.

---

### 7c. Web Scraping - MEDIUM PRIORITY

**Current:** Firecrawl for website crawling

| Upgrade | Why | Cost |
|---|---|---|
| **Browserbase** | Headless Chrome with persistent sessions. Handles JS-heavy SPAs that Firecrawl can miss (competitor pricing pages often use React/Next.js) | ~$0.09/session |
| **ScrapingBee** | Handles CAPTCHAs, JS rendering, residential proxies. Better success rate on anti-bot pages | Pay-per-use |
| **Jina Reader API** (`r.jina.ai`) | Dead simple: `GET r.jina.ai/https://any-url.com` returns clean markdown. Zero config, free tier. Great for quick website reads in the classifier | Free / $20/month |

**Recommendation:** Add Jina Reader as a zero-config fallback when Firecrawl/Tavily extract fails. One HTTP GET, no SDK, instant markdown.

---

### 7d. LLM Strategy - MEDIUM PRIORITY

**Current:** `claude-sonnet-4-6` for everything

| Upgrade | Why |
|---|---|
| **Use `claude-haiku-4-5` for status checks & simple tasks** | The 3 pre-tool status SSE events, brand voice scoring, and hashtag research don't need Sonnet. Haiku is ~20x cheaper and 3x faster for simple operations |
| **Use `claude-opus-4-6` for competitor classification** | The 5-dimension classification is a high-stakes, nuanced task. Opus would produce materially better classifications than Sonnet, especially for Directness and Market Position judgements |
| **Add structured output / tool_use for classification** | Currently parsing Claude's JSON from free-text response. Use `tool_use` with a schema instead - eliminates JSON parsing errors entirely |

---

### 7e. Social Data - MEDIUM PRIORITY

**Current:** Apify scraping (fragile, can break when platforms change)

| Upgrade | Why | Cost |
|---|---|---|
| **Phyllo API** | Official social media data API (Instagram, YouTube, TikTok, LinkedIn, Twitter). Verified data with OAuth consent - no scraping. Gives you real engagement rates, follower history, content performance | Contact for pricing |
| **Modash API** | Influencer + brand social data API. Audience demographics, engagement rates, content history across all platforms | $299/month |
| **Brandwatch API** | Social listening + brand mentions + sentiment at scale | Enterprise |

**Recommendation:** Phyllo is the cleanest path for replacing Apify for brand ingestion. It's OAuth-based so users connect their own accounts and data is accurate.

---

### 7f. Image Generation - LOW PRIORITY

**Current:** DALL-E 3 + Gemini Imagen 3

| Upgrade | Why | Cost |
|---|---|---|
| **Replicate (Flux models)** | Flux 1.1 Pro produces noticeably better marketing creative than DALL-E 3. Much better at text-in-image, product photography style, and brand consistency | ~$0.04/image |
| **Fal.ai** | Fastest Flux inference (~2s). API wrapper around Flux, SDXL, LoRA fine-tuning. Better for real-time generation | ~$0.03/image |
| **Ideogram v2** | Best-in-class text rendering in images. If you need to generate social posts with readable text overlaid, Ideogram beats DALL-E 3 significantly | ~$0.08/image |

---

### 7g. Database & Caching - LOW PRIORITY

**Current:** Firestore only. No caching layer.

| Upgrade | Why |
|---|---|
| **Upstash Redis** | Add a Redis caching layer in front of search queries. The `SEARCH_CACHE_TTL_HOURS: 6` config already anticipates this but it's not implemented. Same search for the same competitor shouldn't cost 6 API calls every time. Upstash is serverless Redis with a generous free tier |
| **Firestore → Supabase (Postgres)** | Long-term: Firestore has no full-text search, no complex queries, and costly reads at scale. Supabase (Postgres + pgvector) would support semantic search on the content library, complex analytics queries, and be significantly cheaper at scale |

---

## 8. Missing Infrastructure Recommendations

### Observability
- **Sentry** - Add error tracking. Currently errors are just `console.error` / Python `logger.error`. Sentry would give you stack traces, user context, and release tracking. Free tier covers most use cases.
- **PostHog** - Product analytics. Track which features are actually used, funnel drop-offs, LLM cost per user, etc. Self-hostable with a generous cloud free tier.
- **Langfuse** - LLM observability specifically. Track every Claude call: latency, token count, cost, input/output. Essential for understanding which features are burning the most API budget.

### Performance
- **Next.js ISR / React Server Components** - The intelligence and library pages do all data fetching client-side. Moving heavy pages to RSC would improve initial load time significantly.
- **Streaming for non-chat responses** - The competitor classification already streams. Consider streaming for campaign generation and research reports too (currently they block for 10–20 seconds with no feedback).

### Security
- **Input validation on all text fields** - Most routes validate length but not content. Consider adding a lightweight abuse filter on the `user_message` field before it reaches Claude.
- **Webhook signature verification** - The Stripe webhook should verify `stripe-signature` headers. Confirm this is implemented in `stripe_service.py`.
- **API key rotation strategy** - Document a rotation procedure for the 15+ API keys in `.env`. Consider using a secrets manager (AWS Secrets Manager, Doppler, or Infisical) instead of a flat `.env` file.

### Cost Controls
- **Per-project LLM spend caps** - Currently rate-limited by message count but not by token spend. A heavy user sending long messages with large contexts could spend disproportionately. Add a monthly token budget per plan tier.
- **Search quota dashboard** - The `EXA_DAILY_SEARCH_LIMIT` and `TAVILY_DAILY_SEARCH_LIMIT` configs exist but there's no UI for admins to see current usage. Add to the admin dashboard.
- **Model fallback strategy** - If Anthropic API is down or rate-limited, fall back to `claude-haiku-4-5` or a Groq-hosted model (already have `GROQ_API_KEY` in config but unused) to maintain uptime.

---

## Summary Table - API Spend Priority

| API | Current Usage | Monthly Estimate | Priority to Optimise |
|---|---|---|---|
| Anthropic Claude | Every chat message, all generation | $$$ | High - add Haiku for cheap ops |
| Firebase Firestore | Every read/write | $$ | Medium - add Redis cache |
| Exa.ai | Search + research | $ | Low - quota managed |
| Tavily | Search + news | $ | Low - quota managed |
| Apify | Brand ingestion | $$ | Medium - replace with Phyllo |
| Firecrawl | Website crawl | $ | Low - add Jina as fallback |
| OpenAI DALL-E | Image generation | $ | Low - consider Flux via Replicate |
| Stripe | Billing | Fixed | N/A |
| Cloudflare R2 | Asset storage | $ | Low - cheapest option already |

---

*This document covers the codebase state as of March 2026. Architecture decisions may evolve.*
