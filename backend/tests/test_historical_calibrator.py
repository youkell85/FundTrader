import unittest
from unittest.mock import patch

import numpy as np

from app.allocation.config import ASSET_CLASSES, DEFAULT_CORR, EQUILIBRIUM_RETURNS
from app.allocation.data.historical_calibrator import HistoricalCalibrator


def _make_stats_snapshot() -> dict:
    quality = {
        asset: {"status": "available", "reason": None}
        for asset in ASSET_CLASSES
    }
    quality["cash"] = {"status": "assumption", "reason": "no_representative_etf"}

    returns = {asset: float(index + 1) for index, asset in enumerate(ASSET_CLASSES)}
    vols = {asset: float(index + 10) for index, asset in enumerate(ASSET_CLASSES)}
    corr = np.asarray(DEFAULT_CORR, dtype=np.float64)
    corr[0, 1] = np.nan
    corr[1, 0] = np.inf
    vol_regime = {asset: 1.05 for asset in ASSET_CLASSES if asset != "cash"}

    return {
        "returns": returns,
        "vols": vols,
        "correlation_matrix": corr.tolist(),
        "quality": quality,
        "vol_regime": vol_regime,
    }


def _make_long_window_stats() -> dict:
    """Simulate a long-window cache entry with a nested ``long_window`` block."""
    quality = {
        asset: {"status": "available", "reason": None}
        for asset in ASSET_CLASSES
    }
    quality["cash"] = {"status": "assumption", "reason": "no_representative_etf"}

    long_returns = {asset: float(index + 3) for index, asset in enumerate(ASSET_CLASSES)}
    long_vols = {asset: float(index + 15) for index, asset in enumerate(ASSET_CLASSES)}
    long_corr = np.eye(len(ASSET_CLASSES), dtype=np.float64)
    long_corr[0, 1] = 0.85
    long_corr[1, 0] = 0.85

    short_returns = {asset: float(index + 1) for index, asset in enumerate(ASSET_CLASSES)}
    short_vols = {asset: float(index + 10) for index, asset in enumerate(ASSET_CLASSES)}

    return {
        "returns": short_returns,
        "vols": short_vols,
        "correlation_matrix": DEFAULT_CORR,
        "returns_long": long_returns,
        "vols_long": long_vols,
        "quality": quality,
        "long_window": {
            "returns": long_returns,
            "vols": long_vols,
            "correlation_matrix": long_corr.tolist(),
            "window_start": "2020-01-01",
            "window_end": "2025-12-31",
            "n_observations": 72,
            "confidence_score": 0.85,
        },
    }


def _make_partial_long_window_stats() -> dict:
    """Long-window block has vol data but no return data; should fall back for returns."""
    quality = {
        asset: {"status": "available", "reason": None}
        for asset in ASSET_CLASSES
    }
    partial_returns = {ASSET_CLASSES[0]: 5.0}  # only one asset
    long_vols = {asset: float(index + 15) for index, asset in enumerate(ASSET_CLASSES)}

    return {
        "returns": partial_returns,
        "vols_long": long_vols,
        "quality": quality,
        "long_window": {
            "returns": {},  # empty; insufficient coverage for returns
            "vols": long_vols,
            "window_start": "2020-06-01",
            "window_end": "2025-06-01",
        },
    }


class HistoricalCalibratorTest(unittest.TestCase):
    # Existing static fallback tests.

    def test_returns_fallback_to_static_assumption_when_data_missing(self):
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=None,
        ), patch(
            "app.allocation.data.market_data_fetcher.compute_rolling_stats_ex",
            return_value=None,
        ), patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=None,
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_returns()

        self.assertEqual(result["source"], "static_assumption")
        self.assertEqual(result["data_status"], "assumption")
        self.assertEqual(result["coverage"], 0.0)
        self.assertEqual(result["values"], EQUILIBRIUM_RETURNS)
        self.assertEqual(result["calibration_version"], "historical-calibrator-v1")
        self.assertTrue(result["as_of"])

    def test_vols_include_version_source_as_of_and_coverage(self):
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=None,
        ), patch(
            "app.allocation.data.market_data_fetcher.compute_rolling_stats_ex",
            return_value=_make_stats_snapshot(),
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_vols()

        self.assertEqual(result["source"], "historical_market_data")
        self.assertEqual(result["data_status"], "partial")
        self.assertEqual(result["calibration_version"], "historical-calibrator-v1")
        self.assertTrue(result["as_of"])
        self.assertGreater(result["coverage"], 0.9)
        self.assertIn("cash:no_representative_etf", result["assumptions_used"])

    def test_correlation_matrix_is_square_finite_and_has_unit_diagonal(self):
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=None,
        ), patch(
            "app.allocation.data.market_data_fetcher.compute_rolling_stats_ex",
            return_value=_make_stats_snapshot(),
        ):
            result = HistoricalCalibrator().calibrate_correlation_matrix()

        matrix = np.asarray(result["matrix"], dtype=float)
        self.assertEqual(matrix.shape, (len(ASSET_CLASSES), len(ASSET_CLASSES)))
        self.assertTrue(np.all(np.isfinite(matrix)))
        self.assertTrue(np.allclose(np.diag(matrix), 1.0))

    # Long-window preference tests.

    def test_long_window_returns_preferred_over_short_window(self):
        """Long-window returns should be used instead of short-window returns when both are present."""
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=_make_long_window_stats(),
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_returns()

        self.assertEqual(result["source"], "long_window_cache")
        self.assertEqual(result["data_status"], "partial")
        self.assertGreater(result["coverage"], 0.9)
        # Bayesian shrinkage blends long-window (index+3) with DMS priors
        self.assertAlmostEqual(result["values"]["a_share_large"], 5.6163, places=2)

    def test_long_window_vols_preferred_over_short_window(self):
        """Long-window vols should be preferred."""
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=_make_long_window_stats(),
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_vols()

        self.assertEqual(result["source"], "long_window_cache")
        self.assertEqual(result["data_status"], "partial")
        self.assertGreater(result["coverage"], 0.9)
        # Bayesian shrinkage blends long-window (index+15) with DMS priors
        self.assertAlmostEqual(result["values"]["a_share_large"], 17.907, places=2)

    def test_long_window_correlation_matrix_preferred(self):
        """Long-window correlation matrix should be preferred over top-level."""
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=_make_long_window_stats(),
        ):
            result = HistoricalCalibrator().calibrate_correlation_matrix()

        self.assertEqual(result["source"], "long_window_cache")
        self.assertEqual(result["data_status"], "partial")
        matrix = np.asarray(result["matrix"], dtype=float)
        self.assertTrue(np.all(np.isfinite(matrix)))
        self.assertTrue(np.allclose(np.diag(matrix), 1.0))
        # Should use long_window identity-like matrix, not DEFAULT_CORR
        self.assertAlmostEqual(matrix[0, 1], 0.85, places=4)

    # Long-window metadata tests.

    def test_long_window_metadata_surfaced_on_returns(self):
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=_make_long_window_stats(),
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_returns()

        self.assertEqual(result["window_start"], "2020-01-01")
        self.assertEqual(result["window_end"], "2025-12-31")
        self.assertEqual(result["n_observations"], 72)
        self.assertAlmostEqual(result["confidence_score"], 0.85, places=4)

    def test_injected_long_window_snapshot_has_distinct_source(self):
        result = HistoricalCalibrator(stats_snapshot=_make_long_window_stats()).calibrate_equilibrium_returns()

        self.assertEqual(result["source"], "long_window_snapshot")
        self.assertEqual(result["data_status"], "partial")
        # Bayesian shrinkage blends long-window (index+3) with DMS priors
        self.assertAlmostEqual(result["values"]["a_share_large"], 5.6163, places=2)

    def test_long_window_metadata_not_surfaced_when_absent(self):
        """Metadata keys should not appear when the snapshot lacks them."""
        snapshot = _make_stats_snapshot()
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=None,
        ), patch(
            "app.allocation.data.market_data_fetcher.compute_rolling_stats_ex",
            return_value=snapshot,
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_returns()

        self.assertNotIn("window_start", result)
        self.assertNotIn("n_observations", result)
        self.assertNotIn("confidence_score", result)

    # Insufficient coverage fallback tests.

    def test_insufficient_long_window_returns_falls_back_to_static(self):
        """When long-window returns cover too few assets, fall back to static assumptions."""
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=_make_partial_long_window_stats(),
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_returns()

        # Coverage < 0.7 falls back to static_assumption
        self.assertEqual(result["source"], "static_assumption")
        self.assertEqual(result["data_status"], "assumption")
        self.assertEqual(len(result["valid_assets"]), 1)  # only a_share_large
        self.assertEqual(
            result["invalid_assets"]["a_share_small"],
            "equilibrium_returns_static_assumption",
        )

    def test_partial_long_window_vols_succeed_when_coverage_adequate(self):
        """Long-window vols with full coverage should succeed even if returns are partial."""
        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=_make_partial_long_window_stats(),
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_vols()

        self.assertEqual(result["source"], "long_window_cache")
        self.assertEqual(result["data_status"], "real")
        self.assertGreater(result["coverage"], 0.9)
        # Bayesian shrinkage with default n_obs=500: blend of 15.0 and DMS prior 20.0
        self.assertAlmostEqual(result["values"]["a_share_large"], 15.8333, places=2)

    # Backward compatibility: flat long-window keys.

    def test_flat_long_window_keys_still_work(self):
        """Snapshot with top-level returns_long/vols_long but no nested long_window block."""
        stats = _make_stats_snapshot()
        stats["returns_long"] = {asset: 9.0 for asset in ASSET_CLASSES}
        stats["vols_long"] = {asset: 20.0 for asset in ASSET_CLASSES}

        with patch(
            "app.allocation.data.historical_calibrator._load_long_window_cache",
            return_value=None,
        ), patch(
            "app.allocation.data.market_data_fetcher.compute_rolling_stats_ex",
            return_value=stats,
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_returns()

        self.assertEqual(result["source"], "historical_market_data")
        # Bayesian shrinkage with default n_obs=500: blend of 9.0 and DMS prior 7.5
        self.assertAlmostEqual(result["values"]["a_share_large"], 8.75, places=2)


class BayesianShrinkageTest(unittest.TestCase):
    """Tests for _apply_bayesian_shrinkage edge cases and Winsorizing."""

    def test_empty_observed_returns_empty(self):
        from app.allocation.data.historical_calibrator import _apply_bayesian_shrinkage
        result = _apply_bayesian_shrinkage({}, {"a_share_large": 7.5}, None)
        self.assertEqual(result, {})

    def test_empty_prior_returns_observed(self):
        from app.allocation.data.historical_calibrator import _apply_bayesian_shrinkage
        result = _apply_bayesian_shrinkage({"a_share_large": 8.0}, {}, None)
        self.assertEqual(result["a_share_large"], 8.0)

    def test_extreme_positive_value_is_winsorized(self):
        from app.allocation.data.historical_calibrator import _apply_bayesian_shrinkage
        stats = {"long_window": {"n_observations": 500}}
        result = _apply_bayesian_shrinkage({"a_share_large": 50.0}, {"a_share_large": 7.5}, stats)
        self.assertLess(result["a_share_large"], 20.0)

    def test_extreme_negative_value_is_winsorized(self):
        from app.allocation.data.historical_calibrator import _apply_bayesian_shrinkage
        stats = {"long_window": {"n_observations": 500}}
        result = _apply_bayesian_shrinkage({"a_share_large": -50.0}, {"a_share_large": 7.5}, stats)
        self.assertGreater(result["a_share_large"], -20.0)

    def test_shrinkage_decreases_with_more_observations(self):
        from app.allocation.data.historical_calibrator import _apply_bayesian_shrinkage
        sample = {"a_share_large": 5.0}
        prior = {"a_share_large": 7.5}
        result_few = _apply_bayesian_shrinkage(sample, prior, {"long_window": {"n_observations": 50}})
        result_many = _apply_bayesian_shrinkage(sample, prior, {"long_window": {"n_observations": 5000}})
        # Fewer obs: closer to prior (more shrinkage); more obs: closer to sample
        self.assertLess(abs(result_few["a_share_large"] - 7.5), abs(result_many["a_share_large"] - 7.5))
        # But both should be between sample and prior
        self.assertGreater(result_few["a_share_large"], 5.0)
        self.assertLess(result_few["a_share_large"], 7.5)
        self.assertGreater(result_many["a_share_large"], 5.0)
        self.assertLess(result_many["a_share_large"], 7.5)

    def test_nan_sample_uses_prior(self):
        from app.allocation.data.historical_calibrator import _apply_bayesian_shrinkage
        result = _apply_bayesian_shrinkage({"a_share_large": float('nan')}, {"a_share_large": 7.5}, None)
        self.assertAlmostEqual(result["a_share_large"], 7.5, places=2)

    def test_zero_n_obs_defaults_to_500(self):
        from app.allocation.data.historical_calibrator import _apply_bayesian_shrinkage
        result = _apply_bayesian_shrinkage({"a_share_large": 5.0}, {"a_share_large": 7.5}, None)
        expected = 0.8333 * 5.0 + 0.1667 * 7.5
        self.assertAlmostEqual(result["a_share_large"], expected, places=1)


class JumpParamsCalibrationTest(unittest.TestCase):
    """Tests for jump params calibration from long-window tail stats."""

    def test_missing_stats_returns_defaults(self):
        from app.allocation.data.historical_calibrator import _extract_jump_params_from_stats
        defaults = {"jump_probability": 0.03, "jump_mean": -0.04, "jump_vol": 0.08}
        result = _extract_jump_params_from_stats(None, defaults)
        self.assertEqual(result, defaults)

    def test_stats_without_tail_distribution_returns_defaults(self):
        from app.allocation.data.historical_calibrator import _extract_jump_params_from_stats
        defaults = {"jump_probability": 0.03, "jump_mean": -0.04, "jump_vol": 0.08}
        stats = {
            "long_window": {"returns": {"a_share_large": -15.0}, "n_observations": 72},
            "quality": {a: {"status": "available"} for a in ASSET_CLASSES},
        }
        result = _extract_jump_params_from_stats(stats, defaults)
        self.assertEqual(result, defaults)

    def test_extracts_real_tail_stats_when_available(self):
        from app.allocation.data.historical_calibrator import _extract_jump_params_from_stats
        defaults = {"jump_probability": 0.03, "jump_mean": -0.04, "jump_vol": 0.08}
        stats = {
            "long_window": {
                "jump_tail_stats": {
                    "jump_probability": 0.012345,
                    "jump_mean": -0.035,
                    "jump_vol": 0.011,
                    "sample_size": 5000,
                    "tail_count": 62,
                    "source_assets": ["a_share_large", "a_share_small"],
                },
                "window_start": "2023-01-01",
                "window_end": "2026-01-01",
                "n_observations": 720,
                "confidence_score": 0.82,
            }
        }
        result = _extract_jump_params_from_stats(stats, defaults)
        self.assertEqual(result["jump_probability"], 0.012345)
        self.assertEqual(result["jump_mean"], -0.035)
        self.assertEqual(result["jump_vol"], 0.011)
        self.assertEqual(result["sample_size"], 5000)
        self.assertEqual(result["tail_count"], 62)
        self.assertEqual(result["source_assets"], ["a_share_large", "a_share_small"])

    def test_rejects_too_few_tail_events(self):
        from app.allocation.data.historical_calibrator import _extract_jump_params_from_stats
        defaults = {"jump_probability": 0.03, "jump_mean": -0.04, "jump_vol": 0.08}
        stats = {
            "jump_tail_stats": {
                "jump_probability": 0.001,
                "jump_mean": -0.02,
                "jump_vol": 0.01,
                "sample_size": 5000,
                "tail_count": 2,
            }
        }
        result = _extract_jump_params_from_stats(stats, defaults)
        self.assertEqual(result, defaults)

    def test_calibrate_jump_params_uses_real_tail_stats(self):
        snapshot = _make_long_window_stats()
        snapshot["long_window"]["jump_tail_stats"] = {
            "jump_probability": 0.012,
            "jump_mean": -0.033,
            "jump_vol": 0.012,
            "sample_size": 5000,
            "tail_count": 60,
            "source_assets": ["a_share_large", "a_share_small", "hk_equity"],
        }
        result = HistoricalCalibrator(stats_snapshot=snapshot).calibrate_jump_params()
        self.assertEqual(result["source"], "long_window_snapshot")
        self.assertEqual(result["data_status"], "partial")
        self.assertEqual(result["params"]["jump_probability"], 0.012)
        self.assertEqual(result["params"]["sample_size"], 5000)
        self.assertEqual(result["window_start"], "2020-01-01")
        self.assertEqual(result["n_observations"], 72)


class StressScenarioScalingTest(unittest.TestCase):
    """Tests for _scale_stress_scenarios_from_stats config-driven scaling."""

    def test_no_stats_returns_base(self):
        from app.allocation.data.historical_calibrator import _scale_stress_scenarios_from_stats
        base = {"crash": {"a_share_large": -0.25}}
        result = _scale_stress_scenarios_from_stats(None, base)
        self.assertEqual(result, base)

    def test_insufficient_quality_returns_base(self):
        from app.allocation.data.historical_calibrator import _scale_stress_scenarios_from_stats
        base = {"crash": {"a_share_large": -0.25}}
        stats = {"long_window": {"vols": {}}, "quality": {}}
        result = _scale_stress_scenarios_from_stats(stats, base)
        self.assertEqual(result, base)

    def test_vol_ratio_scaling_uses_config(self):
        from app.allocation.data.historical_calibrator import _scale_stress_scenarios_from_stats
        from app.allocation.config import EQUILIBRIUM_VOLS
        quality = {a: {"status": "available"} for a in ASSET_CLASSES if a != "cash"}
        quality["cash"] = {"status": "assumption", "reason": "no_representative_etf"}
        vols = {a: EQUILIBRIUM_VOLS.get(a, 10.0) * 1.5 for a in ASSET_CLASSES}
        stats = {"long_window": {"vols": vols}, "quality": quality}
        base = {"crash": {"a_share_large": -0.25, "rate_bond": 0.05, "gold": -0.10}}
        result = _scale_stress_scenarios_from_stats(stats, base)
        self.assertLess(result["crash"]["a_share_large"], -0.25)


if __name__ == "__main__":
    unittest.main()
