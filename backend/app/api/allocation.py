"""资产配置API"""
import asyncio
import json
import logging
import math
import queue
import threading
import uuid
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from .auth_middleware import get_optional_user

logger = logging.getLogger(__name__)

from ..allocation.models import (
    AllocationRequest, AllocationResponse,
    FundRankingRequest, FundRankingResponse, FundRankingItem,
    RebalanceCheckRequest, RebalanceCheckResponse,
    RebalanceDeviationItem, RebalanceTriggerItem, TradeActionItem,
    RebalanceHistoryResponse,
    VariantsResponse, ExplainReportModel, ExplainSectionModel,
    WhatIfRequest, WhatIfResponse,
    ShareSelectorRequest, ShareSelectorResponse, ShareRecommendationItem,
    CorrelationCheckRequest, CorrelationCheckResponse, CorrelationPairItem,
    FeeAnalysisRequest, FeeAnalysisResponse, FeeAnalysisItem,
)
from ..allocation.orchestrator import run as run_allocation
from ..allocation.orchestrator import TaskCancelledError, generate_variants, get_pipeline_health
from ..allocation.dual_engine import run_dual_comparison
from ..allocation.explainability import generate_explain_report
from ..allocation.what_if import WhatIfParams, run_what_if
from ..allocation.share_selector import batch_recommend
from ..allocation.correlation_checker import check_correlation_constraints, suggest_diversification
from ..allocation.fee_scorer import batch_analyze_fees, get_fee_recommendation
from ..allocation.backtest import BacktestRequest, BacktestResponse, run_backtest
from ..allocation.fund_mapper import get_all_rankings
from ..allocation.rebalancer import run_rebalance_check

router = APIRouter(prefix="/allocation", tags=["资产配置"])
GENERIC_ALLOCATION_ERROR = "配置生成失败，请稍后重试或联系管理员。"


def assert_json_finite(obj: Any, path: str = "$") -> None:
    """Reject NaN/Inf before FastAPI or SSE JSON serialization."""
    if isinstance(obj, float):
        if not math.isfinite(obj):
            raise ValueError(f"non_finite_response_value at {path}")
        return
    if isinstance(obj, dict):
        for key, value in obj.items():
            assert_json_finite(value, f"{path}.{key}")
        return
    if isinstance(obj, (list, tuple)):
        for index, value in enumerate(obj):
            assert_json_finite(value, f"{path}[{index}]")


def _response_payload(result: Any) -> Any:
    if hasattr(result, "model_dump"):
        return result.model_dump()
    return result


@router.post("/generate", response_model=AllocationResponse)
async def generate_allocation(request: AllocationRequest, user: dict | None = Depends(get_optional_user)):
    """生成资产配置方案 — 14步量化管线"""
    try:
        result = await run_in_threadpool(run_allocation, request)
        assert_json_finite(_response_payload(result))
        return result
    except Exception:
        error_id = uuid.uuid4().hex
        logger.exception("Allocation pipeline crashed")
        health = get_pipeline_health()
        logger.error(
            "Allocation error id=%s health=%s failed_steps=%s degraded_steps=%s",
            error_id,
            health.get("health", "unknown"),
            health.get("failed_steps", []),
            health.get("degraded_steps", []),
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "配置生成失败",
                "message": GENERIC_ALLOCATION_ERROR,
                "error_id": error_id,
                "pipeline_health": health.get("health", "unknown"),
            },
        )


@router.post("/variants", response_model=VariantsResponse)
async def generate_allocation_variants(request: AllocationRequest, user: dict | None = Depends(get_optional_user)):
    """三方案输出 — 防御型/均衡型/进取型，风险等级±1偏移"""
    result = await run_in_threadpool(generate_variants, request)
    return result


@router.post("/explain", response_model=ExplainReportModel)
async def explain_allocation(request: AllocationRequest):
    """可解释性报告 — 解释配置决策的原因和逻辑"""
    alloc_result = await run_in_threadpool(run_allocation, request)
    report = generate_explain_report(alloc_result)
    return ExplainReportModel(
        sections=[
            ExplainSectionModel(
                title=s.title, key=s.key, summary=s.summary,
                details=s.details, icon=s.icon,
            ) for s in report.sections
        ],
        overall_summary=report.overall_summary,
        confidence_score=report.confidence_score,
    )


@router.post("/generate/stream")
async def generate_allocation_stream(request: AllocationRequest, user: dict | None = Depends(get_optional_user)) -> StreamingResponse:
    """生成资产配置方案（SSE 流式） — 实时推送每步进度 + 支持取消"""

    progress_queue: queue.Queue = queue.Queue()
    cancel_event = threading.Event()

    def _progress_callback(step: int, total: int, name: str, status: str, detail: str):
        progress_queue.put({
            "type": "progress",
            "step": step, "total": total,
            "name": name, "status": status, "detail": detail,
        })

    def _run_pipeline():
        try:
            result = run_allocation(request, _progress_callback, cancel_event)
            payload = _response_payload(result)
            assert_json_finite(payload)
            progress_queue.put({"type": "result", "data": payload})
        except TaskCancelledError as e:
            msg = str(e) if str(e) else "任务已取消"
            progress_queue.put({"type": "cancelled", "message": msg})
        except Exception:
            error_id = uuid.uuid4().hex
            logger.exception("Stream allocation failed")
            progress_queue.put({
                "type": "error",
                "message": GENERIC_ALLOCATION_ERROR,
                "error_id": error_id,
            })

    thread = threading.Thread(target=_run_pipeline, daemon=True)
    thread.start()

    async def _event_stream() -> AsyncGenerator[str, None]:
        _start = asyncio.get_event_loop().time()
        _last_event = _start
        _heartbeat_interval = 3.0

        try:
            while thread.is_alive() or not progress_queue.empty():
                try:
                    msg = progress_queue.get(timeout=0.1)
                    _last_event = asyncio.get_event_loop().time()
                    yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    await asyncio.sleep(0.05)
                    now = asyncio.get_event_loop().time()
                    if now - _last_event >= _heartbeat_interval:
                        elapsed = int(now - _start)
                        yield f"data: {json.dumps({'type': 'heartbeat', 'elapsed': elapsed, 'message': '引擎仍在运行，正在等待下一步结果...'}, ensure_ascii=False)}\n\n"
                        _last_event = now
            yield "data: {\"type\": \"done\"}\n\n"
        except asyncio.CancelledError:
            cancel_event.set()
        finally:
            cancel_event.set()  # 确保客户端断开时取消后台线程

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/what-if", response_model=WhatIfResponse)
async def run_what_if_simulation(request: WhatIfRequest):
    """What-If模拟器 — 6个滑块实时调整参数查看影响"""
    # First run the base allocation
    base_result = await run_in_threadpool(run_allocation, request.base_request)

    # Then apply what-if adjustments
    params = WhatIfParams(
        base_allocations=base_result.saa.allocations,
        amount_multiplier=request.amount_multiplier,
        return_adjust=request.return_adjust,
        vol_multiplier=request.vol_multiplier,
        equity_shift=request.equity_shift,
        bond_duration_shift=request.bond_duration_shift,
        alt_shift=request.alt_shift,
    )
    result = run_what_if(base_result, params)
    return WhatIfResponse(
        modified_allocations=result.modified_allocations,
        expected_return=result.expected_return,
        expected_volatility=result.expected_volatility,
        sharpe_ratio=result.sharpe_ratio,
        max_drawdown=result.max_drawdown,
        equity_ratio=result.equity_ratio,
        delta_return=result.delta_return,
        delta_volatility=result.delta_volatility,
        delta_sharpe=result.delta_sharpe,
    )


@router.post("/backtest", response_model=BacktestResponse)
async def run_allocation_backtest(request: BacktestRequest, user: dict | None = Depends(get_optional_user)):
    """配置回测 — 回放SAA→TAA→熔断管线"""
    import asyncio
    try:
        result = await asyncio.wait_for(
            run_in_threadpool(run_backtest, request),
            timeout=180.0,  # 3分钟硬超时
        )
        return result
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="回测计算超时（3分钟），请缩小回测区间后重试")


BACKTEST_STREAM_STEPS = [
    ("backtest_prepare", "Validate request and initialize backtest"),
    ("historical_data", "Load ETF and macro history"),
    ("strategy_replay", "Replay SAA/TAA allocation rules"),
    ("metric_calculation", "Calculate returns, drawdowns, and risk metrics"),
    ("result_assembly", "Assemble backtest report"),
]


@router.post("/backtest/stream")
async def run_allocation_backtest_stream(request: BacktestRequest, user: dict | None = Depends(get_optional_user)) -> StreamingResponse:
    """Stream allocation backtest progress using the same SSE envelope as generation."""

    progress_queue: queue.Queue = queue.Queue()
    stage_state = {"index": 0}

    def _step_name(index: int) -> str:
        safe_index = max(0, min(index, len(BACKTEST_STREAM_STEPS) - 1))
        return BACKTEST_STREAM_STEPS[safe_index][0]

    def _put_progress(index: int, status: str, detail: str) -> None:
        stage_state["index"] = index
        name, _label = BACKTEST_STREAM_STEPS[index]
        progress_queue.put({
            "type": "progress",
            "step": index + 1,
            "total": len(BACKTEST_STREAM_STEPS),
            "name": name,
            "status": status,
            "detail": detail,
        })

    def _run_pipeline() -> None:
        try:
            _put_progress(0, "ok", "Request accepted")
            _put_progress(1, "running", "Loading historical fund and macro data")
            result = run_backtest(request)
            payload = _response_payload(result)
            assert_json_finite(payload)
            _put_progress(1, "ok", "Historical data loaded")
            _put_progress(2, "ok", "Strategy replay completed")
            _put_progress(3, "ok", "Risk and return metrics calculated")
            _put_progress(4, "ok", "Backtest report assembled")
            progress_queue.put({"type": "result", "data": payload})
        except Exception as exc:
            stage_index = stage_state["index"]
            message = str(exc) or "Backtest failed"
            logger.exception("Stream backtest failed at stage=%s", _step_name(stage_index))
            _put_progress(stage_index, "error", message[:180])
            progress_queue.put({
                "type": "error",
                "message": message,
                "stage": _step_name(stage_index),
                "retryable": True,
            })

    thread = threading.Thread(target=_run_pipeline, daemon=True)
    thread.start()

    async def _event_stream() -> AsyncGenerator[str, None]:
        _start = asyncio.get_event_loop().time()
        _last_event = _start
        _heartbeat_interval = 3.0
        _timeout_seconds = 180.0
        timed_out = False

        try:
            while thread.is_alive() or not progress_queue.empty():
                now = asyncio.get_event_loop().time()
                if thread.is_alive() and now - _start >= _timeout_seconds and not timed_out:
                    timed_out = True
                    stage_index = stage_state["index"]
                    timeout_message = "Backtest timed out after 3 minutes. Please shorten the date range and retry."
                    progress_queue.put({
                        "type": "progress",
                        "step": stage_index + 1,
                        "total": len(BACKTEST_STREAM_STEPS),
                        "name": _step_name(stage_index),
                        "status": "error",
                        "detail": timeout_message,
                    })
                    progress_queue.put({
                        "type": "error",
                        "message": timeout_message,
                        "stage": _step_name(stage_index),
                        "retryable": True,
                    })

                try:
                    msg = progress_queue.get(timeout=0.1)
                    _last_event = asyncio.get_event_loop().time()
                    yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
                    if timed_out and msg.get("type") == "error":
                        break
                except queue.Empty:
                    await asyncio.sleep(0.05)
                    now = asyncio.get_event_loop().time()
                    if now - _last_event >= _heartbeat_interval:
                        elapsed = int(now - _start)
                        yield f"data: {json.dumps({'type': 'heartbeat', 'elapsed': elapsed, 'message': 'Backtest is still running; waiting for the current stage to finish.'}, ensure_ascii=False)}\n\n"
                        _last_event = now
            yield "data: {\"type\": \"done\"}\n\n"
        except asyncio.CancelledError:
            logger.info("Backtest stream client disconnected")

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/fund-ranking", response_model=FundRankingResponse)
async def get_fund_ranking(request: FundRankingRequest):
    """基金选优排名 — 每个资产类别的候选基金多维度评分"""
    rankings_raw = await run_in_threadpool(get_all_rankings, request.preferred_tags)
    # Convert FundScore dataclass to FundRankingItem pydantic model
    rankings = {}
    for asset_class, scores in rankings_raw.items():
        rankings[asset_class] = [
            FundRankingItem(
                code=s.code, name=s.name, fund_type=s.fund_type,
                rank=s.rank, total_score=s.total_score,
                tracking_score=s.tracking_score, liquidity_score=s.liquidity_score,
                cost_score=s.cost_score, scale_score=s.scale_score,
                performance_score=s.performance_score,
                is_recommended=s.is_recommended, reasons=s.reasons,
                management_fee=_get_fee(s.code, "management_fee"),
                custody_fee=_get_fee(s.code, "custody_fee"),
                aum=_get_fee(s.code, "aum"),
                tracking_error=_get_fee(s.code, "tracking_error"),
                metadata_status=s.metadata_status,
                metadata_source=s.metadata_source,
                metadata_as_of=s.metadata_as_of,
                stale_days=s.stale_days,
            )
            for s in scores
        ]
    return FundRankingResponse(rankings=rankings)


def _get_fee(code: str, field: str) -> float:
    """Helper to get fund profile field from pool."""
    from ..allocation.fund_mapper import _FUND_POOL
    profile = _FUND_POOL.get(code)
    if profile:
        return getattr(profile, field, 0.0)
    return 0.0


@router.post("/rebalance-check", response_model=RebalanceCheckResponse)
async def check_rebalance(request: RebalanceCheckRequest):
    """再平衡检查 — 偏离度监控 + 触发规则 + 调仓建议"""
    suggestion = await run_in_threadpool(
        run_rebalance_check,
        request.target_allocations,
        request.current_allocations,
        request.risk_profile,
        request.total_amount,
        request.last_rebalance_date,
        request.regime_changed,
    )
    return RebalanceCheckResponse(
        suggestion_id=suggestion.suggestion_id,
        generated_at=suggestion.generated_at,
        risk_profile=suggestion.risk_profile,
        should_rebalance=suggestion.should_rebalance,
        urgency=suggestion.urgency,
        triggers=[
            RebalanceTriggerItem(
                trigger_type=t.trigger_type, description=t.description,
                triggered=t.triggered, details=t.details,
            ) for t in suggestion.triggers
        ],
        deviations=[
            RebalanceDeviationItem(
                name=d.name, target_weight=d.target_weight,
                current_weight=d.current_weight, deviation=d.deviation,
                deviation_pct=d.deviation_pct, is_group=d.is_group,
                severity=d.severity,
            ) for d in suggestion.deviations
        ],
        actions=[
            TradeActionItem(
                asset_class=a.asset_class, asset_label=a.asset_label,
                direction=a.direction, current_weight=a.current_weight,
                target_weight=a.target_weight, delta_weight=a.delta_weight,
                delta_amount=a.delta_amount, fund_code=a.fund_code,
                fund_name=a.fund_name, priority=a.priority,
            ) for a in suggestion.actions
        ],
        total_turnover=suggestion.total_turnover,
        estimated_cost=suggestion.estimated_cost,
        summary=suggestion.summary,
    )


@router.get("/rebalance-history", response_model=RebalanceHistoryResponse)
async def get_rebalance_history():
    """获取历史调仓记录"""
    # No persisted rebalance ledger exists yet. Return an empty real result
    # instead of synthetic history records.
    return RebalanceHistoryResponse(history=[])


@router.post("/share-selector", response_model=ShareSelectorResponse)
async def select_share_class(request: ShareSelectorRequest):
    """A/C份额智能选择 — 根据持有期限推荐A类或C类份额"""
    recs = batch_recommend(request.funds, request.holding_months, request.amount)

    # Build summary
    a_count = sum(1 for r in recs if r.recommended_share == "A")
    c_count = len(recs) - a_count
    default_count = sum(1 for r in recs if r.fee_source == "default_assumption")
    if not recs or default_count == len(recs):
        data_status = "missing"
    elif default_count > 0:
        data_status = "partial"
    else:
        data_status = "real"
    missing_reason = None
    if default_count:
        missing_reason = f"{default_count}/{len(recs)} 只基金缺少真实 A/C 份额费率档案，仅返回默认假设测算。"
    summary = f"共 {len(recs)} 只基金：测算A类 {a_count} 只，C类 {c_count} 只（持有 {request.holding_months:.0f} 个月）"
    if missing_reason:
        summary = f"{summary}；{missing_reason}"

    return ShareSelectorResponse(
        recommendations=[
            ShareRecommendationItem(
                fund_code=r.fund_code,
                fund_name=r.fund_name,
                recommended_share=r.recommended_share,
                reason=r.reason,
                breakeven_months=r.breakeven_months,
                total_cost_a=r.total_cost_a,
                total_cost_c=r.total_cost_c,
                savings=r.savings,
                fee_source=r.fee_source,
                missing_reason=r.missing_reason,
            ) for r in recs
        ],
        holding_months=request.holding_months,
        summary=summary,
        data_status=data_status,
        missing_reason=missing_reason,
    )


@router.post("/correlation-check", response_model=CorrelationCheckResponse)
async def check_correlation(request: CorrelationCheckRequest):
    """相关性约束检查 — 检测资产对相关性是否超过阈值"""
    result = check_correlation_constraints(request.allocations, request.threshold)
    suggestions = suggest_diversification(request.allocations, request.threshold)

    return CorrelationCheckResponse(
        max_correlation=result.max_correlation,
        max_pair=list(result.max_pair),
        threshold=result.threshold,
        passed=result.passed,
        violations=[
            CorrelationPairItem(
                asset_a=v.asset_a,
                asset_b=v.asset_b,
                correlation=v.correlation,
                exceeds_threshold=v.exceeds_threshold,
            ) for v in result.violations
        ],
        warnings=result.warnings,
        correlation_matrix=result.correlation_matrix,
        suggestions=suggestions,
    )


@router.post("/fee-analysis", response_model=FeeAnalysisResponse)
async def analyze_fund_fees(request: FeeAnalysisRequest):
    """费率评分分析 — 基金费率对比和效率评分"""
    analyses = batch_analyze_fees(request.funds, request.asset_class)
    recommendation = get_fee_recommendation(request.asset_class, holding_years=3)

    return FeeAnalysisResponse(
        analyses=[
            FeeAnalysisItem(
                fund_code=a.fund_code,
                fund_name=a.fund_name,
                asset_class=a.asset_class,
                management_fee=a.management_fee,
                custody_fee=a.custody_fee,
                sales_service_fee=a.sales_service_fee,
                subscription_fee=a.subscription_fee,
                total_expense_ratio=a.total_expense_ratio,
                fee_efficiency_score=a.fee_efficiency_score,
                category_avg_ter=a.category_avg_ter,
                fee_vs_category=a.fee_vs_category,
                cost_1y=a.cost_1y,
                cost_3y=a.cost_3y,
                cost_5y=a.cost_5y,
            ) for a in analyses
        ],
        asset_class=request.asset_class,
        recommendation=recommendation,
    )


@router.get("/pipeline-health")
async def pipeline_health():
    """管线健康报告 — per-step诊断、子系统状态、历史运行摘要"""
    return get_pipeline_health()


@router.post("/dual-engine")
async def dual_engine_compare(request: AllocationRequest):
    """双引擎对比 — v3 vs v4 并行运行，输出差异分析"""
    result = await run_in_threadpool(run_dual_comparison, request)
    return result
