"""Tests for fund_pool_refresher — P1-5 metadata refresh and stale penalty."""
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

from app.allocation.fund_scorer import FundProfile, FundScore, score_fund, rank_funds_for_asset_class
from app.allocation.fund_pool_refresher import (
    refresh_pool_metadata,
    refresh_live_metadata_cache,
    _compute_stale_days,
    _fetch_sqlite_meta,
    _merge_fee_rows,
    _update_profile,
)


class FundPoolRefresherTest(unittest.TestCase):

    def setUp(self):
        from app.allocation import fund_pool_refresher
        with fund_pool_refresher._meta_cache_lock:
            fund_pool_refresher._meta_cache.clear()

    def tearDown(self):
        from app.allocation import fund_pool_refresher
        with fund_pool_refresher._meta_cache_lock:
            fund_pool_refresher._meta_cache.clear()

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
        with patch("app.allocation.fund_pool_refresher._ENABLE_LIVE_PROVIDER_META", True), \
             patch("app.allocation.fund_pool_refresher._fetch_efinance_meta", return_value=live_meta), \
             patch("app.allocation.fund_pool_refresher._fetch_tushare_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_sqlite_meta", return_value=None):
            result = refresh_pool_metadata(pool)

        self.assertEqual(result["518880"].metadata_status, "real")
        self.assertEqual(result["518880"].metadata_source, "efinance")
        self.assertEqual(result["518880"].aum, 250.0)
        self.assertEqual(result["518880"].stale_days, 0)


    def test_refresh_pool_metadata_preserves_static_assumption_when_never_refreshed(self):
        """Built-in static pool entries should keep assumption provenance without live data."""
        profile = self._make_profile(metadata_as_of=None, metadata_status="assumption")
        pool = {"518880": profile}

        with patch("app.allocation.fund_pool_refresher._fetch_efinance_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_tushare_meta", return_value=None), \
             patch("app.allocation.fund_pool_refresher._fetch_sqlite_meta", return_value=None):
            result = refresh_pool_metadata(pool)

        self.assertEqual(result["518880"].metadata_status, "assumption")
        self.assertEqual(result["518880"].metadata_source, "static_fund_pool")
        self.assertIsNone(result["518880"].stale_days)

    def test_refresh_pool_metadata_does_not_call_live_providers_by_default(self):
        """Request-path metadata refresh should not synchronously call live provider SDKs."""
        profile = self._make_profile(metadata_as_of=None, metadata_status="assumption")
        pool = {"518880": profile}

        with patch("app.allocation.fund_pool_refresher._ENABLE_LIVE_PROVIDER_META", False), \
             patch("app.allocation.fund_pool_refresher._fetch_efinance_meta") as efinance, \
             patch("app.allocation.fund_pool_refresher._fetch_tushare_meta") as tushare, \
             patch("app.allocation.fund_pool_refresher._fetch_sqlite_meta", return_value=None):
            result = refresh_pool_metadata(pool)

        efinance.assert_not_called()
        tushare.assert_not_called()
        self.assertEqual(result["518880"].metadata_status, "assumption")

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

    def test_fetch_sqlite_meta_uses_db_context_manager(self):
        """SQLite metadata reads should use the get_db context manager correctly."""
        from contextlib import contextmanager

        class FakeResult:
            def fetchone(self):
                return ("Gold ETF", "ETF", "FundCo", 123.4, 0.005, 0.001, "2026-06-19", "efinance")

        class FakeConnection:
            def execute(self, sql, params):
                self.sql = sql
                self.params = params
                return FakeResult()

        fake_conn = FakeConnection()

        @contextmanager
        def fake_get_db():
            yield fake_conn

        with patch("app.storage.database.get_db", fake_get_db):
            result = _fetch_sqlite_meta("518880")

        self.assertEqual(fake_conn.params, ("518880",))
        self.assertEqual(result["name"], "Gold ETF")
        self.assertEqual(result["fund_type"], "ETF")
        self.assertEqual(result["company"], "FundCo")
        self.assertEqual(result["aum"], 123.4)
        self.assertEqual(result["_source"], "sqlite_cache")
        self.assertEqual(result["_provider_source"], "efinance")

    def test_refresh_live_metadata_cache_persists_provider_rows_and_clears_memory_cache(self):
        """Background refresh should persist bounded provider results and clear request cache."""
        profile = self._make_profile(code="518880")
        pool = {"518880": profile}
        rows = [{"code": "518880", "name": "Gold ETF", "_source": "efinance"}]

        from app.allocation import fund_pool_refresher
        with fund_pool_refresher._meta_cache_lock:
            fund_pool_refresher._meta_cache["518880"] = (0, profile, ("assumption", "static_fund_pool", None, None))

        with patch("app.allocation.fund_pool_refresher._fetch_eastmoney_meta_batch", return_value=rows) as fetch, \
             patch("app.allocation.fund_pool_refresher._fetch_eastmoney_fee_batch", return_value=[]), \
             patch("app.allocation.fund_pool_refresher._save_metadata_cache", return_value=1) as save:
            summary = refresh_live_metadata_cache(pool, timeout_s=5)

        fetch.assert_called_once_with(["518880"], timeout_s=5)
        save.assert_called_once_with(rows)
        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["source"], "eastmoney")
        self.assertEqual(summary["saved"], 1)
        with fund_pool_refresher._meta_cache_lock:
            self.assertNotIn("518880", fund_pool_refresher._meta_cache)

    def test_refresh_live_metadata_cache_falls_back_to_efinance_when_eastmoney_empty(self):
        profile = self._make_profile(code="518880")
        pool = {"518880": profile}
        rows = [{"code": "518880", "name": "Gold ETF", "_source": "efinance"}]

        with patch("app.allocation.fund_pool_refresher._fetch_eastmoney_meta_batch", return_value=[]), \
             patch("app.allocation.fund_pool_refresher._fetch_efinance_meta_batch", return_value=rows) as fetch, \
             patch("app.allocation.fund_pool_refresher._fetch_eastmoney_fee_batch", return_value=[]), \
             patch("app.allocation.fund_pool_refresher._save_metadata_cache", return_value=1):
            summary = refresh_live_metadata_cache(pool, timeout_s=5)

        fetch.assert_called_once_with(["518880"], timeout_s=5)
        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["source"], "efinance")
        self.assertEqual(summary["saved"], 1)

    def test_merge_fee_rows_combines_real_f10_fees_with_metadata(self):
        rows = [{"code": "014915", "name": "Fund A", "fund_type": "hybrid", "_source": "eastmoney_fundmob", "raw": {"a": 1}}]
        fee_rows = [{"code": "014915", "management_fee": 0.012, "custody_fee": 0.002, "raw": {"fee_source": "eastmoney:fundf10_fee_page"}}]

        merged = _merge_fee_rows(rows, fee_rows)

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["name"], "Fund A")
        self.assertEqual(merged[0]["_source"], "eastmoney_fundmob_f10_fee")
        self.assertEqual(merged[0]["management_fee"], 0.012)
        self.assertEqual(merged[0]["custody_fee"], 0.002)

if __name__ == "__main__":
    unittest.main()
