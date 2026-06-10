import unittest
from unittest.mock import patch

import numpy as np

from app.allocation import fund_data_refresher
from app.allocation.fund_mapper import map_funds
from app.allocation.fund_scorer import FundProfile


def _profile(code: str = "510300") -> FundProfile:
    return FundProfile(
        code=code,
        name="Test Fund",
        fund_type="ETF",
        asset_class="a_share_large",
        company="Test",
        aum=10.0,
        daily_turnover=1000.0,
        tracking_error=0.02,
    )


class FundPoolRefresherTest(unittest.TestCase):
    def setUp(self) -> None:
        fund_data_refresher.clear_cache()

    def tearDown(self) -> None:
        fund_data_refresher.clear_cache()

    def test_dynamic_nav_refresh_marks_metadata_real(self):
        prices = np.linspace(1.0, 1.2, 260, dtype=np.float64)
        turnover = np.linspace(10000.0, 20000.0, 260, dtype=np.float64)

        with patch("app.allocation.fund_data_refresher._get_sqlite_metrics", return_value=None), patch(
            "app.allocation.fund_data_refresher._fetch_nav_series",
            return_value=(prices, turnover),
        ), patch("app.storage.database.FundNAVCache.save", return_value=None):
            refreshed = fund_data_refresher.refresh_fund_profile(_profile())

        self.assertEqual(refreshed.metadata_status, "real")
        self.assertEqual(refreshed.metadata_source, "computed_nav")
        self.assertTrue(refreshed.metadata_as_of)
        self.assertEqual(refreshed.stale_days, 0)
        self.assertNotEqual(refreshed.return_1y, 0.0)

    def test_missing_nav_keeps_static_metadata_assumption(self):
        with patch("app.allocation.fund_data_refresher._get_sqlite_metrics", return_value=None), patch(
            "app.allocation.fund_data_refresher._fetch_nav_series",
            return_value=None,
        ):
            refreshed = fund_data_refresher.refresh_fund_profile(_profile())

        self.assertEqual(refreshed.metadata_status, "assumption")
        self.assertEqual(refreshed.metadata_source, "static_fund_pool")

    def test_map_funds_exposes_metadata_fields(self):
        refreshed = _profile()
        refreshed.metadata_status = "real"
        refreshed.metadata_source = "computed_nav"
        refreshed.metadata_as_of = "2026-06-10"
        refreshed.stale_days = 0

        with patch("app.allocation.fund_mapper.refresh_fund_profile", return_value=refreshed):
            funds = map_funds({"a_share_large": 1.0}, 10000.0, [])

        self.assertTrue(funds)
        self.assertEqual(funds[0].metadata_status, "real")
        self.assertEqual(funds[0].metadata_source, "computed_nav")


if __name__ == "__main__":
    unittest.main()
