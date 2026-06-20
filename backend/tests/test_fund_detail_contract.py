import asyncio
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.api import analysis as analysis_api
from app.api import fund as fund_api
from app.services import fund_service
from app.storage import database as db_module


class FundDetailContractTest(unittest.TestCase):
    def test_bounded_series_limits_window_and_points(self):
        points = [
            {"date": f"2024-01-{day:02d}", "return": float(day)}
            for day in range(1, 11)
        ]

        bounded = fund_service._bounded_series(points, window_days=5, max_points=3)

        self.assertLessEqual(len(bounded), 3)
        self.assertEqual(bounded[0]["date"], "2024-01-05")
        self.assertEqual(bounded[-1]["date"], "2024-01-10")

    def test_bounded_series_preserves_edges_when_downsampling(self):
        points = [
            {"date": f"2024-01-{day:02d}", "return": float(day)}
            for day in range(1, 11)
        ]

        bounded = fund_service._bounded_series(points, window_days=None, max_points=4)

        self.assertEqual(len(bounded), 4)
        self.assertEqual(bounded[0], points[0])
        self.assertEqual(bounded[-1], points[-1])

    def test_exchange_nav_history_refreshes_stale_rows_from_efinance(self):
        fetched = [
            {"date": "2099-01-01", "nav": 2.0, "acc_nav": 2.0, "day_growth": 0.0},
            {"date": "2099-01-02", "nav": 2.1, "acc_nav": 2.1, "day_growth": 5.0},
        ]

        with patch("app.data.efinance_fetcher.get_fund_nav_history", return_value=fetched) as fetch, \
            patch.object(db_module.FundDataStore, "save_nav_history_batch", return_value=2) as save:
            rows = fund_service._refresh_exchange_nav_history("510300", "2000-01-02")

        fetch.assert_called_once_with("510300")
        save.assert_called_once()
        self.assertEqual(rows[-1]["nav"], 2.1)

    def test_exchange_nav_history_keeps_current_rows_when_efinance_not_newer(self):
        fetched = [
            {"date": "2099-01-01", "nav": 2.0, "acc_nav": 2.0, "day_growth": 0.0},
            {"date": "2099-01-02", "nav": 2.1, "acc_nav": 2.1, "day_growth": 5.0},
        ]

        with patch("app.data.efinance_fetcher.get_fund_nav_history", return_value=fetched), \
            patch.object(db_module.FundDataStore, "save_nav_history_batch") as save:
            rows = fund_service._refresh_exchange_nav_history("510300", "2099-01-02")

        save.assert_not_called()
        self.assertEqual(rows, [])

    def test_eastmoney_purchase_info_parser_extracts_sales_fields(self):
        html = """
        <table><tr><td class="th">申购状态</td><td>开放申购</td><td class="th">赎回状态</td><td>开放赎回</td></tr></table>
        <table><tr><td class="th">申购起点</td><td>10.00元</td></tr></table>
        <h4><label>运作费用</label></h4>
        <table><tr><td class="th">管理费率</td><td>1.20%（每年）</td><td class="th">托管费率</td><td>0.20%（每年）</td><td class="th">销售服务费率</td><td>---</td></tr></table>
        <div class="box"><h4><label>申购费率（前端）</label></h4><table><tbody><tr><td>小于100万元</td><td><strike>1.50%</strike>|0.15%</td></tr></tbody></table></div>
        <div class="box"><h4><label>赎回费率</label></h4><table><tbody><tr><td>小于7天</td><td>1.50%</td></tr></tbody></table></div>
        """

        payload = fund_service._parse_eastmoney_purchase_info("000001", html, as_of="2026-06-19T00:00:00")

        self.assertIsNotNone(payload)
        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["source"], "eastmoney:fundf10_fee_page")
        self.assertEqual(payload["purchaseStatus"], "开放申购")
        self.assertEqual(payload["redeemStatus"], "开放赎回")
        self.assertEqual(payload["minPurchaseAmount"], 10.0)
        self.assertEqual(payload["subscriptionFeeRate"], "1.50% / 0.15%")
        self.assertEqual(payload["redemptionFeeRate"], "1.50%")
        self.assertEqual(payload["managementFeeRate"], "1.20%")
        self.assertEqual(payload["custodyFeeRate"], "0.20%")
        self.assertEqual(payload["totalFeeRate1y"], "1.40")

    def test_purchase_info_prefers_eastmoney_payload_over_metrics(self):
        eastmoney_payload = {
            "code": "000001",
            "purchaseStatus": "开放申购",
            "dataStatus": "available",
            "source": "eastmoney:fundf10_fee_page",
            "asOf": "2026-06-19T00:00:00",
            "coverage": 1.0,
            "missingReason": None,
        }

        with patch.object(fund_service, "_fetch_eastmoney_purchase_info", return_value=eastmoney_payload), \
            patch.object(fund_service, "get_db_context") as db_ctx:
            payload = fund_service.get_fund_purchase_info("000001")

        self.assertEqual(payload, eastmoney_payload)
        db_ctx.assert_not_called()

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
        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_text", return_value=None):
            payload = fund_service.get_fund_holder_structure("000001", periods=8)

        self.assertEqual(payload["dataStatus"], "missing")
        self.assertEqual(payload["rows"], [])
        self.assertNotEqual(payload["dataStatus"], "simulated")
        self.assertIn("不再使用", payload["missingReason"])

    def test_rating_endpoint_returns_metrics_score_without_star_rating(self):
        context = MagicMock()
        conn = MagicMock()
        context.__enter__.return_value = conn
        conn.execute.return_value.fetchone.return_value = {
            "score": 72.5,
            "as_of": "2026-06-09T14:29:41.211873",
        }

        with patch("app.services.fund_service.get_fund_rating", return_value=None), \
            patch("app.storage.database.get_db_context", return_value=context):
            payload = asyncio.run(fund_api.fund_rating(code="510300"))

        self.assertEqual(payload["dataStatus"], "partial")
        self.assertEqual(payload["source"], "fund_metrics_snapshot")
        self.assertEqual(payload["score"], 72.5)
        self.assertIsNone(payload["rating3y"])
        self.assertIsNone(payload["rating5y"])
        self.assertEqual(payload["asOf"], "2026-06-09T14:29:41.211873")
        self.assertIn("真实评级星级", payload["missingReason"])

    def test_eastmoney_rating_parser_returns_real_overall_rating(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = (
            b'{"Data":[{"FCODE":"019067","RDATE":"2026-03-31",'
            b'"ZSPJ":"4","SZPJ3":null,"ZSPJ5":null,"JAPJ":null,"CXPJ3":null}],'
            b'"ErrCode":0,"TotalCount":1}'
        )

        with patch("urllib.request.urlopen", return_value=response):
            payload = fund_service._fetch_eastmoney_fund_rating("019067")

        self.assertEqual(payload["ratingOverall"], 4)
        self.assertEqual(payload["ratingAgency"], "\u62db\u5546\u8bc4\u7ea7")
        self.assertEqual(payload["asOf"], "2026-03-31")
        self.assertEqual(payload["source"], "eastmoney:fund_rating")

    def test_rating_endpoint_accepts_real_overall_rating(self):
        with patch("app.services.fund_service.get_fund_rating", return_value={
            "code": "019067",
            "rating3y": None,
            "rating5y": None,
            "ratingOverall": 4,
            "ratingAgency": "\u62db\u5546\u8bc4\u7ea7",
            "ratingDate": "2026-03-31",
            "score": None,
            "source": "eastmoney:fund_rating",
            "asOf": "2026-03-31",
        }):
            payload = asyncio.run(fund_api.fund_rating(code="019067"))

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["coverage"], 0.8)
        self.assertEqual(payload["ratingOverall"], 4)
        self.assertIsNone(payload["missingReason"])

    def test_empty_bond_holdings_snapshot_allows_akshare_fallback(self):
        fallback = {
            "bond_holdings": [
                {
                    "name": "26\u56fd\u503a01",
                    "code": "019801",
                    "ratio": 12.34,
                    "quarter": "2026-03-31",
                }
            ]
        }
        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "_fetch_chinamoney_bond_info", return_value=None), \
            patch("app.data.akshare_fetcher.get_fund_bond_portfolio", return_value=fallback):
            payload = fund_service.get_fund_bond_holdings("000001")

        self.assertEqual(payload["dataStatus"], "partial")
        self.assertEqual(payload["rows"][0]["bondName"], "26\u56fd\u503a01")
        self.assertEqual(payload["rows"][0]["bondCode"], "019801")
        self.assertEqual(payload["rows"][0]["bondType"], "\u56fd\u5bb6\u503a\u5238")
        self.assertEqual(payload["rows"][0]["issuer"], "\u4e2d\u534e\u4eba\u6c11\u5171\u548c\u56fd\u8d22\u653f\u90e8")
        self.assertEqual(payload["rows"][0]["navRatio"], 12.34)
        self.assertEqual(payload["asOf"], "2026-03-31")

    def test_bond_holdings_derives_market_value_from_real_scale(self):
        fallback = {
            "bond_holdings": [
                {"name": "26\u519c\u53d101", "code": "260401", "ratio": 2.5, "quarter": "2026-03-31"}
            ]
        }
        scale_row = [{"total_scale": 100.0, "report_date": "2026-03-31", "source": "tushare"}]
        with patch.object(fund_service, "_safe_table_query", side_effect=[[], scale_row]), \
            patch.object(fund_service, "_fetch_chinamoney_bond_info", return_value=None), \
            patch("app.data.akshare_fetcher.get_fund_bond_portfolio", return_value=fallback):
            payload = fund_service.get_fund_bond_holdings("000001")

        row = payload["rows"][0]
        self.assertEqual(row["issuer"], "\u4e2d\u56fd\u519c\u4e1a\u53d1\u5c55\u94f6\u884c")
        self.assertEqual(row["bondType"], "\u653f\u7b56\u6027\u91d1\u878d\u503a")
        self.assertEqual(row["marketValue"], 2.5)
        self.assertEqual(row["marketValueUnit"], "\u4ebf\u5143")
        self.assertTrue(row["marketValueEstimated"])

    def test_bond_holdings_fallback_timeout_returns_missing(self):
        def slow_fetch(code):
            time.sleep(0.05)
            return {"bond_holdings": [{"name": "\u8d85\u65f6\u503a\u5238", "ratio": 1.0}]}

        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "BOND_HOLDINGS_FALLBACK_TIMEOUT_SECONDS", 0.001), \
            patch("app.data.akshare_fetcher.get_fund_bond_portfolio", side_effect=slow_fetch):
            payload = fund_service.get_fund_bond_holdings("000001")

        self.assertEqual(payload["dataStatus"], "missing")
        self.assertEqual(payload["rows"], [])

    def test_bond_holdings_report_confirmed_empty_is_available(self):
        report = {
            "report_date": "2025-12-31",
            "source": "eastmoney:periodic_report_pdf",
            "text": "8.5 \u671f\u672b\u6309\u503a\u5238\u54c1\u79cd\u5206\u7c7b\u7684\u503a\u5238\u6295\u8d44\u7ec4\u5408\n\u672c\u57fa\u91d1\u672c\u62a5\u544a\u671f\u672b\u672a\u6301\u6709\u503a\u5238\u3002",
        }
        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch("app.data.akshare_fetcher.get_fund_bond_portfolio", return_value={}), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_text", return_value=report):
            payload = fund_service.get_fund_bond_holdings("510300")

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["rows"], [])
        self.assertEqual(payload["coverage"], 1.0)
        self.assertEqual(payload["source"], "eastmoney:periodic_report_pdf")
        self.assertEqual(payload["asOf"], "2025-12-31")

    def test_report_pdf_text_parsers_extract_holder_and_bond_allocation(self):
        holder_text = (
            "\u00a79 \u57fa\u91d1\u4efd\u989d\u6301\u6709\u4eba\u4fe1\u606f\n"
            "9.1 \u671f\u672b\u57fa\u91d1\u4efd\u989d\u6301\u6709\u4eba\u6237\u6570\u53ca\u6301\u6709\u4eba\u7ed3\u6784\n"
            "\u5408\u8ba1 1,966,186 4,748.85 21,655,926.84 0.23 9,315,472,893.16 99.77\n"
        )
        bond_text = (
            "8.5 \u671f\u672b\u6309\u503a\u5238\u54c1\u79cd\u5206\u7c7b\u7684\u503a\u5238\u6295\u8d44\u7ec4\u5408\n"
            "\u5e8f\u53f7 \u503a\u5238\u54c1\u79cd \u516c\u5141\u4ef7\u503c \u5360\u57fa\u91d1\u8d44\u4ea7\u51c0\u503c\u6bd4\u4f8b\uff08%\uff09\n"
            "1 \u56fd\u5bb6\u503a\u5238 - -\n"
            "3 \u91d1\u878d\u503a\u5238 625,003,654.79 3.92\n"
            "10 \u5408\u8ba1 625,003,654.79 3.92\n"
        )

        holder_rows = fund_service._parse_holder_structure_from_report_text(holder_text, "2025-12-31")
        bond_rows = fund_service._parse_bond_allocation_from_report_text(bond_text)

        self.assertEqual(holder_rows, [{"quarter": "2025-12-31", "institution": 0.23, "individual": 99.77}])
        self.assertEqual(bond_rows, [{"bondType": "\u91d1\u878d\u503a\u5238", "ratio": 3.92, "changeRatio": None}])

    def test_report_pdf_text_parser_extracts_asset_allocation(self):
        asset_text = (
            "8.1 \u671f\u672b\u57fa\u91d1\u8d44\u4ea7\u7ec4\u5408\u60c5\u51b5\n"
            "1 \u56fa\u5b9a\u6536\u76ca\u6295\u8d44 8,658,973,706.49 64.00\n"
            "\u5176\u4e2d\uff1a\u503a\u5238 8,658,973,706.49 64.00\n"
            "2 \u4e70\u5165\u8fd4\u552e\u91d1\u878d\u8d44\u4ea7 1,568,990,176.72 11.60\n"
            "3 \u94f6\u884c\u5b58\u6b3e\u548c\u7ed3\u7b97\u5907\u4ed8\u91d1\u5408\u8ba1 3,219,947,795.71 23.80\n"
            "4 \u5176\u4ed6\u5404\u9879\u8d44\u4ea7 82,526,086.67 0.61\n"
            "5 \u5408\u8ba1 13,530,437,765.59 100.00\n"
            "8.2 \u62a5\u544a\u671f\u672b\u6309\u884c\u4e1a\u5206\u7c7b\u7684\u80a1\u7968\u6295\u8d44\u7ec4\u5408\n"
        )

        rows = fund_service._parse_asset_allocation_from_report_text(asset_text, "2026-03-31")

        self.assertEqual(
            rows,
            [
                {
                    "name": "\u56fa\u5b9a\u6536\u76ca\u6295\u8d44",
                    "ratio": 64.0,
                    "report_date": "2026-03-31",
                    "source": "eastmoney:periodic_report_pdf",
                },
                {
                    "name": "\u4e70\u5165\u8fd4\u552e\u91d1\u878d\u8d44\u4ea7",
                    "ratio": 11.6,
                    "report_date": "2026-03-31",
                    "source": "eastmoney:periodic_report_pdf",
                },
                {
                    "name": "\u94f6\u884c\u5b58\u6b3e\u548c\u7ed3\u7b97\u5907\u4ed8\u91d1\u5408\u8ba1",
                    "ratio": 23.8,
                    "report_date": "2026-03-31",
                    "source": "eastmoney:periodic_report_pdf",
                },
                {
                    "name": "\u5176\u4ed6\u5404\u9879\u8d44\u4ea7",
                    "ratio": 0.61,
                    "report_date": "2026-03-31",
                    "source": "eastmoney:periodic_report_pdf",
                },
            ],
        )

    def test_report_pdf_text_parser_handles_split_asset_allocation_bank_row(self):
        asset_text = (
            "8.1 \u671f\u672b\u57fa\u91d1\u8d44\u4ea7\u7ec4\u5408\u60c5\u51b5\n"
            "1 \u6743\u76ca\u6295\u8d44 - -\n"
            "2 \u57fa\u91d1\u6295\u8d44 - -\n"
            "3 \u56fa\u5b9a\u6536\u76ca\u6295\u8d44 8,578,276,025.39 99.05\n"
            "\u5176\u4e2d\uff1a\u503a\u5238 8,578,276,025.39 99.05\n"
            "4 \u8d35\u91d1\u5c5e\u6295\u8d44 - -\n"
            "5 \u91d1\u878d\u884d\u751f\u54c1\u6295\u8d44 - -\n"
            "6 \u4e70\u5165\u8fd4\u552e\u91d1\u878d\u8d44\u4ea7 - -\n"
            "\u94f6\u884c\u5b58\u6b3e\u548c\u7ed3\u7b97\u5907\u4ed8\u91d1\u5408\n"
            "7 60,233,180.99 0.70\n"
            "\u8ba1\n"
            "8 \u5176\u4ed6\u5404\u9879\u8d44\u4ea7 21,904,009.72 0.25\n"
            "9 \u5408\u8ba1 8,660,413,216.10 100.00\n"
            "8.2 \u62a5\u544a\u671f\u672b\u6309\u884c\u4e1a\u5206\u7c7b\u7684\u80a1\u7968\u6295\u8d44\u7ec4\u5408\n"
        )

        rows = fund_service._parse_asset_allocation_from_report_text(asset_text, "2026-03-31")

        self.assertEqual(
            [(row["name"], row["ratio"]) for row in rows],
            [
                ("\u56fa\u5b9a\u6536\u76ca\u6295\u8d44", 99.05),
                ("\u94f6\u884c\u5b58\u6b3e\u548c\u7ed3\u7b97\u5907\u4ed8\u91d1\u5408\u8ba1", 0.7),
                ("\u5176\u4ed6\u5404\u9879\u8d44\u4ea7", 0.25),
            ],
        )

    def test_report_pdf_text_parser_extracts_etf_linked_fund_holder_structure(self):
        holder_text = (
            "9.1 \u671f\u672b\u57fa\u91d1\u4efd\u989d\u6301\u6709\u4eba\u6237\u6570\u53ca\u6301\u6709\u4eba\u7ed3\u6784\n"
            "\u6301\u6709\u4eba\u7ed3\u6784\n"
            "\u5357\u65b9\u4e2d\u8bc1 1000 \u4ea4\u6613\u578b\u5f00\u653e\u5f0f\u6307\u6570\u8bc1\u5238\n"
            "\u673a\u6784\u6295\u8d44\u8005 \u4e2a\u4eba\u6295\u8d44\u8005\n"
            "\u6295\u8d44\u57fa\u91d1\u53d1\u8d77\u5f0f\u8054\u63a5\u57fa\u91d1\n"
            "47,119 72,339.0 95.02% 4.01% 0.97%\n"
            "9.2 \u671f\u672b\u4e0a\u5e02\u57fa\u91d1\u524d\u5341\u540d\u6301\u6709\u4eba\n"
        )

        holder_rows = fund_service._parse_holder_structure_from_report_text(holder_text, "2025-12-31")

        self.assertEqual(holder_rows, [{
            "quarter": "2025-12-31",
            "institution": 95.02,
            "individual": 4.01,
            "linkedFund": 0.97,
        }])

    def test_report_pdf_text_parser_handles_split_etf_linked_fund_header(self):
        holder_text = (
            "9.1 \u671f\u672b\u57fa\u91d1\u4efd\u989d\u6301\u6709\u4eba\u6237\u6570\u53ca\u6301\u6709\u4eba\u7ed3\u6784\n"
            "\u4efd\u989d\u5355\u4f4d\uff1a\u4efd\n"
            "\u6301\u6709\u4eba\u7ed3\u6784\n"
            "\u5357\u65b9\u4e2d\u8bc1 1000 \u4ea4\u6613\n"
            "\u6301\u6709\u4eba \u6237\u5747\u6301 \u578b\u5f00\u653e\u5f0f\u6307\u6570\u8bc1\u5238\n"
            "\u673a\u6784\u6295\u8d44\u8005 \u4e2a\u4eba\u6295\u8d44\u8005\n"
            "\u6237\u6570 \u6709\u7684\u57fa \u6295\u8d44\u57fa\u91d1\u53d1\u8d77\u5f0f\u8054\n"
            "\uff08\u6237\uff09 \u91d1\u4efd\u989d \u63a5\u57fa\u91d1\n"
            "\u6301\u6709\u4efd \u5360\u603b\u4efd \u6301\u6709\u4efd \u5360\u603b\u4efd \u6301\u6709\u4efd \u5360\u603b\u4efd\n"
            "47,119 72,339.0 95.02% 4.01% 0.97%\n"
            "9.2 \u671f\u672b\u4e0a\u5e02\u57fa\u91d1\u524d\u5341\u540d\u6301\u6709\u4eba\n"
            "1 \u4e2d\u592e\u6c47\u91d1\u8d44\u4ea7\u7ba1\u7406\u6709\u9650\u8d23\u4efb\u516c\u53f8 51.51%\n"
        )

        holder_rows = fund_service._parse_holder_structure_from_report_text(holder_text, "2025-12-31")

        self.assertEqual(holder_rows, [{
            "quarter": "2025-12-31",
            "institution": 95.02,
            "individual": 4.01,
            "linkedFund": 0.97,
        }])

    def test_report_pdf_text_parser_handles_split_etf_ratio_columns(self):
        holder_text = (
            "\u671f\u672b\u57fa\u91d1\u4efd\u989d\u6301\u6709\u4eba\u6237\u6570\u53ca\u6301\u6709\u4eba\u7ed3\u6784\n"
            "\u4efd\u989d\u5355\u4f4d\uff1a\u4efd\n"
            "\u6301\u6709\u4eba\u7ed3\u6784\n"
            "\u673a\u6784\u6295\u8d44\u8005 \u4e2a\u4eba\u6295\u8d44\u8005 \u6613\u578b\u5f00\u653e\u5f0f\u6307\u6570\u8bc1\u5238\n"
            "\u6301\u6709\u4eba \u6237\u5747\u6301 \u6295\u8d44\u57fa\u91d1\u8054\u63a5\u57fa\u91d1\n"
            "\u6301\u6709\u4efd\u989d \u6bd4\u4f8b \u6301\u6709\u4efd\u989d \u6bd4\u4f8b \u6301\u6709\u4efd\u989d \u6bd4\u4f8b\n"
            "554,43 160,215. 80,189,666,631 90.2 7,974,868,591 665,052,468\n"
            "8.98 0.75\n"
            "8 55 .00 7 .00 .00\n"
            "9.2 \u671f\u672b\u4e0a\u5e02\u57fa\u91d1\u524d\u5341\u540d\u6301\u6709\u4eba\n"
        )

        holder_rows = fund_service._parse_holder_structure_from_report_text(holder_text, "2025-12-31")

        self.assertEqual(holder_rows, [{
            "quarter": "2025-12-31",
            "institution": 90.2,
            "individual": 8.98,
            "linkedFund": 0.75,
        }])

    def test_report_pdf_text_parser_extracts_stock_trading_activity(self):
        text = (
            "8.4.3 \u4e70\u5165\u80a1\u7968\u7684\u6210\u672c\u603b\u989d\u53ca\u5356\u51fa\u80a1\u7968\u7684\u6536\u5165\u603b\u989d\n"
            "\u5355\u4f4d: \u4eba\u6c11\u5e01\u5143\n"
            "\u4e70\u5165\u80a1\u7968\u6210\u672c\uff08\u6210\u4ea4\uff09\u603b\u989d 785,562,768.66\n"
            "\u5356\u51fa\u80a1\u7968\u6536\u5165\uff08\u6210\u4ea4\uff09\u603b\u989d 5,878,949,463.92\n"
        )

        rows = fund_service._parse_stock_trading_activity_from_report_text(text, "2025-12-31")

        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["turnoverRate"])
        self.assertEqual(rows[0]["buyStockAmount"], 785562768.66)
        self.assertEqual(rows[0]["sellStockAmount"], 5878949463.92)
        self.assertEqual(rows[0]["calculationStatus"], "missing_average_stock_market_value")

    def test_report_pdf_text_parser_extracts_stock_trading_activity_with_de_particle(self):
        text = (
            "8.4.3 \u4e70\u5165\u80a1\u7968\u7684\u6210\u672c\u603b\u989d\u53ca\u5356\u51fa\u80a1\u7968\u7684\u6536\u5165\u603b\u989d\n"
            "\u5355\u4f4d\uff1a\u4eba\u6c11\u5e01\u5143\n"
            "\u4e70\u5165\u80a1\u7968\u7684\u6210\u672c\uff08\u6210\u4ea4\uff09\u603b\u989d 122,264,087.58\n"
            "\u5356\u51fa\u80a1\u7968\u7684\u6536\u5165\uff08\u6210\u4ea4\uff09\u603b\u989d 99,251,973.87\n"
        )

        rows = fund_service._parse_stock_trading_activity_from_report_text(text, "2025-12-31")

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["buyStockAmount"], 122264087.58)
        self.assertEqual(rows[0]["sellStockAmount"], 99251973.87)

    def test_holder_structure_falls_back_to_report_pdf_and_persists(self):
        report = {
            "report_date": "2025-12-31",
            "source": "eastmoney:periodic_report_pdf",
            "text": (
                "9.1 \u671f\u672b\u57fa\u91d1\u4efd\u989d\u6301\u6709\u4eba\u6237\u6570\u53ca\u6301\u6709\u4eba\u7ed3\u6784 "
                "\u5408\u8ba1 1,966,186 4,748.85 21,655,926.84 0.23 9,315,472,893.16 99.77"
            ),
        }
        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_text", return_value=report), \
            patch.object(fund_service, "_persist_quarterly_snapshot_field") as persist:
            payload = fund_service.get_fund_holder_structure("000001", periods=8)

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["rows"][0]["institution"], 0.23)
        self.assertEqual(payload["rows"][0]["individual"], 99.77)
        persist.assert_called_once()

    def test_holder_structure_reads_linked_fund_from_snapshot(self):
        rows = [{
            "report_date": "2025-12-31",
            "holder_structure_json": (
                "[{\"quarter\":\"2025-12-31\",\"institution\":95.02,"
                "\"individual\":4.01,\"linkedFund\":0.97}]"
            ),
            "source": "eastmoney:periodic_report_pdf",
            "data_quality": "report_pdf",
            "updated_at": "2026-06-09T00:00:00",
        }]
        with patch.object(fund_service, "_safe_table_query", return_value=rows), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_text") as fetch:
            payload = fund_service.get_fund_holder_structure("512100", periods=8)

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["rows"][0]["linkedFund"], 0.97)
        fetch.assert_not_called()

    def test_holder_structure_reparses_malformed_cached_snapshot(self):
        rows = [{
            "report_date": "2025-12-31",
            "holder_structure_json": "[{\"quarter\":\"2025-12-31\",\"institution\":4.01,\"individual\":0.97}]",
            "source": "eastmoney:periodic_report_pdf",
            "data_quality": "report_pdf",
            "updated_at": "2026-06-09T00:00:00",
        }]
        report = {
            "report_date": "2025-12-31",
            "source": "eastmoney:periodic_report_pdf",
            "text": (
                "9.1 \u671f\u672b\u57fa\u91d1\u4efd\u989d\u6301\u6709\u4eba\u6237\u6570\u53ca\u6301\u6709\u4eba\u7ed3\u6784\n"
                "\u673a\u6784\u6295\u8d44\u8005 \u4e2a\u4eba\u6295\u8d44\u8005 \u63a5\u57fa\u91d1\n"
                "47,119 72,339.0 95.02% 4.01% 0.97%\n"
                "9.2 \u671f\u672b\u4e0a\u5e02\u57fa\u91d1\u524d\u5341\u540d\u6301\u6709\u4eba\n"
            ),
        }
        with patch.object(fund_service, "_safe_table_query", return_value=rows), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_text", return_value=report), \
            patch.object(fund_service, "_persist_quarterly_snapshot_field") as persist:
            payload = fund_service.get_fund_holder_structure("512100", periods=8)

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["rows"][0]["institution"], 95.02)
        self.assertEqual(payload["rows"][0]["individual"], 4.01)
        self.assertEqual(payload["rows"][0]["linkedFund"], 0.97)
        persist.assert_called_once()

    def test_bond_allocation_falls_back_to_report_pdf_and_persists(self):
        report = {
            "report_date": "2025-12-31",
            "source": "eastmoney:periodic_report_pdf",
            "text": (
                "8.5 \u671f\u672b\u6309\u503a\u5238\u54c1\u79cd\u5206\u7c7b\u7684\u503a\u5238\u6295\u8d44\u7ec4\u5408\n"
                "3 \u91d1\u878d\u503a\u5238 625,003,654.79 3.92\n"
                "10 \u5408\u8ba1 625,003,654.79 3.92\n"
            ),
        }
        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_text", return_value=report), \
            patch.object(fund_service, "_persist_quarterly_snapshot_field") as persist:
            payload = fund_service.get_fund_bond_allocation("000001")

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["rows"][0]["bondType"], "\u91d1\u878d\u503a\u5238")
        self.assertEqual(payload["rows"][0]["ratio"], 3.92)
        persist.assert_called_once()

    def test_bond_allocation_report_confirmed_empty_is_available(self):
        report = {
            "report_date": "2025-12-31",
            "source": "eastmoney:periodic_report_pdf",
            "text": (
                "8.5 \u671f\u672b\u6309\u503a\u5238\u54c1\u79cd\u5206\u7c7b\u7684\u503a\u5238\u6295\u8d44\u7ec4\u5408\n"
                "\u672c\u57fa\u91d1\u672c\u62a5\u544a\u671f\u672b\u672a\u6301\u6709\u503a\u5238\u3002\n"
            ),
        }
        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_text", return_value=report), \
            patch.object(fund_service, "_persist_quarterly_snapshot_field") as persist:
            payload = fund_service.get_fund_bond_allocation("510300")

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["rows"], [])
        self.assertEqual(payload["coverage"], 1.0)
        self.assertEqual(payload["source"], "eastmoney:periodic_report_pdf")
        self.assertEqual(payload["asOf"], "2025-12-31")
        persist.assert_not_called()

    def test_report_asset_allocation_snapshot_persists_without_erasing_holdings(self):
        report = {
            "report_date": "2026-03-31",
            "source": "eastmoney:periodic_report_pdf",
            "text": (
                "8.1 \u671f\u672b\u57fa\u91d1\u8d44\u4ea7\u7ec4\u5408\u60c5\u51b5\n"
                "1 \u56fa\u5b9a\u6536\u76ca\u6295\u8d44 8,578,276,025.39 99.05\n"
                "2 \u5176\u4ed6\u5404\u9879\u8d44\u4ea7 21,904,009.72 0.25\n"
                "3 \u5408\u8ba1 8,660,413,216.10 100.00\n"
                "8.2 \u62a5\u544a\u671f\u672b\u6309\u884c\u4e1a\u5206\u7c7b\u7684\u80a1\u7968\u6295\u8d44\u7ec4\u5408\n"
            ),
        }
        base_snapshot = {"code": "000016", "holdings": [{"name": "\u56fd\u503a", "ratio": 12.3}]}
        enriched_snapshot = {
            **base_snapshot,
            "asset_allocation": [{"name": "\u56fa\u5b9a\u6536\u76ca\u6295\u8d44", "ratio": 99.05}],
        }

        with patch.object(db_module.FundDataStore, "get_snapshot", side_effect=[base_snapshot, enriched_snapshot]), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_text", return_value=report), \
            patch.object(
                fund_service,
                "_load_holdings_for_report_date",
                return_value=base_snapshot["holdings"],
            ) as load_holdings, \
            patch.object(db_module.FundDataStore, "save_holdings_snapshot", return_value=1) as save:
            result = fund_service.ensure_report_asset_allocation_snapshot("000016")

        load_holdings.assert_called_once_with("000016", "2026-03-31")
        save.assert_called_once()
        self.assertEqual(save.call_args.kwargs["holdings"], base_snapshot["holdings"])
        self.assertEqual(save.call_args.kwargs["asset_allocation"][0]["ratio"], 99.05)
        self.assertEqual(result["asset_allocation"][0]["ratio"], 99.05)

    def test_turnover_history_falls_back_to_report_trading_activity_as_partial(self):
        report = {
            "report_date": "2025-12-31",
            "source": "eastmoney:periodic_report_pdf",
            "text": (
                "8.4.3 \u4e70\u5165\u80a1\u7968\u7684\u6210\u672c\u603b\u989d\u53ca\u5356\u51fa\u80a1\u7968\u7684\u6536\u5165\u603b\u989d\n"
                "\u4e70\u5165\u80a1\u7968\u6210\u672c\uff08\u6210\u4ea4\uff09\u603b\u989d 785,562,768.66\n"
                "\u5356\u51fa\u80a1\u7968\u6536\u5165\uff08\u6210\u4ea4\uff09\u603b\u989d 5,878,949,463.92\n"
            ),
        }
        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_texts", return_value=[report]):
            payload = fund_service.get_fund_turnover_history("000001", periods=8)

        self.assertEqual(payload["dataStatus"], "partial")
        self.assertEqual(payload["source"], "eastmoney:periodic_report_pdf")
        self.assertIsNone(payload["rows"][0]["turnoverRate"])
        self.assertEqual(payload["rows"][0]["buyStockAmount"], 785562768.66)
        self.assertEqual(payload["rows"][0]["sellStockAmount"], 5878949463.92)
        self.assertIn("1/8", payload["missingReason"])

    def test_turnover_history_does_not_persist_scale_derived_turnover(self):
        report = {
            "report_date": "2025-12-31",
            "source": "eastmoney:periodic_report_pdf",
            "text": (
                "8.4.3 \u4e70\u5165\u80a1\u7968\u7684\u6210\u672c\u603b\u989d\u53ca\u5356\u51fa\u80a1\u7968\u7684\u6536\u5165\u603b\u989d\n"
                "\u4e70\u5165\u80a1\u7968\u7684\u6210\u672c\uff08\u6210\u4ea4\uff09\u603b\u989d 100,000,000.00\n"
                "\u5356\u51fa\u80a1\u7968\u7684\u6536\u5165\uff08\u6210\u4ea4\uff09\u603b\u989d 300,000,000.00\n"
            ),
        }

        def fake_query(sql, params=()):
            if "total_scale" in sql.lower():
                return [{"total_scale": 2.0, "report_date": "2025-12-31"}]
            return []

        with patch.object(fund_service, "_safe_table_query", side_effect=fake_query), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_texts", return_value=[report]), \
            patch.object(fund_service, "_persist_turnover_snapshot") as persist:
            payload = fund_service.get_fund_turnover_history("000001", periods=2)

        persist.assert_not_called()
        self.assertEqual(payload["dataStatus"], "partial")
        self.assertEqual(payload["rows"][0]["calculationStatus"], "estimated_from_total_scale")
        self.assertIn("\u6d3e\u751f", payload["missingReason"])

    def test_turnover_history_with_snapshot_does_not_fetch_reports_for_large_window(self):
        rows = [{"report_date": "2025-12-31", "turnover_rate": 2009.9638, "source": "eastmoney:periodic_report_pdf", "updated_at": "2026-06-19"}]
        with patch.object(fund_service, "_safe_table_query", return_value=rows), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_texts") as fetch_reports:
            payload = fund_service.get_fund_turnover_history("000001", periods=8)

        fetch_reports.assert_not_called()
        self.assertEqual(payload["dataStatus"], "partial")
        self.assertEqual(payload["coverage"], 0.125)
        self.assertIn("1/8", payload["missingReason"])

    def test_turnover_history_backfills_multiple_report_periods(self):
        reports = [
            {
                "report_date": "2025-12-31",
                "source": "eastmoney:periodic_report_pdf",
                "text": (
                    "8.4.3 \u4e70\u5165\u80a1\u7968\u7684\u6210\u672c\u603b\u989d\u53ca\u5356\u51fa\u80a1\u7968\u7684\u6536\u5165\u603b\u989d\n"
                    "\u4e70\u5165\u80a1\u7968\u6210\u672c\uff08\u6210\u4ea4\uff09\u603b\u989d 100,000,000.00\n"
                    "\u5356\u51fa\u80a1\u7968\u6536\u5165\uff08\u6210\u4ea4\uff09\u603b\u989d 300,000,000.00\n"
                    "\u80a1\u7968\u6301\u4ed3\u5e73\u5747\u5e02\u503c 1,000,000,000.00\n"
                ),
            },
            {
                "report_date": "2025-06-30",
                "source": "eastmoney:periodic_report_pdf",
                "text": (
                    "8.4.3 \u4e70\u5165\u80a1\u7968\u7684\u6210\u672c\u603b\u989d\u53ca\u5356\u51fa\u80a1\u7968\u7684\u6536\u5165\u603b\u989d\n"
                    "\u4e70\u5165\u80a1\u7968\u6210\u672c\uff08\u6210\u4ea4\uff09\u603b\u989d 200,000,000.00\n"
                    "\u5356\u51fa\u80a1\u7968\u6536\u5165\uff08\u6210\u4ea4\uff09\u603b\u989d 200,000,000.00\n"
                    "\u80a1\u7968\u6301\u4ed3\u5e73\u5747\u5e02\u503c 2,000,000,000.00\n"
                ),
            },
        ]
        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_texts", return_value=reports), \
            patch.object(fund_service, "_persist_turnover_snapshot") as persist:
            payload = fund_service.get_fund_turnover_history("000001", periods=2)

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["coverage"], 1.0)
        self.assertEqual([row["quarter"] for row in payload["rows"]], ["2025-06-30", "2025-12-31"])
        self.assertEqual(payload["rows"][0]["turnoverRate"], 10.0)
        self.assertEqual(payload["rows"][1]["turnoverRate"], 20.0)
        self.assertEqual(persist.call_count, 2)

    def test_turnover_history_marks_bond_fund_not_applicable(self):
        def fake_query(sql, params=()):
            sql_lower = sql.lower()
            if "turnover_rate" in sql_lower or "total_scale" in sql_lower:
                return []
            if "fund_master" in sql_lower:
                return [{"name": "真实债券基金", "fund_type": "债券型"}]
            return []

        with patch.object(fund_service, "_safe_table_query", side_effect=fake_query), \
            patch.object(fund_service, "_fetch_eastmoney_holder_report_pdf_texts", return_value=[]):
            payload = fund_service.get_fund_turnover_history("000001", periods=8)

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["coverage"], 1.0)
        self.assertEqual(payload["source"], "fund_master")
        self.assertEqual(payload["rows"][0]["calculationStatus"], "not_applicable")
        self.assertIn("不以股票交易换手率", payload["rows"][0]["note"])

    def test_bond_holding_infers_certificate_and_credit_issuer_fields(self):
        rows = [
            {"bondName": "26浦发银行CD059", "bondCode": "112609059", "navRatio": 4.34},
            {"bondName": "25宣城国资SCP005", "bondCode": "012583110", "navRatio": 2.21},
        ]

        with patch.object(fund_service, "_latest_total_scale", return_value=(1.9437, "20250630", "tushare:fund_share")), \
            patch.object(fund_service, "_fetch_chinamoney_bond_info", return_value=None):
            enriched, _notes = fund_service._enrich_bond_holdings("000001", rows)

        self.assertEqual(enriched[0]["bondType"], "同业存单")
        self.assertEqual(enriched[0]["issuer"], "浦发银行")
        self.assertEqual(enriched[1]["bondType"], "超短期融资券")
        self.assertEqual(enriched[1]["issuer"], "宣城国资")

    def test_bond_holding_enriches_chinamoney_coupon_and_disclosure_status(self):
        rows = [
            {"bondName": "26\u6d66\u53d1\u94f6\u884cCD059", "bondCode": "112609059", "navRatio": 4.34},
            {"bondName": "25\u5ba3\u57ce\u56fd\u8d44SCP005", "bondCode": "012583110", "navRatio": 2.21},
        ]

        def fake_chinamoney(bond_code, bond_name=None):
            if bond_code == "112609059":
                return {
                    "source": "chinamoney:bond_detail",
                    "issuer": "\u4e0a\u6d77\u6d66\u4e1c\u53d1\u5c55\u94f6\u884c\u80a1\u4efd\u6709\u9650\u516c\u53f8",
                    "bondType": "\u540c\u4e1a\u5b58\u5355",
                    "couponType": "\u8d34\u73b0\u5f0f",
                    "couponRateStatus": "not_applicable",
                    "creditRatingStatus": "unavailable",
                }
            if bond_code == "012583110":
                return {
                    "source": "chinamoney:bond_detail",
                    "issuer": "\u5ba3\u57ce\u5e02\u56fd\u6709\u8d44\u4ea7\u6295\u8d44\u6709\u9650\u516c\u53f8",
                    "bondType": "\u8d85\u77ed\u671f\u878d\u8d44\u5238",
                    "couponType": "\u96f6\u606f\u5f0f",
                    "couponRate": 1.78,
                    "creditRatingStatus": "unavailable",
                }
            return None

        with patch.object(fund_service, "_latest_total_scale", return_value=(1.9437, "20250630", "tushare:fund_share")), \
            patch.object(fund_service, "_fetch_chinamoney_bond_info", side_effect=fake_chinamoney):
            enriched, _notes = fund_service._enrich_bond_holdings("000001", rows)

        self.assertEqual(enriched[0]["issuer"], "\u4e0a\u6d77\u6d66\u4e1c\u53d1\u5c55\u94f6\u884c\u80a1\u4efd\u6709\u9650\u516c\u53f8")
        self.assertEqual(enriched[0]["couponType"], "\u8d34\u73b0\u5f0f")
        self.assertEqual(enriched[0]["couponRateStatus"], "not_applicable")
        self.assertEqual(enriched[0]["creditRatingStatus"], "unavailable")
        self.assertEqual(enriched[1]["couponRate"], 1.78)
        self.assertEqual(enriched[1]["bondInfoSource"], "chinamoney:bond_detail")

        quality = fund_service._bond_holdings_quality(enriched)
        self.assertEqual(quality["status"], "partial")
        self.assertEqual(quality["coverage"], 0.875)
        self.assertIn("\u4fe1\u7528\u8bc4\u7ea7\u672a\u62ab\u9732", quality["missingReason"])

    def test_cached_analysis_persists_cached_holdings_snapshot(self):
        cached = {
            "code": "000001",
            "holdings": [{"name": "浦发银行", "code": "600000.SH", "ratio": 8.5, "quarter": "20260331"}],
            "asset_allocation": [{"name": "股票", "ratio": 75.94, "report_date": "20260331"}],
            "source": "unit-test",
            "nav_data": [],
        }
        with patch.object(analysis_api.cache, "get", return_value=cached), \
            patch.object(analysis_api.cache, "set"), \
            patch.object(analysis_api, "_persist_holdings_snapshot") as persist:
            result = analysis_api.cached_analyze_fund("000001")

        self.assertEqual(result["holdings"], cached["holdings"])
        persist.assert_called_once_with(
            "000001",
            cached["holdings"],
            cached["asset_allocation"],
            "unit-test",
        )


    def test_fetch_eastmoney_manager_report_parses_periodic_notice(self):
        class FakeNotices:
            empty = False

            def to_dict(self, orient):
                if orient != "records":
                    return []
                return [
                    {
                        "\u516c\u544a\u6807\u9898": "\u67d0\u57fa\u91d1\u51c0\u503c\u516c\u544a",
                        "\u516c\u544a\u65e5\u671f": "2026-04-23",
                        "\u62a5\u544aID": "SKIP",
                    },
                    {
                        "\u516c\u544a\u6807\u9898": "\u67d0\u57fa\u91d12026\u5e74\u7b2c1\u5b63\u5ea6\u62a5\u544a",
                        "\u516c\u544a\u65e5\u671f": "2026-04-22",
                        "\u62a5\u544aID": "AN202604220001",
                    },
                ]

        def fake_get(url, params=None, headers=None, timeout=None):
            self.assertEqual(params["art_code"], "AN202604220001")
            self.assertEqual(timeout, 20)
            return SimpleNamespace(
                json=lambda: {
                    "data": {
                        "notice_content": "\u67d0\u57fa\u91d1 2026 \u5e74 3 \u6708 31 \u65e5\n\u771f\u5b9e\u8fd0\u4f5c\u5206\u6790\u5185\u5bb9"
                    }
                }
            )

        fake_akshare = SimpleNamespace(fund_announcement_report_em=lambda symbol: FakeNotices())
        fake_requests = SimpleNamespace(get=fake_get)

        with patch.dict("sys.modules", {"akshare": fake_akshare, "requests": fake_requests}):
            report = fund_service._fetch_eastmoney_manager_report("000001")

        self.assertIsNotNone(report)
        self.assertEqual(report["report_date"], "2026-03-31")
        self.assertEqual(report["source"], "eastmoney:fund_announcement_report")
        self.assertIn("\u771f\u5b9e\u8fd0\u4f5c\u5206\u6790", report["report_text"])

    def test_manager_report_fetches_and_persists_when_snapshot_missing(self):
        fetched = {
            "report_date": "2026-03-31",
            "report_type": "\u5b63\u5ea6\u62a5\u544a",
            "report_text": "\u771f\u5b9e\u5b63\u62a5\u539f\u6587",
            "source": "eastmoney:fund_announcement_report",
            "updated_at": "2026-04-22T00:00:00",
        }
        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "_fetch_eastmoney_manager_report", return_value=fetched), \
            patch.object(fund_service, "_persist_fund_manager_report") as persist:
            payload = fund_service.get_fund_manager_report("000001")

        self.assertEqual(payload["dataStatus"], "available")
        self.assertEqual(payload["period"], "2026-03-31")
        self.assertEqual(payload["report"], "\u771f\u5b9e\u5b63\u62a5\u539f\u6587")
        self.assertEqual(payload["source"], "eastmoney:fund_announcement_report")
        persist.assert_called_once_with("000001", fetched)

    def test_persist_fund_manager_report_writes_snapshot(self):
        report = {
            "report_date": "2026-03-31",
            "report_type": "\u5b63\u5ea6\u62a5\u544a",
            "report_text": "\u771f\u5b9e\u5b63\u62a5\u539f\u6587",
            "source": "eastmoney:fund_announcement_report",
            "updated_at": "2026-04-22T00:00:00",
        }
        fake_conn = MagicMock()
        with patch.object(fund_service, "get_db_context") as db_ctx:
            db_ctx.return_value.__enter__.return_value = fake_conn
            fund_service._persist_fund_manager_report("000001", report)

        fake_conn.execute.assert_called_once()
        sql, params = fake_conn.execute.call_args.args
        self.assertIn("fund_report_snapshot", sql)
        self.assertIn("ON CONFLICT", sql)
        self.assertEqual(
            params,
            (
                "000001",
                "2026-03-31",
                "\u5b63\u5ea6\u62a5\u544a",
                "\u771f\u5b9e\u5b63\u62a5\u539f\u6587",
                "eastmoney:fund_announcement_report",
                "2026-04-22T00:00:00",
            ),
        )

    def test_manager_history_parser_extracts_report_table_rows(self):
        text = (
            "4.1 \u57fa\u91d1\u7ecf\u7406\uff08\u6216\u57fa\u91d1\u7ecf\u7406\u5c0f\u7ec4\uff09\u7b80\u4ecb\n"
            " \u59d3\u540d    \u804c\u52a1          \u4efb\u672c\u57fa\u91d1\u7684\u57fa\u91d1\u7ecf\u7406\u671f\u9650\n"
            "        \u672c\u57fa\u91d1                              \u5176\u4ed6\u57fa\u91d1\u7ecf\n"
            "\u5d14\u857e    \u57fa\u91d1\u7ecf  2019 \u5e74 7          -  11 \u5e74  \u7406\uff1b2019 \u5e74 6 \u6708 28\n"
            "        \u7406      \u6708 12 \u65e5\n"
            "        \u65e5\u81f3 2022 \u5e74 2 \u6708 18 \u65e5\uff0c\u4efb\u5176\u4ed6\u57fa\u91d1\u7ecf\u7406\n"
            "      \u6295\u8d44\u90e8\u603b 2012 \u5e74 5 \u6708 4\n"
            " \u67f3\u519b \u76d1\u3001\u672c\u57fa    \u65e5        -      24 \u5e74\n"
            " \u6210  50ETF\u3001\u6613\u65b9\u8fbe\u4e2d\u8bc1\u6e2f\u80a1  2016-    -    18 \u5e74\n"
            " \u66e6  \u901a\u4e2d\u56fd 100ETF\u3001\u6613\u65b9\u8fbe  05-07\n"
            "4.2 \u7ba1\u7406\u4eba\u5bf9\u62a5\u544a\u671f\u5185\u672c\u57fa\u91d1\u8fd0\u4f5c\u7684\u8bf4\u660e\n"
        )

        rows = fund_service._parse_manager_history_from_report_text(text, "2026-03-31")

        self.assertEqual(
            [(row["managerName"], row["startDate"], row["endDate"]) for row in rows],
            [
                ("\u5d14\u857e", "2019-07-12", None),
                ("\u67f3\u519b", "2012-05-04", None),
                ("\u6210\u66e6", "2016-05-07", None),
            ],
        )

    def test_manager_history_falls_back_to_report_text_and_persists(self):
        report_payload = {
            "code": "512100",
            "report": (
                "4.1 \u57fa\u91d1\u7ecf\u7406\uff08\u6216\u57fa\u91d1\u7ecf\u7406\u5c0f\u7ec4\uff09\u7b80\u4ecb\n"
                "\u5d14\u857e    \u57fa\u91d1\u7ecf  2019 \u5e74 7          -  11 \u5e74  \u7406\uff1b2019 \u5e74 6 \u6708 28\n"
                "        \u7406      \u6708 12 \u65e5\n"
                "4.2 \u7ba1\u7406\u4eba\u5bf9\u62a5\u544a\u671f\u5185\u672c\u57fa\u91d1\u8fd0\u4f5c\u7684\u8bf4\u660e\n"
            ),
            "period": "2026-03-31",
            "dataStatus": "available",
            "source": "eastmoney:fund_announcement_report",
            "asOf": "2026-03-31",
            "coverage": 1.0,
            "missingReason": None,
        }

        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch("app.data.providers.tushare_provider.TushareProvider.get_fund_manager", return_value={}), \
            patch.object(fund_service, "get_fund_manager_report", return_value=report_payload), \
            patch.object(fund_service, "_persist_manager_history_snapshot") as persist:
            payload = fund_service.get_fund_manager_history("512100")

        self.assertEqual(payload["dataStatus"], "partial")
        self.assertEqual(payload["source"], "eastmoney:fund_announcement_report")
        self.assertEqual(payload["rows"][0]["managerName"], "\u5d14\u857e")
        self.assertEqual(payload["rows"][0]["startDate"], "2019-07-12")
        self.assertIsNone(payload["rows"][0]["totalReturn"])
        persist.assert_called_once()

    def test_manager_history_prefers_report_text_over_current_tushare_manager(self):
        report_payload = {
            "code": "512100",
            "report": (
                "4.1 \u57fa\u91d1\u7ecf\u7406\uff08\u6216\u57fa\u91d1\u7ecf\u7406\u5c0f\u7ec4\uff09\u7b80\u4ecb\n"
                "\u5d14\u857e    \u57fa\u91d1\u7ecf  2019 \u5e74 7          -  11 \u5e74  \u7406\uff1b2019 \u5e74 6 \u6708 28\n"
                "        \u7406      \u6708 12 \u65e5\n"
                "4.2 \u7ba1\u7406\u4eba\u5bf9\u62a5\u544a\u671f\u5185\u672c\u57fa\u91d1\u8fd0\u4f5c\u7684\u8bf4\u660e\n"
            ),
            "period": "2026-03-31",
            "source": "eastmoney:fund_announcement_report",
        }

        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch("app.data.providers.tushare_provider.TushareProvider.get_fund_manager", return_value={
                "name": "\u5f53\u524d\u7ecf\u7406",
                "begin_date": "2024-01-01",
                "reward": 1.2,
            }) as tushare_manager, \
            patch.object(fund_service, "get_fund_manager_report", return_value=report_payload), \
            patch.object(fund_service, "_persist_manager_history_snapshot"):
            payload = fund_service.get_fund_manager_history("512100")

        tushare_manager.assert_not_called()
        self.assertEqual(payload["source"], "eastmoney:fund_announcement_report")
        self.assertEqual(payload["rows"][0]["managerName"], "\u5d14\u857e")

    def test_manager_history_parser_extracts_eastmoney_manager_page_rows(self):
        page_html = (
            "<h4>\u57fa\u91d1\u7ecf\u7406\u53d8\u52a8\u4e00\u89c8</h4>"
            "<table><tbody>"
            "<tr><td>2024-07-10</td><td>\u81f3\u4eca</td>"
            "<td><a>\u9648\u9ece</a></td><td>1\u5e74</td><td class='red'>3.30%</td></tr>"
            "<tr><td>2024-05-07</td><td>2024-07-09</td>"
            "<td><a>\u9ec4\u6d77\u5cf0</a> <a>\u9648\u9ece</a></td><td>63\u5929</td><td>0.38%</td></tr>"
            "</tbody></table>"
        )

        rows = fund_service._parse_eastmoney_manager_history_html(page_html)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["managerName"], "\u9648\u9ece")
        self.assertIsNone(rows[0]["endDate"])
        self.assertEqual(rows[0]["totalReturn"], 3.3)
        self.assertEqual(rows[1]["managerName"], "\u9ec4\u6d77\u5cf0\u3001\u9648\u9ece")
        self.assertEqual(rows[1]["endDate"], "2024-07-09")

    def test_manager_history_uses_eastmoney_manager_page_before_tushare(self):
        page_rows = [{
            "managerName": "\u9648\u9ece",
            "startDate": "2024-07-10",
            "endDate": None,
            "totalReturn": 3.3,
            "annualizedReturn": None,
            "rank": None,
        }]

        with patch.object(fund_service, "_safe_table_query", return_value=[]), \
            patch.object(fund_service, "get_fund_manager_report", return_value={"report": ""}), \
            patch.object(fund_service, "_fetch_eastmoney_manager_history_page", return_value=page_rows), \
            patch("app.data.providers.tushare_provider.TushareProvider.get_fund_manager") as tushare_manager, \
            patch.object(fund_service, "_persist_manager_history_snapshot") as persist:
            payload = fund_service.get_fund_manager_history("019067")

        tushare_manager.assert_not_called()
        persist.assert_called_once()
        self.assertEqual(payload["source"], "eastmoney:fund_manager_page")
        self.assertEqual(payload["rows"][0]["totalReturn"], 3.3)

    def test_manager_history_reparses_repeated_report_snapshot_rows(self):
        snapshot_rows = [
            {
                "manager_name": "\u5d14\u857e",
                "start_date": "2021-04-23",
                "end_date": "",
                "total_return": None,
                "annualized_return": None,
                "rank_json": "{}",
                "source": "eastmoney:fund_announcement_report",
                "updated_at": "2026-06-09T00:00:00",
            },
            {
                "manager_name": "\u5d14\u857e",
                "start_date": "2019-06-28",
                "end_date": "",
                "total_return": None,
                "annualized_return": None,
                "rank_json": "{}",
                "source": "eastmoney:fund_announcement_report",
                "updated_at": "2026-06-09T00:00:00",
            },
        ]
        report_payload = {
            "code": "512100",
            "report": (
                "4.1 \u57fa\u91d1\u7ecf\u7406\uff08\u6216\u57fa\u91d1\u7ecf\u7406\u5c0f\u7ec4\uff09\u7b80\u4ecb\n"
                "\u5d14\u857e    \u57fa\u91d1\u7ecf  2019 \u5e74 7          -  11 \u5e74  \u7406\uff1b2019 \u5e74 6 \u6708 28\n"
                "        \u7406      \u6708 12 \u65e5\n"
                "        \u7814\u7a76\u5458\uff1b2019 \u5e74 6 \u6708 28 \u65e5\u81f3 2022 \u5e74 2 \u6708 18 \u65e5\uff0c\u4efb\u5176\u4ed6\u57fa\u91d1\u7ecf\u7406\n"
                "4.2 \u7ba1\u7406\u4eba\u5bf9\u62a5\u544a\u671f\u5185\u672c\u57fa\u91d1\u8fd0\u4f5c\u7684\u8bf4\u660e\n"
            ),
            "period": "2026-03-31",
            "dataStatus": "available",
            "source": "eastmoney:fund_announcement_report",
            "asOf": "2026-03-31",
            "coverage": 1.0,
            "missingReason": None,
        }

        with patch.object(fund_service, "_safe_table_query", return_value=snapshot_rows), \
            patch("app.data.providers.tushare_provider.TushareProvider.get_fund_manager", return_value={}), \
            patch.object(fund_service, "get_fund_manager_report", return_value=report_payload), \
            patch.object(fund_service, "_persist_manager_history_snapshot") as persist:
            payload = fund_service.get_fund_manager_history("512100")

        self.assertEqual(len(payload["rows"]), 1)
        self.assertEqual(payload["rows"][0]["managerName"], "\u5d14\u857e")
        self.assertEqual(payload["rows"][0]["startDate"], "2019-07-12")
        persist.assert_called_once()

    def test_manager_history_refreshes_single_report_snapshot_row(self):
        snapshot_rows = [{
            "manager_name": "\u5d14\u857e",
            "start_date": "2019-06-28",
            "end_date": "",
            "total_return": None,
            "annualized_return": None,
            "rank_json": "{}",
            "source": "eastmoney:fund_announcement_report",
            "updated_at": "2026-06-09T00:00:00",
        }]
        report_payload = {
            "code": "512100",
            "report": (
                "4.1 \u57fa\u91d1\u7ecf\u7406\uff08\u6216\u57fa\u91d1\u7ecf\u7406\u5c0f\u7ec4\uff09\u7b80\u4ecb\n"
                "        \u672c\u57fa\u91d1                              \u5176\u4ed6\u57fa\u91d1\u7ecf\n"
                "\u5d14\u857e    \u57fa\u91d1\u7ecf  2019 \u5e74 7          -  11 \u5e74  \u7406\uff1b2019 \u5e74 6 \u6708 28\n"
                "        \u7406      \u6708 12 \u65e5\n"
                "4.2 \u7ba1\u7406\u4eba\u5bf9\u62a5\u544a\u671f\u5185\u672c\u57fa\u91d1\u8fd0\u4f5c\u7684\u8bf4\u660e\n"
            ),
            "period": "2026-03-31",
            "dataStatus": "available",
            "source": "eastmoney:fund_announcement_report",
            "asOf": "2026-03-31",
            "coverage": 1.0,
            "missingReason": None,
        }

        with patch.object(fund_service, "_safe_table_query", return_value=snapshot_rows), \
            patch("app.data.providers.tushare_provider.TushareProvider.get_fund_manager", return_value={}), \
            patch.object(fund_service, "get_fund_manager_report", return_value=report_payload), \
            patch.object(fund_service, "_persist_manager_history_snapshot") as persist:
            payload = fund_service.get_fund_manager_history("512100")

        self.assertEqual(payload["rows"][0]["startDate"], "2019-07-12")
        persist.assert_called_once()


class FundDetailCompletenessTest(unittest.TestCase):
    """P2.1: detailCompleteness 必须真实反映 section 覆盖度。"""

    REQUIRED_KEYS = {"dataStatus", "missingReason", "source", "asOf", "coverage"}
    EXPECTED_SECTION_KEYS = [
        "overview", "performance", "navDrawdown", "holdings", "bondAllocation",
        "bondHoldings", "managerHistory", "scaleHistory", "turnoverHistory",
        "peerPerformance", "purchaseInfo", "rating", "assetAllocation",
        "holderStructure", "yearReturns", "riskSummary", "managerReport",
    ]

    _sentinel = object()

    def _invoke(self, snapshot=_sentinel, quarterly=_sentinel, metrics_row=_sentinel, quote_row=_sentinel, detail_payloads=None):
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
            "nav_date": "2099-01-01T00:00:00",
            "updated_at": "2099-01-01T00:00:00",
        } if snapshot is self._sentinel else snapshot
        fake_quarterly = {
            "holder_count": 0,
            "scale_count": 4,
            "turnover_count": 0,
            "bond_alloc_count": 0,
            "bond_hold_count": 0,
            "quarterly_updated": "2099-01-01T00:00:00",
        } if quarterly is self._sentinel else quarterly
        resolved_metrics = {"score": 75.0, "fee_manage": 0.015, "fee_custody": 0.005, "metrics_updated_at": "2099-01-01T00:00:00"} if metrics_row is self._sentinel else metrics_row
        resolved_quote = {"near_1y": 0.05, "near_3y": 0.15, "updated_at": "2099-01-01T00:00:00"} if quote_row is self._sentinel else quote_row

        def fake_execute(sql, params=None):
            m = MagicMock()
            sql_lower = (sql or "").lower()
            if "sum(case" in sql_lower:
                m.fetchone.return_value = fake_quarterly
            elif "fund_manager_history_snapshot" in sql_lower:
                m.fetchone.return_value = {"c": 0}
            elif "fund_report_snapshot" in sql_lower:
                m.fetchone.return_value = {"c": 0}
            elif "fund_metrics_snapshot" in sql_lower:
                # 统一返回 metrics 行，不再按 score/fee 拆分
                m.fetchone.return_value = resolved_metrics
            elif "fund_quote_snapshot" in sql_lower:
                m.fetchone.return_value = resolved_quote
            else:
                m.fetchone.return_value = None
            return m

        missing_payload = {"code": "000001", "dataStatus": "missing", "source": None, "asOf": None, "coverage": 0.0, "missingReason": "missing"}
        payloads = {
            "scale": missing_payload,
            "manager": missing_payload,
            "purchase": missing_payload,
            "rating": missing_payload,
            "report": missing_payload,
            "holder": missing_payload,
            "bond_alloc": missing_payload,
            "bond_holdings": missing_payload,
            "turnover": missing_payload,
            **(detail_payloads or {}),
        }

        with patch.object(
            db_module.FundDataStore, "get_snapshot", return_value=fake_snapshot
        ), patch.object(db_module, "get_db_context") as db_ctx:
            cm = db_ctx.return_value
            cm.__enter__.return_value = cm
            cm.execute = fake_execute
            with patch.object(fund_api, "fund_scale_history", new=AsyncMock(return_value=payloads["scale"])), \
                patch.object(fund_api, "fund_holder_structure", new=AsyncMock(return_value=payloads["holder"])), \
                patch.object(fund_api, "fund_bond_allocation", new=AsyncMock(return_value=payloads["bond_alloc"])), \
                patch.object(fund_api, "fund_bond_holdings", new=AsyncMock(return_value=payloads["bond_holdings"])), \
                patch.object(fund_api, "fund_turnover_history", new=AsyncMock(return_value=payloads["turnover"])), \
                patch.object(fund_api, "fund_manager_history", new=AsyncMock(return_value=payloads["manager"])), \
                patch.object(fund_api, "fund_purchase_info", new=AsyncMock(return_value=payloads["purchase"])), \
                patch.object(fund_api, "fund_rating", new=AsyncMock(return_value=payloads["rating"])), \
                patch.object(fund_api, "fund_manager_report", new=AsyncMock(return_value=payloads["report"])):
                return asyncio.run(fund_api.fund_detail_completeness(code="000001"))

    # ---- 1. section 数量与命名 ------------------------------------------------
    def test_total_sections_at_least_17(self):
        """17 个 section key 全部存在。"""
        result = self._invoke()
        self.assertIsInstance(result, dict)
        self.assertEqual(result["total"], 17, "section 总数应为 17")
        for key in self.EXPECTED_SECTION_KEYS:
            self.assertIn(key, result.get("sections", {}), f"missing section: {key}")

    def test_scaleHistory_and_turnoverHistory_exist(self):
        """scaleHistory / turnoverHistory key 必须存在（旧版用 scale / turnover）。"""
        result = self._invoke()
        self.assertIn("scaleHistory", result["sections"])
        self.assertIn("turnoverHistory", result["sections"])

    # ---- 2. 完整合同字段 ------------------------------------------------------
    def test_exchange_snapshot_backfill_feeds_completeness_when_snapshot_missing(self):
        """Missing exchange-fund snapshots should be rechecked after NAV backfill."""
        fake_snapshot = {
            "nav_data": [{"date": "2099-01-02", "nav": 1.0}] * 300,
            "nav_date": "2099-01-02",
            "updated_at": "2099-01-02T00:00:00",
        }

        def fake_execute(sql, params=None):
            m = MagicMock()
            sql_lower = (sql or "").lower()
            if "sum(case" in sql_lower:
                m.fetchone.return_value = {
                    "holder_count": 0,
                    "scale_count": 0,
                    "turnover_count": 0,
                    "bond_alloc_count": 0,
                    "bond_hold_count": 0,
                    "quarterly_updated": None,
                }
            elif "fund_manager_history_snapshot" in sql_lower or "fund_report_snapshot" in sql_lower:
                m.fetchone.return_value = {"c": 0}
            else:
                m.fetchone.return_value = None
            return m

        missing_payload = {
            "code": "510300",
            "dataStatus": "missing",
            "source": None,
            "asOf": None,
            "coverage": 0.0,
            "missingReason": "missing",
        }

        with patch.object(db_module.FundDataStore, "get_snapshot", return_value=None), \
            patch.object(fund_api, "ensure_exchange_fund_snapshot", return_value=fake_snapshot) as ensure, \
            patch.object(fund_api, "ensure_exchange_fund_holdings_snapshot", return_value=None), \
            patch.object(fund_api, "ensure_report_asset_allocation_snapshot", return_value=None), \
            patch.object(db_module, "get_db_context") as db_ctx:
            cm = db_ctx.return_value
            cm.__enter__.return_value = cm
            cm.execute = fake_execute
            with patch.object(fund_api, "fund_scale_history", new=AsyncMock(return_value=missing_payload)), \
                patch.object(fund_api, "fund_holder_structure", new=AsyncMock(return_value=missing_payload)), \
                patch.object(fund_api, "fund_bond_allocation", new=AsyncMock(return_value=missing_payload)), \
                patch.object(fund_api, "fund_bond_holdings", new=AsyncMock(return_value=missing_payload)), \
                patch.object(fund_api, "fund_turnover_history", new=AsyncMock(return_value=missing_payload)), \
                patch.object(fund_api, "fund_manager_history", new=AsyncMock(return_value=missing_payload)), \
                patch.object(fund_api, "fund_purchase_info", new=AsyncMock(return_value=missing_payload)), \
                patch.object(fund_api, "fund_rating", new=AsyncMock(return_value=missing_payload)), \
                patch.object(fund_api, "fund_manager_report", new=AsyncMock(return_value=missing_payload)):
                result = asyncio.run(fund_api.fund_detail_completeness(code="510300"))

        ensure.assert_called_once_with("510300")
        self.assertEqual(result["sections"]["overview"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["navDrawdown"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["peerPerformance"]["source"], "fund_nav_history")
        self.assertGreater(result["coverage"], 0.25)

    def test_snapshot_detail_backfills_exchange_holdings_when_missing(self):
        base_snapshot = {
            "code": "159915",
            "data_quality": "computed",
            "nav": 1.0,
            "nav_data": [{"date": "2099-01-02", "nav": 1.0}] * 300,
            "nav_date": "2099-01-02",
        }
        enriched_snapshot = {
            **base_snapshot,
            "holdings": [{"code": "300750.SZ", "ratio": 19.73}],
            "asset_allocation": [{"name": "股票", "ratio": 57.19}],
        }
        with patch.object(db_module.FundDataStore, "get_snapshot", return_value=base_snapshot), \
            patch.object(fund_api, "ensure_exchange_fund_snapshot") as ensure_nav, \
            patch.object(
                fund_api,
                "ensure_exchange_fund_holdings_snapshot",
                return_value=enriched_snapshot,
            ) as ensure_holdings:
            result = asyncio.run(fund_api.fund_snapshot_detail(code="159915", enqueue_missing=False))

        ensure_nav.assert_not_called()
        ensure_holdings.assert_called_once_with("159915")
        self.assertEqual(result["holdings"][0]["code"], "300750.SZ")
        self.assertEqual(result["asset_allocation"][0]["name"], "股票")
        self.assertIsNone(result["job_id"])

    def test_snapshot_detail_backfills_report_asset_allocation_when_holdings_snapshot_lacks_it(self):
        base_snapshot = {
            "code": "000016",
            "data_quality": "computed",
            "nav": 1.0,
            "nav_data": [{"date": "2099-01-02", "nav": 1.0}] * 300,
            "nav_date": "2099-01-02",
            "holdings": [{"name": "\u503a\u5238A", "ratio": 12.3}],
        }
        enriched_snapshot = {
            **base_snapshot,
            "asset_allocation": [{"name": "\u56fa\u5b9a\u6536\u76ca\u6295\u8d44", "ratio": 99.05}],
        }
        with patch.object(db_module.FundDataStore, "get_snapshot", return_value=base_snapshot), \
            patch.object(fund_api, "ensure_exchange_fund_snapshot") as ensure_nav, \
            patch.object(
                fund_api,
                "ensure_exchange_fund_holdings_snapshot",
                return_value=base_snapshot,
            ) as ensure_holdings, \
            patch.object(
                fund_api,
                "ensure_report_asset_allocation_snapshot",
                return_value=enriched_snapshot,
            ) as ensure_asset:
            result = asyncio.run(fund_api.fund_snapshot_detail(code="000016", enqueue_missing=False))

        ensure_nav.assert_not_called()
        ensure_holdings.assert_called_once_with("000016")
        ensure_asset.assert_called_once_with("000016")
        self.assertEqual(result["asset_allocation"][0]["ratio"], 99.05)
        self.assertIsNone(result["job_id"])

    def test_each_section_has_full_contract(self):
        """每个 section 必须含 dataStatus / source / asOf / coverage / missingReason。"""
        result = self._invoke()
        for key, section in result["sections"].items():
            missing = self.REQUIRED_KEYS - set(section.keys())
            self.assertEqual(missing, set(), f"section '{key}' missing keys: {missing}")

    # ---- 3. 有数据时各 section 状态正确 ----------------------------------------
    def test_sections_with_data_are_available_or_partial(self):
        """有数据时各 section 不应为 missing（但有 partial 情况）。"""
        result = self._invoke()
        # 测试 snapshot 有 300 点 nav + holdings + asset_alloc
        self.assertEqual(result["sections"]["overview"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["performance"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["navDrawdown"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["holdings"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["assetAllocation"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["yearReturns"]["dataStatus"], "available")
        # rating / purchaseInfo 有 metrics 行但底层数据是 partial 兜底
        self.assertEqual(result["sections"]["rating"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["purchaseInfo"]["dataStatus"], "partial")
        # peerPerformance 有 quote 行
        self.assertEqual(result["sections"]["peerPerformance"]["dataStatus"], "available")
        # riskSummary 有 max_drawdown
        self.assertEqual(result["sections"]["riskSummary"]["dataStatus"], "available")
        # scaleHistory 有 4 季度
        self.assertEqual(result["sections"]["scaleHistory"]["dataStatus"], "available")

    def test_detail_endpoint_payloads_override_snapshot_missing_sections(self):
        """detailCompleteness should mirror actual detail endpoint statuses when they have data."""
        result = self._invoke(
            quarterly={"holder_count": 0, "scale_count": 0, "turnover_count": 0,
                       "bond_alloc_count": 0, "bond_hold_count": 0,
                       "quarterly_updated": None},
            metrics_row=None,
            detail_payloads={
                "scale": {
                    "code": "000001",
                    "rows": [{"quarter": "20250630", "totalScale": 12.3}],
                    "dataStatus": "available",
                    "source": "tushare:fund_share",
                    "asOf": "20250630",
                    "coverage": 1.0,
                    "missingReason": None,
                },
                "manager": {
                    "code": "000001",
                    "rows": [{"managerName": "Alice"}],
                    "dataStatus": "partial",
                    "source": "Tushare fund_manager",
                    "asOf": None,
                    "coverage": 0.35,
                    "missingReason": "partial manager history",
                },
                "purchase": {
                    "code": "000001",
                    "dataStatus": "partial",
                    "source": "fund_metrics_snapshot+industry-defaults",
                    "asOf": None,
                    "coverage": 0.5,
                    "missingReason": "industry defaults",
                },
                "rating": {
                    "code": "000001",
                    "dataStatus": "partial",
                    "source": "computed",
                    "asOf": None,
                    "coverage": 0.5,
                    "missingReason": None,
                },
                "report": {
                    "code": "000001",
                    "report": "real report",
                    "period": "2026-03-31",
                    "dataStatus": "available",
                    "source": "eastmoney:fund_announcement_report",
                    "asOf": "2026-03-31",
                    "coverage": 1.0,
                    "missingReason": None,
                },
                "bond_holdings": {
                    "code": "000001",
                    "rows": [{"bondName": "\u6d4b\u8bd5\u503a\u5238", "navRatio": 12.34}],
                    "dataStatus": "partial",
                    "source": "AkShare",
                    "asOf": "2026",
                    "coverage": 0.45,
                    "missingReason": "partial bond fields",
                },
            },
        )

        self.assertEqual(result["sections"]["scaleHistory"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["scaleHistory"]["source"], "tushare:fund_share")
        self.assertEqual(result["sections"]["managerHistory"]["dataStatus"], "partial")
        self.assertEqual(result["sections"]["purchaseInfo"]["dataStatus"], "partial")
        self.assertEqual(result["sections"]["rating"]["dataStatus"], "partial")
        self.assertEqual(result["sections"]["managerReport"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["managerReport"]["source"], "eastmoney:fund_announcement_report")
        self.assertEqual(result["sections"]["bondHoldings"]["dataStatus"], "partial")
        self.assertEqual(result["sections"]["bondHoldings"]["source"], "AkShare")
        self.assertGreater(result["coverage"], 0.0)

    # ---- 4. 无数据时仍为 missing，不 fake available -----------------------------
    def test_no_data_reports_missing_not_available(self):
        """当 snapshot 为 None、DB 全空时，section 应真实反映 missing。"""
        result = self._invoke(
            snapshot={},
            quarterly={"holder_count": 0, "scale_count": 0, "turnover_count": 0,
                       "bond_alloc_count": 0, "bond_hold_count": 0, "quarterly_updated": None},
            metrics_row=None,
            quote_row=None,
        )
        self.assertIsInstance(result, dict)
        # overview/performance/navDrawdown 无 nav_data → missing
        self.assertEqual(result["sections"]["overview"]["dataStatus"], "missing")
        self.assertEqual(result["sections"]["performance"]["dataStatus"], "missing")
        self.assertEqual(result["sections"]["navDrawdown"]["dataStatus"], "missing")
        # rating/purchaseInfo/peerPerformance 无 metrics/quote → missing
        self.assertEqual(result["sections"]["rating"]["dataStatus"], "missing")
        self.assertEqual(result["sections"]["purchaseInfo"]["dataStatus"], "missing")
        self.assertEqual(result["sections"]["peerPerformance"]["dataStatus"], "missing")
        # 无数据时，没有 section 应为 available 或 stale
        for key in self.EXPECTED_SECTION_KEYS:
            status = result["sections"][key]["dataStatus"]
            self.assertNotIn(
                status, ("available", "stale"),
                f"{key} should NOT be available/stale when no data",
            )

    def test_purchase_info_endpoint_overrides_metrics_when_snapshot_missing(self):
        payload = {
            "code": "000001",
            "dataStatus": "available",
            "source": "eastmoney:fundf10_fee_page",
            "asOf": "2026-06-20T03:21:39",
            "coverage": 1.0,
            "missingReason": None,
            "purchaseStatus": "场内交易",
            "managementFeeRate": "0.15%",
            "custodyFeeRate": "0.05%",
        }
        result = self._invoke(
            snapshot={},
            metrics_row={
                "score": None,
                "fee_manage": 0.0015,
                "fee_custody": 0.0005,
                "metrics_updated_at": "2020-01-01T00:00:00",
            },
            detail_payloads={"purchase": payload},
        )
        self.assertEqual(result["sections"]["purchaseInfo"]["dataStatus"], "available")
        self.assertEqual(result["sections"]["purchaseInfo"]["source"], "eastmoney:fundf10_fee_page")
        self.assertEqual(result["sections"]["purchaseInfo"]["coverage"], 1.0)

    # ---- 5. stale 计数与 coverage 权重 ----------------------------------------
    def test_stale_nav_marks_relevant_sections_stale(self):
        """nav_date 陈旧时，overview/performance/navDrawdown/yearReturns 标记 stale。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2022-01-01", "nav": 1.0}] * 300,
                "holdings": [{"stock_code": "000001"}],
                "asset_allocation": [{"type": "股票", "ratio": 60.0}],
                "nav_date": "2022-01-01",  # 远超 48h
                "updated_at": "2099-01-01T00:00:00",  # holdings / assetAllocation 仍新鲜
            },
            quarterly={"holder_count": 0, "scale_count": 4, "turnover_count": 0,
                       "bond_alloc_count": 0, "bond_hold_count": 0,
                       "quarterly_updated": "2099-01-01T00:00:00"},
        )
        # NAV 过期只影响 overview/performance/navDrawdown/yearReturns
        self.assertEqual(result["sections"]["overview"]["dataStatus"], "stale")
        self.assertEqual(result["sections"]["performance"]["dataStatus"], "stale")
        self.assertEqual(result["sections"]["navDrawdown"]["dataStatus"], "stale")
        self.assertEqual(result["sections"]["yearReturns"]["dataStatus"], "stale")
        # holdings 不应被 nav_stale 影响
        self.assertEqual(result["sections"]["holdings"]["dataStatus"], "available")
        # scaleHistory 不应被 nav_stale 影响
        self.assertEqual(result["sections"]["scaleHistory"]["dataStatus"], "available")
        # 顶层 stale 计数
        self.assertGreater(result["stale"], 0)
        # coverage 含 stale 权重
        self.assertGreater(result["coverage"], 0.0)
        self.assertLess(result["coverage"], 1.0)

    # ---- 6. coverage 计算包含 stale 权重 ----------------------------------
    def test_coverage_formula_includes_stale_weight(self):
        """coverage = (available + partial*0.5 + stale*0.25) / total。"""
        # 简化：全 missing
        all_missing = self._invoke(
            snapshot={},
            quarterly={"holder_count": 0, "scale_count": 0, "turnover_count": 0,
                       "bond_alloc_count": 0, "bond_hold_count": 0, "quarterly_updated": None},
            metrics_row=None,
            quote_row=None,
        )
        self.assertEqual(all_missing["coverage"], 0.0)
        self.assertEqual(all_missing["stale"], 0)

        # 有 stale 的场景：nav 陈旧，验证公式确实包含 stale*0.25
        stale_result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2022-01-01", "nav": 1.0}] * 300,
                "holdings": [{"stock_code": "000001"}],
                "asset_allocation": [{"type": "股票", "ratio": 60.0}],
                "nav_date": "2022-01-01",
                "updated_at": "2099-01-01T00:00:00",
            },
            quarterly={"holder_count": 0, "scale_count": 4, "turnover_count": 0,
                       "bond_alloc_count": 0, "bond_hold_count": 0,
                       "quarterly_updated": "2099-01-01T00:00:00"},
        )
        self.assertGreater(stale_result["stale"], 0)
        total = stale_result["total"]
        av = stale_result["available"]
        pa = stale_result["partial"]
        st = stale_result["stale"]
        expected = round((av + pa * 0.5 + st * 0.25) / total, 4)
        self.assertEqual(stale_result["coverage"], expected)

    def test_stale_counted_in_top_level_stale_field(self):
        """顶层 stale 字段必须统计 stale section 数量。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2022-01-01", "nav": 1.0}] * 300,
                "holdings": [{"stock_code": "000001"}],
                "asset_allocation": [{"type": "股票", "ratio": 60.0}],
                "nav_date": "2022-01-01",
                "updated_at": "2099-01-01T00:00:00",
            },
            quarterly={"holder_count": 0, "scale_count": 4, "turnover_count": 0,
                       "bond_alloc_count": 0, "bond_hold_count": 0,
                       "quarterly_updated": "2099-01-01T00:00:00"},
        )
        stale_sections = sum(
            1 for s in result["sections"].values() if s["dataStatus"] == "stale"
        )
        self.assertEqual(result["stale"], stale_sections, "顶层 stale 应等于各 section stale 之和")

    # ---- 7. section source / asOf 独立性 ----------------------------------
    def test_non_nav_sections_use_own_asof(self):
        """holdings / scaleHistory / rating / purchaseInfo 不应被 nav_date stale 绑定。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2022-01-01", "nav": 1.0}] * 300,
                "holdings": [{"stock_code": "000001"}],
                "asset_allocation": [{"type": "股票", "ratio": 60.0}],
                "nav_date": "2022-01-01",
                "updated_at": "2099-01-01T00:00:00",
            },
            quarterly={"holder_count": 0, "scale_count": 4, "turnover_count": 0,
                       "bond_alloc_count": 0, "bond_hold_count": 0,
                       "quarterly_updated": "2099-01-01T00:00:00"},
            metrics_row={"score": 75.0, "fee_manage": 0.015, "fee_custody": 0.005,
                         "metrics_updated_at": "2099-01-01T00:00:00"},
        )
        # holdings 用 snapshot.updated_at，不是 nav_date
        self.assertNotEqual(result["sections"]["holdings"]["dataStatus"], "stale")
        # scaleHistory 用 quarterly_updated
        self.assertNotEqual(result["sections"]["scaleHistory"]["dataStatus"], "stale")
        # rating / purchaseInfo 用 metrics_updated_at
        self.assertNotEqual(result["sections"]["rating"]["dataStatus"], "stale")
        self.assertNotEqual(result["sections"]["purchaseInfo"]["dataStatus"], "stale")


    # ---- 8. peerPerformance / riskSummary source/asOf 缺口 -------------------
    def test_peerPerformance_nav_fallback_source_and_asof(self):
        """quote_row=None 且 nav_count>=250 时，peerPerformance 应 available，source=fund_nav_history，asOf=nav_as_of。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2026-01-01", "nav": 1.0}] * 300,
                "nav_date": "2099-01-01T00:00:00",
                "updated_at": "2099-01-01T00:00:00",
            },
            quote_row=None,
        )
        pp = result["sections"]["peerPerformance"]
        self.assertEqual(pp["dataStatus"], "available")
        self.assertEqual(pp["source"], "fund_nav_history")
        self.assertEqual(pp["asOf"], "2099-01-01T00:00:00")

    def test_peerPerformance_quote_source_and_asof(self):
        """quote_row 有数据时，source=fund_quote_snapshot，asOf=quote_updated。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2026-01-01", "nav": 1.0}] * 300,
                "nav_date": "2099-01-01T00:00:00",
                "updated_at": "2099-01-01T00:00:00",
            },
            quote_row={"near_1y": 0.05, "near_3y": 0.15, "updated_at": "2099-01-01T00:00:00"},
        )
        pp = result["sections"]["peerPerformance"]
        self.assertEqual(pp["dataStatus"], "available")
        self.assertEqual(pp["source"], "fund_quote_snapshot")
        self.assertEqual(pp["asOf"], "2099-01-01T00:00:00")

    def test_riskSummary_nav_fallback_source_and_asof(self):
        """risk_has_data 由 nav_count>=30 兜底时，riskSummary 应 available，source=fund_nav_history_rule_engine，asOf=nav_as_of。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2026-01-01", "nav": 1.0}] * 300,
                "nav_date": "2099-01-01T00:00:00",
                "updated_at": "2099-01-01T00:00:00",
            },
            metrics_row=None,
        )
        rs = result["sections"]["riskSummary"]
        self.assertEqual(rs["dataStatus"], "available")
        self.assertEqual(rs["source"], "fund_nav_history_rule_engine")
        self.assertEqual(rs["asOf"], "2099-01-01T00:00:00")

    def test_riskSummary_metrics_source_and_asof(self):
        """snapshot 有 max_drawdown/sharpe/volatility 时，source=fund_metrics_snapshot，asOf=metrics_updated。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2026-01-01", "nav": 1.0}] * 300,
                "max_drawdown": 0.1,
                "sharpe_ratio": 0.5,
                "volatility": 0.2,
                "nav_date": "2099-01-01T00:00:00",
                "updated_at": "2099-01-01T00:00:00",
            },
            metrics_row={"score": 75.0, "metrics_updated_at": "2026-04-01T00:00:00"},
        )
        rs = result["sections"]["riskSummary"]
        self.assertEqual(rs["dataStatus"], "available")
        self.assertEqual(rs["source"], "fund_metrics_snapshot")
        self.assertEqual(rs["asOf"], "2026-04-01T00:00:00")

    # ---- 9. quarterly / metrics stale 独立逻辑 -------------------------------
    def test_quarterly_stale_marks_scaleHistory_stale(self):
        """quarterly_updated 很旧且 scale_count>0 时，scaleHistory 应 stale。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2026-01-01", "nav": 1.0}] * 300,
                "nav_date": "2099-01-01T00:00:00",
                "updated_at": "2099-01-01T00:00:00",
            },
            quarterly={"holder_count": 0, "scale_count": 4, "turnover_count": 0,
                       "bond_alloc_count": 0, "bond_hold_count": 0,
                       "quarterly_updated": "2020-01-01T00:00:00"},
        )
        self.assertEqual(result["sections"]["scaleHistory"]["dataStatus"], "stale")
        self.assertEqual(result["sections"]["turnoverHistory"]["dataStatus"], "missing")

    def test_metrics_stale_marks_rating_stale(self):
        """metrics_updated_at 很旧且 rating_count>0 时，rating 应 stale。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2026-01-01", "nav": 1.0}] * 300,
                "nav_date": "2099-01-01T00:00:00",
                "updated_at": "2099-01-01T00:00:00",
            },
            metrics_row={"score": 75.0, "fee_manage": None, "fee_custody": None,
                         "metrics_updated_at": "2020-01-01T00:00:00"},
        )
        self.assertEqual(result["sections"]["rating"]["dataStatus"], "stale")

    def test_metrics_stale_marks_purchaseInfo_stale(self):
        """Stale metric fee fragments remain stale, not available purchase info."""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2026-01-01", "nav": 1.0}] * 300,
                "nav_date": "2099-01-01T00:00:00",
                "updated_at": "2099-01-01T00:00:00",
            },
            metrics_row={"score": None, "fee_manage": 0.015, "fee_custody": 0.005,
                         "metrics_updated_at": "2020-01-01T00:00:00"},
        )
        self.assertEqual(result["sections"]["purchaseInfo"]["dataStatus"], "stale")

    # ---- 10. available/stale/partial 的 asOf 不应为 None -----------------------
    def test_available_section_has_non_none_asof_when_data_derived(self):
        """有数据可推导时，available/stale/partial section 的 asOf 不应为 None。"""
        result = self._invoke(
            snapshot={
                "nav_data": [{"date": "2026-01-01", "nav": 1.0}] * 300,
                "holdings": [{"stock_code": "000001"}],
                "asset_allocation": [{"type": "股票", "ratio": 60.0}],
                "nav_date": "2099-01-01T00:00:00",
                "updated_at": "2099-01-01T00:00:00",
            },
        )
        for key in self.EXPECTED_SECTION_KEYS:
            section = result["sections"][key]
            if section["dataStatus"] in ("available", "stale", "partial"):
                self.assertIsNotNone(
                    section["asOf"],
                    f"section '{key}' is {section['dataStatus']} but asOf is None"
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
