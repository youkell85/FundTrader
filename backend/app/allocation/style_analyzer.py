"""Evidence-aware fund style analysis."""
from __future__ import annotations

from typing import Any

import numpy as np

from .models import EvidenceRef, FusionDataQuality


def analyze_style_profile(nav_data: list[dict[str, Any]], portfolio: dict[str, Any] | None) -> dict[str, Any]:
    """Infer style from NAV and holdings without inventing missing holdings labels."""
    evidence_refs: list[EvidenceRef] = []
    warnings: list[str] = []
    navs = [_to_float(row.get("nav")) for row in nav_data]
    navs = [value for value in navs if value is not None and value > 0]
    if len(navs) >= 60:
        returns = np.diff(navs) / np.asarray(navs[:-1], dtype=float)
        volatility = float(np.std(returns) * np.sqrt(252) * 100)
        period_return = float((navs[-1] - navs[0]) / navs[0] * 100)
        nav_style = {
            "volatility_bucket": _volatility_bucket(volatility),
            "return_bucket": _return_bucket(period_return),
            "volatility": round(volatility, 4),
            "period_return": round(period_return, 4),
        }
        evidence_refs.append(
            EvidenceRef(
                source="fund_nav_history",
                description=f"NAV-derived style using {len(navs)} valid observations.",
                confidence=0.75,
            )
        )
    else:
        nav_style = None
        warnings.append("NAV history has fewer than 60 valid observations; NAV style is missing.")

    holdings = (portfolio or {}).get("stock_holdings") or []
    industries = sorted({str(item.get("industry") or "").strip() for item in holdings if str(item.get("industry") or "").strip()})
    if industries:
        holding_style = {
            "industry_count": len(industries),
            "top_industries": industries[:5],
        }
        evidence_refs.append(
            EvidenceRef(
                source="portfolio_stock_holdings",
                description=f"Holding style derived from {len(holdings)} real holding rows.",
                confidence=0.8,
            )
        )
    else:
        holding_style = None
        warnings.append("Holdings have no industry evidence; holdings style is missing.")

    coverage = (1 if nav_style else 0) * 0.55 + (1 if holding_style else 0) * 0.45
    status = "real" if coverage >= 0.95 else "partial" if coverage > 0 else "missing"
    return {
        "status": status,
        "nav_style": nav_style,
        "holding_style": holding_style,
        "data_quality": FusionDataQuality(
            status=status,
            source="fund_nav_history+portfolio_stock_holdings",
            coverage=round(coverage, 4),
            confidence=0.8 if status == "real" else 0.55 if status == "partial" else 0,
            missing_reason="; ".join(warnings) if warnings else None,
            warnings=warnings,
        ).model_dump(),
        "evidence_refs": [ref.model_dump() for ref in evidence_refs],
        "warnings": warnings,
    }


def _volatility_bucket(volatility: float) -> str:
    if volatility >= 25:
        return "high_volatility"
    if volatility >= 15:
        return "medium_volatility"
    return "low_volatility"


def _return_bucket(period_return: float) -> str:
    if period_return >= 30:
        return "growth"
    if period_return >= 10:
        return "balanced"
    return "value_or_defensive"


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace("%", ""))
    except (TypeError, ValueError):
        return None
    return number if number == number else None
