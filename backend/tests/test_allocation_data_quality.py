import unittest
from unittest.mock import patch

import numpy as np

from app.allocation.data import market_data_fetcher
from app.allocation.data.market_data_service import MarketDataService


class AllocationMarketDataQualityTest(unittest.TestCase):
    def test_validate_price_series_rejects_money_fund_price_jump(self):
        prices = np.concatenate([
            np.linspace(100.0, 100.2, market_data_fetcher.MIN_DAYS),
            np.array([1.0, 1.0]),
        ])

        ok, reason = market_data_fetcher._validate_price_series("money_fund", "511880", prices)

        self.assertFalse(ok)
        self.assertEqual(reason, "abnormal_price_jump")

    def test_compute_rolling_stats_ex_excludes_rejected_asset(self):
        normal_prices = np.linspace(1.0, 1.2, market_data_fetcher.MIN_DAYS + 160)
        bad_money_prices = np.concatenate([
            np.linspace(100.0, 100.2, market_data_fetcher.MIN_DAYS + 158),
            np.array([1.0, 1.0]),
        ])

        def fake_fetch(code):
            if code == "511880":
                return bad_money_prices
            return normal_prices

        with patch.object(market_data_fetcher, "_fetch_etf_nav", side_effect=fake_fetch):
            result = market_data_fetcher.compute_rolling_stats_ex()

        self.assertIsNotNone(result)
        assert result is not None
        self.assertIsNone(result["returns_long"]["money_fund"])
        self.assertIsNone(result["vols_long"]["money_fund"])
        self.assertEqual(result["quality"]["money_fund"]["status"], "rejected")
        self.assertEqual(result["quality"]["money_fund"]["reason"], "abnormal_price_jump")

        corr = np.asarray(result["correlation_matrix"], dtype=float)
        cov = np.asarray(result["covariance_matrix"], dtype=float)
        self.assertTrue(np.all(np.isfinite(corr)))
        self.assertTrue(np.all(np.isfinite(cov)))

    def test_market_data_status_exposes_invalid_assets_and_health(self):
        service = MarketDataService()
        service._rolling_stats = ({}, {}, [])
        service._rolling_stats_ex = {
            "quality": {
                "a_share_large": {"status": "available", "reason": None},
                "money_fund": {"status": "rejected", "reason": "abnormal_price_jump"},
                "cash": {"status": "assumption", "reason": "no_representative_etf"},
            }
        }

        status = service.get_status()

        self.assertEqual(status["health"], "degraded")
        self.assertTrue(status["rolling_stats_available"])
        self.assertEqual(status["rolling_coverage"], 0.3333)
        self.assertEqual(status["invalid_assets"]["money_fund"], "abnormal_price_jump")
        self.assertIn("cash:no_representative_etf", status["assumptions_used"])


if __name__ == "__main__":
    unittest.main()
