"""
Competitor Classifier Service - 5-Dimension Intelligence Engine.

For each competitor it:
  1. Gathers raw data from public sources (Exa / Tavily web search)
  2. Feeds everything to Claude for structured classification
  3. Persists the result to Firestore under competitor_profiles
  4. Streams SSE progress events so the frontend stays live

The 5 dimensions classified:
  1. Geographic Scope      - Local / Regional / National / Global
  2. Size & Revenue        - Micro / SMB / Mid-Market / Enterprise
  3. Directness            - Direct / Indirect / Substitute
  4. Market Position       - Market Leader / Challenger / Niche Player / New Entrant
  5. Customer Segment      - Budget/Premium, B2B/B2C, Verticals, Demographics
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional

from backend.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_SEARCH_RESULTS = 6
# Classification is a structured JSON task - Haiku is sufficient and 5× cheaper.
_CLAUDE_MODEL = settings.LLM_CLASSIFICATION_MODEL

CLASSIFICATION_PROMPT = """\
You are a competitive intelligence analyst. Based on the data gathered below about a competitor,
classify them across exactly 5 dimensions. Output ONLY a valid JSON object - no markdown, no
explanation, no preamble - matching this exact schema:

{
  "geographic_scope": "Local" | "Regional" | "National" | "Global",
  "geographic_locations": ["list of detected office/market locations"],
  "geographic_evidence": "1-2 sentence reasoning",

  "size_tier": "Micro" | "SMB" | "Mid-Market" | "Enterprise",
  "employee_count": "estimated headcount string e.g. '50-200'",
  "revenue_range": "estimated revenue string e.g. '$5M-$20M'",
  "size_evidence": "1-2 sentence reasoning",

  "directness": "Direct" | "Indirect" | "Substitute",
  "directness_reason": "1-2 sentence explanation of the overlap",
  "overlap_score": "Low" | "Medium" | "High",

  "market_position": "Market Leader" | "Challenger" | "Niche Player" | "New Entrant",
  "market_position_signals": ["list of 2-4 supporting signals"],

  "customer_segment_tags": ["array of tags from: B2B, B2C, Enterprise, SMB, Micro, Freemium, Budget, Premium, SaaS, FinTech, HealthTech, EdTech, eCommerce, Retail, Agency, Startup, Consumer"],
  "segment_evidence": "1-2 sentence reasoning",

  "confidence_score": "Low" | "Medium" | "High",
  "sources_used": ["list of source URLs or source names used"],
  "executive_summary": "2-3 sentence competitive summary"
}

Size thresholds:
- Micro: <10 employees OR <$1M revenue
- SMB: 10–200 employees OR $1M–$10M revenue
- Mid-Market: 200–1,000 employees OR $10M–$100M revenue
- Enterprise: 1,000+ employees OR $100M+ revenue

Directness logic (relative to our brand described below):
- Direct = same product category + same target audience
- Indirect = different product but solves the same problem
- Substitute = replaces the need for our category entirely

Market position logic:
- Market Leader = highest traffic, most reviews, longest-standing, dominant
- Challenger = strong growth, actively competing for leader's customers
- Niche Player = focused on one segment, smaller but loyal user base
- New Entrant = founded <3 years, limited reviews, early-stage

Set confidence_score based on data richness:
- High: 4+ clear data signals per dimension
- Medium: 2-3 signals available
- Low: sparse data, heavy inference required

OUR BRAND CONTEXT:
{brand_context}

---

COMPETITOR: {competitor_name}
WEBSITE: {competitor_website}

GATHERED DATA:
{gathered_data}
"""


# ---------------------------------------------------------------------------
# Data gathering helpers
# ---------------------------------------------------------------------------

async def _search(query: str, project_id: Optional[str], num: int = _MAX_SEARCH_RESULTS) -> str:
    """Run a general web search, returns formatted text. Never raises."""
    try:
        from backend.services.integrations import tavily_client
        resp = await tavily_client.search_advanced(
            query=query, max_results=num, include_answer=True, project_id=project_id
        )
        parts = []
        if resp.get("answer"):
            parts.append(f"ANSWER: {resp['answer']}")
        for r in resp.get("results", [])[:num]:
            title = r.get("title", "")
            url   = r.get("url", "")
            snip  = r.get("content", "") or r.get("snippet", "")
            parts.append(f"• {title} ({url})\n  {snip[:300]}")
        return "\n".join(parts) or "No results."
    except Exception:
        pass
    try:
        from backend.services.integrations import exa_client
        results = await exa_client.search(
            query=query, num_results=num, include_highlights=True, project_id=project_id
        )
        parts = []
        for r in results[:num]:
            url = r.get("url", "")
            highlights = r.get("highlights", [])
            snip = highlights[0] if highlights else r.get("text", "")[:300]
            parts.append(f"• {r.get('title', '')} ({url})\n  {snip[:300]}")
        return "\n".join(parts) or "No results."
    except Exception:
        return "Search unavailable."


async def _scrape_website(url: str, project_id: Optional[str]) -> str:
    """Scrape the competitor's own website for key content. Never raises."""
    if not url:
        return ""
    try:
        from backend.services.integrations import tavily_client
        resp = await tavily_client.search_advanced(
            query=f"site:{url} about pricing team",
            max_results=3,
            include_raw_content=False,
            project_id=project_id,
        )
        parts = []
        for r in resp.get("results", [])[:3]:
            parts.append(f"Page: {r.get('url', '')}\n{r.get('content', '')[:400]}")
        return "\n\n".join(parts) or ""
    except Exception:
        return ""


async def _get_news(name: str, project_id: Optional[str]) -> str:
    """Get recent news about the competitor. Never raises."""
    try:
        from backend.services.integrations import exa_client
        results = await exa_client.search_news(
            query=f'"{name}"', num_results=4, days_back=90, project_id=project_id
        )
        parts = []
        for r in results[:4]:
            date = r.get("published_date", "")[:10]
            parts.append(f"• [{date}] {r.get('title', '')} - {r.get('url', '')}")
        return "\n".join(parts) or "No recent news found."
    except Exception:
        pass
    try:
        from backend.services.integrations import tavily_client
        resp = await tavily_client.search_news(
            query=f"{name} news funding revenue", days=90, max_results=4, project_id=project_id
        )
        parts = []
        for r in resp.get("results", [])[:4]:
            parts.append(f"• {r.get('title', '')} - {r.get('url', '')}")
        return "\n".join(parts) or "No recent news found."
    except Exception:
        return "News search unavailable."


# ---------------------------------------------------------------------------
# Main classification generator
# ---------------------------------------------------------------------------

async def classify_competitor(
    name: str,
    website: Optional[str],
    brand_core: dict,
    brand_name: str,
    project_id: str,
) -> AsyncGenerator[dict, None]:
    """
    Classify a competitor across 5 dimensions with live SSE progress events.

    Yields dicts:
      {"type": "step",     "step": str, "message": str}
      {"type": "complete", "profile": {...}}
      {"type": "error",    "message": str}
    """
    from backend.services import firebase_service
    from backend.services.llm_service import get_client

    # ------------------------------------------------------------------
    # 1. Create a pending profile in Firestore immediately so the
    #    frontend can show it while analysis runs.
    # ------------------------------------------------------------------
    pending = firebase_service.save_competitor_profile(project_id, {
        "competitor_name": name,
        "website": website or "",
        "status": "analyzing",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    })
    profile_id = pending["id"]

    yield {"type": "step", "step": "start", "message": f"Starting analysis for {name}", "profile_id": profile_id}

    try:
        # ------------------------------------------------------------------
        # 2. Gather raw data in parallel
        # ------------------------------------------------------------------
        yield {"type": "step", "step": "gathering", "message": "Searching public web sources"}

        website_str = website or ""
        name_q = name.strip()

        tasks = [
            _scrape_website(website_str, project_id),
            _search(f"{name_q} company overview employees revenue funding", project_id),
            _search(f"{name_q} pricing plans target customers", project_id),
            _search(f"{name_q} G2 Capterra reviews competitors alternatives", project_id),
            _search(f"{name_q} market position industry analyst Gartner Forrester", project_id),
            _get_news(name_q, project_id),
        ]

        yield {"type": "step", "step": "scraping", "message": "Scraping company website & review sites"}

        results = await asyncio.gather(*tasks, return_exceptions=True)

        website_content  = results[0] if not isinstance(results[0], Exception) else ""
        firmographics    = results[1] if not isinstance(results[1], Exception) else ""
        pricing_content  = results[2] if not isinstance(results[2], Exception) else ""
        reviews_content  = results[3] if not isinstance(results[3], Exception) else ""
        market_content   = results[4] if not isinstance(results[4], Exception) else ""
        news_content     = results[5] if not isinstance(results[5], Exception) else ""

        gathered_data = f"""
=== WEBSITE CONTENT ===
{website_content or 'Not available'}

=== COMPANY FIRMOGRAPHICS (employees, funding, revenue) ===
{firmographics or 'Not available'}

=== PRICING & TARGET CUSTOMERS ===
{pricing_content or 'Not available'}

=== REVIEWS & ALTERNATIVES (G2/Capterra) ===
{reviews_content or 'Not available'}

=== MARKET POSITION (analyst reports, rankings) ===
{market_content or 'Not available'}

=== RECENT NEWS (last 90 days) ===
{news_content or 'Not available'}
""".strip()

        # ------------------------------------------------------------------
        # 3. Build brand context summary for the prompt
        # ------------------------------------------------------------------
        brand_parts = []
        if brand_name:
            brand_parts.append(f"Brand name: {brand_name}")
        if brand_core.get("audience"):
            aud = brand_core["audience"]
            brand_parts.append(f"Target audience: {aud.get('demographics', '')} | Interests: {', '.join(aud.get('interests', []))}")
        if brand_core.get("messaging"):
            msg = brand_core["messaging"]
            brand_parts.append(f"Value proposition: {msg.get('valueProp', '')}")
        if brand_core.get("themes"):
            brand_parts.append(f"Core themes: {', '.join(brand_core['themes'])}")
        if brand_core.get("tone"):
            brand_parts.append(f"Brand tone: {brand_core['tone'].get('style', '')}")
        brand_context = "\n".join(brand_parts) or "Brand context not available."

        # ------------------------------------------------------------------
        # 4. Call Claude for structured classification
        # ------------------------------------------------------------------
        yield {"type": "step", "step": "classifying", "message": "Running 5-dimension AI classification"}

        client = get_client()

        # Escape curly braces in all user-provided data before calling .format().
        # Search results frequently contain JSON snippets like {"geographic_scope": ...}
        # which Python's str.format() misinterprets as format placeholders → KeyError.
        def _esc(s: str) -> str:
            return s.replace("{", "{{").replace("}", "}}")

        prompt = CLASSIFICATION_PROMPT.format(
            brand_context=_esc(brand_context),
            competitor_name=_esc(name),
            competitor_website=_esc(website_str or "unknown"),
            gathered_data=_esc(gathered_data),
        )

        response = await client.messages.create(
            model=_CLAUDE_MODEL,
            max_tokens=1500,  # complex JSON but bounded schema - 1500 is sufficient
            messages=[{"role": "user", "content": prompt}],
        )

        raw_text = response.content[0].text.strip()

        # Robust JSON extraction - handles fences, prose before/after, truncation
        def _extract_json(text: str) -> dict:
            import re as _re
            # Strip markdown code fences
            fence = _re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
            if fence:
                text = fence.group(1).strip()
            # Try direct parse
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass
            # Find outermost { ... }
            start = text.find("{")
            end   = text.rfind("}")
            if start != -1 and end > start:
                try:
                    return json.loads(text[start:end + 1])
                except json.JSONDecodeError:
                    pass
            raise ValueError(f"No valid JSON found in classifier response (len={len(text)})")

        classification = _extract_json(raw_text)

        # ------------------------------------------------------------------
        # 5. Persist the final profile
        # ------------------------------------------------------------------
        yield {"type": "step", "step": "saving", "message": "Saving competitor profile"}

        now = datetime.now(timezone.utc).isoformat()
        profile_data = {
            "id": profile_id,
            "competitor_name": name,
            "website": website_str,
            "status": "complete",
            "last_updated": now,
            # 5-dimension fields
            "geographic_scope":      classification.get("geographic_scope", "Unknown"),
            "geographic_locations":  classification.get("geographic_locations", []),
            "geographic_evidence":   classification.get("geographic_evidence", ""),
            "size_tier":             classification.get("size_tier", "Unknown"),
            "employee_count":        classification.get("employee_count", "Unknown"),
            "revenue_range":         classification.get("revenue_range", "Unknown"),
            "size_evidence":         classification.get("size_evidence", ""),
            "directness":            classification.get("directness", "Unknown"),
            "directness_reason":     classification.get("directness_reason", ""),
            "overlap_score":         classification.get("overlap_score", "Unknown"),
            "market_position":       classification.get("market_position", "Unknown"),
            "market_position_signals": classification.get("market_position_signals", []),
            "customer_segment_tags": classification.get("customer_segment_tags", []),
            "segment_evidence":      classification.get("segment_evidence", ""),
            "confidence_score":      classification.get("confidence_score", "Low"),
            "sources_used":          classification.get("sources_used", []),
            "executive_summary":     classification.get("executive_summary", ""),
        }

        saved = firebase_service.save_competitor_profile(project_id, profile_data)

        yield {"type": "complete", "profile": saved}

    except Exception as exc:
        logger.error("Competitor classification failed for %s: %s", name, exc)
        try:
            firebase_service.update_competitor_profile_status(
                project_id, profile_id, "error", error=str(exc)
            )
        except Exception:
            pass
        yield {"type": "error", "message": f"Classification failed: {exc}", "profile_id": profile_id}
