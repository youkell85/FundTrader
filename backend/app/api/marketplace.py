"""Portfolio marketplace and builder API."""
from __future__ import annotations

from fastapi import APIRouter, Query

from ..allocation.model_portfolio import list_model_portfolios
from ..allocation.models import (
    ModelPortfolioListResponse,
    PortfolioBuildRequest,
    PortfolioBuildResponse,
)
from ..allocation.portfolio_builder import build_portfolio, list_portfolio_candidates

router = APIRouter(prefix="/marketplace", tags=["portfolio-marketplace"])


@router.get("/candidates")
async def portfolio_candidates(limit: int = Query(default=80, ge=1, le=300)):
    candidates, data_quality, evidence_refs = list_portfolio_candidates(limit=limit)
    return {
        "candidates": candidates,
        "data_quality": data_quality,
        "evidence_refs": evidence_refs,
        "warnings": [] if candidates else ["No active real fund candidates are available."],
    }


@router.post("/portfolio-build", response_model=PortfolioBuildResponse)
async def portfolio_build(request: PortfolioBuildRequest):
    return build_portfolio(request)


@router.get("/model-portfolios", response_model=ModelPortfolioListResponse)
async def model_portfolios(limit: int = Query(default=6, ge=1, le=20)):
    return list_model_portfolios(limit=limit)
