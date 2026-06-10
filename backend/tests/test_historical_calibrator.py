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
        "returns_long": returns,
        "vols_long": vols,
        "correlation_matrix": corr.tolist(),
        "quality": quality,
        "vol_regime": vol_regime,
    }


class HistoricalCalibratorTest(unittest.TestCase):
    def test_returns_fallback_to_static_assumption_when_data_missing(self):
        with patch("app.allocation.data.market_data_fetcher.compute_rolling_stats_ex", return_value=None), patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=None,
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_returns()

        self.assertEqual(result["source"], "static_assumption")
        self.assertEqual(result["coverage"], 0.0)
        self.assertEqual(result["values"], EQUILIBRIUM_RETURNS)
        self.assertEqual(result["calibration_version"], "historical-calibrator-v1")
        self.assertTrue(result["as_of"])

    def test_vols_include_version_source_as_of_and_coverage(self):
        with patch(
            "app.allocation.data.market_data_fetcher.compute_rolling_stats_ex",
            return_value=_make_stats_snapshot(),
        ):
            result = HistoricalCalibrator().calibrate_equilibrium_vols()

        self.assertEqual(result["source"], "historical_market_data")
        self.assertEqual(result["calibration_version"], "historical-calibrator-v1")
        self.assertTrue(result["as_of"])
        self.assertGreater(result["coverage"], 0.9)
        self.assertIn("cash:no_representative_etf", result["assumptions_used"])

    def test_correlation_matrix_is_square_finite_and_has_unit_diagonal(self):
        with patch(
            "app.allocation.data.market_data_fetcher.compute_rolling_stats_ex",
            return_value=_make_stats_snapshot(),
        ):
            result = HistoricalCalibrator().calibrate_correlation_matrix()

        matrix = np.asarray(result["matrix"], dtype=float)
        self.assertEqual(matrix.shape, (len(ASSET_CLASSES), len(ASSET_CLASSES)))
        self.assertTrue(np.all(np.isfinite(matrix)))
        self.assertTrue(np.allclose(np.diag(matrix), 1.0))


if __name__ == "__main__":
    unittest.main()
