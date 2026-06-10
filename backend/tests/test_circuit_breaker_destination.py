"""Tests for circuit breaker destination policy.

Covers:
- Default proportional behavior is unchanged
- Configured destination weights route cut to specified cash-equivalent assets
- Invalid policy falls back to default
- Non-cash-equivalent destination assets are ignored
"""
import unittest
from unittest.mock import patch

from app.allocation.circuit_breaker import _reduce_equity, _load_destination_policy


class CircuitBreakerDestinationDefaultTest(unittest.TestCase):
    """Default proportional distribution behavior is unchanged."""

    def test_proportional_distribution_with_existing_cash(self):
        """When cash_equiv has existing weights, cut is distributed proportionally."""
        alloc = {
            "a_share_large": 0.30,
            "us_equity": 0.20,
            "money_fund": 0.10,
            "cash": 0.05,
            "rate_bond": 0.25,
            "gold": 0.10,
        }
        result = _reduce_equity(alloc, 0.30)

        # Equity total = 0.30 + 0.20 = 0.50, cut = 0.50 * 0.30 = 0.15
        # money_fund share = 0.10 / 0.15 = 2/3, cash share = 0.05 / 0.15 = 1/3
        # money_fund: 0.10 + 0.15 * 2/3 = 0.10 + 0.10 = 0.20
        # cash: 0.05 + 0.15 * 1/3 = 0.05 + 0.05 = 0.10
        self.assertAlmostEqual(result["money_fund"], 0.20, places=6)
        self.assertAlmostEqual(result["cash"], 0.10, places=6)
        # Equity reduced by 30%
        self.assertAlmostEqual(result["a_share_large"], 0.30 * 0.70, places=6)
        self.assertAlmostEqual(result["us_equity"], 0.20 * 0.70, places=6)
        # Non-equity, non-cash unchanged
        self.assertAlmostEqual(result["rate_bond"], 0.25, places=6)
        self.assertAlmostEqual(result["gold"], 0.10, places=6)

    def test_equal_distribution_when_no_existing_cash(self):
        """When cash_equiv has zero weights, cut is distributed equally."""
        alloc = {
            "a_share_large": 0.40,
            "us_equity": 0.30,
            "money_fund": 0.0,
            "cash": 0.0,
            "rate_bond": 0.30,
        }
        result = _reduce_equity(alloc, 0.50)

        # Equity total = 0.70, cut = 0.35
        # Equal split: each cash_equiv gets 0.175
        self.assertAlmostEqual(result["money_fund"], 0.175, places=6)
        self.assertAlmostEqual(result["cash"], 0.175, places=6)
        self.assertAlmostEqual(result["a_share_large"], 0.20, places=6)
        self.assertAlmostEqual(result["us_equity"], 0.15, places=6)

    def test_no_destination_means_default_behavior(self):
        """Passing destination=None uses default proportional behavior."""
        alloc = {
            "a_share_large": 0.50,
            "money_fund": 0.20,
            "cash": 0.10,
            "rate_bond": 0.20,
        }
        result_default = _reduce_equity(alloc, 0.30)
        result_explicit = _reduce_equity(alloc, 0.30, destination=None)
        for k in result_default:
            self.assertAlmostEqual(result_default[k], result_explicit[k], places=6)


class CircuitBreakerDestinationConfiguredTest(unittest.TestCase):
    """Configured destination weights route cut to specified cash-equivalent assets."""

    def test_destination_routes_cut_to_specified_assets(self):
        """Cut is distributed according to destination weights."""
        alloc = {
            "a_share_large": 0.30,
            "us_equity": 0.20,
            "money_fund": 0.10,
            "cash": 0.05,
            "rate_bond": 0.25,
            "gold": 0.10,
        }
        # Route 80% of cut to money_fund, 20% to cash
        destination = {"money_fund": 0.8, "cash": 0.2}
        result = _reduce_equity(alloc, 0.30, destination=destination)

        # Equity total = 0.50, cut = 0.15
        # money_fund: 0.10 + 0.15 * 0.8 = 0.10 + 0.12 = 0.22
        # cash: 0.05 + 0.15 * 0.2 = 0.05 + 0.03 = 0.08
        self.assertAlmostEqual(result["money_fund"], 0.22, places=6)
        self.assertAlmostEqual(result["cash"], 0.08, places=6)
        self.assertAlmostEqual(result["a_share_large"], 0.21, places=6)
        self.assertAlmostEqual(result["us_equity"], 0.14, places=6)

    def test_all_cut_to_single_cash_asset(self):
        """All cut can be routed to a single cash_equiv asset."""
        alloc = {
            "a_share_large": 0.40,
            "money_fund": 0.10,
            "cash": 0.10,
            "rate_bond": 0.40,
        }
        destination = {"money_fund": 1.0, "cash": 0.0}
        result = _reduce_equity(alloc, 0.50, destination=destination)

        # Equity total = 0.40, cut = 0.20
        # money_fund: 0.10 + 0.20 * 1.0 = 0.30
        # cash: 0.10 + 0.20 * 0.0 = 0.10
        self.assertAlmostEqual(result["money_fund"], 0.30, places=6)
        self.assertAlmostEqual(result["cash"], 0.10, places=6)

    def test_destination_weights_are_normalized(self):
        """Unnormalized destination weights are normalized internally."""
        alloc = {
            "a_share_large": 0.50,
            "money_fund": 0.10,
            "cash": 0.10,
            "rate_bond": 0.30,
        }
        # These sum to 10, should be normalized to 0.7/0.3
        destination = {"money_fund": 7.0, "cash": 3.0}
        result = _reduce_equity(alloc, 0.30, destination=destination)

        # Equity total = 0.50, cut = 0.15
        # money_fund: 0.10 + 0.15 * 0.7 = 0.205
        # cash: 0.10 + 0.15 * 0.3 = 0.145
        self.assertAlmostEqual(result["money_fund"], 0.205, places=6)
        self.assertAlmostEqual(result["cash"], 0.145, places=6)


class CircuitBreakerDestinationInvalidTest(unittest.TestCase):
    """Invalid policy falls back to default."""

    def test_empty_destination_falls_back(self):
        """Empty destination dict uses default proportional behavior."""
        alloc = {
            "a_share_large": 0.50,
            "money_fund": 0.20,
            "cash": 0.10,
            "rate_bond": 0.20,
        }
        result = _reduce_equity(alloc, 0.30, destination={})
        result_default = _reduce_equity(alloc, 0.30)
        for k in result_default:
            self.assertAlmostEqual(result[k], result_default[k], places=6)

    def test_all_zero_destination_falls_back(self):
        """All-zero destination weights fall back to default."""
        alloc = {
            "a_share_large": 0.50,
            "money_fund": 0.20,
            "cash": 0.10,
            "rate_bond": 0.20,
        }
        result = _reduce_equity(alloc, 0.30, destination={"money_fund": 0.0, "cash": 0.0})
        result_default = _reduce_equity(alloc, 0.30)
        for k in result_default:
            self.assertAlmostEqual(result[k], result_default[k], places=6)

    def test_negative_destination_weights_ignored(self):
        """Negative destination weights are treated as zero (fall back)."""
        alloc = {
            "a_share_large": 0.50,
            "money_fund": 0.20,
            "cash": 0.10,
            "rate_bond": 0.20,
        }
        # money_fund negative, cash zero → all invalid → fall back
        result = _reduce_equity(alloc, 0.30, destination={"money_fund": -0.5, "cash": 0.0})
        result_default = _reduce_equity(alloc, 0.30)
        for k in result_default:
            self.assertAlmostEqual(result[k], result_default[k], places=6)

    def test_non_cash_equiv_destination_assets_ignored(self):
        """Non-cash-equivalent assets in destination are ignored."""
        alloc = {
            "a_share_large": 0.30,
            "us_equity": 0.20,
            "money_fund": 0.10,
            "cash": 0.05,
            "rate_bond": 0.25,
            "gold": 0.10,
        }
        # gold is not cash_equiv, should be ignored
        destination = {"money_fund": 0.6, "cash": 0.3, "gold": 0.1}
        result = _reduce_equity(alloc, 0.30, destination=destination)

        # Only money_fund and cash are valid cash_equiv
        # Normalized: money_fund=0.6/0.9=2/3, cash=0.3/0.9=1/3
        # Equity total = 0.50, cut = 0.15
        # money_fund: 0.10 + 0.15 * 2/3 = 0.20
        # cash: 0.05 + 0.15 * 1/3 = 0.10
        self.assertAlmostEqual(result["money_fund"], 0.20, places=6)
        self.assertAlmostEqual(result["cash"], 0.10, places=6)
        # gold should be unchanged (not a destination)
        self.assertAlmostEqual(result["gold"], 0.10, places=6)


class CircuitBreakerDestinationPolicyLoaderTest(unittest.TestCase):
    """_load_destination_policy reads from StatsSnapshotCache correctly."""

    def test_returns_none_when_no_cache(self):
        """Returns None when StatsSnapshotCache has no entry."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = None
            result = _load_destination_policy()
            self.assertIsNone(result)

    def test_returns_none_when_no_destination_key(self):
        """Returns None when historical_calibration has no circuit_breaker_destination."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {"regime_thresholds": {}, "other": {}}
            result = _load_destination_policy()
            self.assertIsNone(result)

    def test_loads_nested_params(self):
        """Loads destination from nested {"params": {...}} structure."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {
                "circuit_breaker_destination": {
                    "params": {"money_fund": 0.7, "cash": 0.3}
                }
            }
            result = _load_destination_policy()
            self.assertIsNotNone(result)
            self.assertAlmostEqual(result["money_fund"], 0.7, places=6)
            self.assertAlmostEqual(result["cash"], 0.3, places=6)

    def test_loads_flat_params(self):
        """Loads destination from flat structure (no nested params key)."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {
                "circuit_breaker_destination": {"money_fund": 0.5, "cash": 0.5}
            }
            result = _load_destination_policy()
            self.assertIsNotNone(result)
            self.assertAlmostEqual(result["money_fund"], 0.5, places=6)
            self.assertAlmostEqual(result["cash"], 0.5, places=6)

    def test_normalizes_unnormalized_weights(self):
        """Unnormalized weights are normalized to sum to 1."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {
                "circuit_breaker_destination": {
                    "params": {"money_fund": 70, "cash": 30}
                }
            }
            result = _load_destination_policy()
            self.assertIsNotNone(result)
            self.assertAlmostEqual(result["money_fund"], 0.7, places=6)
            self.assertAlmostEqual(result["cash"], 0.3, places=6)

    def test_ignores_non_cash_equiv_assets(self):
        """Non-cash-equiv assets in cache are ignored."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {
                "circuit_breaker_destination": {
                    "params": {
                        "money_fund": 0.6,
                        "cash": 0.3,
                        "gold": 0.1,  # not cash_equiv
                    }
                }
            }
            result = _load_destination_policy()
            self.assertIsNotNone(result)
            self.assertAlmostEqual(result["money_fund"], 2 / 3, places=6)
            self.assertAlmostEqual(result["cash"], 1 / 3, places=6)
            self.assertNotIn("gold", result)

    def test_returns_none_when_all_weights_zero(self):
        """Returns None when all cash_equiv weights are zero."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {
                "circuit_breaker_destination": {
                    "params": {"money_fund": 0, "cash": 0}
                }
            }
            result = _load_destination_policy()
            self.assertIsNone(result)

    def test_returns_none_when_all_weights_negative(self):
        """Returns None when all cash_equiv weights are negative."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {
                "circuit_breaker_destination": {
                    "params": {"money_fund": -0.5, "cash": -0.5}
                }
            }
            result = _load_destination_policy()
            self.assertIsNone(result)

    def test_returns_none_when_params_not_dict(self):
        """Returns None when params is not a dict."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {
                "circuit_breaker_destination": {"params": "not_a_dict"}
            }
            result = _load_destination_policy()
            self.assertIsNone(result)

    def test_returns_none_on_exception(self):
        """Returns None gracefully when loading raises."""
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.side_effect = RuntimeError("db down")
            result = _load_destination_policy()
            self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
