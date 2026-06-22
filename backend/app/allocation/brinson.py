"""Lightweight Brinson readiness and attribution diagnostics."""
from __future__ import annotations

from typing import Any

from .models import EvidenceRef, FusionDataQuality


def compute_brinson_attribution(portfolio: dict[str, Any] | None, industry_distribution: dict[str, Any]) -> dict[str, Any]:
    """Return missing when holdings or industries are unavailable."""
    holdings = (portfolio or {}).get("stock_holdings") or []
    industries = industry_distribution.get("items") or {}
    if not holdings or not industries or industry_distribution.get("dataStatus") == "missing":
        return {
            "status": "missing",
            "effects": [],
            "benchmark_status": "missing",
            "data_quality": FusionDataQuality(
                status="missing",
                source="portfolio_stock_holdings",
                coverage=0,
                confidence=0,
                missing_reason="Brinson attribution requires real holdings with industry fields.",
            ).model_dump(),
            "evidence_refs": [],
            "warnings": ["Brinson attribution not produced because holdings or industry evidence is missing."],
        }

    total_weight = sum(float(value or 0) for value in industries.values())
    effects = [
        {
            "industry": industry,
            "portfolio_weight": round(float(weight or 0), 4),
            "benchmark_weight": None,
            "allocation_effect": None,
            "selection_effect": None,
            "status": "partial",
            "missing_reason": "Benchmark industry weights are not available.",
        }
        for industry, weight in sorted(industries.items(), key=lambda item: item[1], reverse=True)
    ]
    coverage = min(1.0, total_weight / 100) if total_weight > 0 else 0
    return {
        "status": "partial",
        "effects": effects,
        "benchmark_status": "missing",
        "data_quality": FusionDataQuality(
            status="partial",
            source="portfolio_stock_holdings",
            coverage=round(coverage, 4),
            confidence=0.45,
            missing_reason="Industry holdings are available, but benchmark industry weights are missing.",
            warnings=["Allocation and selection effects are withheld until benchmark industry weights are available."],
        ).model_dump(),
        "evidence_refs": [
            EvidenceRef(
                source="portfolio_stock_holdings",
                description=f"{len(holdings)} real holding rows and {len(industries)} industry buckets reviewed.",
                confidence=0.65,
            ).model_dump()
        ],
        "warnings": ["Allocation and selection effects are withheld until benchmark industry weights are available."],
    }
