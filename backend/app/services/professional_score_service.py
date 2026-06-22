"""Attach evidence-based professional scores without changing legacy analysis."""
from __future__ import annotations

from typing import Any

from ..allocation.brinson import compute_brinson_attribution
from ..allocation.professional_evaluation import build_professional_score
from ..allocation.style_analyzer import analyze_style_profile
from ..storage.database import FundDataStore
from . import professional_service as legacy


def augment_professional_analysis(code: str, base: dict[str, Any]) -> dict[str, Any]:
    """Append PR-06 score fields to the legacy /professional response."""
    nav_data = _safe_nav_data(code)
    portfolio = _safe_portfolio(code)
    asset_allocation = base.get("asset_allocation")
    if not isinstance(asset_allocation, dict):
        asset_allocation = legacy._analyze_asset_allocation(portfolio)
    industry_distribution = base.get("industry_distribution")
    if not isinstance(industry_distribution, dict):
        industry_distribution = legacy._analyze_industry_distribution(portfolio)

    brinson_attribution = compute_brinson_attribution(portfolio, industry_distribution)
    style_profile = analyze_style_profile(nav_data, portfolio)
    snapshot = FundDataStore.get_snapshot(code)
    professional_score = build_professional_score(
        code=code,
        name=str((snapshot or {}).get("name") or base.get("name") or ""),
        metrics={
            "annualized_return": ((base.get("nav_summary") or {}).get("period_return")),
            "sharpe_ratio": base.get("sharpe_ratio"),
            "max_drawdown": base.get("max_drawdown"),
            "volatility": base.get("volatility"),
        },
        snapshot=snapshot,
        asset_allocation=asset_allocation,
        industry_distribution=industry_distribution,
        style_profile=style_profile,
        brinson_attribution=brinson_attribution,
    )
    return {
        **base,
        "brinson_attribution": brinson_attribution,
        "style_profile": style_profile,
        "professional_score": professional_score.model_dump(),
    }


def _safe_nav_data(code: str) -> list[dict[str, Any]]:
    try:
        return legacy._get_nav_history_pro(code) or []
    except Exception:
        return []


def _safe_portfolio(code: str) -> dict[str, Any] | None:
    try:
        return legacy._get_portfolio_fusion(code)
    except Exception:
        return None
