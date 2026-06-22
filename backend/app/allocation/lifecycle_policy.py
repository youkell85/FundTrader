from __future__ import annotations

import uuid

from .goal_manager import sort_goals, summarize_goals
from .goal_monte_carlo import bisect_monthly_contribution
from .models import (
    EvidenceRef,
    FusionDataQuality,
    GlidePathPoint,
    IpsSummary,
    LifecycleGoalItem,
    LifecyclePolicyRequest,
    LifecyclePolicyResponse,
    PolicyBand,
)
from .orchestrator import run as run_allocation


_GOAL_MAX_DRAWDOWN = {
    "retirement": 0.15,
    "education": 0.10,
    "housing": 0.05,
    "wealth": 0.25,
}


def compute_goal_aware_equity_center(age: int, goal_type: str, years_to_goal: float) -> float:
    years = max(0.0, years_to_goal)
    if goal_type == "education":
        pct = 60 if years > 8 else 40 if years > 5 else 20 if years > 3 else 10
    elif goal_type == "housing":
        pct = 30 if years > 5 else 15 if years > 2 else 5
    elif goal_type == "retirement":
        pct = max(20, min(80, 100 - age))
    else:
        pct = max(20, min(80, 110 - age))
    return float(pct) / 100.0


def _build_glide_path(age: int, goal: LifecycleGoalItem | None) -> list[GlidePathPoint]:
    if goal is None:
        equity = compute_goal_aware_equity_center(age, "wealth", 10)
        return [
            GlidePathPoint(
                age=age,
                equity_weight=equity,
                bond_weight=1 - equity,
                cash_weight=0,
                alternative_weight=0,
                note="No goal supplied; wealth-preservation default.",
            )
        ]

    points: list[GlidePathPoint] = []
    horizon = max(1, goal.horizon_years)
    step = max(1, min(5, horizon // 5 or 1))
    for year in range(0, horizon + 1, step):
        point_age = age + year
        years_to_goal = max(0, horizon - year)
        equity = compute_goal_aware_equity_center(point_age, goal.goal_type, years_to_goal)
        cash = 0.05 if years_to_goal <= 2 else 0.02
        bond = max(0.0, 1 - equity - cash)
        points.append(
            GlidePathPoint(
                age=point_age,
                equity_weight=round(equity, 4),
                bond_weight=round(bond, 4),
                cash_weight=round(cash, 4),
                alternative_weight=0,
                note=f"{goal.name}: {years_to_goal} years to target.",
            )
        )
    return points


def _build_policy_bands(age: int, goal: LifecycleGoalItem | None, risk_tolerance: str) -> list[PolicyBand]:
    if goal is None:
        equity_target = 0.5
    else:
        equity_target = compute_goal_aware_equity_center(age, goal.goal_type, goal.horizon_years)
    band_width = {
        "conservative": 0.05,
        "moderate": 0.07,
        "balanced": 0.10,
        "aggressive": 0.12,
        "radical": 0.15,
    }.get(risk_tolerance, 0.10)
    bond_target = 1 - equity_target
    return [
        PolicyBand(
            asset_class="equity",
            target_weight=round(equity_target, 4),
            min_weight=round(max(0.0, equity_target - band_width), 4),
            max_weight=round(min(1.0, equity_target + band_width), 4),
            rebalance_trigger=0.02,
        ),
        PolicyBand(
            asset_class="bond",
            target_weight=round(bond_target, 4),
            min_weight=round(max(0.0, bond_target - band_width), 4),
            max_weight=round(min(1.0, bond_target + band_width), 4),
            rebalance_trigger=0.02,
        ),
    ]


def _build_ips_summary(
    request: LifecyclePolicyRequest,
    primary_goal: LifecycleGoalItem | None,
    required_monthly: float | None,
) -> IpsSummary:
    risk_tolerance = request.base_request.risk_tolerance
    goal_label = primary_goal.name if primary_goal else "General wealth plan"
    horizon = primary_goal.horizon_years if primary_goal else None
    risk_budget = {
        "risk_tolerance": risk_tolerance,
        "max_drawdown": _GOAL_MAX_DRAWDOWN.get(primary_goal.goal_type if primary_goal else "wealth", 0.25),
        "review_frequency": request.review_frequency,
    }
    if required_monthly is not None:
        risk_budget["required_monthly_contribution"] = round(required_monthly, 2)
    return IpsSummary(
        investor_profile=f"Age {request.current_age}, risk tolerance {risk_tolerance}.",
        objectives=[
            f"Primary goal: {goal_label}.",
            f"Horizon: {horizon} years." if horizon else "No explicit goal horizon supplied.",
        ],
        constraints=[
            "Use public fund allocation output as the investable universe anchor.",
            "Review policy bands instead of replacing the existing allocation engine.",
        ],
        risk_budget=risk_budget,
        suitability_notes=[
            "Lifecycle output is a policy wrapper and must be reviewed with client suitability.",
            "Return and success estimates are analytical assumptions, not performance promises.",
        ],
    )


def _merge_data_quality(allocation_status: str | None, fallback_used: bool, fallback_reason: str | None) -> FusionDataQuality:
    if fallback_used:
        return FusionDataQuality(
            status="partial",
            source="allocation_orchestrator+goal_monte_carlo",
            coverage=0.7,
            confidence=0.65,
            missing_reason=fallback_reason,
            warnings=["Monte Carlo monthly contribution used degraded fallback."],
        )
    status = allocation_status if allocation_status in {"real", "partial", "assumption", "stale"} else "partial"
    return FusionDataQuality(
        status=status,
        source="allocation_orchestrator+goal_monte_carlo",
        coverage=0.85,
        confidence=0.75,
        missing_reason=None,
        warnings=[],
    )


def build_lifecycle_policy(request: LifecyclePolicyRequest) -> LifecyclePolicyResponse:
    allocation = run_allocation(request.base_request)
    ordered_goals = sort_goals(request.goals)
    primary_goal = ordered_goals[0] if ordered_goals else None

    required_monthly: float | None = None
    fallback_used = False
    fallback_reason: str | None = None
    if primary_goal is not None:
        required_monthly, fallback_used, fallback_reason = bisect_monthly_contribution(
            initial_amount=primary_goal.current_balance,
            target_amount=primary_goal.target_amount,
            horizon_years=primary_goal.horizon_years,
            annual_return_mean=allocation.saa.expected_return / 100,
            annual_return_std=allocation.saa.expected_volatility / 100,
            target_success_rate=request.target_success_rate,
            timeout_seconds=8,
        )
    else:
        fallback_reason = "no_goal"

    goal_summary = summarize_goals(
        ordered_goals,
        required_monthly_contribution=required_monthly,
        target_success_rate=request.target_success_rate,
        fallback_used=fallback_used,
        fallback_reason=fallback_reason,
    )
    ips = _build_ips_summary(request, primary_goal, required_monthly)
    quality_status = None
    if allocation.data_quality is not None:
        quality_status = allocation.data_quality.overall_status

    warnings = list(allocation.warnings)
    if fallback_reason == "no_goal":
        warnings.append("No lifecycle goal supplied; generated a general IPS wrapper.")
    elif fallback_used and fallback_reason:
        warnings.append(f"Monthly contribution calculation degraded: {fallback_reason}.")

    return LifecyclePolicyResponse(
        plan_id=f"life-{uuid.uuid4().hex[:16]}",
        allocation=allocation,
        goal_summary=goal_summary,
        glide_path=_build_glide_path(request.current_age, primary_goal),
        policy_bands=_build_policy_bands(request.current_age, primary_goal, request.base_request.risk_tolerance),
        ips_summary=ips,
        required_monthly_contribution=required_monthly,
        data_quality=_merge_data_quality(quality_status, fallback_used, fallback_reason),
        suitability_status="review_required",
        evidence_refs=[
            EvidenceRef(
                source="allocation_orchestrator",
                description="Base allocation generated by current FundTrader allocation engine.",
                confidence=0.75,
            )
        ],
        warnings=warnings,
    )
