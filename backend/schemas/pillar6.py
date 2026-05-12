"""
Pillar 6 - Social Media request schemas (gap features only).

Already-built features that are NOT here:
  - Multi-Platform Scheduling   → personal_brand/ayrshare_service.py
  - Social Listening            → intelligence_service.py
  - Trend Detection             → intelligence_service.py
  - Hashtag Strategy            → intelligence_service.py
  - Social Ad Creative          → Carousel Studio
  - Platform Analytics          → personal_brand/analytics_service.py
  - Influencer Discovery        → intelligence_service.discover_influencers() (v1 only)
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Community Management
# ---------------------------------------------------------------------------

class ManualComment(BaseModel):
    """A comment pasted manually (fallback when Ayrshare pull is unavailable)."""
    comment_id: str = Field(default="", description="External ID or leave blank")
    author: str = Field(default="", description="Username / display name of commenter")
    platform: str = Field(..., description="instagram | twitter | facebook | linkedin | tiktok | threads")
    text: str = Field(..., min_length=1, max_length=2000)
    sentiment_hint: Optional[str] = Field(None, description="Optional: positive | neutral | negative | question")


class CommunityManagementRequest(BaseModel):
    reply_tone: str = Field(
        "warm, helpful, and on-brand",
        description="Tone for drafted replies (e.g. 'professional', 'playful', 'empathetic')",
    )
    # Ayrshare pull (optional - requires AYRSHARE_API_KEY + project profile)
    ayrshare_post_ids: Optional[List[str]] = Field(
        None,
        description="Ayrshare post IDs to pull live comments from via the API",
        max_length=10,
    )
    # Manual comment input (fallback or supplement)
    manual_comments: Optional[List[ManualComment]] = Field(
        None,
        description="Paste comments directly if not using Ayrshare pull",
        max_length=50,
    )
    brand_guidelines: Optional[str] = Field(
        None,
        max_length=500,
        description="Any brand-specific reply rules (e.g. 'never offer discounts in comments', 'always sign off with 👋')",
    )


# ---------------------------------------------------------------------------
# Social Proof Harvesting
# ---------------------------------------------------------------------------

class SocialProofRequest(BaseModel):
    brand_name: str = Field(..., min_length=1, max_length=120)
    keywords: List[str] = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Search terms - product name, brand handles, slogans, campaign tags",
    )
    platforms: List[str] = Field(
        default_factory=lambda: ["twitter", "instagram", "linkedin"],
        description="Platforms to search (used for Tavily/Exa web search framing)",
    )
    # User can also paste raw mentions/comments directly
    raw_mentions: Optional[List[str]] = Field(
        None,
        max_length=100,
        description="Paste raw mention/comment text if you have it already",
    )
    harvest_goal: str = Field(
        "testimonials",
        description="testimonials | ugc | sentiment | case_study_leads",
    )


# ---------------------------------------------------------------------------
# Employee Advocacy
# ---------------------------------------------------------------------------

class EmployeeAdvocacyRequest(BaseModel):
    topic: str = Field(
        ...,
        min_length=5,
        max_length=300,
        description="What this batch of posts is about (e.g. 'our new AI reporting feature launch')",
    )
    key_messages: List[str] = Field(
        ...,
        min_length=1,
        max_length=5,
        description="Brand talking points to weave in (e.g. 'saves 5 hrs/week', 'no code required')",
    )
    employee_persona: str = Field(
        ...,
        min_length=5,
        max_length=200,
        description="Describe the employee writing these posts (e.g. 'Senior Account Executive, 5 years in B2B SaaS, informal and curious')",
    )
    platforms: List[str] = Field(
        default_factory=lambda: ["linkedin", "twitter"],
        description="Target platforms for the posts",
    )
    num_posts: int = Field(5, ge=1, le=15, description="Posts to generate per platform")
    tone: str = Field(
        "authentic and personal",
        description="Writing tone (e.g. 'enthusiastic', 'thought-leader', 'storytelling')",
    )
    avoid_phrases: Optional[List[str]] = Field(
        None,
        max_length=10,
        description="Corporate phrases to avoid (e.g. 'synergy', 'best-in-class')",
    )
    push_to_ayrshare: bool = Field(
        False,
        description="Draft-push the first post per platform to Ayrshare for review",
    )
    ayrshare_profile_key: Optional[str] = Field(
        None,
        description="Ayrshare profile key of the employee's personal profile (if push_to_ayrshare=True)",
    )


# ---------------------------------------------------------------------------
# Multi-Platform Content Scheduling
# ---------------------------------------------------------------------------

class SchedulingRequest(BaseModel):
    content_pieces: list[dict] = Field(..., min_length=1, max_length=30, description="List of {title, content_type, platform, description, target_date_hint} dicts")
    planning_horizon_days: int = Field(30, ge=7, le=90)
    posting_frequency: Optional[str] = Field(None, description="e.g. '1x/day LinkedIn, 3x/week Twitter, 2x/week Instagram'")
    best_times: Optional[str] = Field(None, description="Known best posting times per platform")
    content_mix: Optional[str] = Field(None, description="Ratio guidance: e.g. '40% educational, 30% promotional, 30% engagement'")


# ---------------------------------------------------------------------------
# Platform-Native Content Adaptation
# ---------------------------------------------------------------------------

class ContentAdaptationRequest(BaseModel):
    source_content: str = Field(..., min_length=50, max_length=5000, description="The original content to adapt")
    source_platform: str = Field("generic", description="Original platform or format")
    target_platforms: list[str] = Field(..., min_length=1, max_length=6, description="Platforms to adapt for: linkedin | twitter | instagram | tiktok | facebook | youtube")
    core_message: Optional[str] = Field(None, max_length=200, description="The non-negotiable core message to preserve")
    preserve_hashtags: bool = Field(True)
    include_emoji: bool = Field(True)


# ---------------------------------------------------------------------------
# Social Listening
# ---------------------------------------------------------------------------

class SocialListeningRequest(BaseModel):
    brand_name: str = Field(..., min_length=1, max_length=120)
    keywords: list[str] = Field(..., min_length=1, max_length=15, description="Topics, products, slogans, and competitor names to monitor")
    platforms: list[str] = Field(
        default_factory=lambda: ["twitter", "reddit", "linkedin", "news"],
        description="Platforms to listen on",
    )
    days_back: int = Field(7, ge=1, le=30)
    sentiment_focus: Optional[str] = Field(None, description="'positive' | 'negative' | 'neutral' | None (all)")
    competitors: Optional[list[str]] = Field(None, max_length=5)


# ---------------------------------------------------------------------------
# Trend Detection
# ---------------------------------------------------------------------------

class TrendDetectionRequest(BaseModel):
    industry: str = Field(..., min_length=2, max_length=120)
    niche: Optional[str] = Field(None, max_length=200, description="More specific niche within the industry")
    platforms: list[str] = Field(
        default_factory=lambda: ["twitter", "reddit", "linkedin"],
        description="Platforms to scan for trends",
    )
    keywords_to_monitor: list[str] = Field(..., min_length=1, max_length=15)
    days_back: int = Field(7, ge=1, le=14)
    content_goal: str = Field("thought_leadership", description="thought_leadership | product_tie_in | community_engagement | newsjacking")


# ---------------------------------------------------------------------------
# Influencer Identification
# ---------------------------------------------------------------------------

class InfluencerRequest(BaseModel):
    niche: str = Field(..., min_length=2, max_length=200, description="Your industry niche or topic area")
    platforms: list[str] = Field(..., min_length=1, max_length=4, description="instagram | youtube | tiktok | linkedin | twitter | substack")
    audience_size: str = Field("mid_tier", description="nano (1k-10k) | micro (10k-100k) | mid_tier (100k-500k) | macro (500k-1M) | mega (1M+) | any")
    campaign_goal: str = Field(..., description="brand_awareness | product_launch | affiliate | content_collaboration | event_promotion")
    budget_range: Optional[str] = Field(None, description="e.g. '$500-$2000 per post'")
    must_have_traits: Optional[list[str]] = Field(None, max_length=5, description="Required traits: e.g. 'authentic reviews', 'B2B audience', 'female-led'")


# ---------------------------------------------------------------------------
# Social Ad Creative Production
# ---------------------------------------------------------------------------

class SocialAdCreativeRequest(BaseModel):
    platform: str = Field(..., description="meta | tiktok | linkedin | twitter | youtube | pinterest")
    ad_format: str = Field(..., description="single_image | carousel | video_script | story | collection")
    product_name: str = Field(..., min_length=1, max_length=120)
    product_description: str = Field(..., min_length=20, max_length=500)
    target_audience: str = Field(..., min_length=10, max_length=300)
    campaign_objective: str = Field("conversions", description="awareness | traffic | leads | conversions | retargeting")
    tone: str = Field("energetic", description="energetic | professional | emotional | humorous | urgent")
    num_variants: int = Field(3, ge=2, le=5)
    key_message: str = Field(..., min_length=10, max_length=200)
    offer: Optional[str] = Field(None, description="e.g. 'Free 14-day trial', '30% off this week'")


# ---------------------------------------------------------------------------
# Platform Analytics Aggregation
# ---------------------------------------------------------------------------

class PlatformAnalyticsRequest(BaseModel):
    platforms: list[str] = Field(..., min_length=1, max_length=8, description="Platforms to aggregate: linkedin | instagram | twitter | facebook | tiktok | youtube | pinterest")
    date_range: str = Field("last_30_days", description="last_7_days | last_30_days | last_90_days | custom")
    manual_data: Optional[list[dict]] = Field(None, max_length=10, description="Paste data per platform: {platform, followers, impressions, reach, engagements, clicks, top_posts}")
    goals: list[str] = Field(
        default_factory=lambda: ["engagement", "reach", "follower_growth"],
        description="Metrics to focus on",
    )


# ---------------------------------------------------------------------------
# Hashtag Strategy
# ---------------------------------------------------------------------------

class HashtagStrategyRequest(BaseModel):
    content_topic: str = Field(..., min_length=5, max_length=300, description="The content or campaign topic")
    platforms: list[str] = Field(..., min_length=1, max_length=4, description="instagram | twitter | linkedin | tiktok")
    industry: str = Field(..., min_length=2, max_length=100)
    goal: str = Field("reach", description="reach | niche_authority | community | trending | brand")
    audience_size: str = Field("growth_stage", description="new_account | growth_stage | established | large")
    competitor_hashtags: Optional[list[str]] = Field(None, max_length=10, description="Hashtags your competitors use")
