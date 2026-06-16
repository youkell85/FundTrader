"""Tests for backtest metrics computation."""

import unittest
import numpy as np

from app.allocation.backtest.metrics import compute_metrics


def _build_curve(start: float, daily_returns: list) -> tuple:
    """Build (daily_values, dates) from a list of daily returns."""
    values = [start]
    for r in daily_returns:
        values.append(values[-1] * (1 + r))
    dates = [f"2020-01-{i + 1:02d}" for i in range(len(values))]
    return values, dates


def _build_benchmark(start: float, daily_returns: list) -> list:
    """Build benchmark daily values from returns."""
    values = [start]
    for r in daily_returns:
        values.append(values[-1] * (1 + r))
    return values


class TestSortinoRatio(unittest.TestCase):
    def test_sortino_with_downside(self):
        """Sortino should be non-None when downside deviation exists."""
        # Positive overall return with some downside days
        np.random.seed(42)
        returns = list(np.random.normal(0.0005, 0.01, 252))  # mixed up/down
        values, dates = _build_curve(1_000_000, returns)
        m = compute_metrics(values, dates, [])
        self.assertIsNotNone(m.sortino_ratio)

    def test_sortino_no_downside(self):
        """Sortino should be None when no downside returns."""
        returns = [0.005] * 200  # all positive, no downside
        values, dates = _build_curve(1_000_000, returns)
        m = compute_metrics(values, dates, [])
        self.assertIsNone(m.sortino_ratio)


class TestCalmarRatio(unittest.TestCase):
    def test_calmar_with_drawdown(self):
        """Calmar should be non-None when max_drawdown > 0."""
        # Build a curve with drawdown: up then down
        returns = [0.002] * 50 + [-0.001] * 100  # peak then decline
        values, dates = _build_curve(1_000_000, returns)
        m = compute_metrics(values, dates, [])
        self.assertIsNotNone(m.calmar_ratio)
        self.assertGreater(m.max_drawdown, 0)

    def test_calmar_no_drawdown(self):
        """Calmar should be None when max_drawdown is 0."""
        returns = [0.001] * 200  # monotonic increase, no drawdown
        values, dates = _build_curve(1_000_000, returns)
        m = compute_metrics(values, dates, [])
        self.assertEqual(m.max_drawdown, 0.0)
        self.assertIsNone(m.calmar_ratio)


class TestBenchmarkDependentMetrics(unittest.TestCase):
    def test_with_benchmark(self):
        """Benchmark-dependent metrics should be non-None when benchmark provided."""
        # Strategy with noisy returns, correlated with benchmark
        np.random.seed(123)
        bench_returns = list(np.random.normal(0.0005, 0.01, 252))
        # Strategy: correlated but slightly different
        strategy_returns = [b + np.random.normal(0.0002, 0.005) for b in bench_returns]
        values, dates = _build_curve(1_000_000, strategy_returns)
        bench_values = _build_benchmark(1_000_000, bench_returns)

        m = compute_metrics(values, dates, [], benchmark_daily_values=bench_values)
        self.assertIsNotNone(m.tracking_error)
        self.assertIsNotNone(m.information_ratio)
        self.assertIsNotNone(m.beta)
        self.assertIsNotNone(m.alpha)

    def test_without_benchmark(self):
        """Benchmark-dependent metrics should be None when no benchmark."""
        returns = [0.001] * 252
        values, dates = _build_curve(1_000_000, returns)
        m = compute_metrics(values, dates, [])
        self.assertIsNone(m.tracking_error)
        self.assertIsNone(m.information_ratio)
        self.assertIsNone(m.beta)
        self.assertIsNone(m.alpha)

    def test_beta_approx_one_when_correlated(self):
        """Beta should be approximately 1 when strategy closely tracks benchmark."""
        np.random.seed(456)
        bench_returns = list(np.random.normal(0.0005, 0.01, 252))
        # Strategy tracks benchmark closely (small tracking error)
        strategy_returns = [b + np.random.normal(0, 0.001) for b in bench_returns]
        values, dates = _build_curve(1_000_000, strategy_returns)
        bench_values = _build_benchmark(1_000_000, bench_returns)
        m = compute_metrics(values, dates, [], benchmark_daily_values=bench_values)
        self.assertIsNotNone(m.beta)
        # Beta should be close to 1 (within +/- 0.5)
        self.assertGreater(m.beta, 0.5)
        self.assertLess(m.beta, 1.5)

    def test_extended_diagnostics_are_populated(self):
        """P1 diagnostics include CAGR, benchmark excess, and best/worst month."""
        values = [100, 105, 103, 110, 108, 114]
        dates = ["2025-01-02", "2025-01-31", "2025-02-03", "2025-02-28", "2025-03-03", "2025-03-31"]
        bench_values = [100, 102, 101, 103, 104, 105]

        m = compute_metrics(values, dates, [], benchmark_daily_values=bench_values)

        self.assertEqual(m.cagr, m.annualized_return)
        self.assertEqual(m.benchmark_status, "available")
        self.assertIsNotNone(m.benchmark_return)
        self.assertIsNotNone(m.benchmark_excess)
        self.assertEqual(m.best_month["month"], "2025-01")
        self.assertEqual(m.worst_month["month"], "2025-03")


class TestPercentageUnits(unittest.TestCase):
    def test_annualized_return_is_percentage(self):
        """annualized_return should be percentage (e.g. 7.2 for 7.2%)."""
        returns = [0.0003] * 252  # ~7.6% annual
        values, dates = _build_curve(1_000_000, returns)
        m = compute_metrics(values, dates, [])
        self.assertGreater(m.annualized_return, 1)
        self.assertLess(m.annualized_return, 20)

    def test_tracking_error_is_percentage(self):
        """tracking_error should be percentage."""
        np.random.seed(789)
        bench_returns = list(np.random.normal(0.0005, 0.01, 252))
        strategy_returns = [b + np.random.normal(0.0002, 0.005) for b in bench_returns]
        values, dates = _build_curve(1_000_000, strategy_returns)
        bench_values = _build_benchmark(1_000_000, bench_returns)
        m = compute_metrics(values, dates, [], benchmark_daily_values=bench_values)
        self.assertIsNotNone(m.tracking_error)
        self.assertGreater(m.tracking_error, 0.1)

    def test_alpha_is_percentage(self):
        """alpha should be percentage."""
        np.random.seed(321)
        bench_returns = list(np.random.normal(0.0005, 0.01, 252))
        strategy_returns = [b + np.random.normal(0.0002, 0.005) for b in bench_returns]
        values, dates = _build_curve(1_000_000, strategy_returns)
        bench_values = _build_benchmark(1_000_000, bench_returns)
        m = compute_metrics(values, dates, [], benchmark_daily_values=bench_values)
        self.assertIsNotNone(m.alpha)
        self.assertIsInstance(m.alpha, float)


class TestNoOldFieldNames(unittest.TestCase):
    def test_no_old_vol_field(self):
        """Should not have annualized_vol field."""
        returns = [0.001] * 50
        values, dates = _build_curve(1_000_000, returns)
        m = compute_metrics(values, dates, [])
        # annualized_volatility exists, annualized_vol does not
        self.assertTrue(hasattr(m, 'annualized_volatility'))
        self.assertFalse(hasattr(m, 'annualized_vol'))

    def test_no_old_win_rate_field(self):
        """Should not have win_rate_monthly field."""
        returns = [0.001] * 50
        values, dates = _build_curve(1_000_000, returns)
        m = compute_metrics(values, dates, [])
        self.assertTrue(hasattr(m, 'monthly_win_rate'))
        self.assertFalse(hasattr(m, 'win_rate_monthly'))


class TestEmptyMetrics(unittest.TestCase):
    def test_empty_returns_none_for_ratios(self):
        """Empty metrics should return None for optional ratios."""
        m = compute_metrics([], [], [])
        self.assertIsNone(m.sortino_ratio)
        self.assertIsNone(m.calmar_ratio)
        self.assertIsNone(m.information_ratio)
        self.assertIsNone(m.alpha)
        self.assertIsNone(m.beta)
        self.assertIsNone(m.tracking_error)


if __name__ == '__main__':
    unittest.main()
