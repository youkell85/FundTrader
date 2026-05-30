"""Scenario Analysis — probability-weighted return projection."""
from typing import Dict

from .config import ASSET_CLASSES, EQUILIBRIUM_RETURNS
from .models import RegimeState, ScenarioAnalysis, ScenarioItem


def analyze_scenarios(
    allocations: Dict[str, float], regime: RegimeState
) -> ScenarioAnalysis:
    """Generate 3-scenario probability-weighted return analysis.

    Scenarios:
      - Optimistic (25%): All assets perform above equilibrium
      - Baseline (50%): Equilibrium returns
      - Pessimistic (25%): Below equilibrium, especially equities
    """
    # Scenario return multipliers
    scenarios_def = [
        {
            "name": "乐观情景",
            "description": "经济复苏加速，企业盈利超预期，风险偏好提升",
            "probability": 0.25,
            "multiplier": {"equity": 1.4, "fixed_income": 0.9, "alternative": 1.2, "cash_equiv": 1.0},
        },
        {
            "name": "基准情景",
            "description": "经济温和增长，通胀可控，政策中性",
            "probability": 0.50,
            "multiplier": {"equity": 1.0, "fixed_income": 1.0, "alternative": 1.0, "cash_equiv": 1.0},
        },
        {
            "name": "悲观情景",
            "description": "经济下行压力加大，地缘风险升温，流动性收紧",
            "probability": 0.25,
            "multiplier": {"equity": 0.5, "fixed_income": 1.2, "alternative": 0.8, "cash_equiv": 1.0},
        },
    ]

    # Group assets
    from .config import ASSET_TO_GROUP

    scenarios = []
    for s in scenarios_def:
        # Compute scenario return
        scenario_return = 0.0
        for asset in ASSET_CLASSES:
            weight = allocations.get(asset, 0.0)
            base_return = EQUILIBRIUM_RETURNS[asset] / 100.0  # Convert % to decimal
            group = ASSET_TO_GROUP[asset]
            multiplier = s["multiplier"].get(group, 1.0)
            scenario_return += weight * base_return * multiplier

        scenarios.append(ScenarioItem(
            scenario=s["name"],
            description=s["description"],
            probability=s["probability"],
            impact=round(scenario_return, 4),
        ))

    # Weighted return
    weighted_return = sum(s.probability * s.impact for s in scenarios)

    return ScenarioAnalysis(
        weighted_return=round(weighted_return, 4),
        scenarios=scenarios,
    )
