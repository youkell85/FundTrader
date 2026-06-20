"""Stress Test — calibrated historical scenario impact analysis."""
from typing import Dict, List, Tuple

from .config import ASSET_CLASSES
from .models import StressScenarioItem


class StressCalibrationUnavailable(RuntimeError):
    """Raised when stress tests lack calibrated scenario drawdowns."""


def run_stress_tests(allocations: Dict[str, float]) -> List[StressScenarioItem]:
    """Run stress tests against calibrated historical scenario drawdowns."""
    results = []

    scenarios, metadata = _load_stress_scenarios()
    for scenario_name, drawdowns in scenarios.items():
        impact = 0.0
        for asset in ASSET_CLASSES:
            weight = allocations.get(asset, 0.0)
            asset_drawdown = drawdowns[asset] / 100.0
            impact += weight * asset_drawdown

        max_loss = abs(min(impact, 0.0))

        results.append(StressScenarioItem(
            scenario=scenario_name,
            impact=round(impact, 4),
            max_loss=round(max_loss, 4),
            source=metadata.get("source"),
            source_window=metadata.get("source_window"),
            calibration_version=metadata.get("calibration_version"),
        ))

    results.sort(key=lambda x: x.impact)

    return results


def _load_stress_scenarios() -> Tuple[Dict[str, Dict[str, float]], dict]:
    """Load calibrated stress scenarios from cache."""
    try:
        from app.storage.database import StatsSnapshotCache

        snapshot = StatsSnapshotCache.get("historical_calibration") or {}
        section = snapshot.get("stress_scenarios") or {}
        params = section.get("params")
        source = section.get("source") or "sqlite_cache"
        status = section.get("status") or section.get("data_status")
        if source == "static_assumption" or status == "assumption":
            raise StressCalibrationUnavailable("stress_scenarios calibration is static assumption")
        if not _validate_stress_scenarios(params):
            raise StressCalibrationUnavailable("missing valid calibrated stress scenario drawdowns")
        return params, {
            "source": source,
            "source_window": section.get("source_window"),
            "calibration_version": section.get("calibration_version"),
        }
    except StressCalibrationUnavailable:
        raise
    except Exception:
        raise StressCalibrationUnavailable("stress_scenarios calibration cache unavailable")


def _validate_stress_scenarios(params: object) -> bool:
    """Stress params must contain numeric drawdowns for every asset in each scenario."""
    if not isinstance(params, dict) or not params:
        return False
    for drawdowns in params.values():
        if not isinstance(drawdowns, dict):
            return False
        for asset in ASSET_CLASSES:
            value = drawdowns.get(asset)
            if not isinstance(value, (int, float)):
                return False
    return True
