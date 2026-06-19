import unittest
from unittest.mock import patch

from app.api import settings as settings_api


class SettingsApiContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_xinjihui_pool_uses_snapshot_source(self):
        rows = [{
            "code": "510300",
            "name": "沪深300ETF",
            "type": "指数型",
            "tags": ["鑫基荟"],
            "nav_date": "2026-06-19",
        }]
        with patch.object(settings_api.FundDataStore, "list_snapshots", return_value={"funds": rows, "total": 1}):
            result = await settings_api.get_xinjihui_pool()

        self.assertEqual(result["data_status"], "real")
        self.assertEqual(result["source"], "fund_snapshot")
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["as_of"], "2026-06-19")
        self.assertEqual(result["funds"][0]["code"], "510300")
        self.assertEqual(result["funds"][0]["source"], "fund_snapshot")

    async def test_guoyuan_compat_route_does_not_return_static_pool_when_snapshot_missing(self):
        with patch.object(settings_api.FundDataStore, "list_snapshots", return_value={"funds": [], "total": 0}):
            result = await settings_api.get_guoyuan_funds()

        self.assertEqual(result["funds"], [])
        self.assertEqual(result["total"], 0)
        self.assertEqual(result["data_status"], "missing")
        self.assertEqual(result["source"], "fund_snapshot")
        self.assertIn("基金快照为空", result["missing_reason"])

    async def test_import_xinjihui_uses_snapshot_payload(self):
        rows = [{
            "code": "510300",
            "name": "沪深300ETF",
            "type": "指数型",
            "tags": ["鑫基荟"],
            "nav_date": "2026-06-19",
        }]
        with patch.object(settings_api.FundDataStore, "list_snapshots", return_value={"funds": rows, "total": 1}):
            with patch.object(settings_api, "add_funds_batch", return_value={"added": ["510300"], "skipped": [], "invalid": [], "total": 1}) as add_batch:
                result = await settings_api.import_xinjihui_pool()

        add_batch.assert_called_once_with([{
            "code": "510300",
            "name": "沪深300ETF",
            "type": "指数型",
            "tags": ["鑫基荟"],
        }])
        self.assertEqual(result["data_status"], "real")
        self.assertEqual(result["source"], "fund_snapshot")
        self.assertEqual(result["as_of"], "2026-06-19")

    async def test_import_xinjihui_missing_snapshot_does_not_import_static_pool(self):
        with patch.object(settings_api.FundDataStore, "list_snapshots", return_value={"funds": [], "total": 0}):
            with patch.object(settings_api, "add_funds_batch") as add_batch:
                with patch.object(settings_api, "get_watchlist", return_value=[]):
                    result = await settings_api.import_xinjihui_pool()

        add_batch.assert_not_called()
        self.assertEqual(result["data_status"], "missing")
        self.assertEqual(result["source"], "fund_snapshot")
        self.assertEqual(result["added"], [])
        self.assertIn("基金快照为空", result["missing_reason"])


if __name__ == "__main__":
    unittest.main()
