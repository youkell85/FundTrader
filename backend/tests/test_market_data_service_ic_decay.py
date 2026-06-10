"""Integration tests for MarketDataService._compute_ic_decay with cached history."""
import unittest
from unittest.mock import patch

import numpy as np


class MarketDataServiceICDecayTest(unittest.TestCase):
    """Test _compute_ic_decay using synthetic cached macro/ETF data."""

    def _make_macro_history(self, indicator, base_value, noise=0.5):
        """Generate 24 months of synthetic macro history."""
        np.random.seed(hash(indicator) % 2**31)
        history = []
        for m in range(24):
            year = 2024 + (m // 12)
            month = (m % 12) + 1
            date_str = f"{year}-{month:02d}"
            value = base_value + np.random.normal(0, noise)
            history.append((date_str, round(value, 2), "api"))
        return history

    def _make_etf_prices(self, n_days=300):
        """Generate synthetic ETF daily close prices."""
        np.random.seed(42)
        prices = {}
        price = 3.0
        for d in range(n_days):
            year = 2024 + (d // 252)
            doy = d % 252
            month = 1 + (doy // 21)
            day = 1 + (doy % 21)
            date_str = f"{year}-{month:02d}-{day:02d}"
            price *= (1 + np.random.normal(0.0003, 0.012))
            prices[date_str] = round(price, 4)
        return prices

    def test_historical_ic_computed_from_cached_data(self):
        """Real historical IC path: synthetic macro + ETF cache produces valid IC."""
        from app.allocation.data.market_data_service import MarketDataService

        svc = MarketDataService()

        # Set up rolling_stats_ex with a_share_large returns
        np.random.seed(99)
        n = 300
        rets = np.random.normal(0.0003, 0.015, n).tolist()
        svc._rolling_stats_ex = {
            "returns_short": {"a_share_large": rets},
            "returns_medium": {"a_share_large": rets},
            "returns_long": {"a_share_large": rets},
            "vols_short": {"a_share_large": 20.0},
            "vols_medium": {"a_share_large": 20.0},
            "vols_long": {"a_share_large": 20.0},
            "correlation_matrix": [],
            "covariance_matrix": [],
            "vol_regime": {},
            "quality": {},
        }

        # Build synthetic ETF price cache
        etf_prices = self._make_etf_prices(n)

        # Build synthetic macro history for each indicator
        macro_histories = {
            "PMI制造业": self._make_macro_history("PMI制造业", 50.5),
            "GDP同比": self._make_macro_history("GDP同比", 5.0),
            "CPI同比": self._make_macro_history("CPI同比", 2.0),
            "PPI同比": self._make_macro_history("PPI同比", -1.0),
            "10Y国债收益率": self._make_macro_history("10Y国债收益率", 2.5),
            "DR007": self._make_macro_history("DR007", 1.8),
            "社融增量": self._make_macro_history("社融增量", 3.0),
            "M2增速": self._make_macro_history("M2增速", 8.0),
            "融资余额变化": self._make_macro_history("融资余额变化", 0.5),
            "北向资金净流入": self._make_macro_history("北向资金净流入", 50.0),
            "财政赤字率": self._make_macro_history("财政赤字率", 3.0),
            "美联储利率": self._make_macro_history("美联储利率", 5.0),
            "美元指数": self._make_macro_history("美元指数", 104.0),
        }

        def mock_get_history(indicator, limit=60):
            return macro_histories.get(indicator, [])

        def mock_get_range(code, start, end):
            return etf_prices

        # Patch at the source module (app.storage.database) since
        # _compute_ic_decay does late import from there
        with patch(
            "app.storage.database.MacroCache"
        ) as mock_macro, patch(
            "app.storage.database.ETFPriceCache"
        ) as mock_etf:
            mock_macro.get_history.side_effect = mock_get_history
            mock_etf.get_range.side_effect = mock_get_range

            svc._compute_ic_decay()

        ic_data = svc.get_ic_decay()
        self.assertIsNotNone(ic_data)

        # Should have computed IC for most categories
        computed_categories = [k for k in ic_data if not k.startswith("_")]
        self.assertGreater(len(computed_categories), 0)

        # Check metadata on first category
        first_cat = computed_categories[0]
        info = ic_data[first_cat]
        self.assertEqual(info.get("source"), "historical_ic")
        self.assertGreater(info.get("sample_size", 0), 0)
        self.assertIsNotNone(info.get("as_of_date"))
        self.assertIn("ic_series", info)
        self.assertIn("quality", info)
        self.assertIn("half_life", info)
        self.assertIn("ic_mean", info)

    def test_insufficient_history_fallback(self):
        """When macro history is too short, result is marked insufficient_history."""
        from app.allocation.data.market_data_service import MarketDataService

        svc = MarketDataService()

        # Set up rolling_stats_ex
        np.random.seed(99)
        n = 300
        rets = np.random.normal(0.0003, 0.015, n).tolist()
        svc._rolling_stats_ex = {
            "returns_short": {"a_share_large": rets},
            "returns_medium": {"a_share_large": rets},
            "returns_long": {"a_share_large": rets},
            "vols_short": {"a_share_large": 20.0},
            "vols_medium": {"a_share_large": 20.0},
            "vols_long": {"a_share_large": 20.0},
            "correlation_matrix": [],
            "covariance_matrix": [],
            "vol_regime": {},
            "quality": {},
        }

        # ETF prices exist
        etf_prices = self._make_etf_prices(n)

        # Macro history: only 3 months — insufficient
        short_history = [
            ("2024-03", 50.0, "api"),
            ("2024-02", 50.5, "api"),
            ("2024-01", 51.0, "api"),
        ]

        def mock_get_history(indicator, limit=60):
            return short_history

        def mock_get_range(code, start, end):
            return etf_prices

        with patch(
            "app.storage.database.MacroCache"
        ) as mock_macro, patch(
            "app.storage.database.ETFPriceCache"
        ) as mock_etf:
            mock_macro.get_history.side_effect = mock_get_history
            mock_etf.get_range.side_effect = mock_get_range

            svc._compute_ic_decay()

        ic_data = svc.get_ic_decay()
        self.assertIsNotNone(ic_data)

        # Should have _meta with insufficient_history, not fabricated IC
        meta = ic_data.get("_meta")
        self.assertIsNotNone(meta)
        self.assertEqual(meta.get("source"), "insufficient_history")

        # No category-level entries
        computed = [k for k in ic_data if not k.startswith("_")]
        self.assertEqual(len(computed), 0)

    def test_no_rolling_stats_returns_none(self):
        """Without rolling stats, get_ic_decay returns None."""
        from app.allocation.data.market_data_service import MarketDataService

        svc = MarketDataService()
        svc._rolling_stats_ex = None

        svc._compute_ic_decay()

        self.assertIsNone(svc.get_ic_decay())

    def test_adaptive_weights_fallback_on_insufficient_history(self):
        """_get_adaptive_weights falls back to static weights when IC data is insufficient."""
        from app.allocation.taa_engine import _get_adaptive_weights, SIGNAL_CATEGORIES
        from app.allocation.data.market_data_service import market_data_service

        # Set IC cache to insufficient_history marker
        market_data_service._ic_decay_cache = {
            "_meta": {
                "source": "insufficient_history",
                "as_of_date": "2024-06-30",
                "reason": "fewer than 60 aligned observations per category",
            }
        }

        weights = _get_adaptive_weights()

        # Should match static weights exactly
        for cat_key in SIGNAL_CATEGORIES:
            self.assertAlmostEqual(
                weights.get(cat_key, 0),
                SIGNAL_CATEGORIES[cat_key]["weight"],
                places=4,
            )

        # Clean up
        market_data_service._ic_decay_cache = None

    def test_ic_decay_result_keys_preserved(self):
        """Existing IC result keys (quality, half_life, ic_mean) are preserved."""
        from app.allocation.data.market_data_service import MarketDataService

        svc = MarketDataService()

        np.random.seed(99)
        n = 300
        rets = np.random.normal(0.0003, 0.015, n).tolist()
        svc._rolling_stats_ex = {
            "returns_short": {"a_share_large": rets},
            "returns_medium": {"a_share_large": rets},
            "returns_long": {"a_share_large": rets},
            "vols_short": {"a_share_large": 20.0},
            "vols_medium": {"a_share_large": 20.0},
            "vols_long": {"a_share_large": 20.0},
            "correlation_matrix": [],
            "covariance_matrix": [],
            "vol_regime": {},
            "quality": {},
        }

        etf_prices = self._make_etf_prices(n)
        macro_histories = {
            "PMI制造业": self._make_macro_history("PMI制造业", 50.5),
            "GDP同比": self._make_macro_history("GDP同比", 5.0),
            "CPI同比": self._make_macro_history("CPI同比", 2.0),
            "PPI同比": self._make_macro_history("PPI同比", -1.0),
            "10Y国债收益率": self._make_macro_history("10Y国债收益率", 2.5),
            "DR007": self._make_macro_history("DR007", 1.8),
            "社融增量": self._make_macro_history("社融增量", 3.0),
            "M2增速": self._make_macro_history("M2增速", 8.0),
            "融资余额变化": self._make_macro_history("融资余额变化", 0.5),
            "北向资金净流入": self._make_macro_history("北向资金净流入", 50.0),
            "财政赤字率": self._make_macro_history("财政赤字率", 3.0),
            "美联储利率": self._make_macro_history("美联储利率", 5.0),
            "美元指数": self._make_macro_history("美元指数", 104.0),
        }

        def mock_get_history(indicator, limit=60):
            return macro_histories.get(indicator, [])

        def mock_get_range(code, start, end):
            return etf_prices

        with patch(
            "app.storage.database.MacroCache"
        ) as mock_macro, patch(
            "app.storage.database.ETFPriceCache"
        ) as mock_etf:
            mock_macro.get_history.side_effect = mock_get_history
            mock_etf.get_range.side_effect = mock_get_range

            svc._compute_ic_decay()

        ic_data = svc.get_ic_decay()
        computed = [k for k in ic_data if not k.startswith("_")]

        for cat_key in computed:
            info = ic_data[cat_key]
            # Legacy keys preserved
            self.assertIn("quality", info)
            self.assertIn("half_life", info)
            self.assertIn("ic_mean", info)
            # New metadata keys are additive
            self.assertIn("source", info)
            self.assertIn("sample_size", info)
            self.assertIn("as_of_date", info)


if __name__ == "__main__":
    unittest.main()
