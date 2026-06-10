import unittest

from app.allocation import cma_manager
from app.allocation.config import ASSET_CLASSES, DEFAULT_CORR
from app.allocation.data import market_data_service
from app.allocation.models import RegimeState


class CMADataQualityTest(unittest.TestCase):
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
