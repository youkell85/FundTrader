import math
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.api import allocation as allocation_api
from app.allocation.models import AllocationRequest, ShareSelectorRequest


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


if __name__ == "__main__":
    unittest.main()
