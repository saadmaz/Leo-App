"""
Pydantic request/response schemas for Pillar 2 - Content Creation & Management.
"""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Headline A/B Variants
# ---------------------------------------------------------------------------

class HeadlineGenerateRequest(BaseModel):
    topic: str = Field(..., description="The topic, content piece title, or article summary")
    platform: str = Field(default="General", description="LinkedIn, Twitter/X, Email, YouTube, etc.")
    count: int = Field(default=5, ge=3, le=10)
    tone: Optional[str] = None


# ---------------------------------------------------------------------------
# Visual Brief Generation
# ---------------------------------------------------------------------------

class VisualBriefRequest(BaseModel):
    content_type: str = Field(..., description="social_post | blog_cover | ad | email_banner | thumbnail")
    description: str = Field(..., description="What this visual should communicate")
    platform: Optional[str] = None
    dimensions: Optional[str] = None   # e.g. "1080x1080", "1200x628"
    brand_tone: Optional[str] = None


# ---------------------------------------------------------------------------
# Video Script Writing
# ---------------------------------------------------------------------------

class VideoScriptRequest(BaseModel):
    topic: str
    duration_minutes: int = Field(default=3, ge=1, le=30)
    platform: str = Field(default="YouTube", description="YouTube | TikTok | LinkedIn | Instagram Reels")
    tone: Optional[str] = None
    include_broll: bool = True
    cta: Optional[str] = None


# ---------------------------------------------------------------------------
# Podcast Show Notes
# ---------------------------------------------------------------------------

class PodcastNotesRequest(BaseModel):
    audio_url: Optional[str] = Field(default=None, description="Public URL to audio file (mp3/mp4/wav/m4a)")
    transcript: Optional[str] = Field(default=None, description="Pre-existing transcript text")
    episode_title: Optional[str] = None
    speaker_names: Optional[list[str]] = None


# ---------------------------------------------------------------------------
# Content Quality Scoring
# ---------------------------------------------------------------------------

class QualityScoreRequest(BaseModel):
    content: str = Field(..., description="The full text content to score")
    platform: str = Field(default="General", description="LinkedIn | Twitter/X | Blog | Email | Instagram")
    content_type: str = Field(default="post", description="post | article | email | caption | ad_copy")


# ---------------------------------------------------------------------------
# Multilingual Adaptation
# ---------------------------------------------------------------------------

class TranslateRequest(BaseModel):
    content: str = Field(..., description="Source content to translate and adapt")
    source_lang: str = Field(default="EN", description="ISO 639-1 source language code")
    target_langs: list[str] = Field(..., min_length=1, description="e.g. ['ES', 'FR', 'DE', 'AR']")
    preserve_tone: bool = True


# ---------------------------------------------------------------------------
# Case Study Production
# ---------------------------------------------------------------------------

class CaseStudyRequest(BaseModel):
    client_name: str
    industry: str
    challenge: str = Field(..., description="The problem or challenge the client faced")
    solution: str = Field(..., description="How your product/service solved it")
    results: str = Field(..., description="Measurable outcomes, e.g. '40% revenue increase in 3 months'")
    testimonial: Optional[str] = None


# ---------------------------------------------------------------------------
# Content Gap Analysis
# ---------------------------------------------------------------------------

class ContentGapRequest(BaseModel):
    domain: str = Field(..., description="Your website domain, e.g. leoagent.online")
    competitor_domains: list[str] = Field(default_factory=list, description="Competitor domains to compare against")
    location_code: int = Field(default=2840, description="DataForSEO location code (2840=US)")
    language_code: str = Field(default="en")
    limit: int = Field(default=20, ge=5, le=50)


# ---------------------------------------------------------------------------
# Long-Form Content Generation
# ---------------------------------------------------------------------------

class LongFormRequest(BaseModel):
    content_type: str = Field(..., description="blog_post | whitepaper | ebook | guide | report")
    title: str = Field(..., min_length=5, max_length=200, description="Working title for the piece")
    topic: str = Field(..., min_length=10, max_length=500, description="What the content covers in detail")
    target_audience: str = Field(..., min_length=5, max_length=300)
    word_count: int = Field(1200, ge=500, le=5000, description="Target word count")
    tone: str = Field("professional", description="professional | conversational | authoritative | educational")
    key_points: Optional[list[str]] = Field(None, max_length=10, description="Must-cover points or arguments")
    target_keyword: Optional[str] = Field(None, description="Primary SEO keyword to optimise for")
    include_citations: bool = Field(False, description="Include placeholder citation markers")
    cta: Optional[str] = Field(None, description="Call-to-action at the end of the piece")


# ---------------------------------------------------------------------------
# Brand Voice Model
# ---------------------------------------------------------------------------

class BrandVoiceRequest(BaseModel):
    sample_content: list[str] = Field(..., min_length=1, max_length=10, description="Paste 1–10 content samples (posts, articles, emails) that represent the brand voice")
    content_types: Optional[list[str]] = Field(None, description="Types of content in the samples: blog, email, social, etc.")
    desired_voice_notes: Optional[str] = Field(None, max_length=500, description="Any specific voice guidance you want Claude to reinforce")


# ---------------------------------------------------------------------------
# Content Repurposing Engine
# ---------------------------------------------------------------------------

class RepurposeRequest(BaseModel):
    source_content: str = Field(..., min_length=100, max_length=10000, description="The long-form content to repurpose")
    source_type: str = Field("blog_post", description="blog_post | whitepaper | podcast_transcript | video_script | webinar_notes")
    target_formats: list[str] = Field(
        default_factory=lambda: ["linkedin_post", "twitter_thread", "email_newsletter", "short_video_script"],
        description="Desired output formats",
    )


# ---------------------------------------------------------------------------
# Content Calendar Management
# ---------------------------------------------------------------------------

class ContentCalendarRequest(BaseModel):
    planning_horizon_days: int = Field(90, ge=14, le=180, description="How many days out to plan")
    channels: list[str] = Field(
        default_factory=lambda: ["blog", "linkedin", "email", "twitter"],
        description="Content channels to plan for",
    )
    upcoming_events: Optional[list[str]] = Field(None, max_length=10, description="Product launches, events, seasons, holidays")
    content_pillars: Optional[list[str]] = Field(None, max_length=6, description="Core content themes (e.g. 'thought leadership', 'product tutorials', 'customer stories')")
    posting_frequency: Optional[str] = Field(None, description="e.g. 'daily LinkedIn, 2x/week blog, weekly email'")


# ---------------------------------------------------------------------------
# Thought Leadership Ghostwriting
# ---------------------------------------------------------------------------

class GhostwriteRequest(BaseModel):
    content_type: str = Field(..., description="linkedin_post | article | op_ed | twitter_thread | email_newsletter")
    executive_name: str = Field(..., min_length=2, max_length=100)
    executive_title: str = Field(..., min_length=2, max_length=100)
    executive_voice_sample: Optional[str] = Field(None, max_length=2000, description="Paste a sample of their previous writing to capture their voice")
    topic: str = Field(..., min_length=10, max_length=500, description="What they're writing about")
    key_argument: str = Field(..., min_length=10, max_length=500, description="Their main point or take")
    supporting_points: Optional[list[str]] = Field(None, max_length=5)
    target_audience: Optional[str] = Field(None, max_length=200)
    word_count: int = Field(600, ge=100, le=3000)
    tone: str = Field("authoritative and personal", description="Tone that matches this executive")


# ---------------------------------------------------------------------------
# Landing Page Copywriting
# ---------------------------------------------------------------------------

class LandingPageCopyRequest(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=120)
    product_description: str = Field(..., min_length=20, max_length=1000)
    target_audience: str = Field(..., min_length=10, max_length=300)
    primary_benefit: str = Field(..., description="The #1 thing the product does for the customer")
    secondary_benefits: Optional[list[str]] = Field(None, max_length=5)
    pain_points: Optional[list[str]] = Field(None, max_length=5, description="Problems the product solves")
    framework: str = Field("AIDA", description="AIDA | PAS | JTBD | before_after_bridge")
    cta_action: str = Field("Start free trial", description="Primary CTA button text")
    social_proof: Optional[list[str]] = Field(None, max_length=5, description="Key stats, quotes, or logos to mention")
    page_goal: str = Field("sign_up", description="sign_up | demo_request | purchase | download | contact")
