"""Stress Test — historical scenario impact analysis with convertible 3D channel.

Standard scenarios use weighted sum of per-asset drawdowns.
Convertible bonds get independent three-dimensional stress:
  1. Delta channel (equity market pass-through)
  2. Credit spread channel (floor value erosion)
  3. Interest rate channel (duration effect)
"""
from typing import Dict, List

from .config import ASSET_CLASSES, STRESS_SCENARIOS
from .models import StressScenarioItem

# Convertible bond three-dimensional stress parameters
_CONVERTIBLE_PARAMS = {
    "delta": 0.50,           # Average delta (equity pass-through)
    "credit_spread_dur": 3.5,  # Credit spread duration (years)
    "rate_duration": 4.0,    # Interest rate duration (years)
}

# Per-scenario convertible-specific stress adjustments (delta_shock%, credit_spread_widen%, rate_shift%)
_CONVERTIBLE_STRESS_CHANNELS = {
    "2008 全球金融危机": {"equity_shock": -65, "credit_widen": 3.0, "rate_shift": -1.5},
    "2015 A股股灾":      {"equity_shock": -55, "credit_widen": 1.0, "rate_shift": -0.5},
    "2018 中美贸易战":   {"equity_shock": -35, "credit_widen": 0.8, "rate_shift": -0.3},
    "2020 新冠疫情":     {"equity_shock": -34, "credit_widen": 1.5, "rate_shift": -1.0},
    "2022 股债双杀":     {"equity_shock": -35, "credit_widen": 1.2, "rate_shift": 0.5},
    "QDII通道冻结":      {"equity_shock": -10, "credit_widen": 0.3, "rate_shift": 0.0},
}


def run_stress_tests(allocations: Dict[str, float]) -> List[StressScenarioItem]:
    """Run stress tests against 6 historical scenarios.

    For convertible bonds, uses independent three-dimensional stress:
      impact_cb = delta * equity_shock + credit_dur * credit_widen + rate_dur * rate_shift

    For all other assets, uses simple per-asset drawdown weights.
    """
    results = []

    for scenario_name, drawdowns in STRESS_SCENARIOS.items():
        # Compute convertible 3D stress independently
        cb_stress = _compute_convertible_stress(scenario_name)

        # Compute portfolio-level impact
        impact = 0.0
        for asset in ASSET_CLASSES:
            weight = allocations.get(asset, 0.0)
            if asset == "convertible":
                # Use 3D stress result instead of historical drawdown
                asset_drawdown = cb_stress / 100.0
            else:
                asset_drawdown = drawdowns.get(asset, 0.0) / 100.0
            impact += weight * asset_drawdown

        # Max loss is the absolute value of negative impact
        max_loss = abs(min(impact, 0.0))

        results.append(StressScenarioItem(
            scenario=scenario_name,
            impact=round(impact, 4),
            max_loss=round(max_loss, 4),
        ))

    # Add dedicated convertible stress scenario
    cb_dedicated = _compute_convertible_dedicated_stress(allocations)
    if cb_dedicated is not None:
        results.append(cb_dedicated)

    # Sort by severity (most negative impact first)
    results.sort(key=lambda x: x.impact)

    return results


def _compute_convertible_stress(scenario_name: str) -> float:
    """Compute convertible bond stress from three-dimensional channels.

    Returns stress in percentage terms (e.g., -18.5 = -18.5%).

    Channels:
    1. Delta: delta * equity_shock (equity market pass-through)
    2. Credit: -credit_spread_dur * credit_widen (spread widening erodes floor)
    3. Rate: -rate_duration * rate_shift (rate change duration effect)
    """
    channels = _CONVERTIBLE_STRESS_CHANNELS.get(scenario_name)
    if channels is None:
        # Fallback to default parameters
        return -15.0

    params = _CONVERTIBLE_PARAMS
    equity_shock = channels["equity_shock"]
    credit_widen = channels["credit_widen"]
    rate_shift = channels["rate_shift"]

    # Channel 1: Delta exposure
    delta_impact = params["delta"] * equity_shock

    # Channel 2: Credit spread widening (negative for widening)
    credit_impact = -params["credit_spread_dur"] * credit_widen

    # Channel 3: Interest rate duration (positive rate shift = price drop)
    rate_impact = -params["rate_duration"] * rate_shift

    total = delta_impact + credit_impact + rate_impact
    return round(total, 2)


def _compute_convertible_dedicated_stress(allocations: Dict[str, float]) -> StressScenarioItem | None:
    """Compute a dedicated convertible stress scenario combining extreme channels.

    Simulates: equity -30% + credit spread +200bp + rate +100bp simultaneously.
    This provides a standalone "convertible crash" scenario.
    """
    cb_weight = allocations.get("convertible", 0.0)
    if cb_weight < 0.001:
        return None

    params = _CONVERTIBLE_PARAMS
    # Extreme but plausible simultaneous shock
    equity_shock = -30.0
    credit_widen = 2.0   # 200bp
    rate_shift = 1.0     # 100bp

    delta_impact = params["delta"] * equity_shock          # -15.0%
    credit_impact = -params["credit_spread_dur"] * credit_widen  # -7.0%
    rate_impact = -params["rate_duration"] * rate_shift     # -4.0%

    cb_total = delta_impact + credit_impact + rate_impact  # ~-26.0%

    # Portfolio impact: only the convertible portion
    portfolio_impact = cb_weight * (cb_total / 100.0)
    max_loss = abs(min(portfolio_impact, 0.0))

    return StressScenarioItem(
        scenario="可转债三维压力(股-30%/利差+200bp/利率+100bp)",
        impact=round(portfolio_impact, 4),
        max_loss=round(max_loss, 4),
    )
