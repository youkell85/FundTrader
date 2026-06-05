import asyncio
import unittest
from unittest.mock import MagicMock, patch

from app.api import fund as fund_api
from app.services import fund_service
from app.storage import database as db_module


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
        ), patch.object(
            fund_service,
            "_get_index_nav_history",
            return_value=[],
        ), patch.object(
            fund_service,
            "_peer_year_return",
            return_value=None,
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


class FundDetailCompletenessTest(unittest.TestCase):
    """P2.1: detailCompleteness 必须真实反映 13 接口覆盖度（5 个新增 section）。"""

    def _invoke(self):
        """直接调用 fund_detail_completeness，mock 数据源。"""
        fake_snapshot = {
            "max_drawdown": 0.1,
            "sharpe_ratio": 0.5,
            "volatility": 0.2,
            "score": 75.0,
            "feeManage": 0.015,
            "nav_data": [{"date": "2024-01-01", "nav": 1.0}] * 300,
            "holdings": [{"stock_code": "000001"}],
            "asset_allocation": [{"type": "股票", "ratio": 60.0}],
        }
        fake_quarterly = {
            "holder_count": 0,
            "scale_count": 4,
            "turnover_count": 0,
            "bond_alloc_count": 0,
            "bond_hold_count": 0,
        }

        def fake_execute(sql, params=None):
            m = MagicMock()
            sql_lower = (sql or "").lower()
            if "sum(case" in sql_lower:
                m.fetchone.return_value = fake_quarterly
            elif "fund_manager_history_snapshot" in sql_lower:
                m.fetchone.return_value = {"c": 0}
            elif "fund_report_snapshot" in sql_lower:
                m.fetchone.return_value = {"c": 0}
            elif "fund_metrics_snapshot" in sql_lower and "score" in sql_lower:
                m.fetchone.return_value = {"c": 1}
            elif "fund_metrics_snapshot" in sql_lower and "fee" in sql_lower:
                m.fetchone.return_value = {"c": 1}
            elif "fund_quote_snapshot" in sql_lower:
                m.fetchone.return_value = {"near_1y": 0.05, "near_3y": 0.15}
            else:
                m.fetchone.return_value = None
            return m

        with patch.object(
            db_module.FundDataStore, "get_snapshot", return_value=fake_snapshot
        ), patch.object(db_module, "get_db_context") as db_ctx:
            cm = db_ctx.return_value
            cm.__enter__.return_value = cm
            cm.execute = fake_execute
            return asyncio.run(fund_api.fund_detail_completeness(code="000001"))

    def test_total_sections_at_least_17(self):
        """补齐后 sections 总数应 >= 17（12 旧 + 5 新：rating/purchaseInfo/yearReturns/peerPerformance/riskSummary）。"""
        result = self._invoke()
        self.assertIsInstance(result, dict)
        self.assertGreaterEqual(result.get("total", 0), 17)
        for key in ("rating", "purchaseInfo", "yearReturns", "peerPerformance", "riskSummary"):
            self.assertIn(key, result.get("sections", {}), f"missing section: {key}")
        self.assertEqual(result["sections"]["rating"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["purchaseInfo"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["yearReturns"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["peerPerformance"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["riskSummary"]["dataStatus"], "available")

    def test_no_data_snapshot_reports_missing(self):
        """当 snapshot 为 None、DB 全空时，section 应真实反映 missing。"""
        def fake_execute(sql, params=None):
            m = MagicMock()
            sql_lower = (sql or "").lower()
            if "sum(case" in sql_lower:
                m.fetchone.return_value = {
                    "holder_count": 0, "scale_count": 0, "turnover_count": 0,
                    "bond_alloc_count": 0, "bond_hold_count": 0,
                }
            elif "fund_metrics_snapshot" in sql_lower and "score" in sql_lower:
                m.fetchone.return_value = {"c": 0}
            elif "fund_metrics_snapshot" in sql_lower and "fee" in sql_lower:
                m.fetchone.return_value = {"c": 0}
            elif "fund_quote_snapshot" in sql_lower:
                m.fetchone.return_value = None
            else:
                m.fetchone.return_value = {"c": 0}
            return m

        with patch.object(
            db_module.FundDataStore, "get_snapshot", return_value=None
        ), patch.object(db_module, "get_db_context") as db_ctx:
            cm = db_ctx.return_value
            cm.__enter__.return_value = cm
            cm.execute = fake_execute
            result = asyncio.run(fund_api.fund_detail_completeness(code="000001"))

        self.assertIsInstance(result, dict)
        # 无数据时，rating/yearReturns/peerPerformance/riskSummary 应为 missing
        for key in ("rating", "purchaseInfo", "yearReturns", "peerPerformance", "riskSummary"):
            self.assertEqual(
                result["sections"][key]["dataStatus"], "missing",
                f"{key} should be missing",
            )


class ScaleHistoryBackfillTest(unittest.TestCase):
    """P2.1: scaleHistory 在 DB 样本 < 4 时应回填 tushare fund_share×unit_nav。"""

    def test_tushare_backfill_merges_with_db_and_dedups(self):
        """DB 1 季度 + tushare 4 季度 → 合并去重后 ≥ 4 季度。"""
        from app.services import fund_service as fs

        db_rows = [
            {"report_date": "2025-09-30", "total_scale": 10.5, "source": "snapshot", "updated_at": "2025-10-01"},
        ]
        tushare_out = [
            {"quarter": "2025-09-30", "totalScale": 10.5, "peer25Scale": None},  # 重复
            {"quarter": "2025-06-30", "totalScale": 11.2, "peer25Scale": None},
            {"quarter": "2025-03-31", "totalScale": 12.0, "peer25Scale": None},
            {"quarter": "2024-12-31", "totalScale": 12.5, "peer25Scale": None},
        ]
        with patch.object(fs, "_safe_table_query", return_value=db_rows), \
             patch.object(fs, "_backfill_scale_history_from_tushare", return_value=tushare_out):
            payload = fs.get_fund_scale_history("000001", periods=4)

        # 4 行，按时间正序
        self.assertEqual(len(payload["rows"]), 4)
        quarters = [r["quarter"] for r in payload["rows"]]
        self.assertEqual(quarters, ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30"])
        # 不应重复 2025-09-30
        self.assertEqual(quarters.count("2025-09-30"), 1)
        # 数值精度 OK
        self.assertAlmostEqual(payload["rows"][0]["totalScale"], 12.5, places=4)
        self.assertEqual(payload["dataStatus"], "available")

    def test_tushare_backfill_helper_handles_missing_provider(self):
        """tushare pro 不可用时返回空列表，不抛异常。"""
        from app.services import fund_service as fs

        # Mock 整个 tushare import 失败
        import sys
        with patch.dict(sys.modules, {"app.data.providers.tushare_provider": None}):
            result = fs._backfill_scale_history_from_tushare("000001", 4, [])
        self.assertEqual(result, [])

    def test_db_only_path_unchanged_when_enough_rows(self):
        """DB 已有 4+ 季度时不应触发 tushare 回填。"""
        from app.services import fund_service as fs

        db_rows = [
            {"report_date": f"2025-0{i+1}-{(i+1)*5:02d}", "total_scale": 10.0 + i, "source": "snapshot", "updated_at": ""}
            for i in range(4)
        ]
        with patch.object(fs, "_safe_table_query", return_value=db_rows), \
             patch.object(fs, "_backfill_scale_history_from_tushare") as mock_backfill:
            payload = fs.get_fund_scale_history("000001", periods=4)
        # 不应调用 tushare 回填
        mock_backfill.assert_not_called()
        self.assertEqual(len(payload["rows"]), 4)
        self.assertEqual(payload["dataStatus"], "available")


class PeerYearReturnTest(unittest.TestCase):
    """P2.1: yearReturns.peerReturn 来自同类基金年度均值（百分数，不二次乘 100）。"""

    def test_peer_year_return_computes_trimmed_mean_as_percent(self):
        """_peer_year_return 返回百分数（不应再被 *100）。"""
        from app.services import fund_service as fs

        # Mock _safe_table_query: first call returns fund_type, second peer codes, third nav rows
        call_count = {"n": 0}
        responses = [
            [{"fund_type": "混合型"}],
            [{"code": "000002"}, {"code": "000003"}, {"code": "000004"}, {"code": "000005"}],
            # 4 个 peer 的 start/end nav
            [
                {"code": "000002", "start_nav": 1.0, "end_nav": 1.2},   # +20%
                {"code": "000003", "start_nav": 1.0, "end_nav": 1.1},   # +10%
                {"code": "000004", "start_nav": 1.0, "end_nav": 1.3},   # +30%
                {"code": "000005", "start_nav": 1.0, "end_nav": 1.05},  # +5%
            ],
        ]

        def fake_safe_query(sql, params=None):
            call_count["n"] += 1
            if call_count["n"] <= len(responses):
                return responses[call_count["n"] - 1]
            return []

        with patch.object(fs, "_safe_table_query", side_effect=fake_safe_query):
            peer = fs._peer_year_return("000001", 2024)

        # trim 10% from each end on n=4: k=1, trimmed = [10, 20] → mean 15.0 → 百分数
        self.assertIsNotNone(peer)
        self.assertAlmostEqual(peer, 15.0, places=2)
        # 不应是 1500 之类（避免二次乘 100）
        self.assertLess(abs(peer), 200, "peer should be percent, not basis points or fraction")

    def test_peer_year_return_returns_none_with_too_few_samples(self):
        """同类型 < 3 个基金时返回 None（避免极端噪声）。"""
        from app.services import fund_service as fs

        call_count = {"n": 0}
        responses = [
            [{"fund_type": "货币型"}],
            [{"code": "000002"}, {"code": "000003"}],  # 仅有 2 个
            [
                {"code": "000002", "start_nav": 1.0, "end_nav": 1.01},
                {"code": "000003", "start_nav": 1.0, "end_nav": 1.02},
            ],
        ]

        def fake_safe_query(sql, params=None):
            call_count["n"] += 1
            if call_count["n"] <= len(responses):
                return responses[call_count["n"] - 1]
            return []

        with patch.object(fs, "_safe_table_query", side_effect=fake_safe_query):
            peer = fs._peer_year_return("000001", 2024)
        self.assertIsNone(peer)

    def test_peer_year_return_returns_none_when_fund_type_missing(self):
        """基金无 fund_type 时返回 None。"""
        from app.services import fund_service as fs

        with patch.object(fs, "_safe_table_query", return_value=[]):
            peer = fs._peer_year_return("999999", 2024)
        self.assertIsNone(peer)


if __name__ == "__main__":
    unittest.main()
