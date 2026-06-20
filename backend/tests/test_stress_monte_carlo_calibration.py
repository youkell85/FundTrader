import unittest
from unittest.mock import patch

from app.allocation.config import ASSET_CLASSES
from app.allocation.models import AllocationRequest, CMAResult
from app.allocation.monte_carlo import simulate
from app.allocation.orchestrator import run
from app.allocation.stress_test import StressCalibrationUnavailable, run_stress_tests


def _cma() -> CMAResult:
    return CMAResult(
        expected_returns={asset: 4.0 for asset in ASSET_CLASSES},
        volatilities={asset: 10.0 for asset in ASSET_CLASSES},
        covariance_matrix=[[0.01 if i == j else 0.0 for j in ASSET_CLASSES] for i in ASSET_CLASSES],
    )


class StressMonteCarloCalibrationTest(unittest.TestCase):
    def test_stress_results_require_calibrated_source(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=None):
            with self.assertRaises(StressCalibrationUnavailable):
                run_stress_tests({"a_share_large": 1.0})

    def test_static_stress_snapshot_is_rejected(self):
        snapshot = {
            "stress_scenarios": {
                "source": "static_assumption",
                "status": "assumption",
                "params": {"fake": {asset: -1.0 for asset in ASSET_CLASSES}},
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=snapshot):
            with self.assertRaises(StressCalibrationUnavailable):
                run_stress_tests({"a_share_large": 1.0})

    def test_calibrated_stress_results_use_cache_drawdowns(self):
        snapshot = {
            "stress_scenarios": {
                "source": "historical_market_data",
                "status": "partial",
                "source_window": "2024-01-01/2026-01-01",
                "calibration_version": "stress-cal-v2",
                "params": {
                    "calibrated selloff": {asset: -10.0 for asset in ASSET_CLASSES},
                    "calibrated rebound": {asset: 2.0 for asset in ASSET_CLASSES},
                },
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=snapshot):
            results = run_stress_tests({"a_share_large": 1.0, "convertible": 1.0})

        self.assertEqual(len(results), 2)
        self.assertTrue(results)
        self.assertTrue(all(item.source == "historical_market_data" for item in results))
        self.assertTrue(all(item.calibration_version == "stress-cal-v2" for item in results))
        self.assertFalse(any("convertible" in (item.calibration_version or "") for item in results))

    def test_orchestrator_skips_stress_tests_without_real_calibration(self):
        request = AllocationRequest(
            risk_tolerance="balanced",
            age=40,
            amount=100000,
            horizon="3-5y",
            goal_type="wealth",
        )

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=None):
            result = run(request)

        self.assertEqual(result.stress_tests, [])
        self.assertTrue(any("压力测试缺少真实校准数据" in item for item in result.warnings))

    def test_monte_carlo_result_includes_jump_metadata(self):
        snapshot = {
            "jump_params": {
                "source": "historical_market_data",
                "as_of": "2026-06-10",
                "calibration_version": "historical-calibrator-v1",
                "params": {
                    "jump_probability": 0.01,
                    "jump_mean": -0.02,
                    "jump_vol": 0.03,
                    "sample_size": 120,
                },
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=snapshot):
            result = simulate({"a_share_large": 1.0}, _cma(), horizon_months=6, n_paths=50)

        self.assertEqual(result.jump_source, "historical_market_data")
        self.assertEqual(result.jump_sample_size, 120)
        self.assertEqual(result.calibration_version, "historical-calibrator-v1")
        self.assertIsNone(result.jump_missing_reason)

    def test_monte_carlo_missing_jump_params_disables_jump_without_static_fallback(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=None):
            result = simulate({"a_share_large": 1.0}, _cma(), horizon_months=6, n_paths=50)

        self.assertEqual(result.jump_source, "missing")
        self.assertIsNone(result.calibration_version)
        self.assertIsNotNone(result.jump_missing_reason)

    def test_monte_carlo_rejects_static_jump_params(self):
        snapshot = {
            "jump_params": {
                "source": "static_assumption",
                "status": "assumption",
                "calibration_version": "static-jump-params",
                "params": {
                    "jump_probability": 0.02,
                    "jump_mean": -0.03,
                    "jump_vol": 0.025,
                },
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=snapshot):
            result = simulate({"a_share_large": 1.0}, _cma(), horizon_months=6, n_paths=50)

        self.assertEqual(result.jump_source, "missing")
        self.assertIsNone(result.calibration_version)
        self.assertIn("static assumption", result.jump_missing_reason)

    def test_monte_carlo_invalid_jump_params_do_not_use_defaults(self):
        snapshot = {
            "jump_params": {
                "source": "historical_market_data",
                "params": {
                    "jump_probability": 1.5,
                    "jump_mean": -0.03,
                    "jump_vol": 0.025,
                },
            }
        }

        with patch("app.storage.database.StatsSnapshotCache.get", return_value=snapshot):
            result = simulate({"a_share_large": 1.0}, _cma(), horizon_months=6, n_paths=50)

        self.assertEqual(result.jump_source, "missing")
        self.assertIn("invalid", result.jump_missing_reason)


if __name__ == "__main__":
    unittest.main()
