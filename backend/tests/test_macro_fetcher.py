import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from app.allocation.data import macro_fetcher


class MacroFetcherTest(unittest.TestCase):
    def test_ak_fiscal_deficit_parses_ratio_column(self):
        fake_akshare = SimpleNamespace(
            macro_china_fiscal_deficit=lambda: pd.DataFrame({"财政赤字率": [2.8, 3.0]})
        )

        with patch.dict(sys.modules, {"akshare": fake_akshare}):
            value = macro_fetcher._ak_fiscal_deficit()

        self.assertEqual(value, 3.0)

    def test_fiscal_deficit_source_is_not_inferred_from_value(self):
        with patch.object(macro_fetcher, "_ak_fiscal_deficit", return_value=3.0), \
            patch.object(macro_fetcher, "_ak_gov_deficit_target", return_value=None):
            value, source = macro_fetcher._fetch_fiscal_deficit_with_source()

        self.assertEqual(value, 3.0)
        self.assertEqual(source, "akshare:fiscal_deficit")

    def test_fiscal_deficit_does_not_fall_back_to_static_target(self):
        with patch.object(macro_fetcher, "_ak_fiscal_deficit", return_value=None), \
            patch.object(macro_fetcher, "_ak_gov_deficit_target", return_value=None):
            value, source = macro_fetcher._fetch_fiscal_deficit_with_source()

        self.assertIsNone(value)
        self.assertEqual(source, "missing")

    def test_fetch_all_keeps_api_source_when_fiscal_value_is_three_percent(self):
        patches = [
            patch.object(macro_fetcher, "_get_tushare", return_value=None),
            patch.object(macro_fetcher, "_fetch_pmi", return_value=None),
            patch.object(macro_fetcher, "_fetch_gdp", return_value=None),
            patch.object(macro_fetcher, "_fetch_cpi", return_value=None),
            patch.object(macro_fetcher, "_fetch_ppi", return_value=None),
            patch.object(macro_fetcher, "_fetch_bond_yield_10y", return_value=None),
            patch.object(macro_fetcher, "_fetch_dr007", return_value=None),
            patch.object(macro_fetcher, "_fetch_social_financing", return_value=None),
            patch.object(macro_fetcher, "_fetch_m2", return_value=None),
            patch.object(macro_fetcher, "_fetch_margin_balance", return_value=None),
            patch.object(macro_fetcher, "_fetch_northbound", return_value=None),
            patch.object(
                macro_fetcher,
                "_fetch_fiscal_deficit_with_source",
                return_value=(3.0, "akshare:fiscal_deficit"),
            ),
            patch.object(macro_fetcher, "_fetch_fed_rate", return_value=None),
            patch.object(macro_fetcher, "_fetch_usd_index", return_value=None),
        ]
        for item in patches:
            item.start()
        try:
            snapshot = macro_fetcher.fetch_all()
        finally:
            for item in reversed(patches):
                item.stop()

        indicator = snapshot.indicators["财政赤字率"]
        self.assertEqual(indicator.value, 3.0)
        self.assertEqual(indicator.source, "akshare:fiscal_deficit")
        self.assertEqual(indicator.confidence, 0.85)

    def test_fetch_all_marks_fiscal_deficit_missing_without_static_value(self):
        patches = [
            patch.object(macro_fetcher, "_get_tushare", return_value=None),
            patch.object(macro_fetcher, "_fetch_pmi", return_value=None),
            patch.object(macro_fetcher, "_fetch_gdp", return_value=None),
            patch.object(macro_fetcher, "_fetch_cpi", return_value=None),
            patch.object(macro_fetcher, "_fetch_ppi", return_value=None),
            patch.object(macro_fetcher, "_fetch_bond_yield_10y", return_value=None),
            patch.object(macro_fetcher, "_fetch_dr007", return_value=None),
            patch.object(macro_fetcher, "_fetch_social_financing", return_value=None),
            patch.object(macro_fetcher, "_fetch_m2", return_value=None),
            patch.object(macro_fetcher, "_fetch_margin_balance", return_value=None),
            patch.object(macro_fetcher, "_fetch_northbound", return_value=None),
            patch.object(
                macro_fetcher,
                "_fetch_fiscal_deficit_with_source",
                return_value=(None, "missing"),
            ),
            patch.object(macro_fetcher, "_fetch_fed_rate", return_value=None),
            patch.object(macro_fetcher, "_fetch_usd_index", return_value=None),
        ]
        for item in patches:
            item.start()
        try:
            snapshot = macro_fetcher.fetch_all()
        finally:
            for item in reversed(patches):
                item.stop()

        indicator = snapshot.indicators["财政赤字率"]
        self.assertIsNone(indicator.value)
        self.assertEqual(indicator.source, "missing")
        self.assertEqual(indicator.confidence, 0.0)

    def test_calculate_dxy_from_usd_rates_uses_usd_base_direction(self):
        rates = {
            "EUR": 0.92,
            "JPY": 157.0,
            "GBP": 0.79,
            "CAD": 1.37,
            "SEK": 10.52,
            "CHF": 0.89,
        }

        dxy = macro_fetcher._calculate_dxy_from_usd_rates(rates)

        expected = (
            50.14348112
            * (0.92 ** 0.576)
            * (157.0 ** 0.136)
            * (0.79 ** 0.119)
            * (1.37 ** 0.091)
            * (10.52 ** 0.042)
            * (0.89 ** 0.036)
        )
        self.assertAlmostEqual(dxy, expected, places=8)

    def test_calculate_dxy_rejects_missing_or_non_positive_rates(self):
        self.assertIsNone(macro_fetcher._calculate_dxy_from_usd_rates({"EUR": 0.92}))
        self.assertIsNone(macro_fetcher._calculate_dxy_from_usd_rates({
            "EUR": 0.92,
            "JPY": 157.0,
            "GBP": 0.79,
            "CAD": 1.37,
            "SEK": 10.52,
            "CHF": 0,
        }))

    def test_fetch_all_labels_dxy_source_as_derived_formula(self):
        """P1-3: DXY source must be 'derived_fx_formula', not 'forex_api'."""
        fake_rates = {"EUR": 0.92, "JPY": 157.0, "GBP": 0.79,
                      "CAD": 1.37, "SEK": 10.52, "CHF": 0.89}
        fake_response = SimpleNamespace(status_code=200, json=lambda: {"rates": fake_rates})
        patches = [
            patch.object(macro_fetcher, "_get_tushare", return_value=None),
            patch.object(macro_fetcher, "_fetch_pmi", return_value=None),
            patch.object(macro_fetcher, "_fetch_gdp", return_value=None),
            patch.object(macro_fetcher, "_fetch_cpi", return_value=None),
            patch.object(macro_fetcher, "_fetch_ppi", return_value=None),
            patch.object(macro_fetcher, "_fetch_bond_yield_10y", return_value=None),
            patch.object(macro_fetcher, "_fetch_dr007", return_value=None),
            patch.object(macro_fetcher, "_fetch_social_financing", return_value=None),
            patch.object(macro_fetcher, "_fetch_m2", return_value=None),
            patch.object(macro_fetcher, "_fetch_margin_balance", return_value=None),
            patch.object(macro_fetcher, "_fetch_northbound", return_value=None),
            patch.object(
                macro_fetcher,
                "_fetch_fiscal_deficit_with_source",
                return_value=(None, "missing"),
            ),
            patch.object(macro_fetcher, "_fetch_fed_rate", return_value=None),
        ]
        for item in patches:
            item.start()
        try:
            snapshot = macro_fetcher.fetch_all()
        finally:
            for item in reversed(patches):
                item.stop()

        indicator = snapshot.indicators["美元指数"]
        self.assertEqual(indicator.source, "derived_fx_formula")
        self.assertAlmostEqual(indicator.confidence, 0.7)


if __name__ == "__main__":
    unittest.main()
