"""资产配置API"""
import asyncio
import json
import logging
import queue
import threading
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

from ..allocation.models import (
    AllocationRequest, AllocationResponse,
    FundRankingRequest, FundRankingResponse, FundRankingItem,
    RebalanceCheckRequest, RebalanceCheckResponse,
    RebalanceDeviationItem, RebalanceTriggerItem, TradeActionItem,
    RebalanceHistoryResponse, RebalanceHistoryItem,
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
from ..allocation.rebalancer import run_rebalance_check, get_mock_history

router = APIRouter(prefix="/allocation", tags=["资产配置"])


@router.post("/generate", response_model=AllocationResponse)
async def generate_allocation(request: AllocationRequest):
    """生成资产配置方案 — 14步量化管线"""
    try:
        result = await run_in_threadpool(run_allocation, request)
        return result
    except Exception as e:
        logger.exception("Allocation pipeline crashed")
        health = get_pipeline_health()
        raise HTTPException(
            status_code=500,
            detail={
                "error": "配置生成失败",
                "message": str(e)[:200],
                "pipeline_health": health.get("health", "unknown"),
                "failed_steps": health.get("failed_steps", []),
                "degraded_steps": health.get("degraded_steps", []),
            },
        )


@router.post("/variants", response_model=VariantsResponse)
async def generate_allocation_variants(request: AllocationRequest):
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
async def generate_allocation_stream(request: AllocationRequest) -> StreamingResponse:
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
            progress_queue.put({"type": "result", "data": result.model_dump()})
        except TaskCancelledError:
            progress_queue.put({"type": "cancelled", "message": "任务已取消"})
        except Exception as e:
            logger.exception("Stream allocation failed")
            progress_queue.put({"type": "error", "message": str(e)[:300]})

    thread = threading.Thread(target=_run_pipeline, daemon=True)
    thread.start()

    async def _event_stream() -> AsyncGenerator[str, None]:
        try:
            while thread.is_alive() or not progress_queue.empty():
                try:
                    msg = progress_queue.get(timeout=0.1)
                    yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    await asyncio.sleep(0.05)
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
async def run_allocation_backtest(request: BacktestRequest):
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
    history = await run_in_threadpool(get_mock_history)
    return RebalanceHistoryResponse(
        history=[
            RebalanceHistoryItem(
                entry_id=h.entry_id, executed_at=h.executed_at,
                risk_profile=h.risk_profile, trigger_type=h.trigger_type,
                actions_count=h.actions_count, total_turnover=h.total_turnover,
                estimated_cost=h.estimated_cost, status=h.status,
                summary=h.summary,
            ) for h in history
        ]
    )


@router.post("/share-selector", response_model=ShareSelectorResponse)
async def select_share_class(request: ShareSelectorRequest):
    """A/C份额智能选择 — 根据持有期限推荐A类或C类份额"""
    recs = batch_recommend(request.funds, request.holding_months, request.amount)

    # Build summary
    a_count = sum(1 for r in recs if r.recommended_share == "A")
    c_count = len(recs) - a_count
    summary = f"共 {len(recs)} 只基金：推荐A类 {a_count} 只，C类 {c_count} 只（持有 {request.holding_months:.0f} 个月）"

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
            ) for r in recs
        ],
        holding_months=request.holding_months,
        summary=summary,
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
