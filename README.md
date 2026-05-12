# 🧠 Growth Intelligence Enginee

> **"Boardroom-level market insight in minutes."**

A multi-agent AI system that turns scattered internet signals into structured competitive intelligence - rendered as interactive artifacts inside a conversational interface.

---

## 📌 What Is This?

Growth teams spend weeks manually piecing together signals from ads, reviews, competitors, patents, and hiring data to produce a strategic brief. **Growth Intelligence Engine** compresses that into minutes.

Ask a question like:

> *"Is Vector Agents competitive in the AI SDR market right now?"*

And the system spawns **6 parallel AI agents**, collects live signals from the web, synthesises structured intelligence, and renders **interactive charts, scorecards, and briefs directly inside the chat** - all grounded in real sources with confidence scores.

---

## 🎯 Core Objectives

| Objective | Description |
|---|---|
| **Multi-Agent System** | 6+ coordinated specialist agents running in parallel |
| **Live Signals** | Real-time data from Reddit, HN, SerpAPI, G2, LinkedIn, and more |
| **Inline UI Artifacts** | Charts, scorecards, and tables rendered inside the conversation |
| **Structured Intelligence** | Every finding separates facts from interpretation |
| **Traceable Sources** | Every claim carries a source URL and confidence level |

---

## 🏗️ System Architecture

```
User Query
    │
    ▼
┌─────────────────────────────┐
│    Conversational UI        │  ← Next.js · Tailwind · shadcn/ui
│    (Chat Interface)         │
└────────────┬────────────────┘
             │  POST /api/intelligence (SSE Stream)
             ▼
┌─────────────────────────────┐
│       Orchestrator          │  ← Runs all agents via asyncio.gather / Promise.all()
└──┬──────┬──────┬──────┬─────┘
   │      │      │      │
   ▼      ▼      ▼      ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│Mkt   │ │Comp  │ │Win/  │ │Pric- │ │Posi- │ │Adj.  │
│Trend │ │Intel │ │Loss  │ │ing   │ │tion  │ │Threat│
│Agent │ │Agent │ │Agent │ │Agent │ │Agent │ │Agent │
└──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
   │         │        │        │        │        │
   └─────────┴────────┴────────┴────────┴────────┘
             │
             ▼
┌─────────────────────────────┐
│   Confidence Verifier       │  ← Normalises, downgrades weak claims, flags conflicts
└────────────┬────────────────┘
             ▼
┌─────────────────────────────┐
│      Synthesis Agent        │  ← Executive summary · Opportunities · Risks · Bets
└────────────┬────────────────┘
             ▼
┌─────────────────────────────┐
│   Structured JSON Response  │  → Rendered as inline artifacts in the UI
└─────────────────────────────┘
```

### Data Flow

1. User submits a strategic question via the chat interface
2. The orchestrator parses intent and spawns all 6 specialist agents simultaneously
3. Each agent calls the Anthropic API with web search tools and its own system prompt
4. Agents return structured JSON findings, evidence, and artifacts
5. The Confidence Verifier normalises scores and flags weak or conflicting claims
6. The Synthesis Agent merges everything into a strategic brief
7. The frontend streams agent status live, then renders interactive artifacts inline

---

## 🤖 Agent Roster

| Agent | Mission | Key Artifacts |
|---|---|---|
| **Market & Trend Agent** | Category growth signals, hiring trends, Google Trends proxies, funding news | `trend_timeline`, `signal_summary` |
| **Competitive Intelligence Agent** | Competitor mapping, feature launches, positioning shifts | `competitor_matrix`, `feature_comparison` |
| **Win/Loss Intelligence Agent** | Buyer voice from G2, Reddit, HN - what they love, hate, and switch for | `objection_map`, `buyer_pain_clusters` |
| **Pricing & Packaging Agent** | Pricing model detection, seat vs usage vs outcome, willingness-to-pay signals | `pricing_table`, `packaging_comparison` |
| **Positioning & Messaging Agent** | Ad copy analysis, landing page messaging, whitespace detection | `message_gap_heatmap`, `positioning_summary` |
| **Adjacent Market Agent** | Converging categories, platform encroachment, emerging substitutes | `threat_map`, `category_overlap` |
| **Confidence Verifier** | Inspects all findings, normalises confidence, detects contradictions | `confidence_summary` artifact |
| **Synthesis Agent** | Merges all outputs into a unified strategic brief | Full `FinalResponse` JSON |

---

## 🖥️ Frontend Interface

A premium AI SaaS interface inspired by Linear, Vercel, Perplexity, and Notion AI - but the entire experience lives inside a single conversation page.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Growth Intelligence Engine  ·  Boardroom-level insight in   │
│  minutes                                        [Switch Prod]│
├──────────────────┬───────────────────────────────────────────┤
│  AGENT STATUS    │                                           │
│                  │         CONVERSATION THREAD               │
│  ● Mkt Trend     │                                           │
│    running...    │   ┌─────────────────────────────────┐     │
│  ✓ Comp Intel    │   │  User: Is Vector Agents         │    │
│    done          │   │  competitive in AI SDR?          │    │
│  ○ Win/Loss      │   └─────────────────────────────────┘    │
│    queued        │                                           │
│  ○ Pricing       │   ┌─────────────────────────────────┐    │
│    queued        │   │  [COMPETITIVE SCORECARD]         │    │
│  ○ Positioning   │   │  [TREND CHART]                   │    │
│    queued        │   │  [STRATEGIC BRIEF]               │    │
│  ○ Adjacent      │   └─────────────────────────────────┘    │
│    queued        │                                           │
│                  │   ┌─ Follow-ups ───────────────────────┐  │
│                  │   │ [What should we build?] [Pricing?] │  │
│                  │   └────────────────────────────────────┘  │
│                  ├───────────────────────────────────────────┤
│                  │  Ask a growth intelligence question...   │
└──────────────────┴───────────────────────────────────────────┘
```

### Inline Artifact Components

| Component | Description |
|---|---|
| **Competitive Scorecard** | Table: Competitor · Positioning · Strengths · Weaknesses · Threat Level (colour-coded) |
| **Trend Chart** | Recharts `LineChart` showing category momentum; competitor funding events as markers |
| **Positioning Map** | 2×2 SVG scatter plot (Enterprise↔SMB × Automation↔Augmentation) with draggable dots |
| **Strategic Brief** | Sections: Executive Summary · Top 3 Opportunities · Top 3 Risks · Recommended Bets |
| **Source Trail** | Expandable source list per artifact - favicon, title, domain, timestamp, credibility colour |
| **Confidence Indicator** | Progress bar showing confidence percentage per insight |

### Design System

```
Background (primary):   #0f0f10  (charcoal black)
Background (secondary): #16171a  (dark grey)
Text:                   #f5f5f5  (pearl white)
Accent - positive:      #00ff9f  (laser green)
Accent - alert:         #ff2a2a  (laser red)

Typography: Geist or similar - clean, minimal, monospace-adjacent
Effects:    Glass panels · subtle gradients · soft shadows
```

---

## 🔧 Tech Stack

### Frontend
| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| Charts | Recharts |
| Animations | Framer Motion |
| Icons | Lucide |

### Backend
| Layer | Technology |
|---|---|
| Runtime | Python · FastAPI |
| Validation | Pydantic |
| Concurrency | asyncio |
| Agent Orchestration | LangGraph / asyncio.gather |
| AI Model | Anthropic Claude (`claude-opus-4-5`) |
| Web Search | Anthropic web_search tool (built-in) |

### Data Sources
| Source | Used By |
|---|---|
| SerpAPI / Google Search | Trend Agent, Competitive Agent |
| Reddit API | Win/Loss Agent, Sentiment |
| HackerNews Algolia | Market signals, product discussions |
| Firecrawl | Page scraping (pricing, messaging) |
| G2 / Capterra | Buyer voice, reviews |
| LinkedIn (inferred) | Hiring signals |

---

## 📁 Project Structure

```
.
├── frontend/                          # Next.js application
│   ├── app/
│   │   ├── page.tsx                   # Main conversational UI
│   │   └── api/
│   │       └── intelligence/
│   │           └── route.ts           # SSE streaming orchestrator endpoint
│   ├── agents/
│   │   ├── market.ts
│   │   ├── competitive.ts
│   │   ├── winloss.ts
│   │   ├── pricing.ts
│   │   ├── positioning.ts
│   │   ├── adjacent.ts
│   │   └── synthesiser.ts
│   ├── orchestrator.ts                # Runs all 6 agents in parallel, streams status
│   ├── components/
│   │   ├── ChatThread.tsx
│   │   ├── AgentStatusPanel.tsx
│   │   ├── QuestionChips.tsx
│   │   ├── ProductBar.tsx
│   │   └── artifacts/
│   │       ├── CompetitiveScorecard.tsx
│   │       ├── TrendChart.tsx
│   │       ├── PositioningMap.tsx
│   │       ├── StrategicBrief.tsx
│   │       └── SourceTrail.tsx
│   └── lib/
│       ├── anthropic.ts               # Shared client + web_search config
│       ├── cache.ts                   # Query result caching (1hr TTL)
│       └── types.ts                   # Shared TypeScript interfaces
│
└── backend/                           # Python FastAPI application
    ├── main.py
    ├── api/routes/
    │   └── query.py                   # POST /query endpoint
    ├── orchestrator/
    │   ├── orchestrator.py
    │   └── agent_registry.py
    ├── agents/
    │   ├── base_agent.py
    │   ├── market_trends_agent.py
    │   ├── competitive_agent.py
    │   ├── adjacent_threat_agent.py
    │   ├── win_loss_agent.py
    │   ├── pricing_agent.py
    │   ├── positioning_agent.py
    │   ├── confidence_verifier_agent.py
    │   └── synthesizer_agent.py
    ├── schemas/
    │   ├── query_schema.py
    │   ├── finding_schema.py
    │   ├── evidence_schema.py
    │   ├── artifact_schema.py
    │   ├── agent_output.py
    │   ├── final_response.py
    │   └── memory_schema.py
    ├── memory/
    │   └── memory_manager.py
    ├── tools/
    │   ├── search_tools.py
    │   ├── scraper_tools.py
    │   └── signal_extractors.py
    ├── scripts/
    │   └── run_sample_query.py
    └── tests/
        ├── test_agents.py
        └── test_orchestrator.py
```

---

## 📐 Data Contracts

### Query Request
```json
{
  "query": "Is Vector competitive in the AI SDR market right now?",
  "company_name": "Vector Agents",
  "product_name": "Vector",
  "session_id": "demo-session-1",
  "context": {}
}
```

### Finding Schema
```typescript
type Finding = {
  id: string
  statement: string
  type: "fact" | "interpretation"
  confidence: "low" | "medium" | "high"
  rationale: string
  domain: string
  evidence_ids: string[]
}
```

### Evidence Schema
```typescript
type Evidence = {
  id: string
  source_type: string
  url: string
  title: string
  snippet: string
  collected_at: string
  entity: string
  tags: string[]
}
```

### Agent Output Schema
```typescript
type AgentOutput = {
  agent_name: string
  status: "success" | "partial" | "failed"
  findings: Finding[]
  evidence: Evidence[]
  artifacts: Artifact[]
  errors: string[]
}
```

### Final Response Schema
```typescript
type FinalResponse = {
  executive_summary: string
  findings: Finding[]
  facts: string[]
  interpretations: string[]
  evidence: Evidence[]
  artifacts: Artifact[]
  recommendations: string[]
  confidence_overview: Record<string, number>
  follow_up_questions: string[]
  agent_statuses: Record<string, "success" | "partial" | "failed">
}
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- `ANTHROPIC_API_KEY` environment variable set

### Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env.local
# Add ANTHROPIC_API_KEY to .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
uvicorn main:app --reload
```

API available at [http://localhost:8000](http://localhost:8000)

### Run a Sample Query (no frontend)

```bash
cd backend
python scripts/run_sample_query.py
```

---

## 🎬 Demo Scenario

The system is pre-loaded with three demo queries targeting **Vector Agents** (`vectoragents.ai`):

| # | Question |
|---|---|
| 1 | *"Is Vector Agents competitive in the AI SDR market right now?"* |
| 2 | *"Is the digital workers category accelerating or consolidating?"* |
| 3 | *"What should Vector build or reposition over the next 6 months?"* |

### Demo Flow (2 Minutes)

```
Step 1  →  User submits Question 1 via the chat interface

Step 2  →  Agent Status Panel lights up:
            [●] Market Trend Agent    running...
            [●] Competitive Agent     running...
            [○] Win/Loss Agent        queued

Step 3  →  Live signals appear in the feed:
            "Reddit discussion detected"
            "HN thread detected"
            "Job posting signal found"

Step 4  →  Artifacts render inline:
            📊 Trend Chart
            🏆 Competitor Scorecard
            📋 Strategic Brief

Step 5  →  Final synthesis:
            "SMB automation demand rising.
             Competitors focused on enterprise.
             Opportunity: reposition for SMB."
```

**Pitch line:**
> *"We built a system that turns scattered internet signals into boardroom-level growth intelligence in minutes."*

---

## ⚡ SSE Streaming Events

The `/api/intelligence` endpoint streams real-time status via Server-Sent Events:

```
event: agent_started     → { agent: "competitive" }
event: agent_complete    → { agent: "competitive", data: {...} }
event: synthesis_started → {}
event: synthesis_complete→ { data: FinalResponse }
```

---

## 💰 Cost & Performance

| Metric | Value |
|---|---|
| Estimated cost per query | ~$0.15–$0.40 |
| Agent parallelism | 6 simultaneous |
| Cache TTL | 1 hour (keyed by product + question hash) |
| Architecture | Stateless agents - horizontally scalable to serverless |

Cost estimate is displayed to the user after each query.

---

## 🛡️ Resilience

- **Graceful agent failure**: if one agent fails, the system continues with all others and marks that agent `"partial"` or `"failed"` in the response
- **API fallback**: cached results used if live APIs are unavailable
- **Confidence downgrading**: weak, unsupported claims are automatically downgraded by the Confidence Verifier

---

## 🔑 Key Technical Decisions

| Decision | Choice | Reason |
|---|---|---|
| Agent concurrency | `asyncio.gather` / `Promise.all()` | True parallelism, not sequential |
| AI model | `claude-opus-4-5` | Best-in-class reasoning + web_search tool |
| Streaming | Server-Sent Events | Simple, no WebSocket overhead |
| Storage | In-memory session store | Hackathon-feasible, no DB setup |
| Charts | Recharts | Composable, React-native, no config hell |

### What We Did NOT Build (intentionally)
- Authentication / user accounts
- Full database / persistent storage
- Complex scraping infrastructure
- Vector databases
- Separate dashboards

These would waste hackathon time without increasing judging score.

---

## 🧪 Testing

```bash
cd backend
pytest tests/test_agents.py
pytest tests/test_orchestrator.py
```

Tests verify:
- Each agent returns the expected `AgentOutput` shape
- The orchestrator runs all agents and collects outputs
- A single failing agent does not crash the system

---

## 📣 Pitch Points

1. **Multi-agent system** synthesising live growth signals in parallel
2. **Structured intelligence** with confidence scoring and source attribution
3. **Conversational interface** generating decision-ready artifacts inline

---

## 👥 Team Roles (6-Hour Build)

| Person | Responsibility |
|---|---|
| **Person 1** | Backend · FastAPI · Agent orchestration |
| **Person 2** | Frontend · Next.js · Chat UI · Artifact rendering |
| **Person 3** | Data integrations · Signal tools · API connections |

---
