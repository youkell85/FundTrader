import unittest
from unittest.mock import patch

from app.services import fund_service


class FundListContractTest(unittest.TestCase):
    def test_empty_snapshot_returns_missing_without_static_pool(self):
        with patch.object(fund_service, "_get_snapshot_funds", return_value=[]):
            result = fund_service.get_fund_list(page=1, page_size=20, guoyuan_only=True)

        self.assertEqual(result["funds"], [])
        self.assertEqual(result["total"], 0)
        self.assertEqual(result["source"], "fund_snapshot")
        self.assertEqual(result["data_status"], "missing")
        self.assertIn("基金快照为空", result["missing_reason"])

    def test_snapshot_list_remains_real_source(self):
        snapshot = [{
            "code": "510300",
            "name": "沪深300ETF",
            "type": "指数型",
            "nav": 1.23,
            "ytd": 5.2,
        }]
        with patch.object(fund_service, "_get_snapshot_funds", return_value=snapshot):
            result = fund_service.get_fund_list(page=1, page_size=20, guoyuan_only=True)

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["funds"][0]["code"], "510300")
        self.assertEqual(result["source"], "fund_snapshot")
        self.assertEqual(result["data_status"], "real")
        self.assertIsNone(result["missing_reason"])


if __name__ == "__main__":
    unittest.main()
