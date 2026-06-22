from __future__ import annotations

from typing import Iterable

from .models import LifecycleGoalItem, LifecycleGoalSummary


def sort_goals(goals: Iterable[LifecycleGoalItem]) -> list[LifecycleGoalItem]:
    return sorted(goals, key=lambda goal: (goal.priority, goal.horizon_years, goal.target_amount))


def summarize_goals(
    goals: list[LifecycleGoalItem],
    required_monthly_contribution: float | None = None,
    target_success_rate: float = 0.8,
    fallback_used: bool = False,
    fallback_reason: str | None = None,
) -> LifecycleGoalSummary:
    ordered = sort_goals(goals)
    total_target = sum(goal.target_amount for goal in ordered)
    total_balance = sum(goal.current_balance for goal in ordered)
    total_monthly = sum(goal.monthly_contribution for goal in ordered)
    return LifecycleGoalSummary(
        total_goals=len(ordered),
        total_target_amount=round(total_target, 2),
        total_current_balance=round(total_balance, 2),
        total_monthly_contribution=round(total_monthly, 2),
        funding_gap=round(max(0.0, total_target - total_balance), 2),
        primary_goal_id=ordered[0].id if ordered else None,
        required_monthly_contribution=(
            round(required_monthly_contribution, 2)
            if required_monthly_contribution is not None
            else None
        ),
        target_success_rate=target_success_rate,
        fallback_used=fallback_used,
        fallback_reason=fallback_reason,
    )


def required_monthly_linear(
    initial_amount: float,
    target_amount: float,
    horizon_years: float,
    annual_return_mean: float,
) -> float:
    n_months = max(1.0, horizon_years * 12.0)
    monthly_return = annual_return_mean / 12.0
    future_value = initial_amount * (1 + monthly_return) ** n_months
    residual = target_amount - future_value
    if residual <= 0:
        return 0.0
    if abs(monthly_return) < 1e-9:
        return max(0.0, residual / n_months)
    denominator = (1 + monthly_return) ** n_months - 1
    if denominator <= 0:
        return max(0.0, residual / n_months)
    return max(0.0, residual * monthly_return / denominator)
