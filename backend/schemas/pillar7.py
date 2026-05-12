"""
Pillar 7 - Analytics & Reporting request schemas.

Already-built features NOT duplicated here:
  - Weekly Brand Health Report → reports.py
  - Competitive Benchmarking   → intelligence_service.py
  - Revenue Attribution         → pillar4/attribution_service.py (v2 multi-touch)
  - Content Analytics Overview  → analytics_service.py
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Unified Dashboard
# ---------------------------------------------------------------------------

class ChannelDataPoint(BaseModel):
    """Manual cross-channel data row when APIs are not configured."""
    channel: str = Field(..., description="e.g. 'organic_search', 'paid_social', 'email', 'direct'")
    sessions: Optional[int] = None
    conversions: Optional[int] = None
    revenue: Optional[float] = None
    impressions: Optional[int] = None
    clicks: Optional[int] = None
    spend: Optional[float] = None


class UnifiedDashboardRequest(BaseModel):
    date_range_days: int = Field(30, ge=7, le=365)
    goals: List[str] = Field(
        default_factory=lambda: ["traffic", "conversions", "revenue"],
        description="What metrics to focus on",
    )
    # Manual fallback when GA4/Meta not configured
    manual_channel_data: Optional[List[ChannelDataPoint]] = Field(
        None,
        description="Paste channel data manually if APIs are not connected",
    )
    include_meta: bool = Field(False, description="Pull Meta Ads Insights if META_ACCESS_TOKEN is set")
    meta_ad_account_id: Optional[str] = Field(None, description="Meta Ad Account ID (act_xxxxxxx)")


# ---------------------------------------------------------------------------
# Cohort Analysis
# ---------------------------------------------------------------------------

class CohortRow(BaseModel):
    cohort_name: str = Field(..., description="e.g. 'January 2026 signups'")
    initial_users: int
    week0: Optional[float] = Field(None, description="Retention % in week 0 (acquisition week)")
    week1: Optional[float] = None
    week2: Optional[float] = None
    week4: Optional[float] = None
    week8: Optional[float] = None
    week12: Optional[float] = None
    custom_periods: Optional[Dict[str, float]] = Field(
        None, description="Additional period labels → retention %"
    )


class CohortAnalysisRequest(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=120)
    cohorts: List[CohortRow] = Field(..., min_length=1, max_length=24)
    cohort_type: str = Field(
        "retention",
        description="retention | revenue | activation | feature_adoption",
    )
    business_context: Optional[str] = Field(
        None, max_length=400,
        description="e.g. 'We launched a new onboarding flow in February - check if it moved week2 retention'",
    )


# ---------------------------------------------------------------------------
# Funnel Conversion Analysis
# ---------------------------------------------------------------------------

class FunnelStep(BaseModel):
    name: str = Field(..., description="e.g. 'Homepage Visit', 'Sign Up', 'First Action', 'Paid'")
    users: int = Field(..., ge=0)
    drop_off_reasons: Optional[List[str]] = Field(
        None,
        description="Known or hypothesised reasons for drop-off at this step",
    )


class FunnelAnalysisRequest(BaseModel):
    funnel_name: str = Field(..., min_length=1, max_length=120)
    steps: List[FunnelStep] = Field(..., min_length=2, max_length=10)
    time_period: str = Field("last 30 days", description="Label for the time period")
    industry_benchmark: Optional[str] = Field(
        None,
        description="e.g. 'SaaS free-to-paid typically 3-5%' - Claude will compare against this",
    )
    goal_conversion_event: str = Field(
        "paid subscription",
        description="The ultimate conversion event (bottom of funnel)",
    )


# ---------------------------------------------------------------------------
# Anomaly Detection
# ---------------------------------------------------------------------------

class MetricTimeSeries(BaseModel):
    metric_name: str = Field(..., description="e.g. 'Daily Active Users', 'Conversion Rate', 'MRR'")
    unit: str = Field("count", description="count | percent | currency | rate")
    data_points: List[Dict[str, Any]] = Field(
        ...,
        description="List of {date: 'YYYY-MM-DD', value: number} objects",
        min_length=7,
    )


class AnomalyDetectionRequest(BaseModel):
    metrics: List[MetricTimeSeries] = Field(..., min_length=1, max_length=10)
    sensitivity: str = Field("medium", description="low | medium | high")
    business_context: Optional[str] = Field(
        None, max_length=400,
        description="Recent events that could explain data changes (e.g. 'launched new pricing on March 1')",
    )


# ---------------------------------------------------------------------------
# Forecasting Model
# ---------------------------------------------------------------------------

class ForecastMetric(BaseModel):
    metric_name: str
    unit: str = Field("count", description="count | percent | currency | rate")
    historical_data: List[Dict[str, Any]] = Field(
        ...,
        description="List of {period: 'YYYY-MM', value: number}",
        min_length=3,
    )


class ForecastingRequest(BaseModel):
    metrics: List[ForecastMetric] = Field(..., min_length=1, max_length=5)
    forecast_periods: int = Field(3, ge=1, le=12, description="Number of future periods to forecast")
    period_type: str = Field("month", description="month | week | quarter")
    growth_assumptions: Optional[str] = Field(
        None, max_length=400,
        description="Known factors: 'Hiring 3 SDRs in April', 'Launching in EU in Q3'",
    )
    scenarios: bool = Field(True, description="Generate base / optimistic / pessimistic scenarios")


# ---------------------------------------------------------------------------
# CAC + LTV Tracking
# ---------------------------------------------------------------------------

class AcquisitionChannel(BaseModel):
    channel: str
    new_customers: int = Field(..., ge=0)
    spend: float = Field(0.0, ge=0)


class CacLtvRequest(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=120)
    time_period: str = Field("last 90 days", description="Label for the reporting period")
    # Revenue inputs (manual - Stripe auto-pull if STRIPE_SECRET_KEY set)
    total_revenue: Optional[float] = Field(None, description="Total revenue in the period")
    new_customers: Optional[int] = Field(None, description="Total new customers in the period")
    churned_customers: Optional[int] = Field(None, ge=0)
    avg_subscription_value: Optional[float] = Field(None, description="Average MRR or ACV per customer")
    # Acquisition breakdown by channel
    acquisition_channels: Optional[List[AcquisitionChannel]] = Field(None)
    # Additional context
    avg_support_cost_per_customer: Optional[float] = Field(None)
    avg_onboarding_cost_per_customer: Optional[float] = Field(None)
    gross_margin_pct: Optional[float] = Field(None, ge=0, le=100)
    # Auto-pull toggles
    pull_from_stripe: bool = Field(False, description="Pull MRR/churn from Stripe if STRIPE_SECRET_KEY set")
    pull_from_hubspot: bool = Field(False, description="Pull deal data from HubSpot if HUBSPOT_ACCESS_TOKEN set")


# ---------------------------------------------------------------------------
# Board-Ready Reporting
# ---------------------------------------------------------------------------

class BoardMetric(BaseModel):
    name: str
    value: str = Field(..., description="The metric value as a string (e.g. '$1.2M', '23%', '1,450')")
    vs_prior_period: Optional[str] = Field(None, description="e.g. '+12%', '-3 pp'")
    context: Optional[str] = Field(None, description="Brief note on what drove this")


class BoardReportRequest(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=120)
    report_period: str = Field(..., description="e.g. 'Q1 2026', 'March 2026'")
    report_type: str = Field(
        "board_update",
        description="board_update | investor_update | exec_summary | monthly_review",
    )
    metrics: List[BoardMetric] = Field(..., min_length=1, max_length=20)
    wins: List[str] = Field(default_factory=list, max_length=10)
    challenges: List[str] = Field(default_factory=list, max_length=10)
    priorities_next_period: List[str] = Field(default_factory=list, max_length=10)
    narrative_context: Optional[str] = Field(
        None, max_length=1000,
        description="Free-text context for the narrative (strategy, market conditions, team updates)",
    )
    tone: str = Field("confident and data-driven", description="Report tone")
    include_appendix: bool = Field(True, description="Include detailed metrics appendix")


# ---------------------------------------------------------------------------
# Competitive Benchmarking
# ---------------------------------------------------------------------------

class CompetitiveBenchmarkingRequest(BaseModel):
    your_brand: str = Field(..., min_length=1, max_length=120)
    your_domain: str = Field(..., min_length=2, max_length=120)
    competitors: list[str] = Field(..., min_length=1, max_length=8, description="Competitor brand names")
    competitor_domains: Optional[list[str]] = Field(None, max_length=8, description="Competitor domains for traffic estimation")
    metrics_to_compare: list[str] = Field(
        default_factory=lambda: ["share_of_voice", "traffic_estimate", "keyword_overlap", "social_following", "domain_authority"],
        description="Metrics to include in the benchmark",
    )
    manual_data: Optional[str] = Field(None, max_length=2000, description="Paste any data you already have (follower counts, Semrush estimates, etc.)")
    benchmark_period: str = Field("last_quarter", description="Time period: last_month | last_quarter | last_year")
