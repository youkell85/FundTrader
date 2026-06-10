"""Scenario Analysis — probability-weighted return projection."""
from typing import Dict, Optional, Tuple

from .config import ASSET_CLASSES, EQUILIBRIUM_RETURNS
from .models import RegimeState, ScenarioAnalysis, ScenarioItem


# ─── Static defaults (preserved for backward compatibility) ───

_DEFAULT_SCENARIOS = [
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

_DEFAULT_PROVENANCE = {
    "source": "static_assumption",
    "calibration_version": "static-scenario-params",
    "as_of_date": None,
    "probability_source": "static_assumption",
    "baseline_source": "static_assumption",
}


def _validate_probabilities(probs: list) -> bool:
    """Probabilities must all be positive and sum to 1 (within tolerance)."""
    if not probs or len(probs) != 3:
        return False
    if any(p <= 0 for p in probs):
        return False
    return abs(sum(probs) - 1.0) < 0.001


def _validate_baseline_returns(returns: dict) -> bool:
    """Baseline returns must be numeric for every known asset class."""
    if not isinstance(returns, dict):
        return False
    for asset in ASSET_CLASSES:
        v = returns.get(asset)
        if v is None:
            return False
        if not isinstance(v, (int, float)):
            return False
    return True


def _load_scenario_params() -> Tuple[dict, dict]:
    """Load calibrated scenario params from cache when available.

    Returns (params, provenance) where params may contain:
      - baseline_returns: per-asset baseline returns overriding EQUILIBRIUM_RETURNS
      - probabilities: [optimistic, baseline, pessimistic] probabilities
      - multiplier_overrides: optional per-scenario/group multiplier overrides
    """
    fallback = {
        "baseline_returns": dict(EQUILIBRIUM_RETURNS),
        "probabilities": [0.25, 0.50, 0.25],
        "multiplier_overrides": None,
    }
    try:
        from app.storage.database import StatsSnapshotCache

        cached = StatsSnapshotCache.get("historical_calibration") or {}
        section = cached.get("scenario_analysis") or {}
        params = section.get("params") or {}

        if not isinstance(params, dict) or not params:
            return fallback, dict(_DEFAULT_PROVENANCE)

        # Extract with per-field fallback
        baseline_returns = params.get("baseline_returns")
        probabilities = params.get("probabilities")
        multiplier_overrides = params.get("multiplier_overrides")

        # Validate probabilities
        if probabilities is not None:
            if not _validate_probabilities(probabilities):
                probabilities = [0.25, 0.50, 0.25]
        else:
            probabilities = [0.25, 0.50, 0.25]

        # Validate baseline returns
        if baseline_returns is not None:
            if not _validate_baseline_returns(baseline_returns):
                baseline_returns = dict(EQUILIBRIUM_RETURNS)
        else:
            baseline_returns = dict(EQUILIBRIUM_RETURNS)

        # Multiplier overrides are optional and low-risk
        if multiplier_overrides is not None and not isinstance(multiplier_overrides, dict):
            multiplier_overrides = None

        result = {
            "baseline_returns": baseline_returns,
            "probabilities": probabilities,
            "multiplier_overrides": multiplier_overrides,
        }

        provenance = {
            "source": section.get("source") or "sqlite_cache",
            "calibration_version": section.get("calibration_version"),
            "as_of_date": section.get("as_of"),
            "probability_source": "sqlite_cache" if probabilities != [0.25, 0.50, 0.25] else "static_assumption",
            "baseline_source": "sqlite_cache" if baseline_returns != dict(EQUILIBRIUM_RETURNS) else "static_assumption",
        }
        return result, provenance
    except Exception:
        return fallback, dict(_DEFAULT_PROVENANCE)


def analyze_scenarios(
    allocations: Dict[str, float], regime: RegimeState
) -> ScenarioAnalysis:
    """Generate 3-scenario probability-weighted return analysis.

    Scenarios:
      - Optimistic: All assets perform above equilibrium
      - Baseline: Equilibrium returns
      - Pessimistic: Below equilibrium, especially equities

    When calibration cache is available, baseline returns and scenario
    probabilities are loaded from StatsSnapshotCache("historical_calibration")
    -> scenario_analysis.params.  Invalid or missing values fall back
    per-field to static defaults.
    """
    params, provenance = _load_scenario_params()
    baseline_returns = params["baseline_returns"]
    probabilities = params["probabilities"]
    multiplier_overrides = params.get("multiplier_overrides")

    # Build scenario definitions with optional multiplier overrides
    scenarios_def = []
    for i, s in enumerate(_DEFAULT_SCENARIOS):
        mult = dict(s["multiplier"])
        if multiplier_overrides:
            override = multiplier_overrides.get(str(i)) or multiplier_overrides.get(s["name"])
            if isinstance(override, dict):
                mult.update(override)
        scenarios_def.append({
            "name": s["name"],
            "description": s["description"],
            "probability": probabilities[i],
            "multiplier": mult,
        })

    # Group assets
    from .config import ASSET_TO_GROUP

    scenarios = []
    for s in scenarios_def:
        scenario_return = 0.0
        for asset in ASSET_CLASSES:
            weight = allocations.get(asset, 0.0)
            base_return = baseline_returns[asset] / 100.0  # Convert % to decimal
            group = ASSET_TO_GROUP[asset]
            multiplier = s["multiplier"].get(group, 1.0)
            scenario_return += weight * base_return * multiplier

        scenarios.append(ScenarioItem(
            scenario=s["name"],
            description=s["description"],
            probability=s["probability"],
            impact=round(scenario_return, 4),
        ))

    weighted_return = sum(s.probability * s.impact for s in scenarios)

    return ScenarioAnalysis(
        weighted_return=round(weighted_return, 4),
        scenarios=scenarios,
        source=provenance["source"],
        calibration_version=provenance["calibration_version"],
        as_of_date=provenance["as_of_date"],
        probability_source=provenance["probability_source"],
        baseline_source=provenance["baseline_source"],
    )
