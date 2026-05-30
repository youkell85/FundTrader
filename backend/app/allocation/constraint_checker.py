"""Constraint Checker — regulatory and portfolio constraint enforcement."""
from typing import Dict, List, Tuple

from .config import (
    ASSET_CLASSES,
    ASSET_TO_GROUP,
    CASH_FLOOR,
    GROUP_MAP,
    HK_LIMIT,
    QDII_LIMIT,
    SINGLE_ASSET_LIMIT,
    SUM_TOLERANCE,
)
from .models import ConstraintCheckItem


def check_constraints(
    allocations: Dict[str, float],
) -> Tuple[Dict[str, float], List[ConstraintCheckItem]]:
    """Check and enforce portfolio constraints.

    Returns (clipped_allocations, constraint_check_items).
    Constraints:
      1. us_equity ≤ 30% (QDII limit)
      2. hk_equity ≤ 20%
      3. Any single asset ≤ 35%
      4. cash_equiv (money_fund + cash) ≥ 5%
      5. Sum = 100%
    """
    checks: List[ConstraintCheckItem] = []
    adjusted = dict(allocations)

    # 1. QDII limit (us_equity)
    us_val = adjusted.get("us_equity", 0.0)
    passed = us_val <= QDII_LIMIT + SUM_TOLERANCE
    checks.append(ConstraintCheckItem(
        rule="QDII额度限制",
        value=f"{us_val * 100:.1f}%",
        limit=f"≤{QDII_LIMIT * 100:.0f}%",
        passed=passed,
    ))
    if not passed:
        overflow = us_val - QDII_LIMIT
        adjusted["us_equity"] = QDII_LIMIT
        _redistribute_overflow(adjusted, overflow, exclude=["us_equity"])

    # 2. HK limit
    hk_val = adjusted.get("hk_equity", 0.0)
    passed = hk_val <= HK_LIMIT + SUM_TOLERANCE
    checks.append(ConstraintCheckItem(
        rule="港股通限制",
        value=f"{hk_val * 100:.1f}%",
        limit=f"≤{HK_LIMIT * 100:.0f}%",
        passed=passed,
    ))
    if not passed:
        overflow = hk_val - HK_LIMIT
        adjusted["hk_equity"] = HK_LIMIT
        _redistribute_overflow(adjusted, overflow, exclude=["hk_equity", "us_equity"])

    # 3. Single asset concentration
    max_asset = max(adjusted.items(), key=lambda x: x[1])
    passed = max_asset[1] <= SINGLE_ASSET_LIMIT + SUM_TOLERANCE
    checks.append(ConstraintCheckItem(
        rule="单资产集中度",
        value=f"{max_asset[0]}={max_asset[1] * 100:.1f}%",
        limit=f"≤{SINGLE_ASSET_LIMIT * 100:.0f}%",
        passed=passed,
    ))
    if not passed:
        overflow = max_asset[1] - SINGLE_ASSET_LIMIT
        adjusted[max_asset[0]] = SINGLE_ASSET_LIMIT
        _redistribute_overflow(adjusted, overflow, exclude=[max_asset[0]])

    # 4. Cash floor
    cash_assets = GROUP_MAP["cash_equiv"]
    cash_total = sum(adjusted.get(a, 0.0) for a in cash_assets)
    passed = cash_total >= CASH_FLOOR - SUM_TOLERANCE
    checks.append(ConstraintCheckItem(
        rule="流动性底线",
        value=f"{cash_total * 100:.1f}%",
        limit=f"≥{CASH_FLOOR * 100:.0f}%",
        passed=passed,
    ))
    if not passed:
        deficit = CASH_FLOOR - cash_total
        # Add to money_fund, take from largest non-cash asset
        adjusted["money_fund"] = adjusted.get("money_fund", 0.0) + deficit
        # Find largest non-cash asset to take from
        non_cash = [(a, v) for a, v in adjusted.items() if a not in cash_assets]
        if non_cash:
            non_cash.sort(key=lambda x: x[1], reverse=True)
            adjusted[non_cash[0][0]] = max(0, adjusted[non_cash[0][0]] - deficit)

    # 5. Sum = 100% (renormalize)
    total = sum(adjusted.values())
    deviation = abs(total - 1.0)
    passed = deviation < SUM_TOLERANCE
    checks.append(ConstraintCheckItem(
        rule="权重总和",
        value=f"{total * 100:.2f}%",
        limit="=100%",
        passed=passed,
    ))
    if not passed:
        # Force normalize
        if total > 0:
            for a in adjusted:
                adjusted[a] = adjusted[a] / total

    # Ensure no negatives after all adjustments
    for a in adjusted:
        adjusted[a] = max(0.0, adjusted[a])

    # Final renormalize
    total = sum(adjusted.values())
    if total > 0 and abs(total - 1.0) > SUM_TOLERANCE:
        for a in adjusted:
            adjusted[a] = adjusted[a] / total

    # Round for cleanliness
    adjusted = {a: round(v, 6) for a, v in adjusted.items()}

    return adjusted, checks


def _redistribute_overflow(
    allocations: Dict[str, float], overflow: float, exclude: List[str]
) -> None:
    """Redistribute overflow to other assets proportionally."""
    eligible = {a: v for a, v in allocations.items() if a not in exclude and v > 0}
    total_eligible = sum(eligible.values())
    if total_eligible <= 0:
        return
    for a, v in eligible.items():
        allocations[a] = v + overflow * (v / total_eligible)
