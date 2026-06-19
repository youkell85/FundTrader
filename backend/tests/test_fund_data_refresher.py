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

    def test_refresh_fund_profile_preserves_structural_metadata_provenance(self):
        profile = FundProfile(
            code="510300",
            name="CSI 300 ETF",
            fund_type="ETF",
            asset_class="a_share_large",
            metadata_status="real",
            metadata_source="sqlite_cache",
            metadata_as_of="2026-06-19",
            stale_days=0,
        )
        metrics = {
            "return_1y": 12.3,
            "sharpe_1y": 1.2,
            "tracking_error": 0.02,
            "metadata_status": "real",
            "metadata_source": "computed_nav",
            "metadata_as_of": None,
            "stale_days": 0,
        }

        with patch("app.allocation.fund_data_refresher._get_sqlite_metrics", return_value=metrics):
            refreshed = refresh_fund_profile(profile)

        self.assertEqual(refreshed.return_1y, 12.3)
        self.assertEqual(refreshed.metadata_status, "real")
        self.assertEqual(refreshed.metadata_source, "sqlite_cache")
        self.assertEqual(refreshed.metadata_as_of, "2026-06-19")


if __name__ == "__main__":
    unittest.main()
