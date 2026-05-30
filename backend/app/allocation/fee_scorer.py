"""Fee Scoring — enhanced fee analysis and comparison.

Provides detailed fee analysis including:
- Total Expense Ratio (TER) estimation
- Fee efficiency score relative to peers
- Category average comparison
- Long-term cost impact projection
"""
from dataclasses import dataclass
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


# Category average TER benchmarks (annualized %)
CATEGORY_AVG_TER = {
    "a_share_large": 0.60,
    "a_share_small": 0.65,
    "a_share_value": 0.60,
    "a_share_growth": 0.65,
    "hk_equity": 0.80,
    "us_equity": 0.85,
    "rate_bond": 0.40,
    "credit_bond": 0.50,
    "convertible": 0.70,
    "money_fund": 0.30,
    "gold": 0.60,
    "commodity": 0.80,
    "reits": 0.60,
    "cash": 0.0,
}


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

    # Category average
    cat_avg = CATEGORY_AVG_TER.get(asset_class, 0.60)
    fee_vs_cat = ter - cat_avg

    # Fee efficiency score (0-100, higher = cheaper)
    if peers:
        peer_ters = [
            (p.get("management_fee", 0) + p.get("custody_fee", 0) + p.get("sales_service_fee", 0)) * 100
            for p in peers
        ]
        fee_efficiency_score = _score_fee_efficiency(ter, peer_ters)
    else:
        # Score based on category average
        if ter <= cat_avg * 0.5:
            fee_efficiency_score = 95.0
        elif ter <= cat_avg * 0.8:
            fee_efficiency_score = 85.0
        elif ter <= cat_avg:
            fee_efficiency_score = 70.0
        elif ter <= cat_avg * 1.3:
            fee_efficiency_score = 50.0
        else:
            fee_efficiency_score = 30.0

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
        category_avg_ter=cat_avg,
        fee_vs_category=round(fee_vs_cat, 3),
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
    peer_fees = [
        {
            "management_fee": f.get("management_fee", 0),
            "custody_fee": f.get("custody_fee", 0),
            "sales_service_fee": f.get("sales_service_fee", 0),
        }
        for f in funds
    ]

    results = []
    for f in funds:
        analysis = analyze_fees(
            fund_code=f.get("code", ""),
            fund_name=f.get("name", ""),
            asset_class=asset_class,
            management_fee=f.get("management_fee", 0.005),
            custody_fee=f.get("custody_fee", 0.001),
            sales_service_fee=f.get("sales_service_fee", 0.0),
            subscription_fee=f.get("subscription_fee", 0.0),
            peers=peer_fees,
        )
        results.append(analysis)

    # Sort by fee efficiency (best first)
    results.sort(key=lambda x: x.fee_efficiency_score, reverse=True)
    return results


def get_fee_recommendation(asset_class: str, holding_years: float = 3) -> str:
    """Get a fee-related recommendation for an asset class.

    Args:
        asset_class: The asset class
        holding_years: Expected holding period in years

    Returns:
        A recommendation string about fee considerations
    """
    cat_avg = CATEGORY_AVG_TER.get(asset_class, 0.60)

    if holding_years < 1:
        return f"短期持有（<1年）建议选择C类份额，避免申购费。该类基金平均TER约{cat_avg:.2f}%"
    elif holding_years < 3:
        return f"中期持有（1-3年）A/C份额费用接近，可优先考虑低TER（<{cat_avg:.2f}%）的基金"
    else:
        return f"长期持有（>3年）建议选择A类份额，低TER（<{cat_avg:.2f}%）的基金累计节省更多"
