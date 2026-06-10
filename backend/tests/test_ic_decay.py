"""Tests for ic_decay module — historical IC computation and signal series building."""
import unittest

import numpy as np

from app.allocation.data.ic_decay import (
    build_daily_signal_series,
    compute_ic_series,
    ic_half_life,
    signal_quality_score,
    analyze_macro_signals,
)


class BuildDailySignalSeriesTest(unittest.TestCase):
    """Test conversion of monthly macro history to daily signal series."""

    def test_basic_forward_fill(self):
        """Monthly values are forward-filled to daily dates."""
        history = [
            ("2024-06", 52.0, "api"),
            ("2024-05", 51.5, "api"),
            ("2024-04", 50.8, "api"),
            ("2024-03", 51.2, "api"),
            ("2024-02", 50.5, "api"),
            ("2024-01", 50.0, "api"),
        ]
        # Daily dates spanning Jan-Jun 2024 (need 60+ for valid count)
        return_dates = []
        for m in range(1, 7):
            for d in range(1, 22):
                return_dates.append(f"2024-{m:02d}-{d:02d}")

        result = build_daily_signal_series(history, return_dates)

        self.assertIsNotNone(result)
        self.assertEqual(len(result), len(return_dates))
        # Jan dates get 50.0
        self.assertAlmostEqual(result[0], 50.0)
        self.assertAlmostEqual(result[20], 50.0)
        # Jun dates get 52.0
        self.assertAlmostEqual(result[-1], 52.0)
        self.assertAlmostEqual(result[-21], 52.0)

    def test_insufficient_history_returns_none(self):
        """Fewer than 6 monthly observations returns None."""
        history = [
            ("2024-03", 51.0, "api"),
            ("2024-02", 50.5, "api"),
            ("2024-01", 50.0, "api"),
        ]
        return_dates = ["2024-01-15", "2024-02-15", "2024-03-15"]

        result = build_daily_signal_series(history, return_dates)

        self.assertIsNone(result)

    def test_leading_nan_trimmed(self):
        """Dates before first monthly observation produce NaN, trimmed by valid count check."""
        history = [
            ("2024-06", 52.0, "api"),
            ("2024-05", 51.5, "api"),
            ("2024-04", 50.8, "api"),
            ("2024-03", 51.2, "api"),
            ("2024-02", 50.5, "api"),
            ("2024-01", 50.0, "api"),
        ]
        # Return dates: 30 before first macro data, then 100 days of Jan-Jun
        return_dates = [f"2023-12-{d:02d}" for d in range(1, 31)]
        for m in range(1, 7):
            for d in range(1, 22):
                return_dates.append(f"2024-{m:02d}-{d:02d}")

        result = build_daily_signal_series(history, return_dates)

        # First elements are NaN (before first observation), but 100+ valid
        self.assertIsNotNone(result)
        self.assertTrue(np.isnan(result[0]))
        # After Jan 2024, values are filled
        self.assertAlmostEqual(result[30], 50.0)  # First Jan date

    def test_empty_history(self):
        result = build_daily_signal_series([], ["2024-01-15"])
        self.assertIsNone(result)

    def test_yyyy_mm_dd_format(self):
        """History entries with YYYY-MM-DD format are parsed as monthly."""
        history = [
            ("2024-06-30", 52.0, "api"),
            ("2024-05-31", 51.5, "api"),
            ("2024-04-30", 50.8, "api"),
            ("2024-03-31", 51.2, "api"),
            ("2024-02-29", 50.5, "api"),
            ("2024-01-31", 50.0, "api"),
        ]
        # Need 60+ dates for valid count threshold
        return_dates = []
        for m in range(1, 7):
            for d in range(1, 22):
                return_dates.append(f"2024-{m:02d}-{d:02d}")

        result = build_daily_signal_series(history, return_dates)

        self.assertIsNotNone(result)
        self.assertAlmostEqual(result[0], 50.0)
        self.assertAlmostEqual(result[-1], 52.0)


class ComputeICSeriesTest(unittest.TestCase):
    """Test compute_ic_series with synthetic data."""

    def test_perfect_positive_correlation(self):
        """Linearly related signal and returns produce high IC."""
        np.random.seed(42)
        n = 300
        signal = np.linspace(0, 10, n)
        returns = signal * 0.01 + np.random.normal(0, 0.001, n)

        result = compute_ic_series(signal, returns)

        self.assertIsNotNone(result.get("1m"))
        self.assertGreater(abs(result["1m"]), 0.3)

    def test_no_correlation(self):
        """Uncorrelated signal and returns produce near-zero IC."""
        np.random.seed(42)
        n = 300
        signal = np.random.normal(0, 1, n)
        returns = np.random.normal(0, 0.01, n)

        result = compute_ic_series(signal, returns)

        # Should be near zero for all horizons
        for horizon, ic in result.items():
            if ic is not None:
                self.assertLess(abs(ic), 0.3)

    def test_short_series_returns_none(self):
        """Series shorter than 10 valid points returns None for all horizons."""
        signal = np.array([1.0, 2.0, 3.0])
        returns = np.array([0.01, 0.02, 0.03])

        result = compute_ic_series(signal, returns)

        for v in result.values():
            self.assertIsNone(v)

    def test_nan_handling(self):
        """NaN values are excluded from correlation."""
        n = 300
        signal = np.linspace(0, 10, n)
        returns = signal * 0.01
        signal[50:60] = np.nan
        returns[100:110] = np.nan

        result = compute_ic_series(signal, returns)

        self.assertIsNotNone(result.get("1m"))
        self.assertGreater(abs(result["1m"]), 0.3)

    def test_stable_behavior(self):
        """Existing compute_ic_series behavior remains stable."""
        np.random.seed(123)
        n = 252
        signal = np.random.normal(0, 1, n)
        returns = signal * 0.005 + np.random.normal(0, 0.01, n)

        result = compute_ic_series(signal, returns)

        # All horizons should produce values
        self.assertIn("1m", result)
        self.assertIn("3m", result)
        self.assertIn("6m", result)
        self.assertIn("12m", result)
        # 1m should be valid (252 - 21 = 231 > 10)
        self.assertIsNotNone(result["1m"])
        # 12m should be valid (252 - 252 = 0, but we need 10)
        self.assertIsNone(result["12m"])


class ICHalfLifeTest(unittest.TestCase):
    """Test ic_half_life threshold detection."""

    def test_fast_decay(self):
        ic = {"1m": 0.20, "3m": 0.08, "6m": 0.03, "12m": 0.01}
        result = ic_half_life(ic)
        self.assertEqual(result, "3m")  # 0.08 < 0.10 (half of 0.20)

    def test_slow_decay(self):
        ic = {"1m": 0.15, "3m": 0.14, "6m": 0.12, "12m": 0.10}
        result = ic_half_life(ic)
        self.assertIsNone(result)  # Never drops below 50%

    def test_no_meaningful_signal(self):
        ic = {"1m": 0.005, "3m": 0.003}
        result = ic_half_life(ic)
        self.assertIsNone(result)  # Peak < 0.01


class SignalQualityScoreTest(unittest.TestCase):
    """Test signal_quality_score composite metric."""

    def test_strong_persistent_signal(self):
        ic = {"1m": 0.15, "3m": 0.14, "6m": 0.13, "12m": 0.12}
        score = signal_quality_score(ic)
        self.assertGreater(score, 0.5)

    def test_weak_signal(self):
        ic = {"1m": 0.02, "3m": 0.01, "6m": 0.005}
        score = signal_quality_score(ic)
        self.assertLess(score, 0.3)

    def test_single_horizon(self):
        ic = {"1m": 0.10}
        score = signal_quality_score(ic)
        self.assertEqual(score, 0.0)  # Need at least 2 horizons


class AnalyzeMacroSignalsTest(unittest.TestCase):
    """Test analyze_macro_signals with synthetic data."""

    def test_basic_analysis(self):
        np.random.seed(42)
        n = 200
        signals = {
            "PMI": np.linspace(48, 52, n) + np.random.normal(0, 0.5, n),
        }
        asset_returns = {
            "equity": np.random.normal(0.0005, 0.015, n),
        }

        result = analyze_macro_signals(signals, asset_returns)

        self.assertIn("PMI", result)
        self.assertIn("assets", result["PMI"])
        self.assertIn("equity", result["PMI"]["assets"])
        self.assertIn("ic_series", result["PMI"]["assets"]["equity"])
        self.assertIn("quality", result["PMI"]["assets"]["equity"])

    def test_short_series_skipped(self):
        signals = {"PMI": np.array([50.0] * 30)}
        asset_returns = {"equity": np.array([0.001] * 30)}

        result = analyze_macro_signals(signals, asset_returns)

        # PMI should have no asset results (too short)
        self.assertEqual(len(result["PMI"]["assets"]), 0)


if __name__ == "__main__":
    unittest.main()
