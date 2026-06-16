import tempfile
import unittest
from datetime import date, timedelta

from app.data.cache_manager import CacheManager
from app.data.efinance_fetcher import _calc_fixed_dca
import app.services.dca_service as dca_service


def constant_nav(start: date, end: date, nav: float = 1.0):
    points = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            points.append({"date": current.isoformat(), "nav": nav})
        current += timedelta(days=1)
    return points


class DcaLogicTest(unittest.TestCase):
    def setUp(self):
        self.original_cache = dca_service.cache
        self.original_get_nav_history = dca_service._get_nav_history
        dca_service.cache = CacheManager(tempfile.mkdtemp())

    def tearDown(self):
        dca_service.cache = self.original_cache
        dca_service._get_nav_history = self.original_get_nav_history

    def test_constant_nav_has_zero_risk_adjusted_return(self):
        result = _calc_fixed_dca(constant_nav(date(2025, 1, 1), date(2025, 12, 31)), 1000, "monthly")

        self.assertEqual(result["total_profit_rate"], 0)
        self.assertEqual(result["annual_return"], 0)
        self.assertEqual(result["max_drawdown"], 0)
        self.assertEqual(result["sharpe_ratio"], 0)

    def test_cache_key_separates_different_amounts(self):
        nav = constant_nav(date(2025, 1, 1), date(2025, 12, 31))
        dca_service._get_nav_history = lambda *_args, **_kwargs: nav

        first = dca_service.run_dca_backtest(
            ["000001"], amount=1000, frequency="monthly", strategy="fixed", start_date="2025-01-01", end_date="2025-12-31"
        )
        second = dca_service.run_dca_backtest(
            ["000001"], amount=2000, frequency="monthly", strategy="fixed", start_date="2025-01-01", end_date="2025-12-31"
        )

        self.assertEqual(first["individual"][0]["total_invested"], 12000)
        self.assertEqual(second["individual"][0]["total_invested"], 24000)
        self.assertIn("cagr", first["individual"][0])
        self.assertIn("max_drawdown_duration_days", first["individual"][0])
        self.assertIn("benchmark_excess", first["individual"][0])
        self.assertEqual(first["individual"][0]["benchmark_status"], "available")

    def test_backend_combined_backtest_sums_portfolio_cashflows(self):
        nav = constant_nav(date(2025, 1, 1), date(2025, 12, 31))
        dca_service._get_nav_history = lambda *_args, **_kwargs: nav

        result = dca_service.run_dca_backtest(
            ["000001", "000002"], amount=1000, frequency="monthly", strategy="fixed", start_date="2025-01-01", end_date="2025-12-31"
        )

        self.assertEqual(result["combined"]["total_invested"], 24000)
        self.assertEqual(result["combined"]["total_value"], 24000)
        self.assertEqual(result["combined"]["sharpe_ratio"], 0)
        self.assertIn("best_month", result["combined"])
        self.assertIn("worst_month", result["combined"])
        self.assertEqual(result["combined"]["benchmark_status"], "available")

    def test_suggestion_handles_flat_recent_nav(self):
        nav = constant_nav(date(2025, 1, 1), date(2025, 4, 30))
        dca_service._get_nav_history = lambda *_args, **_kwargs: nav

        result = dca_service.get_dca_suggestion("000001")

        self.assertEqual(result["position"], 50)


if __name__ == "__main__":
    unittest.main()
