import unittest
from unittest.mock import patch

from app.allocation.lifecycle_policy import build_lifecycle_policy
from app.allocation.models import (
    AllocationDataQuality,
    AllocationMeta,
    AllocationRequest,
    AllocationResponse,
    DataQualityItem,
    LifecycleGoalItem,
    LifecyclePolicyRequest,
    SAASummary,
    TAASummary,
    UserProfileSummary,
)


def _fake_allocation() -> AllocationResponse:
    quality = DataQualityItem(status="real", source="unit-test", confidence=1.0)
    return AllocationResponse(
        meta=AllocationMeta(generated_at="2026-06-22T00:00:00"),
        user_profile=UserProfileSummary(
            risk_tolerance="balanced",
            risk_label="Balanced",
            effective_risk="balanced",
            age=35,
            amount=500000,
            horizon="medium",
        ),
        saa=SAASummary(
            allocations={"a_share_large": 50, "investment_grade_bond": 50},
            group_allocations={"equity": 50, "bond": 50},
            equity_center=50,
            expected_return=5.0,
            expected_volatility=10.0,
            expected_max_drawdown=25.0,
            sharpe_ratio=0.5,
            risk_contributions={"a_share_large": 0.5, "investment_grade_bond": 0.5},
        ),
        taa=TAASummary(taa_adjusted={}, adjustments={}),
        funds=[],
        portfolio_metrics={"expected_return": 5.0},
        stress_tests=[],
        factor_exposures={},
        constraints=[],
        risk_disclaimer="unit test",
        warnings=[],
        data_quality=AllocationDataQuality(
            overall_status="real",
            cma=quality,
            factor=quality,
            fund_mapping=quality,
            monte_carlo=quality,
        ),
    )


class LifecyclePolicyTest(unittest.TestCase):
    def _request(self) -> LifecyclePolicyRequest:
        return LifecyclePolicyRequest(
            base_request=AllocationRequest(
                age=35,
                amount=500000,
                risk_tolerance="balanced",
                preferred_tags=[],
                goal_type="wealth",
            ),
            current_age=35,
            target_success_rate=0.8,
            goals=[
                LifecycleGoalItem(
                    id="goal-1",
                    name="Wealth target",
                    goal_type="wealth",
                    target_amount=1200000,
                    horizon_years=8,
                    priority=1,
                    current_balance=500000,
                    monthly_contribution=0,
                )
            ],
        )

    def test_build_lifecycle_policy_wraps_allocation(self):
        with patch("app.allocation.lifecycle_policy.run_allocation", return_value=_fake_allocation()):
            result = build_lifecycle_policy(self._request())

        self.assertIsNotNone(result.allocation)
        self.assertEqual(result.goal_summary.total_goals, 1)
        self.assertEqual(result.ips_summary.risk_budget["risk_tolerance"], "balanced")
        self.assertGreater(len(result.glide_path), 1)
        self.assertEqual(result.data_quality.status, "real")

    def test_monthly_timeout_degrades_to_partial(self):
        with patch("app.allocation.lifecycle_policy.run_allocation", return_value=_fake_allocation()), \
            patch(
                "app.allocation.lifecycle_policy.bisect_monthly_contribution",
                return_value=(12345.0, True, "timeout_linear_approximation"),
            ):
            result = build_lifecycle_policy(self._request())

        self.assertEqual(result.data_quality.status, "partial")
        self.assertEqual(result.goal_summary.required_monthly_contribution, 12345.0)
        self.assertEqual(result.goal_summary.fallback_reason, "timeout_linear_approximation")
        self.assertTrue(result.goal_summary.fallback_used)


if __name__ == "__main__":
    unittest.main()
