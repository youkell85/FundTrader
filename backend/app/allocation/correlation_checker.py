"""Correlation Constraint Checker — ensures portfolio diversification.

Checks that no pair of assets in the portfolio exceeds the maximum
allowed correlation threshold (default 0.85). High correlation between
assets reduces diversification benefits.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Tuple
import numpy as np

from .config import ASSET_CLASSES


@dataclass
class CorrelationPair:
    """A pair of assets with their correlation."""
    asset_a: str
    asset_b: str
    correlation: float
    exceeds_threshold: bool


@dataclass
class CorrelationCheckResult:
    """Result of correlation constraint check."""
    max_correlation: float
    max_pair: Tuple[str, str]
    threshold: float
    passed: bool
    violations: List[CorrelationPair]
    warnings: List[str]
    correlation_matrix: Dict[str, Dict[str, float]]


# Default correlation matrix (based on historical data approximation)
# This is a simplified version — in production, use rolling historical correlations
_DEFAULT_CORRELATIONS = {
    ("a_share_large", "a_share_small"): 0.82,
    ("a_share_large", "a_share_value"): 0.88,
    ("a_share_large", "a_share_growth"): 0.78,
    ("a_share_large", "hk_equity"): 0.55,
    ("a_share_large", "us_equity"): 0.35,
    ("a_share_large", "rate_bond"): -0.15,
    ("a_share_large", "credit_bond"): -0.05,
    ("a_share_large", "convertible"): 0.45,
    ("a_share_large", "money_fund"): 0.0,
    ("a_share_large", "gold"): -0.10,
    ("a_share_large", "commodity"): 0.10,
    ("a_share_large", "reits"): 0.40,
    ("a_share_large", "cash"): 0.0,
    ("a_share_small", "a_share_value"): 0.72,
    ("a_share_small", "a_share_growth"): 0.85,
    ("a_share_small", "hk_equity"): 0.50,
    ("a_share_small", "us_equity"): 0.30,
    ("a_share_small", "rate_bond"): -0.20,
    ("a_share_small", "credit_bond"): -0.10,
    ("a_share_small", "convertible"): 0.40,
    ("a_share_small", "money_fund"): 0.0,
    ("a_share_small", "gold"): -0.15,
    ("a_share_small", "commodity"): 0.05,
    ("a_share_small", "reits"): 0.35,
    ("a_share_small", "cash"): 0.0,
    ("a_share_value", "a_share_growth"): 0.65,
    ("a_share_value", "hk_equity"): 0.50,
    ("a_share_value", "us_equity"): 0.30,
    ("a_share_value", "rate_bond"): -0.10,
    ("a_share_value", "credit_bond"): 0.0,
    ("a_share_value", "convertible"): 0.40,
    ("a_share_value", "money_fund"): 0.0,
    ("a_share_value", "gold"): -0.05,
    ("a_share_value", "commodity"): 0.10,
    ("a_share_value", "reits"): 0.35,
    ("a_share_value", "cash"): 0.0,
    ("a_share_growth", "hk_equity"): 0.55,
    ("a_share_growth", "us_equity"): 0.40,
    ("a_share_growth", "rate_bond"): -0.15,
    ("a_share_growth", "credit_bond"): -0.05,
    ("a_share_growth", "convertible"): 0.45,
    ("a_share_growth", "money_fund"): 0.0,
    ("a_share_growth", "gold"): -0.10,
    ("a_share_growth", "commodity"): 0.05,
    ("a_share_growth", "reits"): 0.40,
    ("a_share_growth", "cash"): 0.0,
    ("hk_equity", "us_equity"): 0.60,
    ("hk_equity", "rate_bond"): -0.10,
    ("hk_equity", "credit_bond"): 0.0,
    ("hk_equity", "convertible"): 0.35,
    ("hk_equity", "money_fund"): 0.0,
    ("hk_equity", "gold"): -0.05,
    ("hk_equity", "commodity"): 0.10,
    ("hk_equity", "reits"): 0.40,
    ("hk_equity", "cash"): 0.0,
    ("us_equity", "rate_bond"): -0.20,
    ("us_equity", "credit_bond"): -0.05,
    ("us_equity", "convertible"): 0.30,
    ("us_equity", "money_fund"): 0.0,
    ("us_equity", "gold"): -0.10,
    ("us_equity", "commodity"): 0.15,
    ("us_equity", "reits"): 0.45,
    ("us_equity", "cash"): 0.0,
    ("rate_bond", "credit_bond"): 0.70,
    ("rate_bond", "convertible"): 0.10,
    ("rate_bond", "money_fund"): 0.30,
    ("rate_bond", "gold"): 0.15,
    ("rate_bond", "commodity"): -0.05,
    ("rate_bond", "reits"): 0.10,
    ("rate_bond", "cash"): 0.20,
    ("credit_bond", "convertible"): 0.25,
    ("credit_bond", "money_fund"): 0.20,
    ("credit_bond", "gold"): 0.10,
    ("credit_bond", "commodity"): 0.0,
    ("credit_bond", "reits"): 0.15,
    ("credit_bond", "cash"): 0.15,
    ("convertible", "money_fund"): 0.0,
    ("convertible", "gold"): -0.05,
    ("convertible", "commodity"): 0.10,
    ("convertible", "reits"): 0.30,
    ("convertible", "cash"): 0.0,
    ("money_fund", "gold"): 0.0,
    ("money_fund", "commodity"): 0.0,
    ("money_fund", "reits"): 0.0,
    ("money_fund", "cash"): 0.90,
    ("gold", "commodity"): 0.35,
    ("gold", "reits"): 0.10,
    ("gold", "cash"): 0.0,
    ("commodity", "reits"): 0.15,
    ("commodity", "cash"): 0.0,
    ("reits", "cash"): 0.0,
}

_ASSET_LABELS = {
    "a_share_large": "A股大盘", "a_share_small": "A股小盘",
    "a_share_value": "A股价值", "a_share_growth": "A股成长",
    "hk_equity": "港股", "us_equity": "美股",
    "rate_bond": "利率债", "credit_bond": "信用债", "convertible": "可转债",
    "money_fund": "货币基金", "gold": "黄金", "commodity": "商品",
    "reits": "REITs", "cash": "现金",
}


def get_correlation(asset_a: str, asset_b: str) -> float:
    """Get the correlation between two assets."""
    if asset_a == asset_b:
        return 1.0
    key = tuple(sorted([asset_a, asset_b]))
    return _DEFAULT_CORRELATIONS.get(key, 0.0)


def build_correlation_matrix(assets: List[str]) -> Dict[str, Dict[str, float]]:
    """Build a correlation matrix for a list of assets."""
    matrix = {}
    for a in assets:
        matrix[a] = {}
        for b in assets:
            matrix[a][b] = get_correlation(a, b)
    return matrix


def check_correlation_constraints(
    allocations: Dict[str, float],
    threshold: float = 0.85,
    min_weight: float = 0.01,
) -> CorrelationCheckResult:
    """Check correlation constraints for a portfolio.

    Args:
        allocations: Asset class -> weight (fraction, e.g. 0.15 for 15%)
        threshold: Maximum allowed correlation (default 0.85)
        min_weight: Minimum weight to consider an asset (default 1% as fraction)

    Returns:
        CorrelationCheckResult with violations and warnings
    """
    active_assets = [
        a for a, w in allocations.items()
        if w > min_weight
    ]

    if len(active_assets) < 2:
        return CorrelationCheckResult(
            max_correlation=0.0,
            max_pair=("", ""),
            threshold=threshold,
            passed=True,
            violations=[],
            warnings=["资产类别不足2个，无法计算相关性"],
            correlation_matrix={},
        )

    # Build correlation matrix
    corr_matrix = build_correlation_matrix(active_assets)

    # Find all pairs and check for violations
    violations = []
    max_corr = 0.0
    max_pair = ("", "")

    for i, a in enumerate(active_assets):
        for b in active_assets[i + 1:]:
            corr = get_correlation(a, b)
            if corr > max_corr:
                max_corr = corr
                max_pair = (a, b)
            if corr > threshold:
                violations.append(CorrelationPair(
                    asset_a=a,
                    asset_b=b,
                    correlation=corr,
                    exceeds_threshold=True,
                ))

    # Sort violations by correlation (highest first)
    violations.sort(key=lambda v: v.correlation, reverse=True)

    # Generate warnings
    warnings = []
    if violations:
        for v in violations:
            label_a = _ASSET_LABELS.get(v.asset_a, v.asset_a)
            label_b = _ASSET_LABELS.get(v.asset_b, v.asset_b)
            warnings.append(
                f"⚠ {label_a}与{label_b}相关性 {v.correlation:.2f} 超过阈值 {threshold}"
            )
    else:
        warnings.append(f"✓ 所有资产对相关性均低于 {threshold}")

    passed = len(violations) == 0

    return CorrelationCheckResult(
        max_correlation=max_corr,
        max_pair=max_pair,
        threshold=threshold,
        passed=passed,
        violations=violations,
        warnings=warnings,
        correlation_matrix=corr_matrix,
    )


def suggest_diversification(
    allocations: Dict[str, float],
    threshold: float = 0.85,
) -> List[str]:
    """Suggest ways to improve diversification.

    Returns a list of suggestions for reducing correlation.
    """
    result = check_correlation_constraints(allocations, threshold)
    suggestions = []

    if not result.passed:
        for v in result.violations:
            label_a = _ASSET_LABELS.get(v.asset_a, v.asset_a)
            label_b = _ASSET_LABELS.get(v.asset_b, v.asset_b)
            suggestions.append(
                f"考虑降低{label_a}或{label_b}的配比（当前相关性 {v.correlation:.2f}）"
            )
            suggestions.append(
                f"可增配与两者相关性较低的资产（如黄金、利率债等）"
            )

    # Check for concentration
    total_equity = sum(
        allocations.get(a, 0)
        for a in ["a_share_large", "a_share_small", "a_share_value", "a_share_growth", "hk_equity", "us_equity"]
    )
    if total_equity > 70:
        suggestions.append(f"权益类资产占比 {total_equity:.0f}% 较高，建议适当分散至固收或另类资产")

    return suggestions
