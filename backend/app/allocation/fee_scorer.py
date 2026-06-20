"""Fee Scoring — enhanced fee analysis and comparison.

Provides detailed fee analysis including:
- Total Expense Ratio (TER) estimation
- Fee efficiency score relative to peers
- Category average comparison
- Long-term cost impact projection
"""
from dataclasses import dataclass
import math
from typing import Dict, List, Optional


@dataclass
class FeeAnalysis:
    """Detailed fee analysis for a fund."""
    fund_code: str
    fund_name: str
    asset_class: str
    # Fee components
    management_fee: float  # annual
    custody_fee: float  # annual
    sales_service_fee: float  # annual (C-share only)
    subscription_fee: float  # one-time
    # Computed metrics
    total_expense_ratio: float  # TER = management + custody (+ sales service)
    fee_efficiency_score: float  # 0-100, higher = cheaper relative to peers
    category_avg_ter: float  # average TER in this asset class
    fee_vs_category: float  # negative = cheaper than avg, positive = more expensive
    # Long-term cost projection
    cost_1y: float  # total cost % for 1 year holding
    cost_3y: float  # total cost % for 3 year holding
    cost_5y: float  # total cost % for 5 year holding


def analyze_fees(
    fund_code: str,
    fund_name: str,
    asset_class: str,
    management_fee: float,
    custody_fee: float,
    sales_service_fee: float = 0.0,
    subscription_fee: float = 0.0,
    peers: Optional[List[dict]] = None,
) -> FeeAnalysis:
    """Analyze fees for a fund and compare to category.

    Args:
        fund_code: Fund code
        fund_name: Fund name
        asset_class: Asset class identifier
        management_fee: Annual management fee (decimal, e.g. 0.005 for 0.5%)
        custody_fee: Annual custody fee (decimal)
        sales_service_fee: Annual sales service fee (decimal, C-share only)
        subscription_fee: One-time subscription fee (decimal)
        peers: List of peer fund fee dicts for comparison

    Returns:
        FeeAnalysis with detailed metrics
    """
    # Convert to percentage for display
    mgmt_pct = management_fee * 100
    custody_pct = custody_fee * 100
    sales_pct = sales_service_fee * 100
    sub_pct = subscription_fee * 100

    # Total Expense Ratio
    ter = mgmt_pct + custody_pct + sales_pct

    # Compare only against the verified fee sample in this request.
    peer_ters = [
        (p.get("management_fee", 0) + p.get("custody_fee", 0) + p.get("sales_service_fee", 0)) * 100
        for p in peers or []
    ]
    sample_avg = sum(peer_ters) / len(peer_ters) if peer_ters else ter
    fee_vs_sample = ter - sample_avg

    # Fee efficiency score (0-100, higher = cheaper)
    if peers:
        fee_efficiency_score = _score_fee_efficiency(ter, peer_ters)
    else:
        fee_efficiency_score = 75.0

    # Long-term cost projection (assuming no subscription fee for ongoing)
    cost_1y = ter + sub_pct
    cost_3y = ter * 3 + sub_pct
    cost_5y = ter * 5 + sub_pct

    return FeeAnalysis(
        fund_code=fund_code,
        fund_name=fund_name,
        asset_class=asset_class,
        management_fee=mgmt_pct,
        custody_fee=custody_pct,
        sales_service_fee=sales_pct,
        subscription_fee=sub_pct,
        total_expense_ratio=round(ter, 3),
        fee_efficiency_score=round(fee_efficiency_score, 1),
        category_avg_ter=round(sample_avg, 3),
        fee_vs_category=round(fee_vs_sample, 3),
        cost_1y=round(cost_1y, 3),
        cost_3y=round(cost_3y, 3),
        cost_5y=round(cost_5y, 3),
    )


def _score_fee_efficiency(ter: float, peer_ters: List[float]) -> float:
    """Score fee efficiency relative to peers. Lower TER = higher score."""
    if not peer_ters or len(peer_ters) < 2:
        return 75.0

    min_ter = min(peer_ters)
    max_ter = max(peer_ters)

    if max_ter <= min_ter:
        return 80.0

    # Lower TER = higher score (inverted scale)
    ratio = (max_ter - ter) / (max_ter - min_ter)
    return round(max(0, min(100, 20 + ratio * 80)), 1)


def _fee_number(value) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < 0:
        return None
    return number


def _has_verified_fee_profile(fund: dict) -> bool:
    return _fee_number(fund.get("management_fee")) is not None and _fee_number(fund.get("custody_fee")) is not None


def batch_analyze_fees(
    funds: List[dict],
    asset_class: str,
) -> List[FeeAnalysis]:
    """Batch analyze fees for multiple funds in the same asset class.

    Args:
        funds: List of dicts with code, name, management_fee, custody_fee, etc.
        asset_class: Asset class for all funds

    Returns:
        List of FeeAnalysis sorted by fee_efficiency_score
    """
    # Build peer list for comparison
    verified_funds = [f for f in funds if _has_verified_fee_profile(f)]
    if not verified_funds:
        return []

    peer_fees = [
        {
            "management_fee": _fee_number(f.get("management_fee")) or 0.0,
            "custody_fee": _fee_number(f.get("custody_fee")) or 0.0,
            "sales_service_fee": _fee_number(f.get("sales_service_fee")) or 0.0,
        }
        for f in verified_funds
    ]

    results = []
    for f in verified_funds:
        analysis = analyze_fees(
            fund_code=f.get("code", ""),
            fund_name=f.get("name", ""),
            asset_class=asset_class,
            management_fee=_fee_number(f.get("management_fee")) or 0.0,
            custody_fee=_fee_number(f.get("custody_fee")) or 0.0,
            sales_service_fee=_fee_number(f.get("sales_service_fee")) or 0.0,
            subscription_fee=_fee_number(f.get("subscription_fee")) or 0.0,
            peers=peer_fees,
        )
        results.append(analysis)

    # Sort by fee efficiency (best first)
    results.sort(key=lambda x: x.fee_efficiency_score, reverse=True)
    return results

