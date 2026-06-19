import unittest
from unittest.mock import patch

from app.services import recommend_service


class RecommendServiceContractTest(unittest.TestCase):
    def test_empty_snapshot_does_not_generate_static_recommendations(self):
        with patch.object(recommend_service.FundDataStore, "list_snapshots", return_value={"funds": [], "total": 0}):
            result = recommend_service.generate_recommendation(amount=100000)

        self.assertEqual(result["funds"], [])
        self.assertEqual(result["data_status"], "missing")
        self.assertEqual(result["source"], "fund_snapshot")
        self.assertIsNone(result["expected_return"])
        self.assertIsNone(result["expected_risk"])
        self.assertIn("未生成静态推荐", result["missing_reason"])

    def test_recommendation_uses_snapshot_metrics(self):
        rows = [
            {
                "code": "BOND01",
                "name": "真实债券基金",
                "type": "债券型",
                "tags": ["鑫基荟"],
                "nav": 1.01,
                "nav_date": "2026-06-19",
                "near_1y": 3.0,
                "annualized_return": 3.5,
                "max_drawdown": -2.5,
                "volatility": 4.0,
            },
            {
                "code": "MIX001",
                "name": "真实混合基金",
                "type": "混合型",
                "tags": ["鑫基荟"],
                "nav": 1.22,
                "nav_date": "2026-06-19",
                "near_1y": 8.0,
                "annualized_return": 8.5,
                "max_drawdown": -8.0,
                "volatility": 10.0,
            },
            {
                "code": "EQ0001",
                "name": "真实股票基金",
                "type": "股票型",
                "tags": ["鑫基荟"],
                "nav": 1.55,
                "nav_date": "2026-06-19",
                "near_1y": 15.0,
                "annualized_return": 16.0,
                "max_drawdown": -18.0,
                "volatility": 20.0,
            },
            {
                "code": "IDX001",
                "name": "真实指数基金",
                "type": "指数型",
                "tags": ["鑫基荟"],
                "nav": 1.33,
                "nav_date": "2026-06-19",
                "near_1y": 9.0,
                "annualized_return": 9.5,
                "max_drawdown": -10.0,
                "volatility": 12.0,
            },
        ]
        with patch.object(recommend_service.FundDataStore, "list_snapshots", return_value={"funds": rows, "total": len(rows)}):
            result = recommend_service.generate_recommendation(risk_level="稳健", amount=100000)

        self.assertEqual(result["data_status"], "real")
        self.assertEqual(result["source"], "fund_snapshot")
        self.assertIsNone(result["missing_reason"])
        self.assertEqual(len(result["funds"]), 4)
        self.assertTrue(all(item["source"] == "fund_snapshot" for item in result["funds"]))
        self.assertTrue(all(item["metric_status"] == "real" for item in result["funds"]))
        self.assertEqual(result["expected_return"], 8.6)
        self.assertEqual(result["expected_risk"], 10.4)

    def test_partial_metrics_are_disclosed(self):
        rows = [
            {
                "code": "BOND01",
                "name": "真实债券基金",
                "type": "债券型",
                "tags": ["鑫基荟"],
                "nav": 1.01,
                "near_1y": 3.0,
            },
        ]
        with patch.object(recommend_service.FundDataStore, "list_snapshots", return_value={"funds": rows, "total": 1}):
            result = recommend_service.generate_recommendation(risk_level="保守", amount=100000)

        self.assertEqual(result["data_status"], "partial")
        self.assertIn("缺少完整收益或风险快照指标", result["missing_reason"])
        self.assertEqual(result["funds"][0]["metric_status"], "partial")
        self.assertIsNone(result["expected_return"])
        self.assertIsNone(result["expected_risk"])


if __name__ == "__main__":
    unittest.main()
