import unittest
from unittest.mock import patch

from app.services import fund_service


class FundDetailContractTest(unittest.TestCase):
    def test_pct_for_api_does_not_double_scale_percent_values(self):
        self.assertEqual(fund_service._pct_for_api(54.57), 54.57)
        self.assertEqual(fund_service._pct_for_api("54.57"), 54.57)
        self.assertEqual(fund_service._pct_for_api(0.5457), 54.57)

    def test_year_returns_are_computed_from_nav_history(self):
        nav_rows = [
            {"nav_date": "2024-01-02", "nav": 1.0},
            {"nav_date": "2024-12-31", "nav": 1.2},
            {"nav_date": "2025-01-02", "nav": 1.2},
            {"nav_date": "2025-12-31", "nav": 1.5},
        ]
        with patch.object(
            fund_service,
            "_get_nav_history_for_detail",
            return_value=(nav_rows, "unit-test", "2025-12-31"),
        ):
            payload = fund_service.get_fund_year_returns("000001")

        self.assertEqual(payload["dataStatus"], "partial")
        self.assertEqual(payload["rows"][0]["fundReturn"], 20.0)
        self.assertEqual(payload["rows"][1]["fundReturn"], 25.0)
        self.assertIsNone(payload["rows"][0]["hs300Return"])
        self.assertIn("真实净值", payload["missingReason"])

    def test_missing_holder_structure_returns_missing_not_mock(self):
        with patch.object(fund_service, "_safe_table_query", return_value=[]):
            payload = fund_service.get_fund_holder_structure("000001", periods=8)

        self.assertEqual(payload["dataStatus"], "missing")
        self.assertEqual(payload["rows"], [])
        self.assertNotEqual(payload["dataStatus"], "simulated")
        self.assertIn("不再使用", payload["missingReason"])


if __name__ == "__main__":
    unittest.main()
