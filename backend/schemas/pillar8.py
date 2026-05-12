"""
Pillar 8 - PR & Communications request schemas.

Features:
  1. Press Release Writing     - Claude API
  2. Media List Building       - Hunter.io + Apify
  3. Pitch Email Generation    - Claude + Hunter
  4. Coverage Monitoring       - SerpAPI + Apify
  5. Crisis Communications     - Claude API
  6. Award Submissions         - Firecrawl + Claude
  7. Analyst Relations         - Firecrawl + Claude
  8. Partnership Comms         - Claude API
"""
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 1. Press Release Writing
# ---------------------------------------------------------------------------

class PressReleaseRequest(BaseModel):
    news_type: str = Field(..., description="e.g. 'product_launch', 'funding', 'partnership', 'milestone', 'executive_hire', 'award'")
    headline_topic: str = Field(..., description="The core announcement in one sentence")
    company_name: str = Field(..., description="Company name for the release")
    key_facts: List[str] = Field(..., description="Bullet facts to include - numbers, dates, names")
    quote_name: Optional[str] = Field(None, description="Name of the person being quoted")
    quote_title: Optional[str] = Field(None, description="Their title")
    quote_hint: Optional[str] = Field(None, description="What the quote should convey (Claude will draft it)")
    target_audience: Optional[str] = Field(None, description="Who will read this - tech press, trade media, investors…")
    embargo_date: Optional[str] = Field(None, description="Embargo date/time if applicable")
    boilerplate: Optional[str] = Field(None, description="Standard company boilerplate (About section). Claude will write one if omitted.")
    tone: str = Field("professional", description="professional | conversational | bold")


# ---------------------------------------------------------------------------
# 2. Media List Building
# ---------------------------------------------------------------------------

class MediaListRequest(BaseModel):
    industry: str = Field(..., description="Target industry or beat - e.g. 'B2B SaaS', 'fintech', 'climate tech'")
    news_angle: str = Field(..., description="What the story is about - used to find relevant journalists")
    geography: Optional[str] = Field(None, description="Target geography - e.g. 'US', 'UK', 'global'")
    publication_types: List[str] = Field(
        default_factory=lambda: ["tech press", "trade publications", "business media"],
        description="Types of publications to target",
    )
    num_contacts: int = Field(20, ge=5, le=50, description="Target number of contacts to build")
    verify_emails: bool = Field(True, description="Use Hunter.io to verify contact emails")


# ---------------------------------------------------------------------------
# 3. Pitch Email Generation
# ---------------------------------------------------------------------------

class PitchEmailRequest(BaseModel):
    journalist_name: str = Field(..., description="Journalist's full name")
    journalist_outlet: str = Field(..., description="Their publication or outlet")
    journalist_beat: Optional[str] = Field(None, description="What they cover - inferred from outlet if omitted")
    recent_article: Optional[str] = Field(None, description="A recent article title/URL they wrote - used to personalise")
    pitch_angle: str = Field(..., description="Your story angle - what makes this newsworthy for them")
    company_name: str = Field(..., description="Your company")
    news_hook: str = Field(..., description="The specific news hook or announcement")
    key_stats: Optional[List[str]] = Field(None, description="Compelling data points to include")
    exclusive_offer: bool = Field(False, description="Offer this journalist an exclusive")
    tone: str = Field("professional", description="professional | conversational | bold")


# ---------------------------------------------------------------------------
# 4. Coverage Monitoring
# ---------------------------------------------------------------------------

class CoverageMonitoringRequest(BaseModel):
    brand_name: str = Field(..., description="Primary brand/company name to monitor")
    keywords: List[str] = Field(default_factory=list, description="Additional keywords to track alongside brand name")
    include_reddit: bool = Field(True, description="Scrape Reddit via Apify")
    include_news: bool = Field(True, description="Search news via SerpAPI")
    days_back: int = Field(7, ge=1, le=30, description="How many days back to search")
    sentiment_filter: Optional[str] = Field(None, description="'positive' | 'negative' | 'neutral' | None (all)")


# ---------------------------------------------------------------------------
# 5. Crisis Communications
# ---------------------------------------------------------------------------

class CrisisCommsRequest(BaseModel):
    crisis_type: str = Field(..., description="e.g. 'data_breach', 'product_recall', 'executive_misconduct', 'negative_press', 'social_backlash', 'regulatory_action'")
    crisis_summary: str = Field(..., description="What happened - be factual and concise")
    severity: str = Field("medium", description="low | medium | high | critical")
    affected_stakeholders: List[str] = Field(
        default_factory=lambda: ["customers", "media", "employees"],
        description="Who needs to be communicated with",
    )
    company_name: str = Field(..., description="Company name")
    company_response_so_far: Optional[str] = Field(None, description="Any response already given")
    facts_confirmed: Optional[List[str]] = Field(None, description="Confirmed facts you can state publicly")
    facts_unknown: Optional[List[str]] = Field(None, description="Things still being investigated")
    spokesperson_name: Optional[str] = Field(None, description="Spokesperson for the statement")
    spokesperson_title: Optional[str] = Field(None, description="Their title")


# ---------------------------------------------------------------------------
# 6. Award Submissions
# ---------------------------------------------------------------------------

class AwardSubmissionRequest(BaseModel):
    award_name: str = Field(..., description="Name of the award or programme")
    award_url: Optional[str] = Field(None, description="URL of the award page - Firecrawl will read submission criteria")
    award_category: Optional[str] = Field(None, description="Specific category being entered")
    company_name: str = Field(..., description="Company name")
    submission_angle: str = Field(..., description="The achievement or story you're entering for")
    key_achievements: List[str] = Field(..., description="Specific achievements, metrics, milestones to highlight")
    word_limit: Optional[int] = Field(None, ge=50, le=5000, description="Word limit if specified by the award")
    supporting_data: Optional[List[str]] = Field(None, description="Any data points / evidence to include")


# ---------------------------------------------------------------------------
# 7. Analyst Relations
# ---------------------------------------------------------------------------

class AnalystRelationsRequest(BaseModel):
    analyst_firm: str = Field(..., description="e.g. 'Gartner', 'Forrester', 'IDC', 'G2'")
    analyst_name: Optional[str] = Field(None, description="Specific analyst name if known")
    briefing_purpose: str = Field("introductory_briefing", description="introductory_briefing | product_update | inquiry_response | market_positioning")
    company_name: str = Field(..., description="Company name")
    product_name: str = Field(..., description="Product or solution being briefed")
    analyst_coverage_url: Optional[str] = Field(None, description="URL to their recent research/report - Firecrawl will read it")
    company_differentiation: List[str] = Field(..., description="Key differentiators vs. competitors")
    target_use_cases: List[str] = Field(..., description="Primary use cases or market segments")
    traction_metrics: Optional[List[str]] = Field(None, description="Customer, revenue, or growth metrics you can share")
    desired_outcome: Optional[str] = Field(None, description="What you want from this analyst relationship")


# ---------------------------------------------------------------------------
# 8. Partnership Communications
# ---------------------------------------------------------------------------

class PartnershipCommsRequest(BaseModel):
    comms_type: str = Field(..., description="'initial_outreach' | 'proposal' | 'announcement_draft' | 'joint_press_release'")
    your_company: str = Field(..., description="Your company name")
    partner_company: str = Field(..., description="Potential or existing partner company name")
    partnership_type: str = Field(..., description="e.g. 'technology integration', 'co-marketing', 'reseller', 'strategic alliance', 'OEM'")
    value_proposition: str = Field(..., description="What each side gets from the partnership")
    key_ask: Optional[str] = Field(None, description="Specific ask in the outreach or proposal")
    partner_contact_name: Optional[str] = Field(None, description="Partner contact if known")
    partner_contact_title: Optional[str] = Field(None, description="Their title")
    tone: str = Field("professional", description="professional | warm | bold")
    include_terms_outline: bool = Field(False, description="Include a high-level partnership terms outline")
