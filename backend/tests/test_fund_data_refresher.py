import unittest
from unittest.mock import patch

from app.allocation.fund_data_refresher import refresh_fund_profile
from app.allocation.fund_scorer import FundProfile


class FundDataRefresherTest(unittest.TestCase):
    def test_refresh_fund_profile_does_not_compute_live_metrics_by_default(self):
        profile = FundProfile(
            code="518880",
            name="Gold ETF",
            fund_type="ETF",
            asset_class="gold",
        )

        with patch("app.allocation.fund_data_refresher._ENABLE_LIVE_NAV_REFRESH", False), patch(
            "app.allocation.fund_data_refresher._get_sqlite_metrics",
            return_value=None,
        ), patch(
            "app.allocation.fund_data_refresher._get_memory_metrics",
            return_value=None,
        ), patch(
            "app.allocation.fund_data_refresher._get_cached_metrics",
            side_effect=AssertionError("live NAV refresh should not run"),
        ):
            refreshed = refresh_fund_profile(profile)

        self.assertEqual(refreshed, profile)


if __name__ == "__main__":
    unittest.main()
