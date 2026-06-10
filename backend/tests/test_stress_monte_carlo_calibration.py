import unittest
from unittest.mock import patch

from app.allocation.config import ASSET_CLASSES
from app.allocation.models import CMAResult
from app.allocation.monte_carlo import simulate
from app.allocation.stress_test import run_stress_tests


def _cma() -> CMAResult:
    return CMAResult(
        expected_returns={asset: 4.0 for asset in ASSET_CLASSES},
        volatilities={asset: 10.0 for asset in ASSET_CLASSES},
        covariance_matrix=[[0.01 if i == j else 0.0 for j in ASSET_CLASSES] for i in ASSET_CLASSES],
    )


class StressMonteCarloCalibrationTest(unittest.TestCase):
    def test_stress_results_include_static_source_metadata(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=None):
            results = run_stress_tests({"a_share_large": 1.0})

        self.assertTrue(results)
        self.assertTrue(all(item.source for item in results))
        self.assertIn("static", results[0].calibration_version)

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


if __name__ == "__main__":
    unittest.main()
