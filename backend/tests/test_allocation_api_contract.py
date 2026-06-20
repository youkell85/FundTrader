import math
import unittest
from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.api import allocation as allocation_api
from app.allocation.correlation_checker import check_correlation_constraints
from app.allocation.models import AllocationRequest, FeeAnalysisRequest, ShareSelectorRequest


class AllocationApiContractTest(unittest.IsolatedAsyncioTestCase):
    def test_assert_json_finite_rejects_nested_nan(self):
        payload = {
            "saa": {"expected_return": 4.2},
            "monte_carlo": [{"var_95": math.nan}],
        }

        with self.assertRaisesRegex(ValueError, r"non_finite_response_value at \$\.monte_carlo\[0\]\.var_95"):
            allocation_api.assert_json_finite(payload)

    async def test_generate_allocation_rejects_non_finite_pipeline_response(self):
        class FakeResponse:
            def model_dump(self):
                return {
                    "meta": {},
                    "saa": {"expected_return": math.inf},
                }

        request = AllocationRequest(
            age=35,
            goal_type="wealth",
            investment_horizon="medium",
            amount=500000,
            risk_tolerance="balanced",
            preferred_tags=[],
        )

        with patch.object(allocation_api, "run_in_threadpool", new=AsyncMock(return_value=FakeResponse())):
            with patch.object(allocation_api, "get_pipeline_health", return_value={"health": "degraded"}):
                with self.assertRaises(HTTPException) as caught:
                    await allocation_api.generate_allocation(request, user={"id": "test"})

        self.assertEqual(caught.exception.status_code, 500)
        self.assertNotIn("non_finite_response_value", caught.exception.detail["message"])
        self.assertIn("error_id", caught.exception.detail)
        self.assertNotIn("failed_steps", caught.exception.detail)

    async def test_share_selector_exposes_missing_fee_source_state(self):
        request = ShareSelectorRequest(
            funds=[{"code": "510300", "name": "沪深300ETF"}],
            holding_months=12,
            amount=100000,
        )

        response = await allocation_api.select_share_class(request)

        self.assertEqual(response.data_status, "missing")
        self.assertIn("缺少真实 A/C 份额费率档案", response.missing_reason or "")
        self.assertIn("未生成默认假设测算", response.missing_reason or "")
        self.assertEqual(response.recommendations, [])

    async def test_fee_analysis_does_not_use_default_fee_assumptions(self):
        request = FeeAnalysisRequest(
            funds=[{"code": "NOFEE", "name": "沪深300ETF"}],
            asset_class="all",
        )

        response = await allocation_api.analyze_fund_fees(request)

        self.assertEqual(response.analyses, [])
        self.assertIn("缺少真实管理费/托管费字段", response.recommendation)
        self.assertIn("未生成默认费率评分", response.recommendation)

    async def test_fee_analysis_enriches_verified_sqlite_fee_fields(self):
        class FakeCursor:
            def fetchall(self):
                return [
                    {
                        "code": "510300",
                        "management_fee": 0.0015,
                        "custody_fee": 0.0005,
                        "metadata_as_of": "2026-06-21",
                        "source": "tushare",
                    }
                ]

        class FakeConnection:
            def execute(self, query, params):
                return FakeCursor()

        @contextmanager
        def fake_get_db():
            yield FakeConnection()

        request = FeeAnalysisRequest(
            funds=[{"code": "510300", "name": "沪深300ETF"}],
            asset_class="all",
        )

        with patch.object(allocation_api, "get_db", fake_get_db):
            response = await allocation_api.analyze_fund_fees(request)

        self.assertEqual(len(response.analyses), 1)
        self.assertAlmostEqual(response.analyses[0].management_fee, 0.15)
        self.assertAlmostEqual(response.analyses[0].custody_fee, 0.05)
        self.assertIn("真实管理费/托管费字段", response.recommendation)

    def test_correlation_warning_is_not_hard_failure_below_material_weight(self):
        result = check_correlation_constraints(
            {"a_share_large": 0.0663, "a_share_value": 0.0954},
            threshold=0.85,
            material_weight=0.20,
        )

        self.assertTrue(result.passed)
        self.assertEqual(result.violations, [])
        self.assertAlmostEqual(result.max_correlation, 0.88)
        self.assertTrue(any("观察项" in warning for warning in result.warnings))

    async def test_fee_analysis_uses_verified_sample_average(self):
        request = FeeAnalysisRequest(
            funds=[
                {"code": "510300", "name": "沪深300ETF", "management_fee": 0.0015, "custody_fee": 0.0005},
                {"code": "159919", "name": "沪深300ETF联接", "management_fee": 0.005, "custody_fee": 0.001},
            ],
            asset_class="all",
        )

        response = await allocation_api.analyze_fund_fees(request)

        self.assertEqual(len(response.analyses), 2)
        self.assertIn("真实管理费/托管费字段", response.recommendation)
        self.assertIn("样本均值", response.recommendation)
        for item in response.analyses:
            self.assertAlmostEqual(item.category_avg_ter, 0.4)


if __name__ == "__main__":
    unittest.main()
