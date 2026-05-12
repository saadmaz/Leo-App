"""
Pillar 10 - Experimentation & Optimisation request schemas.

Features:
  1. A/B Test Design           - Claude API (pure LLM)
  2. Landing Page CRO          - Claude API (copy variants; user implements in VWO/Optimizely)
  3. Messaging Resonance       - Meta Ads API + Claude
  4. Email A/B Testing         - Loops/Brevo results + Claude analysis
  5. Experiment Log            - Firestore CRUD (native DB)
  6. Learning Propagation      - Claude reads experiment log, applies insights
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 1. A/B Test Design
# ---------------------------------------------------------------------------

class ABTestDesignRequest(BaseModel):
    what_to_test: str = Field(..., description="What you want to test - e.g. 'homepage hero headline', 'CTA button colour + copy', 'email subject line'")
    test_type: str = Field("copy", description="copy | layout | pricing | cta | audience | channel")
    business_goal: str = Field(..., description="What business outcome you're optimising for - e.g. 'increase trial signups', 'reduce bounce rate'")
    current_version: Optional[str] = Field(None, description="The current (control) version - describe or quote it")
    target_audience: Optional[str] = Field(None, description="Who will see the test")
    traffic_per_day: Optional[int] = Field(None, description="Estimated daily visitors / sends to the test surface")
    current_conversion_rate: Optional[float] = Field(None, ge=0, le=100, description="Current conversion rate % (e.g. 3.2)")
    minimum_detectable_effect: Optional[float] = Field(5.0, ge=0.5, le=50, description="Smallest lift % worth detecting (default 5%)")
    confidence_level: int = Field(95, description="Statistical confidence level (90 | 95 | 99)")
    num_variants: int = Field(2, ge=2, le=5, description="Number of variants including control")
    platform: Optional[str] = Field(None, description="Platform where the test runs - e.g. 'website', 'email', 'Meta Ads', 'Google Ads'")


# ---------------------------------------------------------------------------
# 2. Landing Page CRO
# ---------------------------------------------------------------------------

class LandingPageCRORequest(BaseModel):
    page_url: Optional[str] = Field(None, description="URL of the landing page (Firecrawl will read it if provided)")
    page_description: Optional[str] = Field(None, description="Describe the page if no URL - product, audience, current CTA")
    conversion_goal: str = Field(..., description="What action you want visitors to take - e.g. 'book a demo', 'start free trial'")
    current_headline: Optional[str] = Field(None, description="Current hero headline (Claude will generate variants)")
    current_cta: Optional[str] = Field(None, description="Current CTA text")
    target_audience: str = Field(..., description="Describe the ideal visitor")
    pain_points: Optional[List[str]] = Field(None, description="Known visitor pain points")
    num_variants: int = Field(3, ge=2, le=5, description="Number of copy variants to generate per section")
    sections_to_optimise: List[str] = Field(
        default_factory=lambda: ["hero_headline", "subheadline", "cta", "value_proposition"],
        description="Which sections to generate variants for",
    )


# ---------------------------------------------------------------------------
# 3. Messaging Resonance Testing
# ---------------------------------------------------------------------------

class MetaAdResultRow(BaseModel):
    """A single Meta Ads result row for a test variant."""
    variant_name: str = Field(..., description="e.g. 'Variant A - Pain-led headline'")
    ad_copy: Optional[str] = Field(None, description="The ad copy used")
    impressions: int = Field(0)
    clicks: int = Field(0)
    spend: float = Field(0.0)
    conversions: int = Field(0)
    ctr: Optional[float] = Field(None, description="Click-through rate % - calculated if not provided")
    cpc: Optional[float] = Field(None, description="Cost per click - calculated if not provided")
    cpa: Optional[float] = Field(None, description="Cost per acquisition - calculated if not provided")
    roas: Optional[float] = Field(None, description="Return on ad spend")


class MessagingResonanceRequest(BaseModel):
    test_name: str = Field(..., description="Name of the messaging test")
    test_objective: str = Field(..., description="What you were testing - e.g. 'pain-led vs benefit-led headline'")
    ad_results: List[MetaAdResultRow] = Field(..., min_length=2, description="Results from each variant")
    audience_description: Optional[str] = Field(None, description="Who saw these ads")
    budget_spent: Optional[float] = Field(None, description="Total budget spent across all variants")
    test_duration_days: Optional[int] = Field(None, ge=1)
    fetch_live_data: bool = Field(False, description="If True, attempt to pull fresh data via Meta Ads API")
    meta_ad_account_id: Optional[str] = Field(None, description="Meta Ad Account ID (act_xxxxxxx) for live fetch")
    meta_campaign_id: Optional[str] = Field(None, description="Campaign ID to fetch insights for")


# ---------------------------------------------------------------------------
# 4. Email A/B Testing
# ---------------------------------------------------------------------------

class EmailVariantResult(BaseModel):
    variant_name: str = Field(..., description="e.g. 'Subject A - curiosity-driven'")
    subject_line: str
    preview_text: Optional[str] = None
    sends: int = Field(0)
    opens: int = Field(0)
    clicks: int = Field(0)
    conversions: int = Field(0)
    unsubscribes: int = Field(0)
    open_rate: Optional[float] = Field(None, description="Calculated if not provided")
    click_rate: Optional[float] = Field(None)
    conversion_rate: Optional[float] = Field(None)


class EmailABTestRequest(BaseModel):
    test_name: str = Field(..., description="Name of this email A/B test")
    campaign_type: str = Field("newsletter", description="newsletter | drip | promotional | transactional | re-engagement")
    test_element: str = Field("subject_line", description="What was tested: subject_line | preview_text | send_time | from_name | body_copy | cta")
    variant_results: List[EmailVariantResult] = Field(..., min_length=2)
    audience_segment: Optional[str] = Field(None, description="Which segment received this test")
    test_duration_hours: Optional[int] = Field(None, ge=1)
    winner_selection_metric: str = Field("open_rate", description="open_rate | click_rate | conversion_rate")
    fetch_from_loops: bool = Field(False, description="Attempt to fetch results from Loops.so API")
    loops_campaign_id: Optional[str] = Field(None, description="Loops campaign ID for live fetch")


# ---------------------------------------------------------------------------
# 5. Experiment Log - CRUD operations
# ---------------------------------------------------------------------------

class ExperimentLogCreate(BaseModel):
    name: str = Field(..., description="Experiment name")
    hypothesis: str = Field(..., description="What you believe will happen and why")
    test_type: str = Field("copy", description="copy | layout | pricing | audience | channel | feature")
    variants: List[Dict[str, Any]] = Field(..., description="List of variant descriptions")
    success_metric: str = Field(..., description="Primary metric to determine winner")
    secondary_metrics: Optional[List[str]] = Field(None)
    target_surface: str = Field(..., description="Where the test runs - e.g. 'homepage', 'onboarding email', 'Meta Ads'")
    sample_size_needed: Optional[int] = Field(None, description="Estimated sample size per variant")
    planned_duration_days: Optional[int] = Field(None)
    status: str = Field("planned", description="planned | running | concluded | archived")
    tags: Optional[List[str]] = Field(None)


class ExperimentLogUpdate(BaseModel):
    name: Optional[str] = None
    hypothesis: Optional[str] = None
    status: Optional[str] = None
    winner_variant: Optional[str] = None
    results_summary: Optional[str] = None
    learnings: Optional[str] = None
    lift_achieved: Optional[float] = Field(None, description="Percentage lift achieved by winner vs control")
    confidence_level_achieved: Optional[float] = Field(None, description="Statistical confidence achieved")
    concluded_at: Optional[str] = None
    tags: Optional[List[str]] = None


# ---------------------------------------------------------------------------
# 6. Learning Propagation
# ---------------------------------------------------------------------------

class LearningPropagationRequest(BaseModel):
    experiment_ids: Optional[List[str]] = Field(None, description="Specific experiment IDs to propagate learnings from. If omitted, uses all concluded experiments.")
    propagation_targets: List[str] = Field(
        default_factory=lambda: ["email", "landing_pages", "ad_copy", "onboarding"],
        description="Which content areas to apply learnings to",
    )
    context: Optional[str] = Field(None, description="Additional context about current campaigns or content")
    generate_action_plan: bool = Field(True, description="Generate a prioritised action plan alongside the learnings")
