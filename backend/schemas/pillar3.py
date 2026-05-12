"""
Pillar 3 - SEO & Organic Search request schemas.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class KeywordResearchRequest(BaseModel):
    seed_keywords: list[str] = Field(..., min_length=1, max_length=10)
    location_code: int = Field(2840, description="DataForSEO location code (2840 = US)")
    language_code: str = Field("en")
    limit: int = Field(50, ge=5, le=200)


class SerpIntentRequest(BaseModel):
    keyword: str = Field(..., min_length=1)
    location_code: int = Field(2840)
    language_code: str = Field("en")
    depth: int = Field(10, ge=5, le=30)


class OnPageSeoRequest(BaseModel):
    url: str = Field(..., min_length=4)
    target_keyword: Optional[str] = None


class FeaturedSnippetRequest(BaseModel):
    keyword: str = Field(..., min_length=1)
    your_content: Optional[str] = None  # existing content to rewrite
    location_code: int = Field(2840)
    language_code: str = Field("en")


class ContentFreshnessRequest(BaseModel):
    url: str = Field(..., min_length=4)
    keyword: str = Field(..., min_length=1)
    location_code: int = Field(2840)
    language_code: str = Field("en")


class TechnicalSeoRequest(BaseModel):
    url: str = Field(..., min_length=4)
    enable_javascript: bool = Field(True)


# ---------------------------------------------------------------------------
# Programmatic SEO
# ---------------------------------------------------------------------------

class ProgrammaticSeoRequest(BaseModel):
    template_type: str = Field(..., description="location_service | comparison | vs_competitor | use_case | industry_vertical | faq | long_tail")
    seed_keyword: str = Field(..., min_length=2, max_length=200, description="The core keyword pattern (e.g. 'CRM software for {industry}')")
    variables: list[str] = Field(..., min_length=1, max_length=50, description="The variable values to fill the template (e.g. list of industries)")
    product_name: str = Field(..., min_length=1, max_length=120)
    product_description: str = Field(..., min_length=20, max_length=500)
    num_examples: int = Field(5, ge=2, le=15, description="Number of example pages to generate")


# ---------------------------------------------------------------------------
# Link Building Outreach
# ---------------------------------------------------------------------------

class LinkBuildingRequest(BaseModel):
    your_url: str = Field(..., min_length=4, description="The page you want links to")
    your_domain: str = Field(..., min_length=2, max_length=120)
    link_angle: str = Field(..., min_length=10, max_length=300, description="Why should they link to you? What value does your content offer?")
    target_niches: list[str] = Field(..., min_length=1, max_length=5, description="Types of sites to target (e.g. 'SaaS blogs', 'marketing newsletters', 'VC firm blogs')")
    outreach_style: str = Field("resource_page", description="resource_page | guest_post | skyscraper | broken_link | digital_pr | unlinked_mention")
    num_prospects: int = Field(10, ge=3, le=25)
    your_name: str = Field("", description="Your first name for personalisation")
    your_title: str = Field("", description="Your role/title")


# ---------------------------------------------------------------------------
# Local SEO Management
# ---------------------------------------------------------------------------

class LocalSeoRequest(BaseModel):
    business_name: str = Field(..., min_length=2, max_length=120)
    business_category: str = Field(..., min_length=2, max_length=100, description="e.g. 'restaurant', 'dentist', 'law firm'")
    locations: list[str] = Field(..., min_length=1, max_length=10, description="Cities or areas to optimise for")
    primary_service: str = Field(..., min_length=5, max_length=200)
    current_issues: Optional[list[str]] = Field(None, max_length=5, description="Known problems: inconsistent NAP, missing citations, low reviews, etc.")
    competitors: Optional[list[str]] = Field(None, max_length=3, description="Local competitor names to benchmark against")


# ---------------------------------------------------------------------------
# International SEO
# ---------------------------------------------------------------------------

class InternationalSeoRequest(BaseModel):
    domain: str = Field(..., min_length=2, max_length=120)
    current_market: str = Field("US", description="Primary market you currently serve")
    target_markets: list[str] = Field(..., min_length=1, max_length=10, description="Countries/regions to expand into (e.g. 'UK', 'Germany', 'Japan')")
    content_strategy: str = Field("translate", description="translate | adapt | create_new")
    current_structure: str = Field("single_domain", description="single_domain | subdomain | subdirectory | ccTLD")
    top_keywords: Optional[list[str]] = Field(None, max_length=10, description="Your highest-traffic keywords in the current market")
