"""What-If Simulator — real-time scenario analysis with parameter sliders.

Allows users to adjust 6 parameters and instantly see the impact on
portfolio metrics without re-running the full 14-step pipeline.
"""
from dataclasses import dataclass
from typing import Dict, Optional
import numpy as np

from .models import AllocationResponse


@dataclass
class WhatIfParams:
    """What-If simulator input parameters (6 sliders)."""
    # Base allocations to modify
    base_allocations: Dict[str, float]  # asset_class -> weight (fraction)

    # Slider 1: Amount multiplier (0.5x - 2.0x)
    amount_multiplier: float = 1.0

    # Slider 2: Return adjust (-3% to +3% shift)
    return_adjust: float = 0.0

    # Slider 3: Vol adjust (0.5x - 2.0x vol scaling)
    vol_multiplier: float = 1.0

    # Slider 4: Equity shift (-20% to +20% equity rotation)
    equity_shift: float = 0.0

    # Slider 5: Bond duration shift (-1 to +1 year equivalent)
    bond_duration_shift: float = 0.0

    # Slider 6: Alternative allocation shift (-10% to +10%)
    alt_shift: float = 0.0


@dataclass
class WhatIfResult:
    """What-If simulator output."""
    modified_allocations: Dict[str, float]  # modified weights (percentage)
    expected_return: float  # modified expected return (%)
    expected_volatility: float  # modified volatility (%)
    sharpe_ratio: float
    max_drawdown: float  # estimated max drawdown (%)
    equity_ratio: float  # total equity allocation (%)
    delta_return: float  # change vs base
    delta_volatility: float  # change vs base
    delta_sharpe: float  # change vs base


# Asset class groups for shift operations
_EQUITY_ASSETS = ["a_share_large", "a_share_small", "a_share_value", "a_share_growth", "hk_equity", "us_equity"]
_BOND_ASSETS = ["rate_bond", "credit_bond", "convertible"]
_ALT_ASSETS = ["gold", "commodity", "reits"]
_CASH_ASSETS = ["money_fund", "cash"]

# Default expected returns per asset class (annualized %)
_DEFAULT_RETURNS = {
    "a_share_large": 8.0, "a_share_small": 10.0, "a_share_value": 7.5,
    "a_share_growth": 9.5, "hk_equity": 7.0, "us_equity": 8.5,
    "rate_bond": 3.5, "credit_bond": 4.5, "convertible": 6.0,
    "money_fund": 2.0, "gold": 5.0, "commodity": 4.0, "reits": 6.5, "cash": 1.5,
}

# Default volatilities per asset class (annualized %)
_DEFAULT_VOLS = {
    "a_share_large": 20.0, "a_share_small": 25.0, "a_share_value": 18.0,
    "a_share_growth": 22.0, "hk_equity": 22.0, "us_equity": 18.0,
    "rate_bond": 4.0, "credit_bond": 6.0, "convertible": 12.0,
    "money_fund": 0.5, "gold": 15.0, "commodity": 18.0, "reits": 14.0, "cash": 0.1,
}

# Default correlations (simplified — average pairwise within/across groups)
_INTRA_GROUP_CORR = {"equity": 0.7, "fixed_income": 0.6, "alternative": 0.4, "cash_equiv": 0.3}
_INTER_GROUP_CORR = {
    ("equity", "fixed_income"): -0.1,
    ("equity", "alternative"): 0.15,
    ("equity", "cash_equiv"): 0.0,
    ("fixed_income", "alternative"): 0.05,
    ("fixed_income", "cash_equiv"): 0.2,
    ("alternative", "cash_equiv"): 0.0,
}


def _get_group(asset: str) -> str:
    """Get the group for an asset."""
    if asset in _EQUITY_ASSETS:
        return "equity"
    elif asset in _BOND_ASSETS:
        return "fixed_income"
    elif asset in _ALT_ASSETS:
        return "alternative"
    elif asset in _CASH_ASSETS:
        return "cash_equiv"
    return "other"


def _build_cov_matrix(assets: list, vols: Dict[str, float], vol_multiplier: float) -> np.ndarray:
    """Build a simplified covariance matrix for given assets."""
    n = len(assets)
    cov = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i == j:
                cov[i, j] = (vols.get(assets[i], 15.0) * vol_multiplier / 100) ** 2
            else:
                gi, gj = _get_group(assets[i]), _get_group(assets[j])
                if gi == gj:
                    corr = _INTRA_GROUP_CORR.get(gi, 0.5)
                else:
                    key = tuple(sorted([gi, gj]))
                    corr = _INTER_GROUP_CORR.get(key, 0.1)
                cov[i, j] = corr * (vols[assets[i]] * vol_multiplier / 100) * (vols[assets[j]] * vol_multiplier / 100)
    return cov


def _apply_equity_shift(allocs: Dict[str, float], shift: float) -> Dict[str, float]:
    """Shift equity allocation up/down, offsetting from cash_equiv."""
    result = dict(allocs)
    equity_total = sum(result.get(a, 0) for a in _EQUITY_ASSETS)
    cash_total = sum(result.get(a, 0) for a in _CASH_ASSETS)

    # Apply shift (positive = more equity, negative = less)
    actual_shift = min(shift, cash_total) if shift > 0 else max(shift, -equity_total)

    if abs(actual_shift) < 0.001:
        return result

    # Distribute shift proportionally within equity
    for a in _EQUITY_ASSETS:
        if equity_total > 0:
            result[a] = result.get(a, 0) + actual_shift * (result.get(a, 0) / equity_total)
        elif actual_shift > 0:
            result[a] = result.get(a, 0) + actual_shift / len(_EQUITY_ASSETS)

    # Offset from cash_equiv
    for a in _CASH_ASSETS:
        if cash_total > 0:
            result[a] = max(0, result.get(a, 0) - actual_shift * (result.get(a, 0) / cash_total))

    # Re-normalize
    total = sum(result.values())
    if total > 0:
        result = {k: v / total for k, v in result.items()}
    return result


def _apply_bond_duration_shift(allocs: Dict[str, float], shift: float) -> Dict[str, float]:
    """Shift between short and long duration bonds.
    Positive shift = more long duration (credit_bond), negative = more short (rate_bond).
    """
    result = dict(allocs)
    total_bond = sum(result.get(a, 0) for a in _BOND_ASSETS)
    if total_bond < 0.001:
        return result

    actual_shift = min(abs(shift) * 0.1, total_bond * 0.3)  # Cap at 30% of bond allocation
    if shift > 0:
        # Shift from rate_bond to credit_bond
        result["rate_bond"] = max(0, result.get("rate_bond", 0) - actual_shift)
        result["credit_bond"] = result.get("credit_bond", 0) + actual_shift
    elif shift < 0:
        # Shift from credit_bond to rate_bond
        result["credit_bond"] = max(0, result.get("credit_bond", 0) - actual_shift)
        result["rate_bond"] = result.get("rate_bond", 0) + actual_shift

    return result


def _apply_alt_shift(allocs: Dict[str, float], shift: float) -> Dict[str, float]:
    """Shift alternative allocation, offsetting from fixed_income."""
    result = dict(allocs)
    alt_total = sum(result.get(a, 0) for a in _ALT_ASSETS)
    bond_total = sum(result.get(a, 0) for a in _BOND_ASSETS)

    actual_shift = min(shift, bond_total * 0.3) if shift > 0 else max(shift, -alt_total)
    if abs(actual_shift) < 0.001:
        return result

    # Distribute shift to gold (primary alt)
    result["gold"] = result.get("gold", 0) + actual_shift * 0.5
    result["commodity"] = result.get("commodity", 0) + actual_shift * 0.3
    result["reits"] = result.get("reits", 0) + actual_shift * 0.2

    # Offset from bonds
    for a in _BOND_ASSETS:
        if bond_total > 0:
            result[a] = max(0, result.get(a, 0) - actual_shift * (result.get(a, 0) / bond_total))

    # Re-normalize
    total = sum(result.values())
    if total > 0:
        result = {k: v / total for k, v in result.items()}
    return result


def run_what_if(base_response: AllocationResponse, params: WhatIfParams) -> WhatIfResult:
    """Run what-if simulation on a base allocation response.

    Args:
        base_response: The original AllocationResponse to modify
        params: WhatIfParams with 6 slider values

    Returns:
        WhatIfResult with modified metrics
    """
    # Start with base allocations (already in percentage from response)
    base_allocs = {k: v / 100 for k, v in base_response.saa.allocations.items()}

    # Get base metrics
    base_return = base_response.saa.expected_return
    base_vol = base_response.saa.expected_volatility
    base_sharpe = base_response.saa.sharpe_ratio

    # Apply shifts sequentially
    allocs = _apply_equity_shift(base_allocs, params.equity_shift / 100)
    allocs = _apply_bond_duration_shift(allocs, params.bond_duration_shift)
    allocs = _apply_alt_shift(allocs, params.alt_shift / 100)

    # Build returns and vols dicts
    returns = {k: _DEFAULT_RETURNS.get(k, 5.0) + params.return_adjust for k in allocs}
    vols = {k: _DEFAULT_VOLS.get(k, 10.0) for k in allocs}

    # Compute portfolio return
    port_return = sum(allocs.get(a, 0) * returns.get(a, 5.0) for a in allocs)

    # Compute portfolio volatility using covariance matrix
    assets = [a for a in allocs if allocs[a] > 0.001]
    weights = np.array([allocs[a] for a in assets])
    if len(assets) > 0:
        cov = _build_cov_matrix(assets, vols, params.vol_multiplier)
        port_var = float(weights @ cov @ weights)
        port_vol = np.sqrt(port_var) * 100
    else:
        port_vol = 5.0

    # Apply amount multiplier to expected return (scale effect is minimal)
    port_return *= params.amount_multiplier ** 0.1  # Diminishing returns for larger amounts

    # Compute Sharpe
    rf = 2.0
    port_sharpe = (port_return - rf) / port_vol if port_vol > 0.1 else 0.0

    # Estimate max drawdown (vol * 2.5 as approximation)
    port_max_dd = port_vol * 2.5

    # Equity ratio
    equity_ratio = sum(allocs.get(a, 0) for a in _EQUITY_ASSETS) * 100

    # Convert allocations back to percentage
    modified_pct = {k: round(v * 100, 2) for k, v in allocs.items()}

    return WhatIfResult(
        modified_allocations=modified_pct,
        expected_return=round(port_return, 2),
        expected_volatility=round(port_vol, 2),
        sharpe_ratio=round(port_sharpe, 2),
        max_drawdown=round(port_max_dd, 2),
        equity_ratio=round(equity_ratio, 2),
        delta_return=round(port_return - base_return, 2),
        delta_volatility=round(port_vol - base_vol, 2),
        delta_sharpe=round(port_sharpe - base_sharpe, 2),
    )
