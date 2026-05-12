"""
Pillar 4 - Paid Advertising request schemas.
"""
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


AD_PLATFORMS = ["google_search", "google_display", "meta_feed", "meta_stories", "tiktok", "linkedin"]
AD_OBJECTIVES = ["awareness", "traffic", "leads", "sales", "app_installs"]


class AdBriefRequest(BaseModel):
    campaign_name: str = Field(..., min_length=1, max_length=120)
    objective: str = Field(..., description="One of: awareness, traffic, leads, sales, app_installs")
    target_audience: str = Field(..., min_length=10, max_length=500)
    platforms: List[str] = Field(..., min_length=1, max_length=6)
    daily_budget: str = Field(..., description="e.g. '$50/day' or '$1,500/month'")
    timeline: str = Field("30 days")
    product_name: str = Field(..., min_length=1, max_length=120)
    unique_selling_points: List[str] = Field(default_factory=list, max_length=5)
    landing_page_url: Optional[str] = Field(None, max_length=500)


class AdCopyRequest(BaseModel):
    platform: str = Field(..., description="One of: google_search, google_display, meta_feed, meta_stories, tiktok, linkedin")
    objective: str = Field(..., description="What the ad should drive (leads, sales, signups, etc.)")
    product_name: str = Field(..., min_length=1, max_length=120)
    product_description: str = Field(..., min_length=20, max_length=1000)
    target_audience: str = Field(..., min_length=10, max_length=500)
    tone: str = Field("professional", description="professional | casual | urgent | inspirational")
    num_variants: int = Field(3, ge=2, le=5)
    usp: List[str] = Field(default_factory=list, max_length=5)
    landing_page_url: Optional[str] = Field(None, max_length=500)


class RetargetingRequest(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=120)
    product_description: str = Field(..., min_length=20, max_length=1000)
    audience_segment: str = Field(
        ...,
        description="website_visitors | cart_abandoners | past_buyers | video_viewers | lead_nurture",
    )
    platforms: List[str] = Field(..., min_length=1, max_length=4)
    sequence_length: int = Field(5, ge=3, le=7, description="Number of touch points in the sequence")
    conversion_goal: str = Field(..., description="purchase | sign_up | demo_request | free_trial")


class ChannelMetrics(BaseModel):
    channel: str = Field(..., min_length=1)
    sessions: int = Field(0, ge=0)
    conversions: int = Field(0, ge=0)
    revenue: float = Field(0.0, ge=0)
    cost: float = Field(0.0, ge=0)


class AttributionRequest(BaseModel):
    date_range_days: int = Field(30, ge=7, le=365)
    channel_data: List[ChannelMetrics] = Field(
        default_factory=list,
        description="Manual channel metrics. Leave empty to pull from GA4 (if configured).",
    )
    conversion_goal: str = Field("purchase", description="The primary conversion event to attribute")
    currency: str = Field("USD", max_length=3)


# ---------------------------------------------------------------------------
# Audience Building
# ---------------------------------------------------------------------------

class AudienceBuildingRequest(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=120)
    target_description: str = Field(..., min_length=20, max_length=500, description="Who you're trying to reach")
    platform: str = Field(..., description="meta | google | linkedin | tiktok | pinterest")
    audience_type: str = Field("custom", description="custom | lookalike | interest | retargeting | crm_upload")
    crm_data_summary: Optional[str] = Field(None, max_length=500, description="Summary of your CRM data (size, industry breakdown, job titles, etc.)")
    existing_audience_size: Optional[int] = Field(None, description="Size of your seed audience for lookalike")
    budget: Optional[str] = Field(None, description="e.g. '$5,000/month' - used to size audience appropriately")


class BidStrategyRequest(BaseModel):
    campaign_name: str = Field(..., min_length=1, max_length=120)
    platform: str = Field(..., description="google | meta | linkedin | tiktok")
    objective: str = Field(..., description="leads | sales | traffic | brand_awareness | app_installs")
    current_bid_strategy: Optional[str] = Field(None, description="Current bidding approach (e.g. 'manual CPC', 'target CPA $45')")
    current_metrics: Optional[str] = Field(None, max_length=500, description="Paste current performance: CPA, ROAS, CTR, CPC, conversion rate")
    target_cpa: Optional[float] = Field(None, description="Target cost per acquisition in $")
    target_roas: Optional[float] = Field(None, description="Target return on ad spend (e.g. 3.5 = 350%)")
    monthly_budget: Optional[float] = Field(None, description="Monthly budget in $")
    campaign_maturity: str = Field("established", description="new | learning | established | mature")


class BudgetPacingRequest(BaseModel):
    campaigns: list[dict] = Field(..., min_length=1, max_length=20, description="List of {name, platform, monthly_budget, spent_to_date, days_elapsed, days_total, conversions, spend} dicts")
    pacing_period: str = Field("month", description="week | month | quarter")
    optimization_goal: str = Field("conversions", description="conversions | roas | cpa | impressions")
    reallocation_threshold_pct: int = Field(20, ge=5, le=50, description="Min % over/under pace to trigger reallocation")


class NegativeKeywordsRequest(BaseModel):
    campaign_name: str = Field(..., min_length=1, max_length=120)
    platform: str = Field("google", description="google | microsoft")
    campaign_type: str = Field("search", description="search | shopping | display")
    product_name: str = Field(..., min_length=1, max_length=120)
    product_description: str = Field(..., min_length=20, max_length=500)
    search_terms_report: Optional[str] = Field(None, max_length=5000, description="Paste your search terms report (terms + clicks + cost + conversions)")
    industry: Optional[str] = Field(None, max_length=100)
    existing_negatives: Optional[list[str]] = Field(None, max_length=50, description="Your current negative keyword list")


class CreativePerformanceRequest(BaseModel):
    platform: str = Field(..., description="meta | google | tiktok | linkedin | youtube")
    creatives: list[dict] = Field(..., min_length=2, max_length=30, description="List of {name, format, headline, ctr, cvr, spend, conversions, roas, impressions, age_days} dicts")
    optimization_goal: str = Field("conversions", description="conversions | roas | cpa | ctr | brand_awareness")
    budget_to_reallocate: Optional[float] = Field(None, description="Budget freed by pausing losers ($)")


class CompetitorAdMonitoringRequest(BaseModel):
    competitors: list[str] = Field(..., min_length=1, max_length=10, description="Competitor brand names")
    platforms: list[str] = Field(default_factory=lambda: ["meta", "google"], description="Platforms to monitor: meta | google | tiktok | linkedin")
    your_product_category: str = Field(..., min_length=5, max_length=200, description="Your product category to find relevant ads")
    alert_on: list[str] = Field(
        default_factory=lambda: ["new_offer", "price_change", "new_creative_angle", "new_platform"],
        description="What signals to flag",
    )
