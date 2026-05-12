"""
Pillar 5 - Email Marketing & CRM request schemas.
"""
from __future__ import annotations

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Email Sequence Builder
# ---------------------------------------------------------------------------

class EmailSequenceRequest(BaseModel):
    sequence_name: str = Field(..., min_length=1, max_length=120)
    goal: str = Field(..., description="e.g. onboarding, nurture, re-engagement, upsell, trial-to-paid")
    audience: str = Field(..., min_length=10, max_length=500)
    product_name: str = Field(..., min_length=1, max_length=120)
    product_description: str = Field(..., min_length=20, max_length=1000)
    num_emails: int = Field(5, ge=3, le=10)
    tone: str = Field("conversational", description="conversational | professional | urgent | warm")
    push_to_loops: bool = Field(False, description="Push the sequence to Loops.so if API key is configured")
    loops_list_id: Optional[str] = Field(None, description="Loops list ID to attach the sequence to")


# ---------------------------------------------------------------------------
# Subject Line Optimiser
# ---------------------------------------------------------------------------

class SubjectLineRequest(BaseModel):
    email_topic: str = Field(..., min_length=5, max_length=300)
    audience: str = Field(..., min_length=5, max_length=300)
    goal: str = Field("open_rate", description="open_rate | click_rate | reply_rate")
    num_variants: int = Field(5, ge=3, le=10)
    tone: str = Field("conversational", description="conversational | professional | urgent | playful | curious")
    avoid_spam_words: bool = Field(True)


# ---------------------------------------------------------------------------
# Send Time Optimiser
# ---------------------------------------------------------------------------

class SendTimeRequest(BaseModel):
    audience_description: str = Field(..., min_length=10, max_length=500)
    email_type: str = Field(
        "newsletter",
        description="newsletter | promotional | transactional | re-engagement | event",
    )
    timezone_focus: str = Field("US Eastern", description="Primary audience timezone")
    industry: Optional[str] = Field(None, max_length=100)
    existing_open_data: Optional[List[Dict[str, Any]]] = Field(
        None,
        description="Optional: list of {day: str, hour: int, open_rate: float} from past sends",
    )


# ---------------------------------------------------------------------------
# Newsletter Production
# ---------------------------------------------------------------------------

class NewsletterRequest(BaseModel):
    newsletter_name: str = Field(..., min_length=1, max_length=120)
    edition_topic: str = Field(..., min_length=5, max_length=300)
    audience: str = Field(..., min_length=10, max_length=500)
    sections: List[str] = Field(
        default_factory=lambda: ["intro", "main_story", "quick_hits", "tip_of_the_week", "cta"],
        description="Sections to include in this edition",
    )
    tone: str = Field("warm and insightful")
    source_urls: List[str] = Field(
        default_factory=list,
        description="Optional URLs to draw content from (Claude will summarise)",
        max_length=5,
    )
    push_to_loops: bool = Field(False)
    loops_list_id: Optional[str] = Field(None)


# ---------------------------------------------------------------------------
# Churn Risk Detection
# ---------------------------------------------------------------------------

class ContactEngagement(BaseModel):
    contact_id: str
    email: Optional[str] = None
    name: Optional[str] = None
    last_login_days_ago: Optional[int] = None
    last_email_open_days_ago: Optional[int] = None
    sessions_last_30d: Optional[int] = None
    features_used_last_30d: Optional[int] = None
    support_tickets_last_90d: Optional[int] = None
    subscription_days_remaining: Optional[int] = None
    plan: Optional[str] = None
    custom_signals: Optional[Dict[str, Any]] = None


class ChurnRiskRequest(BaseModel):
    contacts: List[ContactEngagement] = Field(..., min_length=1, max_length=200)
    product_name: str = Field(..., min_length=1, max_length=120)
    win_back_sequence: bool = Field(True, description="Also generate win-back email copy for at-risk contacts")


# ---------------------------------------------------------------------------
# Lead Scoring
# ---------------------------------------------------------------------------

class LeadSignal(BaseModel):
    contact_id: str
    email: Optional[str] = None
    name: Optional[str] = None
    company: Optional[str] = None
    job_title: Optional[str] = None
    company_size: Optional[str] = None
    industry: Optional[str] = None
    pages_visited: Optional[List[str]] = None
    content_downloaded: Optional[List[str]] = None
    emails_opened: Optional[int] = None
    demo_requested: Optional[bool] = None
    free_trial_started: Optional[bool] = None
    days_since_signup: Optional[int] = None
    hubspot_lifecycle_stage: Optional[str] = None
    custom_signals: Optional[Dict[str, Any]] = None


class LeadScoringRequest(BaseModel):
    leads: List[LeadSignal] = Field(..., min_length=1, max_length=100)
    product_name: str = Field(..., min_length=1, max_length=120)
    ideal_customer_profile: str = Field(..., min_length=20, max_length=500)
    push_scores_to_hubspot: bool = Field(False, description="Write scores back to HubSpot contacts if token configured")


# ---------------------------------------------------------------------------
# Win/Loss Analysis
# ---------------------------------------------------------------------------

class DealOutcome(BaseModel):
    deal_id: str
    outcome: str = Field(..., description="won | lost | churned | no_decision")
    product: Optional[str] = None
    competitor_chosen: Optional[str] = None
    deal_size: Optional[float] = None
    close_date: Optional[str] = None
    reason_given: Optional[str] = None
    sales_notes: Optional[str] = None
    survey_responses: Optional[Dict[str, str]] = None


class WinLossRequest(BaseModel):
    deals: List[DealOutcome] = Field(..., min_length=1, max_length=100)
    product_name: str = Field(..., min_length=1, max_length=120)
    date_range: Optional[str] = Field(None, description="e.g. 'Q1 2026' or 'Last 90 days'")


# ---------------------------------------------------------------------------
# Behavioral Trigger Automation
# ---------------------------------------------------------------------------

class BehavioralTriggerRequest(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=120)
    trigger_event: str = Field(..., description="e.g. 'visited pricing page', 'opened email 3x without clicking', 'went inactive for 30 days', 'trial day 7'")
    audience_context: str = Field(..., min_length=10, max_length=300, description="Who triggers this - segment, lifecycle stage, product usage")
    email_platform: str = Field("generic", description="loops | hubspot | mailchimp | klaviyo | generic")
    sequence_length: int = Field(3, ge=1, le=7, description="Number of emails in the sequence")
    conversion_goal: str = Field(..., description="What action should the recipient take: upgrade, book demo, re-engage, etc.")
    tone: str = Field("helpful and personal")


# ---------------------------------------------------------------------------
# Segmentation Engine
# ---------------------------------------------------------------------------

class SegmentationRequest(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=120)
    total_contacts: Optional[int] = Field(None, description="Total contacts in database")
    available_data: list[str] = Field(..., min_length=1, description="Data fields available: e.g. ['industry', 'company_size', 'signup_date', 'last_active', 'plan_type', 'country']")
    segmentation_goal: str = Field(..., description="e.g. 'identify expansion revenue candidates', 'find churn risks', 'personalise onboarding by role'")
    crm_platform: str = Field("generic", description="hubspot | salesforce | pipedrive | attio | generic")
    existing_segments: Optional[list[str]] = Field(None, max_length=10, description="Existing segments if any")


# ---------------------------------------------------------------------------
# List Hygiene Management
# ---------------------------------------------------------------------------

class ListHygieneRequest(BaseModel):
    list_size: int = Field(..., ge=1, description="Total number of contacts in your list")
    bounce_rate_pct: Optional[float] = Field(None, ge=0, le=100, description="Current bounce rate %")
    open_rate_pct: Optional[float] = Field(None, ge=0, le=100, description="Average open rate %")
    inactive_threshold_days: int = Field(180, ge=30, le=730, description="Days without engagement to flag as inactive")
    email_platform: str = Field("generic", description="loops | hubspot | mailchimp | klaviyo | generic")
    emails_to_verify: Optional[list[str]] = Field(None, max_length=100, description="Specific email addresses to verify via ZeroBounce")
    run_verification: bool = Field(False, description="Run ZeroBounce verification on provided emails")


# ---------------------------------------------------------------------------
# Deliverability Monitoring
# ---------------------------------------------------------------------------

class DeliverabilityRequest(BaseModel):
    domain: str = Field(..., min_length=2, max_length=120, description="Your sending domain")
    sending_volume_monthly: Optional[int] = Field(None, description="Monthly send volume")
    current_metrics: Optional[str] = Field(None, max_length=1000, description="Paste current metrics: open rate, bounce rate, spam complaints, inbox placement rate, etc.")
    email_platform: str = Field("generic", description="loops | hubspot | sendgrid | postmark | ses | generic")
    known_issues: Optional[list[str]] = Field(None, max_length=5, description="Known issues: high spam complaints, low inbox placement, SPF/DKIM failures, etc.")
    authentication_status: Optional[str] = Field(None, description="SPF/DKIM/DMARC status if known")


# ---------------------------------------------------------------------------
# CRM Enrichment
# ---------------------------------------------------------------------------

class CrmEnrichmentRequest(BaseModel):
    crm_platform: str = Field(..., description="hubspot | salesforce | pipedrive | attio | generic")
    record_type: str = Field("contact", description="contact | company | deal")
    sample_records: list[dict] = Field(..., min_length=1, max_length=20, description="Sample CRM records with known fields - Claude will identify what's missing and suggest enrichment")
    enrichment_goals: list[str] = Field(
        default_factory=lambda: ["company_size", "industry", "tech_stack", "funding_status", "decision_maker_title"],
        description="Data fields to enrich",
    )
    enrichment_sources: list[str] = Field(
        default_factory=lambda: ["Apollo", "Clearbit", "LinkedIn", "Crunchbase"],
        description="Preferred enrichment sources",
    )
