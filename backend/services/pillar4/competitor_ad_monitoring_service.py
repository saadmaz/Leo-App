"""Competitor Ad Monitoring - Claude SSE streaming."""
from __future__ import annotations
import json
import logging
from typing import AsyncGenerator
import anthropic
from backend.config import settings
from backend.schemas.pillar4 import CompetitorAdMonitoringRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)
def _sse(d: dict) -> str: return f"data: {json.dumps(d)}\n\n"

_SYSTEM = """\
You are LEO, a competitive intelligence specialist focused on paid advertising.

OUTPUT FORMAT - respond with ONLY a JSON object (no markdown fences):
{
  "monitoring_summary": "Overall competitive landscape in paid advertising",
  "competitor_profiles": [
    {
      "competitor": "Competitor name",
      "estimated_ad_spend": "High | Medium | Low (with estimate if available)",
      "primary_platforms": ["meta", "google"],
      "observed_angles": ["Pain point messaging", "ROI-focused", "Feature comparison"],
      "common_offers": ["Free trial", "Demo request", "Discount"],
      "creative_styles": ["Video testimonials", "Static product shots", "Comparison tables"],
      "target_audiences": ["SMB owners", "Marketing managers"],
      "key_messages": ["Their core value propositions"],
      "seasonal_patterns": "Any observed seasonal campaign patterns"
    }
  ],
  "alerts": [
    {
      "competitor": "Competitor name",
      "signal_type": "new_offer | price_change | new_platform | new_creative_angle | increased_spend",
      "description": "What was observed",
      "urgency": "high | medium | low",
      "recommended_response": "What you should do in response"
    }
  ],
  "whitespace_opportunities": ["Angles and audiences competitors are NOT targeting"],
  "counter_messaging": [
    {"competitor_claim": "Their claim", "your_counter": "How to counter it in your ads"}
  ],
  "creative_inspiration": ["Legitimate creative angles you could adapt for your brand"],
  "monitoring_cadence": "How often to check each platform and what to look for",
  "tools_for_ongoing_monitoring": ["Meta Ad Library", "Google Transparency Center", "SpyFu", "SimilarWeb"]
}
"""

async def generate(project: dict, body: CompetitorAdMonitoringRequest, project_id: str, owner_uid: str) -> AsyncGenerator[str, None]:
    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        doc = firebase_service.create_pillar1_doc(project_id, "competitor_ad_monitoring", owner_uid, f"Competitor Ads - {', '.join(body.competitors[:3])}")
        doc_id = doc["id"]
        yield _sse({"type": "research_step", "step": "monitoring", "label": f"Analysing ads from {len(body.competitors)} competitors…", "status": "running"})
        user_prompt = f"""Brand: {brand_name}\nProduct category: {body.your_product_category}\nCompetitors: {', '.join(body.competitors)}\nPlatforms: {', '.join(body.platforms)}\nAlert on: {', '.join(body.alert_on)}\n\nAnalyse competitor advertising strategies and surface actionable intelligence."""
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        assembled: list[str] = []
        async with client.messages.stream(model=settings.LLM_CHAT_MODEL, max_tokens=3000, system=_SYSTEM, messages=[{"role": "user", "content": user_prompt}]) as stream:
            async for text in stream.text_stream:
                assembled.append(text); yield _sse({"type": "delta", "content": text})
        raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
        try: payload = json.loads(raw)
        except: payload = {"raw": raw, "parse_error": True}
        firebase_service.update_pillar1_doc(project_id, doc_id, {"status": "complete", "payload": payload, "credits_spent": 20})
        yield _sse({"type": "research_step", "step": "monitoring", "label": "Competitor ad report ready", "status": "done"})
        yield _sse({"type": "competitor_ad_monitoring_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"
    return _stream()
