import unittest
from unittest.mock import patch

from app.allocation import cma_manager
from app.allocation.config import ASSET_CLASSES, DEFAULT_CORR
from app.allocation.data import market_data_service
from app.allocation.models import RegimeState


class CMADataQualityTest(unittest.TestCase):
    def test_historical_anchor_is_used_when_signal_layer_missing(self):
        returns = {asset: float(index + 1) for index, asset in enumerate(ASSET_CLASSES)}
        vols = {asset: float(index + 10) for index, asset in enumerate(ASSET_CLASSES)}
        snapshot = {
            "equilibrium_returns": {
                "values": returns,
                "source": "historical_market_data",
                "as_of": "2026-06-10",
                "coverage": 1.0,
                "valid_assets": list(ASSET_CLASSES),
                "invalid_assets": {},
                "assumptions_used": [],
                "calibration_version": "historical-calibrator-v1",
            },
            "equilibrium_vols": {
                "values": vols,
                "source": "historical_market_data",
                "as_of": "2026-06-10",
                "coverage": 1.0,
                "valid_assets": list(ASSET_CLASSES),
                "invalid_assets": {},
                "assumptions_used": [],
                "calibration_version": "historical-calibrator-v1",
            },
            "correlation_matrix": {
                "matrix": DEFAULT_CORR,
                "source": "historical_market_data",
                "as_of": "2026-06-10",
                "coverage": 1.0,
                "valid_assets": list(ASSET_CLASSES),
                "invalid_assets": {},
                "assumptions_used": [],
                "calibration_version": "historical-calibrator-v1",
            },
        }

        with patch("app.allocation.cma_manager._get_signal_layer", return_value=(None, None, None, {})), patch(
            "app.allocation.cma_manager._load_cached_anchor_snapshot",
            return_value=None,
        ), patch(
            "app.allocation.cma_manager._current_market_stats_snapshot",
            return_value={"returns_long": returns, "vols_long": vols, "correlation_matrix": DEFAULT_CORR, "quality": {}},
        ), patch(
            "app.allocation.data.historical_calibrator.HistoricalCalibrator.calibrate_all",
            return_value=snapshot,
        ):
            cma = cma_manager.estimate_cma(RegimeState())

        self.assertEqual(cma.expected_returns["a_share_large"], returns["a_share_large"])
        self.assertEqual(cma.quality["data_status"], "partial")
        self.assertEqual(cma.quality["anchor_source"], "historical_market_data")
        self.assertEqual(cma.quality["source"], "historical_anchor")
        self.assertEqual(cma.quality["calibration_version"], "historical-calibrator-v1")

    def test_long_window_anchor_source_is_not_reported_as_static(self):
        returns = {asset: float(index + 1) for index, asset in enumerate(ASSET_CLASSES)}
        vols = {asset: float(index + 10) for index, asset in enumerate(ASSET_CLASSES)}
        snapshot = {
            "equilibrium_returns": {"values": returns, "source": "long_window_snapshot", "coverage": 1.0},
            "equilibrium_vols": {"values": vols, "source": "long_window_snapshot", "coverage": 1.0},
            "correlation_matrix": {"matrix": DEFAULT_CORR, "source": "long_window_snapshot", "coverage": 1.0},
        }

        with patch("app.allocation.cma_manager._get_signal_layer", return_value=(None, None, None, {})), patch(
            "app.allocation.cma_manager._load_cached_anchor_snapshot",
            return_value=snapshot,
        ):
            cma = cma_manager.estimate_cma(RegimeState())

        self.assertEqual(cma.quality["anchor_source"], "long_window_snapshot")
        self.assertEqual(cma.quality["source"], "historical_anchor")

    def test_reits_low_volatility_real_signal_is_allowed(self):
        ok, reason = cma_manager._validate_signal_value(
            "reits",
            -12.48,
            3.96,
            {"status": "available", "source": "representative_etf:508006"},
        )

        self.assertTrue(ok)
        self.assertIsNone(reason)

    def test_rejected_signal_asset_is_reported_and_excluded(self):
        returns = {asset: 4.0 for asset in ASSET_CLASSES}
        vols = {asset: 12.0 for asset in ASSET_CLASSES}
        quality = {
            asset: {
                "status": "available",
                "source": "representative_etf:test",
                "reason": None,
            }
            for asset in ASSET_CLASSES
        }
        returns["money_fund"] = -450.0
        vols["money_fund"] = 80.0
        quality["money_fund"] = {
            "status": "rejected",
            "source": "representative_etf:511880",
            "reason": "abnormal_price_jump",
        }

        stats = {
            "returns_long": returns,
            "vols_long": vols,
            "correlation_matrix": DEFAULT_CORR,
            "quality": quality,
        }

        original = market_data_service.get_rolling_stats_ex
        market_data_service.get_rolling_stats_ex = lambda: stats
        try:
            cma = cma_manager.estimate_cma(RegimeState())
        finally:
            market_data_service.get_rolling_stats_ex = original

        assert cma.quality is not None
        self.assertEqual(cma.quality["data_status"], "partial")
        self.assertEqual(
            cma.quality["invalid_assets"]["money_fund"],
            "abnormal_price_jump",
        )
        self.assertLessEqual(cma.expected_returns["money_fund"], 8.0)
        self.assertLessEqual(cma.volatilities["money_fund"], 3.0)


if __name__ == "__main__":
    unittest.main()
