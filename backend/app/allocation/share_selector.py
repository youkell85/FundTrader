"""A/C Share Intelligent Selector — recommends A-class or C-class fund shares.

A-class shares: Front-end load (申购费), lower ongoing management/custody fees
C-class shares: No front-end load, but higher sales service fee (销售服务费)

The breakeven holding period determines which is more cost-effective.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass
class ShareFeeProfile:
    """Fee structure for A/C share comparison."""
    fund_code: str
    fund_name: str
    # A-class fees
    a_subscription_fee: float  # 申购费率 (%)
    a_management_fee: float  # 管理费率 (%/year)
    a_custody_fee: float  # 托管费率 (%/year)
    a_redemption_fee_short: float  # 赎回费-短期 (<7天) (%)
    a_redemption_fee_mid: float  # 赎回费-中期 (7天-1年) (%)
    a_redemption_fee_long: float  # 赎回费-长期 (>1年) (%)
    # C-class fees
    c_subscription_fee: float  # 申购费率 (%)
    c_management_fee: float  # 管理费率 (%/year)
    c_custody_fee: float  # 托管费率 (%/year)
    c_sales_service_fee: float  # 销售服务费率 (%/year)
    c_redemption_fee_short: float  # 赎回费-短期 (%)
    c_redemption_fee_long: float  # 赎回费-长期 (%)
    source: str = "verified_fee_profile"
    missing_reason: str = ""


@dataclass
class ShareRecommendation:
    """Recommendation for A/C share selection."""
    fund_code: str
    fund_name: str
    recommended_share: str  # "A" or "C"
    reason: str
    breakeven_months: float  # months where A/C cost equalizes
    total_cost_a: float  # total cost % for A-share over holding period
    total_cost_c: float  # total cost % for C-share over holding period
    savings: float  # savings % by choosing recommended share
    fee_source: str = "verified_fee_profile"
    missing_reason: str = ""


# Common fund fee profiles (ETF/LOF typically have lower fees)
_DEFAULT_PROFILES: Dict[str, ShareFeeProfile] = {}


def get_fee_profile(fund_code: str, fund_name: str = "") -> Optional[ShareFeeProfile]:
    """Get a verified fee profile for a fund, if one is available."""
    if fund_code in _DEFAULT_PROFILES:
        return _DEFAULT_PROFILES[fund_code]
    return None


def calculate_total_cost(
    fee_profile: ShareFeeProfile,
    share_type: str,
    holding_months: float,
    amount: float = 10000,
) -> float:
    """Calculate total cost (%) for holding a share type over a period.

    Args:
        fee_profile: Fund fee structure
        share_type: "A" or "C"
        holding_months: Expected holding period in months
        amount: Investment amount (for redemption fee tiers)

    Returns:
        Total cost as percentage of investment
    """
    holding_years = holding_months / 12

    if share_type == "A":
        # A-class: subscription fee + ongoing fees + redemption fee
        subscription = fee_profile.a_subscription_fee
        ongoing = (fee_profile.a_management_fee + fee_profile.a_custody_fee) * holding_years

        # Redemption fee based on holding period
        if holding_months < 0.25:  # < 7 days
            redemption = fee_profile.a_redemption_fee_short
        elif holding_months < 12:
            redemption = fee_profile.a_redemption_fee_mid
        else:
            redemption = fee_profile.a_redemption_fee_long

        return subscription + ongoing + redemption

    else:  # C-class
        subscription = fee_profile.c_subscription_fee
        ongoing = (
            fee_profile.c_management_fee +
            fee_profile.c_custody_fee +
            fee_profile.c_sales_service_fee
        ) * holding_years

        # Redemption fee
        if holding_months < 1:
            redemption = fee_profile.c_redemption_fee_short
        else:
            redemption = fee_profile.c_redemption_fee_long

        return subscription + ongoing + redemption


def calculate_breakeven(fee_profile: ShareFeeProfile) -> float:
    """Calculate the breakeven holding period in months.

    At breakeven, total cost of A-share equals total cost of C-share.
    """
    # A-share annual cost: management + custody
    a_annual = fee_profile.a_management_fee + fee_profile.a_custody_fee
    # C-share annual cost: management + custody + sales service
    c_annual = fee_profile.c_management_fee + fee_profile.c_custody_fee + fee_profile.c_sales_service_fee

    # Cost difference per year
    annual_diff = c_annual - a_annual

    if annual_diff <= 0:
        # C-share is always cheaper or equal
        return float("inf")

    # A-share has higher upfront cost (subscription fee)
    upfront_diff = fee_profile.a_subscription_fee - fee_profile.c_subscription_fee

    if upfront_diff <= 0:
        # A-share has no upfront advantage, C is always better
        return 0.0

    # Breakeven: upfront_diff = annual_diff * years
    breakeven_years = upfront_diff / annual_diff
    return breakeven_years * 12


def recommend_share(
    fund_code: str,
    fund_name: str,
    holding_months: float,
    amount: float = 10000,
    fee_profile: Optional[ShareFeeProfile] = None,
) -> Optional[ShareRecommendation]:
    """Recommend A or C share based on holding period.

    Args:
        fund_code: Fund code
        fund_name: Fund name
        holding_months: Expected holding period in months
        amount: Investment amount
        fee_profile: Optional custom fee profile

    Returns:
        ShareRecommendation with A/C recommendation
    """
    if fee_profile is None:
        fee_profile = get_fee_profile(fund_code, fund_name)
    if fee_profile is None:
        return None

    cost_a = calculate_total_cost(fee_profile, "A", holding_months, amount)
    cost_c = calculate_total_cost(fee_profile, "C", holding_months, amount)
    breakeven = calculate_breakeven(fee_profile)

    if cost_a < cost_c:
        recommended = "A"
        savings = cost_c - cost_a
        reason = (
            f"持有 {holding_months:.0f} 个月超过盈亏平衡点 {breakeven:.0f} 个月，"
            f"A类份额总费用 {cost_a:.2f}% 低于C类 {cost_c:.2f}%"
        )
    elif cost_c < cost_a:
        recommended = "C"
        savings = cost_a - cost_c
        reason = (
            f"持有 {holding_months:.0f} 个月未达盈亏平衡点 {breakeven:.0f} 个月，"
            f"C类份额总费用 {cost_c:.2f}% 低于A类 {cost_a:.2f}%"
        )
    else:
        recommended = "C"  # Default to C for equal cost (more flexible)
        savings = 0
        reason = f"A/C份额费用相同 ({cost_a:.2f}%)，C类更灵活"

    return ShareRecommendation(
        fund_code=fund_code,
        fund_name=fund_name,
        recommended_share=recommended,
        reason=reason,
        breakeven_months=breakeven,
        total_cost_a=round(cost_a, 4),
        total_cost_c=round(cost_c, 4),
        savings=round(savings, 4),
        fee_source=fee_profile.source,
        missing_reason=fee_profile.missing_reason,
    )


def batch_recommend(
    funds: List[Dict],
    holding_months: float,
    amount: float = 10000,
) -> List[ShareRecommendation]:
    """Batch recommend A/C shares for multiple funds.

    Args:
        funds: List of dicts with 'code' and 'name' keys
        holding_months: Expected holding period in months
        amount: Investment amount

    Returns:
        List of recommendations backed by verified fee profiles.
    """
    results = []
    for fund in funds:
        rec = recommend_share(
            fund_code=fund.get("code", ""),
            fund_name=fund.get("name", ""),
            holding_months=holding_months,
            amount=amount,
        )
        if rec is not None:
            results.append(rec)
    return results
