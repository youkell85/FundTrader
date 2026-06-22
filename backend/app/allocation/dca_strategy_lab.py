from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from .models import DcaStrategyLabRequest, DcaStrategyLabResponse, DcaStrategyScore, EvidenceRef, FusionDataQuality
from ..services.dca_strategies import SUPPORTED_STRATEGIES, bounded_rolling_start_dates, fetch_real_nav_history, run_strategy_compare
from ..storage.database import get_db


def _metric(strategy_result: dict, *names: str) -> float | None:
    for name in names:
        value = strategy_result.get(name)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
    return None


def _score(strategy_id: str, strategy_result: dict, rank: int | None = None) -> DcaStrategyScore:
    annual_return = _metric(strategy_result, "annual_return", "annualized_return", "total_return")
    max_drawdown = _metric(strategy_result, "max_drawdown")
    sharpe = _metric(strategy_result, "sharpe_ratio", "sharpe")
    volatility = _metric(strategy_result, "volatility")
    raw = 50.0
    if annual_return is not None:
        raw += min(30, max(-30, annual_return))
    if max_drawdown is not None:
        raw -= min(25, abs(max_drawdown) * 0.8)
    if sharpe is not None:
        raw += min(20, max(-10, sharpe * 10))
    return DcaStrategyScore(
        strategy_id=strategy_id,
        strategy_type=strategy_id,
        annualized_return=annual_return,
        volatility=volatility,
        max_drawdown=max_drawdown,
        sharpe_ratio=sharpe,
        score=round(max(0, min(100, raw)), 2),
        rank=rank,
        data_quality=FusionDataQuality(status="real", source="dca_service", coverage=1.0, confidence=0.75),
    )


def _persist_run(request: DcaStrategyLabRequest, response: DcaStrategyLabResponse) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO dca_strategy_runs
                (id, owner_user_id, codes_json, request_json, result_summary_json,
                 data_status, missing_reason, evidence_refs_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                response.run_id,
                request.owner_user_id,
                json.dumps(request.fund_codes, ensure_ascii=False),
                json.dumps(request.model_dump(), ensure_ascii=False),
                json.dumps(response.model_dump(), ensure_ascii=False),
                response.data_quality.status,
                response.data_quality.missing_reason,
                json.dumps([ref.model_dump() for ref in response.evidence_refs], ensure_ascii=False),
                datetime.now(UTC).isoformat(),
            ),
        )


def run_dca_strategy_lab(request: DcaStrategyLabRequest) -> DcaStrategyLabResponse:
    run_id = uuid.uuid4().hex
    if not request.fund_codes:
        response = DcaStrategyLabResponse(
            run_id=run_id,
            scores=[],
            data_quality=FusionDataQuality(status="missing", source="dca_strategy_lab", missing_reason="fund_codes is empty"),
            warnings=["未提供基金代码。"],
        )
        _persist_run(request, response)
        return response

    code = request.fund_codes[0]
    nav = fetch_real_nav_history(code, request.start_date, request.end_date)
    if not nav:
        response = DcaStrategyLabResponse(
            run_id=run_id,
            scores=[],
            data_quality=FusionDataQuality(status="missing", source="fund_nav_history", missing_reason=f"{code} 缺少真实净值数据"),
            warnings=["缺少真实净值，未生成策略评分。"],
        )
        _persist_run(request, response)
        return response

    rolling_starts = bounded_rolling_start_dates(nav, max_windows=36)
    result = run_strategy_compare(code, request.monthly_amount, request.start_date, request.end_date)
    strategies = result.get("strategies") if isinstance(result, dict) else None
    if not isinstance(strategies, dict):
        response = DcaStrategyLabResponse(
            run_id=run_id,
            scores=[],
            data_quality=FusionDataQuality(status="missing", source="dca_service", missing_reason=str(result.get("error") if isinstance(result, dict) else "strategy result unavailable")),
            warnings=["定投策略结果不可用。"],
        )
        _persist_run(request, response)
        return response

    allowed = set(request.strategy_types or SUPPORTED_STRATEGIES)
    scored = [_score(name, value) for name, value in strategies.items() if name in allowed and isinstance(value, dict)]
    scored.sort(key=lambda item: item.score, reverse=True)
    for idx, item in enumerate(scored, start=1):
        item.rank = idx
    best = scored[0].strategy_id if scored else None
    response = DcaStrategyLabResponse(
        run_id=run_id,
        scores=scored,
        best_strategy_id=best,
        data_quality=FusionDataQuality(status="real", source="fund_nav_history+dca_service", coverage=1.0, confidence=0.75),
        evidence_refs=[
            EvidenceRef(
                source="fund_nav_history",
                as_of=nav[-1]["date"],
                description=f"{code} NAV rows={len(nav)}, rolling_starts={len(rolling_starts)} (max 36)",
                confidence=0.8,
            )
        ],
        warnings=["历史区间适配度分析，不构成收益承诺。"],
    )
    _persist_run(request, response)
    return response
