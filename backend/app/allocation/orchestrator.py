"""Orchestrator — 14-step allocation pipeline controller with per-step diagnostics."""
import logging
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from .circuit_breaker import evaluate_breaker, get_breaker_status
from .cma_manager import estimate_cma
from .config import ASSET_CLASSES, ASSET_TO_GROUP, GROUP_MAP
from .constraint_checker import check_constraints
from .factor_exposure import calculate_exposures
from .fund_mapper import map_funds
from .models import (
    AllocationMeta,
    AllocationRequest,
    AllocationResponse,
    CMAResult,
    SAASummary,
    UserProfileSummary,
    VariantComparison,
    VariantItem,
    VariantsResponse,
)
from .monte_carlo import simulate
from .regime_detector import detect_regime, get_regime_status
from .risk_profiler import RISK_LABELS, profile_user
from .saa_engine import optimize_saa
from .scenario_analysis import analyze_scenarios
from .stress_test import run_stress_tests
from .taa_engine import adjust_taa

logger = logging.getLogger(__name__)


class TaskCancelledError(Exception):
    """Raised when a pipeline task is cancelled by the user."""
    pass

# ─── Pipeline Diagnostics ───
_STEP_NAMES = [
    "risk_profiling", "cma_estimation", "saa_optimization", "regime_detection",
    "taa_adjustment", "circuit_breaker", "constraint_check", "fund_mapping",
    "monte_carlo", "stress_test", "factor_exposure", "scenario_analysis",
    "portfolio_metrics", "output_assembly",
]


class _StepDiag:
    """Per-step diagnostic record."""
    __slots__ = ("name", "status", "elapsed_ms", "detail")

    def __init__(self, name: str):
        self.name = name
        self.status = "ok"
        self.elapsed_ms = 0.0
        self.detail: Optional[str] = None

    def to_dict(self) -> dict:
        d = {"step": self.name, "status": self.status, "elapsed_ms": round(self.elapsed_ms, 2)}
        if self.detail:
            d["detail"] = self.detail
        return d


# Module-level history (last 10 runs)
_DIAG_HISTORY: List[Dict[str, Any]] = []
_MAX_HISTORY = 10


def _record_run(diags: List[_StepDiag], warnings: List[str], total_ms: float):
    """Record a pipeline run into diagnostic history."""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_ms": round(total_ms, 2),
        "steps": [d.to_dict() for d in diags],
        "warnings": list(warnings),
        "degraded_steps": [d.name for d in diags if d.status == "degraded"],
        "failed_steps": [d.name for d in diags if d.status == "error"],
        "health": "healthy",
    }
    if record["failed_steps"]:
        record["health"] = "critical"
    elif record["degraded_steps"] or len(warnings) > 2:
        record["health"] = "degraded"

    _DIAG_HISTORY.append(record)
    if len(_DIAG_HISTORY) > _MAX_HISTORY:
        _DIAG_HISTORY.pop(0)

    return record


def run(
    request: AllocationRequest,
    progress_callback: Optional[Callable[[int, int, str, str, str], None]] = None,
    cancel_event: Optional[threading.Event] = None,
) -> AllocationResponse:
    """Execute the full 14-step allocation pipeline with per-step diagnostics.

    Steps:
      1. Risk Profiling
      2. CMA Estimation
      3. SAA Optimization (5-level fallback)
      4. Regime Detection
      5. TAA Adjustment
      6. Circuit Breaker
      7. Constraint Check
      8. Fund Mapping
      9. Monte Carlo Simulation
      10. Stress Testing
      11. Factor Exposure
      12. Scenario Analysis
      13. Portfolio Metrics
      14. Output Assembly

    Args:
        request: Allocation request parameters.
        progress_callback: Called after each step: (step_num, total, name, status, detail).
        cancel_event: If set, raises TaskCancelledError before next step.
    """
    TOTAL_STEPS = 14

    def _check_cancel():
        if cancel_event and cancel_event.is_set():
            raise TaskCancelledError("任务已被用户取消")

    warnings: List[str] = []
    diags: List[_StepDiag] = []
    t_total = time.monotonic()

    def _step(name: str) -> _StepDiag:
        _check_cancel()
        d = _StepDiag(name)
        diags.append(d)
        return d

    def _notify(step_num: int, diag: _StepDiag):
        if progress_callback:
            progress_callback(step_num, TOTAL_STEPS, diag.name, diag.status, diag.detail or "")

    # ─── Step 1: Risk Profiling ───
    d = _step("risk_profiling")
    t0 = time.monotonic()
    try:
        profile = profile_user(request)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
    except Exception as e:
        d.status = "error"
        d.detail = str(e)[:100]
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        _notify(1, d)
        raise
    _notify(1, d)

    # ─── Step 2: CMA Estimation ───
    d = _step("cma_estimation")
    t0 = time.monotonic()
    try:
        regime = detect_regime()
        regime_detect_ms = (time.monotonic() - t0) * 1000
        cma = estimate_cma(regime)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
    except Exception as e:
        d.status = "degraded"
        d.detail = f"降级至均衡CMA: {str(e)[:80]}"
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        warnings.append(f"CMA估计失败，已降级使用均衡配置")
        logger.exception("CMA estimation failed, falling back to equilibrium")
        from .config import DEFAULT_CORR, EQUILIBRIUM_RETURNS, EQUILIBRIUM_VOLS
        cma = CMAResult(
            expected_returns=EQUILIBRIUM_RETURNS,
            volatilities=EQUILIBRIUM_VOLS,
            covariance_matrix=DEFAULT_CORR,
        )
    _notify(2, d)

    # ─── Step 3: SAA Optimization ───
    d = _step("saa_optimization")
    t0 = time.monotonic()
    try:
        saa_result = optimize_saa(profile, cma)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        if saa_result["optimizer_level"] >= 4:
            d.status = "degraded"
            d.detail = f"降级至L{saa_result['optimizer_level']}"
            warnings.append(f"优化器降级至L{saa_result['optimizer_level']}，结果可能不够精确")
    except Exception as e:
        d.status = "error"
        d.detail = str(e)[:100]
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        _notify(3, d)
        raise
    _notify(3, d)

    allocations = saa_result["allocations"]

    # ─── Step 4: Regime Detection (already in step 2, record status) ───
    d = _step("regime_detection")
    d.elapsed_ms = round(regime_detect_ms, 2)
    d.detail = f"{regime.regime}(conf={regime.confidence})"
    if not regime.is_confirmed:
        d.status = "degraded"
        d.detail += f" pending={regime.pending_regime}"
    _notify(4, d)

    # ─── Step 5: TAA Adjustment ───
    d = _step("taa_adjustment")
    t0 = time.monotonic()
    try:
        taa_result = adjust_taa(allocations, regime)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
    except Exception as e:
        d.status = "error"
        d.detail = str(e)[:100]
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        _notify(5, d)
        raise
    _notify(5, d)

    taa_allocations = taa_result.taa_adjusted
    taa_skipped = all(abs(v) < 0.001 for v in taa_result.adjustments.values())

    # ─── Step 6: Circuit Breaker ───
    d = _step("circuit_breaker")
    t0 = time.monotonic()
    try:
        post_breaker_alloc, breaker_triggered = evaluate_breaker(regime, taa_allocations)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        if breaker_triggered:
            d.status = "degraded"
            d.detail = "权益仓位已降低"
            warnings.append("断路器已触发，权益仓位已自动降低")
    except Exception as e:
        d.status = "error"
        d.detail = str(e)[:100]
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        _notify(6, d)
        raise
    _notify(6, d)

    # ─── Step 7: Constraint Check ───
    d = _step("constraint_check")
    t0 = time.monotonic()
    try:
        final_alloc, constraint_checks = check_constraints(post_breaker_alloc)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        failed = [c for c in constraint_checks if not c.passed]
        if failed:
            d.status = "degraded"
            d.detail = f"{len(failed)}项约束未通过"
    except Exception as e:
        d.status = "error"
        d.detail = str(e)[:100]
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        _notify(7, d)
        raise
    _notify(7, d)

    # ─── Step 8: Fund Mapping ───
    d = _step("fund_mapping")
    t0 = time.monotonic()
    try:
        fund_list = map_funds(final_alloc, request.amount, request.preferred_tags)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        if not fund_list:
            d.status = "degraded"
            d.detail = "基金池未覆盖"
            warnings.append("基金池未能覆盖所有资产类别")
    except Exception as e:
        d.status = "error"
        d.detail = str(e)[:100]
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        _notify(8, d)
        raise
    _notify(8, d)

    # ─── Step 9: Monte Carlo ───
    d = _step("monte_carlo")
    t0 = time.monotonic()
    try:
        mc_result = simulate(final_alloc, cma, profile.horizon_months, regime=regime)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
    except Exception as e:
        mc_result = None
        d.status = "degraded"
        d.detail = str(e)[:100]
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        warnings.append(f"蒙特卡洛模拟异常: {str(e)[:50]}")
    _notify(9, d)

    # ─── Step 10: Stress Test ───
    d = _step("stress_test")
    t0 = time.monotonic()
    try:
        stress_results = run_stress_tests(final_alloc)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
    except Exception as e:
        stress_results = []
        d.status = "degraded"
        d.detail = f"压力测试跳过: {str(e)[:80]}"
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        warnings.append("压力测试不可用，已跳过")
        logger.exception("Stress test failed, skipping")
    _notify(10, d)

    # Convert stress results: fractions → percentages + currency
    amount = request.amount
    for item in stress_results:
        item.max_loss = round(abs(min(item.impact, 0.0)) * amount, 0)
        item.impact = round(item.impact * 100, 2)

    # ─── Step 11: Factor Exposure ───
    d = _step("factor_exposure")
    t0 = time.monotonic()
    try:
        factor_exposures = calculate_exposures(final_alloc)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
    except Exception as e:
        d.status = "error"
        d.detail = str(e)[:100]
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        _notify(11, d)
        raise
    _notify(11, d)

    # ─── Step 12: Scenario Analysis ───
    d = _step("scenario_analysis")
    t0 = time.monotonic()
    try:
        scenario_result = analyze_scenarios(final_alloc, regime)
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        # Convert scenario returns: fractions → percentages
        scenario_result.weighted_return = round(scenario_result.weighted_return * 100, 2)
        for s in scenario_result.scenarios:
            s.impact = round(s.impact * 100, 2)
    except Exception as e:
        d.status = "error"
        d.detail = str(e)[:100]
        d.elapsed_ms = (time.monotonic() - t0) * 1000
        _notify(12, d)
        raise
    _notify(12, d)

    # ─── Step 13: Portfolio Metrics ───
    d = _step("portfolio_metrics")
    t0 = time.monotonic()
    portfolio_metrics = _compute_portfolio_metrics(saa_result, mc_result, fund_list)
    d.elapsed_ms = (time.monotonic() - t0) * 1000
    _notify(13, d)

    # Convert fund weights: fractions → percentages
    for f in fund_list:
        f.weight = round(f.weight * 100, 2)

    # ─── Step 14: Output Assembly ───
    d = _step("output_assembly")
    t0 = time.monotonic()

    # Group allocations
    group_allocs = _compute_group_allocations(final_alloc)

    # Convert fractions → percentages for frontend display
    pct_allocations = {a: round(v * 100, 2) for a, v in final_alloc.items()}
    pct_group_allocs = {g: round(v * 100, 2) for g, v in group_allocs.items()}
    pct_risk_contributions = {a: round(v * 100, 2) for a, v in saa_result["risk_contributions"].items()}

    # SAA summary — use MC MDD95 when available, otherwise estimate from vol
    mc_mdd = mc_result.max_drawdown_95 if mc_result else None
    estimated_mdd = round(saa_result["expected_volatility"] * 2.5, 2)
    effective_mdd = abs(mc_mdd) if mc_mdd and abs(mc_mdd) > 0 else estimated_mdd

    saa_summary = SAASummary(
        allocations=pct_allocations,
        group_allocations=pct_group_allocs,
        equity_center=round(profile.equity_center, 1),
        expected_return=saa_result["expected_return"],
        expected_volatility=saa_result["expected_volatility"],
        expected_max_drawdown=effective_mdd,
        sharpe_ratio=_compute_sharpe(saa_result["expected_return"], saa_result["expected_volatility"]),
        glide_path_applied=profile.glide_path_applied,
        risk_contributions=pct_risk_contributions,
    )

    # User profile summary
    user_profile = UserProfileSummary(
        risk_tolerance=profile.risk_tolerance,
        risk_label=RISK_LABELS.get(profile.risk_tolerance, "平衡型"),
        effective_risk=profile.effective_risk,
        behavior_adjusted=profile.behavior_adjusted,
        age=profile.age,
        amount=profile.amount,
        horizon=profile.horizon,
    )

    # Meta
    meta = AllocationMeta(
        engine_version="4.0.0",
        generated_at=datetime.now(timezone.utc).isoformat(),
        regime=regime.regime,
        regime_label=regime.regime_label,
        regime_pending=regime.pending_regime,
        regime_pending_count=regime.pending_count,
        regime_is_confirmed=regime.is_confirmed,
        taa_skipped=taa_skipped,
        circuit_breaker_triggered=breaker_triggered,
    )

    # Risk disclaimer
    risk_disclaimer = (
        "本配置方案由量化模型自动生成，仅供参考，不构成投资建议。"
        "历史表现不代表未来收益，投资有风险，请根据自身情况审慎决策。"
    )

    d.elapsed_ms = (time.monotonic() - t0) * 1000
    _notify(14, d)

    # Record diagnostics
    total_ms = (time.monotonic() - t_total) * 1000
    _record_run(diags, warnings, total_ms)

    return AllocationResponse(
        meta=meta,
        user_profile=user_profile,
        saa=saa_summary,
        taa=taa_result,
        funds=fund_list,
        portfolio_metrics=portfolio_metrics,
        stress_tests=stress_results,
        monte_carlo=mc_result,
        scenario_analysis=scenario_result,
        factor_exposures=factor_exposures,
        constraints=constraint_checks,
        risk_disclaimer=risk_disclaimer,
        warnings=warnings,
    )


def get_pipeline_health() -> dict:
    """Return pipeline health report with per-step diagnostics.

    Includes:
    - Last run status (per-step timing, degradation, errors)
    - Subsystem status (regime, circuit breaker)
    - Historical run summary (last 10 runs)
    """
    # Subsystem status
    regime_status = get_regime_status()
    breaker_status = get_breaker_status()

    last_run = _DIAG_HISTORY[-1] if _DIAG_HISTORY else None

    # Summary stats from history
    total_runs = len(_DIAG_HISTORY)
    healthy_runs = sum(1 for r in _DIAG_HISTORY if r["health"] == "healthy")
    degraded_runs = sum(1 for r in _DIAG_HISTORY if r["health"] == "degraded")
    critical_runs = sum(1 for r in _DIAG_HISTORY if r["health"] == "critical")

    avg_ms = 0.0
    if total_runs > 0:
        avg_ms = sum(r["total_ms"] for r in _DIAG_HISTORY) / total_runs

    return {
        "last_run": last_run,
        "subsystems": {
            "regime": regime_status,
            "circuit_breaker": breaker_status,
        },
        "history_summary": {
            "total_runs": total_runs,
            "healthy": healthy_runs,
            "degraded": degraded_runs,
            "critical": critical_runs,
            "avg_total_ms": round(avg_ms, 2),
        },
        "health": last_run["health"] if last_run else "unknown",
    }


def _compute_group_allocations(allocations: Dict[str, float]) -> Dict[str, float]:
    """Sum allocations by group."""
    groups = {}
    for grp, assets in GROUP_MAP.items():
        groups[grp] = round(sum(allocations.get(a, 0.0) for a in assets), 4)
    return groups


def _compute_sharpe(expected_return: float, volatility: float, rf: float = None) -> float:
    """Compute Sharpe ratio. Returns and vol in % terms.

    Uses 10Y government bond yield as risk-free rate when available,
    otherwise falls back to 2.0% default.
    """
    if rf is None:
        rf = _get_risk_free_rate()
    if volatility < 0.01:
        return 0.0
    return round((expected_return - rf) / volatility, 2)


def _get_risk_free_rate() -> float:
    """Get risk-free rate from macro data (10Y government bond yield).

    Falls back to 2.0% if data is unavailable.
    """
    try:
        from .data import market_data_service
        macro = market_data_service.get_macro_snapshot()
        if macro is not None:
            yield_10y = macro.get_value("10Y国债收益率")
            if yield_10y is not None and 0 < yield_10y < 10:
                return yield_10y
    except Exception:
        pass
    return 2.0


def _compute_portfolio_metrics(saa_result: dict, mc_result, fund_list) -> Dict[str, float]:
    """Assemble portfolio-level metrics for display (frontend field names)."""
    # Use MC MDD95 when available, otherwise estimate from vol
    mc_mdd = mc_result.max_drawdown_95 if mc_result else None
    estimated_mdd = round(saa_result["expected_volatility"] * 2.5, 2)
    effective_mdd = abs(mc_mdd) if mc_mdd and abs(mc_mdd) > 0 else estimated_mdd

    metrics = {
        "expected_return": round(saa_result["expected_return"], 2),
        "volatility": round(saa_result["expected_volatility"], 2),
        "max_drawdown": effective_mdd,
        "sharpe": _compute_sharpe(saa_result["expected_return"], saa_result["expected_volatility"]),
        "calmar": 0.0,
        "fund_count": len(fund_list),
    }

    # Calmar = return / max_drawdown
    if metrics["max_drawdown"] > 0:
        metrics["calmar"] = round(metrics["expected_return"] / metrics["max_drawdown"], 2)

    return metrics


# ─── Risk level ordering for variant generation ───
_RISK_LEVELS = ["conservative", "moderate", "balanced", "aggressive", "radical"]
_VARIANT_LABELS = {
    "defensive": "防御型",
    "balanced": "均衡型",
    "growth": "进取型",
}


def generate_variants(request: AllocationRequest) -> VariantsResponse:
    """Generate 3 allocation variants: defensive / balanced / growth.

    Defensive shifts risk_tolerance down 1 level, growth shifts up 1 level.
    Each variant runs the full 14-step pipeline independently.
    """
    current_risk = request.risk_tolerance
    current_idx = _RISK_LEVELS.index(current_risk)

    # Build 3 requests with shifted risk levels
    shift_map = {
        "defensive": max(0, current_idx - 1),
        "balanced": current_idx,
        "growth": min(len(_RISK_LEVELS) - 1, current_idx + 1),
    }

    variants: Dict[str, VariantItem] = {}
    errors: Dict[str, str] = {}
    for label, idx in shift_map.items():
        try:
            variant_req = request.model_copy(update={"risk_tolerance": _RISK_LEVELS[idx]})
            resp = run(variant_req)
            variants[label] = VariantItem(
                label=label,
                label_cn=_VARIANT_LABELS[label],
                risk_tolerance=_RISK_LEVELS[idx],
                response=resp,
            )
        except Exception as e:
            logger.exception(f"Variant {label} generation failed")
            errors[label] = str(e)[:200]

    # 全部失败才报错
    if not variants and errors:
        raise RuntimeError(f"所有变体生成失败: {errors}")

    # Build comparison summary
    def _metric(key: str) -> Dict[str, float]:
        return {k: v.response.portfolio_metrics.get(key, 0.0) for k, v in variants.items()}

    # Equity ratio from group_allocations (key = "equity")
    equity_ratio = {}
    for k, v in variants.items():
        equity_ratio[k] = round(v.response.saa.group_allocations.get("equity", 0.0), 2)

    comparison = VariantComparison(
        expected_return=_metric("expected_return"),
        volatility=_metric("volatility"),
        sharpe_ratio=_metric("sharpe"),
        max_drawdown=_metric("max_drawdown"),
        equity_ratio=equity_ratio,
    )

    return VariantsResponse(variants=variants, comparison=comparison)
