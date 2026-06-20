"""Scenario Analysis — probability-weighted return projection."""
from typing import Dict, Optional, Tuple

from .config import ASSET_CLASSES
from .models import RegimeState, ScenarioAnalysis, ScenarioItem


class ScenarioCalibrationUnavailable(RuntimeError):
    """Raised when scenario analysis lacks real calibrated inputs."""


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


def _validate_multiplier_overrides(overrides: dict) -> bool:
    """Multiplier overrides must cover all 3 scenarios with numeric group values."""
    if not isinstance(overrides, dict):
        return False
    required_groups = {"equity", "fixed_income", "alternative", "cash_equiv"}
    for idx, scenario in enumerate(_DEFAULT_SCENARIOS):
        raw = overrides.get(str(idx)) or overrides.get(scenario["name"])
        if not isinstance(raw, dict):
            return False
        for group in required_groups:
            value = raw.get(group)
            if not isinstance(value, (int, float)):
                return False
            if value < 0:
                return False
    return True


def _load_scenario_params() -> Tuple[dict, dict]:
    """Load calibrated scenario params from cache when available.

    Returns (params, provenance) where params may contain:
      - baseline_returns: per-asset calibrated baseline returns
      - probabilities: [optimistic, baseline, pessimistic] probabilities
      - multiplier_overrides: per-scenario/group multipliers
    """
    try:
        from app.storage.database import StatsSnapshotCache

        cached = StatsSnapshotCache.get("historical_calibration") or {}
        section = cached.get("scenario_analysis") or {}
        params = section.get("params") or {}

        if not isinstance(params, dict) or not params:
            raise ScenarioCalibrationUnavailable("missing scenario_analysis calibration params")

        source = section.get("source") or "sqlite_cache"
        status = section.get("status")
        if source == "static_assumption" or status == "assumption":
            raise ScenarioCalibrationUnavailable("scenario_analysis calibration is static assumption")

        baseline_returns = params.get("baseline_returns")
        probabilities = params.get("probabilities")
        multiplier_overrides = params.get("multiplier_overrides")

        if not _validate_baseline_returns(baseline_returns):
            raise ScenarioCalibrationUnavailable("missing valid calibrated baseline returns")
        if not _validate_probabilities(probabilities):
            raise ScenarioCalibrationUnavailable("missing valid calibrated scenario probabilities")
        if not _validate_multiplier_overrides(multiplier_overrides):
            raise ScenarioCalibrationUnavailable("missing valid calibrated scenario multipliers")

        result = {
            "baseline_returns": baseline_returns,
            "probabilities": probabilities,
            "multiplier_overrides": multiplier_overrides,
        }

        provenance = {
            "source": source,
            "calibration_version": section.get("calibration_version"),
            "as_of_date": section.get("as_of"),
            "probability_source": source,
            "baseline_source": source,
            "multiplier_source": source,
        }
        return result, provenance
    except ScenarioCalibrationUnavailable:
        raise
    except Exception:
        raise ScenarioCalibrationUnavailable("scenario_analysis calibration cache unavailable")


def analyze_scenarios(
    allocations: Dict[str, float], regime: RegimeState
) -> ScenarioAnalysis:
    """Generate 3-scenario probability-weighted return analysis.

    Scenarios:
      - Optimistic: All assets perform above equilibrium
      - Baseline: Equilibrium returns
      - Pessimistic: Below equilibrium, especially equities

    Baseline returns, probabilities, and multipliers must all come from
    StatsSnapshotCache("historical_calibration") -> scenario_analysis.params.
    Invalid or missing calibration raises ScenarioCalibrationUnavailable
    so the orchestrator can expose scenario_analysis as missing instead of
    fabricating static projections.
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
