"""Tests for fund_pool_refresher — P1-5 metadata refresh and stale penalty."""
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

from app.allocation.fund_scorer import FundProfile, FundScore, score_fund, rank_funds_for_asset_class
from app.allocation.fund_pool_refresher import (
    refresh_pool_metadata,
    _compute_stale_days,
    _update_profile,
)


class FundPoolRefresherTest(unittest.TestCase):

    def _make_profile(self, code="518880", stale_days=None, metadata_status="assumption",
                      metadata_as_of=None, aum=100.0) -> FundProfile:
        return FundProfile(
            code=code, name="Test Gold ETF", fund_type="商品型-贵金属",
            asset_class="gold", company="TestFund",
            aum=aum, daily_turnover=50000.0, tracking_error=0.01,
            metadata_status=metadata_status, metadata_source="static_fund_pool",
            metadata_as_of=metadata_as_of, stale_days=stale_days,
        )

    def test_compute_stale_days_none_as_of(self):
        self.assertIsNone(_compute_stale_days(None))

    def test_compute_stale_days_recent(self):
        from datetime import date
        today = date.today().isoformat()
        self.assertEqual(_compute_stale_days(today), 0)

    def test_compute_stale_days_old(self):
        from datetime import date, timedelta
        old = (date.today() - timedelta(days=10)).isoformat()
        self.assertEqual(_compute_stale_days(old), 10)

    def test_stale_penalty_applied_after_7_days(self):
        """Funds with stale_days > 7 should have total_score penalized."""
        fresh = self._make_profile(code="FRESH", stale_days=0)
        stale = self._make_profile(code="STALE", stale_days=15)
        peers = [fresh, stale]
        score_fresh = score_fund(fresh, peers)
        score_stale = score_fund(stale, peers)
        self.assertGreater(score_fresh.total_score, score_stale.total_score)
        self.assertTrue(any("陈旧" in r for r in score_stale.reasons))

    def test_missing_metadata_heavy_penalty(self):
        """Funds with metadata_status=missing should be heavily penalized."""
        ok_fund = self._make_profile(code="OK", metadata_status="real")
        missing_fund = self._make_profile(code="MISS", metadata_status="missing")
        peers = [ok_fund, missing_fund]
        score_ok = score_fund(ok_fund, peers)
        score_miss = score_fund(missing_fund, peers)
        self.assertGreater(score_ok.total_score - score_miss.total_score, 30)

    def test_update_profile_preserves_unchanged_fields(self):
        profile = self._make_profile()
        updated = _update_profile(profile, {"aum": 200.0, "metadata_status": "real"})
        self.assertEqual(updated.aum, 200.0)
        self.assertEqual(updated.metadata_status, "real")
        self.assertEqual(updated.code, profile.code)
        self.assertEqual(updated.name, profile.name)
        self.assertEqual(updated.asset_class, profile.asset_class)

    def test_refresh_pool_metadata_marks_stale_when_no_live_data(self):
        """When no live data is available and as_of is old, profile should be marked stale."""
        from datetime import date, timedelta
        old_date = (date.today() - timedelta(days=10)).isoformat()
        profile = self._make_profile(metadata_as_of=old_date, metadata_status="real")
        pool = {"518880": profile}

        with patch("app.allocation.fund_pool_refresher._fetch_efinance_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_tushare_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_sqlite_meta", return_value=None):
            result = refresh_pool_metadata(pool)

        self.assertEqual(result["518880"].metadata_status, "stale")
        self.assertEqual(result["518880"].stale_days, 10)

    def test_refresh_pool_metadata_marks_real_when_live_data(self):
        """When live data is available, profile should be marked real."""
        profile = self._make_profile(metadata_status="assumption")
        pool = {"518880": profile}

        live_meta = {"_source": "efinance", "aum": 250.0, "name": "Updated ETF"}
        with patch("app.allocation.fund_pool_refresher._fetch_efinance_meta", return_value=live_meta), \
             patch("app.allocation.fund_pool_refresher._fetch_tushare_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_sqlite_meta", return_value=None):
            result = refresh_pool_metadata(pool)

        self.assertEqual(result["518880"].metadata_status, "real")
        self.assertEqual(result["518880"].metadata_source, "efinance")
        self.assertEqual(result["518880"].aum, 250.0)
        self.assertEqual(result["518880"].stale_days, 0)


    def test_refresh_pool_metadata_marks_missing_when_never_refreshed(self):
        """When no live data and metadata_as_of is None, profile should be marked missing."""
        profile = self._make_profile(metadata_as_of=None, metadata_status="assumption")
        pool = {"518880": profile}

        with patch("app.allocation.fund_pool_refresher._fetch_efinance_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_tushare_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_sqlite_meta", return_value=None):
            result = refresh_pool_metadata(pool)

        self.assertEqual(result["518880"].metadata_status, "missing")
        self.assertIsNone(result["518880"].stale_days)

    def test_refresh_pool_metadata_marks_assumption_within_grace_period(self):
        """When no live data but as_of is recent, profile should be marked assumption."""
        from datetime import date, timedelta
        recent = (date.today() - timedelta(days=3)).isoformat()
        profile = self._make_profile(metadata_as_of=recent, metadata_status="real")
        pool = {"518880": profile}

        with patch("app.allocation.fund_pool_refresher._fetch_efinance_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_tushare_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_sqlite_meta", return_value=None):
            result = refresh_pool_metadata(pool)

        self.assertEqual(result["518880"].metadata_status, "assumption")
        self.assertEqual(result["518880"].stale_days, 3)

if __name__ == "__main__":
    unittest.main()
