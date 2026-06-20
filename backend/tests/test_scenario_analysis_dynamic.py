"""Tests for cache-backed scenario analysis without static projection fallback."""
import unittest
from unittest.mock import patch

from app.allocation.config import ASSET_CLASSES
from app.allocation.models import AllocationRequest, RegimeState, ScenarioAnalysis
from app.allocation.orchestrator import run
from app.allocation.scenario_analysis import (
    ScenarioCalibrationUnavailable,
    _validate_baseline_returns,
    _validate_multiplier_overrides,
    _validate_probabilities,
    analyze_scenarios,
)


def _regime():
    return RegimeState(
        regime="baseline",
        regime_label="baseline",
        confidence=0.5,
        score=0.0,
    )


def _returns(value: float = 10.0) -> dict[str, float]:
    return {asset: value for asset in ASSET_CLASSES}


def _multipliers() -> dict[str, dict[str, float]]:
    return {
        "0": {"equity": 1.4, "fixed_income": 0.9, "alternative": 1.2, "cash_equiv": 1.0},
        "1": {"equity": 1.0, "fixed_income": 1.0, "alternative": 1.0, "cash_equiv": 1.0},
        "2": {"equity": 0.5, "fixed_income": 1.2, "alternative": 0.8, "cash_equiv": 1.0},
    }


def _calibrated_cache(**params):
    payload = {
        "baseline_returns": _returns(),
        "probabilities": [0.30, 0.40, 0.30],
        "multiplier_overrides": _multipliers(),
    }
    payload.update(params)
    return {
        "scenario_analysis": {
            "source": "historical_market_data",
            "status": "partial",
            "calibration_version": "cal-v2",
            "as_of": "2026-06-01",
            "params": payload,
        }
    }


class ValidateScenarioInputsTest(unittest.TestCase):
    def test_valid_probabilities(self):
        self.assertTrue(_validate_probabilities([0.30, 0.40, 0.30]))

    def test_invalid_probabilities(self):
        self.assertFalse(_validate_probabilities([0.5, 0.5, 0.5]))
        self.assertFalse(_validate_probabilities([0.5, 0.5]))
        self.assertFalse(_validate_probabilities([-0.1, 0.5, 0.6]))

    def test_valid_baseline_returns(self):
        self.assertTrue(_validate_baseline_returns(_returns()))

    def test_invalid_baseline_returns(self):
        bad = _returns()
        del bad["a_share_large"]
        self.assertFalse(_validate_baseline_returns(bad))
        self.assertFalse(_validate_baseline_returns("not a dict"))

    def test_valid_multiplier_overrides(self):
        self.assertTrue(_validate_multiplier_overrides(_multipliers()))

    def test_invalid_multiplier_overrides(self):
        self.assertFalse(_validate_multiplier_overrides(None))
        self.assertFalse(_validate_multiplier_overrides({"0": {"equity": 1.0}}))
        bad = _multipliers()
        bad["1"]["equity"] = "bad"
        self.assertFalse(_validate_multiplier_overrides(bad))


class ScenarioAnalysisContractTest(unittest.TestCase):
    def test_complete_calibrated_cache_generates_analysis(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=_calibrated_cache()):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        self.assertIsInstance(result, ScenarioAnalysis)
        self.assertEqual(result.source, "historical_market_data")
        self.assertEqual(result.calibration_version, "cal-v2")
        self.assertEqual(result.as_of_date, "2026-06-01")
        self.assertEqual(result.probability_source, "historical_market_data")
        self.assertEqual(result.baseline_source, "historical_market_data")
        self.assertAlmostEqual(sum(s.probability for s in result.scenarios), 1.0, places=3)
        self.assertAlmostEqual(result.scenarios[1].impact, 0.10, places=4)

    def test_missing_cache_raises_missing_calibration(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=None):
            with self.assertRaises(ScenarioCalibrationUnavailable):
                analyze_scenarios({"a_share_large": 1.0}, _regime())

    def test_static_assumption_cache_is_rejected(self):
        cached = _calibrated_cache()
        cached["scenario_analysis"]["source"] = "static_assumption"
        cached["scenario_analysis"]["status"] = "assumption"

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            with self.assertRaises(ScenarioCalibrationUnavailable):
                analyze_scenarios({"a_share_large": 1.0}, _regime())

    def test_invalid_baseline_does_not_fall_back_to_static_returns(self):
        with patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=_calibrated_cache(baseline_returns={"a_share_large": 10.0}),
        ):
            with self.assertRaises(ScenarioCalibrationUnavailable):
                analyze_scenarios({"rate_bond": 1.0}, _regime())

    def test_invalid_probabilities_do_not_fall_back_to_static_probs(self):
        with patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=_calibrated_cache(probabilities=[0.5, 0.5, 0.5]),
        ):
            with self.assertRaises(ScenarioCalibrationUnavailable):
                analyze_scenarios({"a_share_large": 1.0}, _regime())

    def test_missing_multipliers_do_not_use_default_projection_multipliers(self):
        with patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=_calibrated_cache(multiplier_overrides=None),
        ):
            with self.assertRaises(ScenarioCalibrationUnavailable):
                analyze_scenarios({"a_share_large": 1.0}, _regime())


class OrchestratorScenarioDegradationTest(unittest.TestCase):
    def test_orchestrator_returns_null_scenario_analysis_when_calibration_missing(self):
        request = AllocationRequest(
            risk_tolerance="balanced",
            age=40,
            amount=100000,
            horizon="3-5y",
            goal_type="wealth",
        )

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=None):
            result = run(request)

        self.assertIsNone(result.scenario_analysis)
        self.assertTrue(any("情景分析缺少真实校准数据" in item for item in result.warnings))


if __name__ == "__main__":
    unittest.main()
