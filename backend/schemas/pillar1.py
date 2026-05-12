"""
Pydantic request/response schemas for Pillar 1 - Strategy & Planning features.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# ICP Builder
# ---------------------------------------------------------------------------

class ICPGenerateRequest(BaseModel):
    target_region: str = "Global"
    use_apollo: bool = True
    manual_segments: Optional[list[str]] = None
    industry_tags: Optional[list[str]] = None
    employee_ranges: Optional[list[str]] = Field(
        default=None,
        description="Apollo employee ranges, e.g. ['1,10', '11,50']",
    )


# ---------------------------------------------------------------------------
# GTM Strategy
# ---------------------------------------------------------------------------

class GTMGenerateRequest(BaseModel):
    product_name: str
    launch_date: Optional[str] = None
    budget: Optional[str] = None
    primary_channel: Optional[str] = None
    target_geography: str = "Global"


# ---------------------------------------------------------------------------
# Quarterly OKR Drafting
# ---------------------------------------------------------------------------

class OKRGenerateRequest(BaseModel):
    quarter: str = Field(..., description="e.g. 'Q3 2026'")
    company_goals: str
    team_focus: Optional[str] = None
    num_objectives: int = Field(default=3, ge=1, le=7)


# ---------------------------------------------------------------------------
# Budget Modelling
# ---------------------------------------------------------------------------

class BudgetModelRequest(BaseModel):
    total_budget: float = Field(..., gt=0)
    currency: str = "USD"
    duration_months: int = Field(default=3, ge=1, le=24)
    channels: list[str] = Field(..., min_length=1)
    fetch_live_benchmarks: bool = True


# ---------------------------------------------------------------------------
# Persona Generation
# ---------------------------------------------------------------------------

class PersonaGenerateRequest(BaseModel):
    segment_names: list[str] = Field(..., min_length=1)
    use_apollo: bool = True
    domains_for_enrichment: Optional[list[str]] = None


# ---------------------------------------------------------------------------
# Market Sizing
# ---------------------------------------------------------------------------

class MarketSizingRequest(BaseModel):
    market_description: str
    geography: str = "Global"
    methodology: str = "TAM-SAM-SOM"


# ---------------------------------------------------------------------------
# Positioning Workshop
# ---------------------------------------------------------------------------

class PositioningStartRequest(BaseModel):
    context: Optional[str] = None


class PositioningMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)


# ---------------------------------------------------------------------------
# Competitive Positioning Map
# ---------------------------------------------------------------------------

class CompMapGenerateRequest(BaseModel):
    competitors: list[str] = Field(..., min_length=1)
    x_axis: str = "Price"
    y_axis: str = "Features"


# ---------------------------------------------------------------------------
# Launch Planning
# ---------------------------------------------------------------------------

class LaunchPlanRequest(BaseModel):
    product_name: str
    launch_date: str = Field(..., description="ISO date, e.g. '2026-09-01'")
    channels: list[str] = Field(..., min_length=1)
    budget: Optional[str] = None
    target_audience: Optional[str] = None


# ---------------------------------------------------------------------------
# Risk Flagging
# ---------------------------------------------------------------------------

class RiskScanRequest(BaseModel):
    keywords: Optional[list[str]] = None
    include_competitor_signals: bool = True
