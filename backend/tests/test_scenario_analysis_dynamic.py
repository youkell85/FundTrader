"""Tests for dynamic scenario analysis with cache-backed calibration."""
import unittest
from unittest.mock import patch

from app.allocation.config import ASSET_CLASSES, EQUILIBRIUM_RETURNS
from app.allocation.models import RegimeState, ScenarioAnalysis
from app.allocation.scenario_analysis import analyze_scenarios, _validate_probabilities, _validate_baseline_returns


def _regime():
    return RegimeState(
        regime="baseline",
        regime_label="基准",
        confidence=0.5,
        score=0.0,
    )


class ValidateProbabilitiesTest(unittest.TestCase):
    def test_valid_default_probs(self):
        self.assertTrue(_validate_probabilities([0.25, 0.50, 0.25]))

    def test_valid_custom_probs(self):
        self.assertTrue(_validate_probabilities([0.30, 0.40, 0.30]))

    def test_non_normalized_fails(self):
        self.assertFalse(_validate_probabilities([0.5, 0.5, 0.5]))

    def test_negative_prob_fails(self):
        self.assertFalse(_validate_probabilities([-0.1, 0.5, 0.6]))

    def test_wrong_count_fails(self):
        self.assertFalse(_validate_probabilities([0.5, 0.5]))


class ValidateBaselineReturnsTest(unittest.TestCase):
    def test_valid_equilibrium_returns(self):
        self.assertTrue(_validate_baseline_returns(EQUILIBRIUM_RETURNS))

    def test_missing_asset_fails(self):
        bad = dict(EQUILIBRIUM_RETURNS)
        del bad["a_share_large"]
        self.assertFalse(_validate_baseline_returns(bad))

    def test_non_numeric_fails(self):
        bad = dict(EQUILIBRIUM_RETURNS)
        bad["a_share_large"] = "high"
        self.assertFalse(_validate_baseline_returns(bad))

    def test_non_dict_fails(self):
        self.assertFalse(_validate_baseline_returns("not a dict"))


class DefaultScenarioAnalysisTest(unittest.TestCase):
    """Default behavior: no cache → static probabilities and equilibrium returns."""

    def test_returns_scenario_analysis_with_static_defaults(self):
        result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        self.assertIsInstance(result, ScenarioAnalysis)
        self.assertEqual(len(result.scenarios), 3)
        self.assertAlmostEqual(
            sum(s.probability for s in result.scenarios), 1.0, places=3,
        )

    def test_static_provenance_when_no_cache(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=None):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        self.assertEqual(result.source, "static_assumption")
        self.assertEqual(result.calibration_version, "static-scenario-params")
        self.assertEqual(result.probability_source, "static_assumption")
        self.assertEqual(result.baseline_source, "static_assumption")

    def test_default_probabilities_match_hardcoded(self):
        result = analyze_scenarios({"a_share_large": 1.0}, _regime())
        probs = [s.probability for s in result.scenarios]
        self.assertAlmostEqual(probs[0], 0.25, places=3)
        self.assertAlmostEqual(probs[1], 0.50, places=3)
        self.assertAlmostEqual(probs[2], 0.25, places=3)

    def test_weighted_return_with_full_allocation(self):
        """When 100% in one asset, weighted return uses that asset's equilibrium."""
        result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        base_return = EQUILIBRIUM_RETURNS["a_share_large"] / 100.0
        expected_per_scenario = [
            base_return * 1.4,  # optimistic
            base_return * 1.0,  # baseline
            base_return * 0.5,  # pessimistic
        ]
        for s, exp in zip(result.scenarios, expected_per_scenario):
            self.assertAlmostEqual(s.impact, exp, places=4)

        expected_weighted = 0.25 * expected_per_scenario[0] + 0.50 * expected_per_scenario[1] + 0.25 * expected_per_scenario[2]
        self.assertAlmostEqual(result.weighted_return, expected_weighted, places=4)


class CalibratedBaselineReturnsTest(unittest.TestCase):
    """Calibrated baseline returns override EQUILIBRIUM_RETURNS."""

    def test_custom_baseline_returns_used(self):
        custom_returns = {asset: 10.0 for asset in ASSET_CLASSES}
        cached = {
            "scenario_analysis": {
                "source": "historical_calibrator",
                "calibration_version": "cal-v2",
                "as_of": "2026-06-01",
                "params": {
                    "baseline_returns": custom_returns,
                },
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        base_return = 10.0 / 100.0  # 0.10 from custom returns
        self.assertAlmostEqual(result.scenarios[1].impact, base_return * 1.0, places=4)
        self.assertEqual(result.baseline_source, "sqlite_cache")
        self.assertEqual(result.calibration_version, "cal-v2")
        self.assertEqual(result.as_of_date, "2026-06-01")

    def test_invalid_baseline_falls_back(self):
        """Missing asset in custom returns → fallback to static."""
        bad_returns = {"a_share_large": 10.0}  # only one asset
        cached = {
            "scenario_analysis": {
                "params": {"baseline_returns": bad_returns},
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            result = analyze_scenarios({"rate_bond": 1.0}, _regime())

        # Should use EQUILIBRIUM_RETURNS fallback since validation fails
        self.assertEqual(result.baseline_source, "static_assumption")
        base_return = EQUILIBRIUM_RETURNS["rate_bond"] / 100.0
        self.assertAlmostEqual(result.scenarios[1].impact, base_return * 1.0, places=4)


class CalibratedProbabilitiesTest(unittest.TestCase):
    """Calibrated scenario probabilities override defaults."""

    def test_custom_probabilities_used(self):
        cached = {
            "scenario_analysis": {
                "source": "historical_calibrator",
                "calibration_version": "cal-v3",
                "params": {
                    "probabilities": [0.30, 0.40, 0.30],
                },
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        probs = [s.probability for s in result.scenarios]
        self.assertAlmostEqual(probs[0], 0.30, places=3)
        self.assertAlmostEqual(probs[1], 0.40, places=3)
        self.assertAlmostEqual(probs[2], 0.30, places=3)
        self.assertEqual(result.probability_source, "sqlite_cache")

    def test_non_normalized_probs_fall_back(self):
        cached = {
            "scenario_analysis": {
                "params": {"probabilities": [0.5, 0.5, 0.5]},
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        probs = [s.probability for s in result.scenarios]
        self.assertAlmostEqual(probs[0], 0.25, places=3)
        self.assertAlmostEqual(probs[1], 0.50, places=3)
        self.assertAlmostEqual(probs[2], 0.25, places=3)
        self.assertEqual(result.probability_source, "static_assumption")


class InvalidCacheFallbackTest(unittest.TestCase):
    """Invalid or missing cache values fall back per-field."""

    def test_empty_cache_uses_static_defaults(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value={}):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        self.assertEqual(result.source, "static_assumption")
        probs = [s.probability for s in result.scenarios]
        self.assertAlmostEqual(sum(probs), 1.0, places=3)

    def test_cache_exception_falls_back_gracefully(self):
        def raise_exc(*args, **kwargs):
            raise RuntimeError("db down")

        with patch("app.storage.database.StatsSnapshotCache.get", side_effect=raise_exc):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        self.assertEqual(result.source, "static_assumption")
        self.assertEqual(len(result.scenarios), 3)

    def test_missing_scenario_analysis_section_falls_back(self):
        cached = {"jump_params": {"params": {"prob": 0.01}}}
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        self.assertEqual(result.source, "static_assumption")

    def test_none_params_falls_back(self):
        cached = {"scenario_analysis": {"params": None}}
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        self.assertEqual(result.source, "static_assumption")


class MultiplierOverrideTest(unittest.TestCase):
    """Optional multiplier overrides by scenario index/name."""

    def test_multiplier_override_by_index(self):
        cached = {
            "scenario_analysis": {
                "params": {
                    "multiplier_overrides": {
                        "0": {"equity": 2.0, "fixed_income": 0.5},
                    },
                },
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            result = analyze_scenarios({"a_share_large": 1.0, "rate_bond": 0.0}, _regime())

        # Optimistic (index 0): equity multiplier should be 2.0 instead of 1.4
        base_return = EQUILIBRIUM_RETURNS["a_share_large"] / 100.0
        expected_optimistic = base_return * 2.0
        self.assertAlmostEqual(result.scenarios[0].impact, expected_optimistic, places=4)

    def test_multiplier_override_by_name(self):
        cached = {
            "scenario_analysis": {
                "params": {
                    "multiplier_overrides": {
                        "悲观情景": {"equity": 0.2},
                    },
                },
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        base_return = EQUILIBRIUM_RETURNS["a_share_large"] / 100.0
        expected_pessimistic = base_return * 0.2
        self.assertAlmostEqual(result.scenarios[2].impact, expected_pessimistic, places=4)


class ProvenanceFieldsTest(unittest.TestCase):
    """Provenance fields are always present on ScenarioAnalysis."""

    def test_all_provenance_fields_present(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=None):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        self.assertIsNotNone(result.source)
        self.assertIsNotNone(result.calibration_version)
        # as_of_date may be None, but field exists
        self.assertTrue(hasattr(result, "as_of_date"))
        self.assertIsNotNone(result.probability_source)
        self.assertIsNotNone(result.baseline_source)

    def test_calibrated_cache_sets_all_provenance(self):
        custom_returns = {asset: 5.0 for asset in ASSET_CLASSES}
        cached = {
            "scenario_analysis": {
                "source": "my_calibrator",
                "calibration_version": "v99",
                "as_of": "2026-05-15",
                "params": {
                    "baseline_returns": custom_returns,
                    "probabilities": [0.20, 0.60, 0.20],
                },
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=cached):
            result = analyze_scenarios({"a_share_large": 1.0}, _regime())

        self.assertEqual(result.source, "my_calibrator")
        self.assertEqual(result.calibration_version, "v99")
        self.assertEqual(result.as_of_date, "2026-05-15")
        self.assertEqual(result.probability_source, "sqlite_cache")
        self.assertEqual(result.baseline_source, "sqlite_cache")


if __name__ == "__main__":
    unittest.main()
