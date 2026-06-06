"""Storage API — 配置方案存储与调仓历史管理"""
import uuid
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from starlette.concurrency import run_in_threadpool

from ..allocation.models import (
    SavePlanRequest, SavedPlanItem, PlanListResponse, UpdatePlanRequest,
    AddRebalanceRecordRequest, RebalanceStatsResponse,
    RebalanceHistoryItem, RebalanceHistoryResponse,
)
from ..storage.database import Database, UserStore
from ..allocation.report_generator import generate_allocation_report, generate_comparison_report
from ..allocation.alert_engine import (
    check_alerts, get_active_alerts, mark_alert_read, clear_alerts, DEFAULT_THRESHOLDS,
)

router = APIRouter(prefix="/storage", tags=["数据存储"])


def _get_current_user(request: Request) -> Optional[dict]:
    """从 cookie 或 Authorization header 解析当前登录用户。"""
    token = None
    # 1. 从 cookie 读取
    cookie = request.headers.get("cookie", "")
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith("kimi_sid="):
            token = part[len("kimi_sid="):]
            break
    # 2. 从 Authorization header 读取
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[len("bearer "):].strip()
    if not token:
        return None
    return UserStore.get_user_by_session(token)


def _require_user(request: Request) -> dict:
    """要求必须登录，否则 401。"""
    user = _get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    return user


# ─── Allocation Plans ───

@router.post("/plans", response_model=SavedPlanItem)
async def save_plan(req: SavePlanRequest, request: Request):
    """保存配置方案"""
    user = _require_user(request)
    plan_id = str(uuid.uuid4())[:8]

    def _save():
        Database.save_plan(
            plan_id=plan_id,
            name=req.name,
            request=req.request,
            response=req.response,
            risk_profile=req.request.get("risk_tolerance", "balanced"),
            description=req.description,
            owner_user_id=user["id"],
        )
        return Database.get_plan(plan_id, owner_user_id=user["id"])

    plan = await run_in_threadpool(_save)
    if plan:
        return SavedPlanItem(**plan)
    raise HTTPException(status_code=500, detail="Failed to save plan")


@router.get("/plans", response_model=PlanListResponse)
async def list_plans(
    request: Request,
    risk_profile: str | None = None,
    favorite_only: bool = False,
    limit: int = 50,
    offset: int = 0,
):
    """获取配置方案列表"""
    user = _require_user(request)
    def _list():
        plans = Database.list_plans(
            risk_profile=risk_profile,
            favorite_only=favorite_only,
            limit=limit,
            offset=offset,
            owner_user_id=user["id"],
        )
        total = Database.count_plans(risk_profile=risk_profile, owner_user_id=user["id"])
        return plans, total

    plans, total = await run_in_threadpool(_list)
    return PlanListResponse(
        plans=[SavedPlanItem(**p) for p in plans],
        total=total,
    )


@router.get("/plans/{plan_id}", response_model=SavedPlanItem)
async def get_plan(plan_id: str, request: Request):
    """获取单个配置方案"""
    user = _require_user(request)
    plan = await run_in_threadpool(Database.get_plan, plan_id, owner_user_id=user["id"])
    if plan:
        return SavedPlanItem(**plan)
    raise HTTPException(status_code=404, detail="Plan not found")


@router.patch("/plans/{plan_id}", response_model=SavedPlanItem)
async def update_plan(plan_id: str, req: UpdatePlanRequest, request: Request):
    """更新配置方案"""
    user = _require_user(request)
    def _update():
        success = Database.update_plan(
            plan_id=plan_id,
            name=req.name,
            description=req.description,
            is_favorite=req.is_favorite,
            is_archived=req.is_archived,
            owner_user_id=user["id"],
        )
        if not success:
            return None
        return Database.get_plan(plan_id, owner_user_id=user["id"])

    plan = await run_in_threadpool(_update)
    if plan:
        return SavedPlanItem(**plan)
    raise HTTPException(status_code=404, detail="Plan not found")


@router.delete("/plans/{plan_id}")
async def delete_plan(plan_id: str, request: Request):
    """删除配置方案"""
    user = _require_user(request)
    success = await run_in_threadpool(Database.delete_plan, plan_id, owner_user_id=user["id"])
    if success:
        return {"success": True}
    raise HTTPException(status_code=404, detail="Plan not found")


@router.post("/plans/{plan_id}/clone")
async def clone_plan(plan_id: str, request: Request, name: str = Query(default=None, description="新方案名称")):
    """克隆一个已保存的配置方案"""
    user = _require_user(request)
    plan = await run_in_threadpool(Database.get_plan, plan_id, owner_user_id=user["id"])
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    new_id = str(uuid.uuid4())[:8]
    clone_name = name or f"{plan.get('name', '方案')} (副本)"

    def _clone():
        Database.save_plan(
            plan_id=new_id,
            name=clone_name,
            request=plan["request"],
            response=plan["response"],
            risk_profile=plan.get("risk_profile", "balanced"),
            description=plan.get("description", ""),
            owner_user_id=user["id"],
        )
        return Database.get_plan(new_id, owner_user_id=user["id"])

    new_plan = await run_in_threadpool(_clone)
    return SavedPlanItem(**new_plan)


@router.get("/plans/compare-metrics")
async def compare_plan_metrics(
    request: Request,
    plan_ids: str = Query(..., description="方案ID列表(逗号分隔, 最多5个)"),
):
    """Compare performance metrics across multiple saved plans."""
    user = _require_user(request)
    from ..allocation.portfolio_tracker import compute_portfolio_performance, extract_weights_from_plan

    ids = [pid.strip() for pid in plan_ids.split(",")[:5]]

    def _compare():
        results = []
        for pid in ids:
            plan = Database.get_plan(pid, owner_user_id=user["id"])
            if not plan:
                continue
            weights = extract_weights_from_plan(plan["response"])
            if not weights:
                continue
            start_date = plan.get("created_at", "")[:10]
            perf = compute_portfolio_performance(weights=weights, start_date=start_date)
            if perf:
                results.append({
                    "plan_id": pid,
                    "plan_name": plan.get("name", "未命名"),
                    "risk_profile": plan.get("risk_profile", "balanced"),
                    "metrics": perf["metrics"],
                    "weights": perf["weights_used"],
                })
        return results

    results = await run_in_threadpool(_compare)
    return {"comparisons": results}


@router.post("/plans/batch-delete")
async def batch_delete_plans(request: Request, body: dict):
    """批量删除方案"""
    user = _require_user(request)
    plan_ids = body.get("plan_ids", [])
    if not plan_ids:
        raise HTTPException(status_code=400, detail="plan_ids required")

    def _batch():
        deleted = []
        for pid in plan_ids[:20]:  # Limit to 20
            if Database.delete_plan(pid, owner_user_id=user["id"]):
                deleted.append(pid)
        return deleted

    deleted = await run_in_threadpool(_batch)
    return {"deleted": deleted, "count": len(deleted)}


@router.post("/plans/batch-archive")
async def batch_archive_plans(request: Request, body: dict):
    """批量归档/取消归档方案"""
    user = _require_user(request)
    plan_ids = body.get("plan_ids", [])
    archive = body.get("archive", True)

    def _batch():
        updated = []
        for pid in plan_ids[:20]:
            if Database.update_plan(pid, is_archived=archive, owner_user_id=user["id"]):
                updated.append(pid)
        return updated

    updated = await run_in_threadpool(_batch)
    return {"updated": updated, "count": len(updated)}


# ─── Rebalance History ───

@router.post("/rebalance", response_model=dict)
async def add_rebalance_record(request: AddRebalanceRecordRequest):
    """添加调仓记录"""
    record_id = str(uuid.uuid4())[:8]

    def _add():
        Database.add_rebalance_record(
            record_id=record_id,
            risk_profile=request.risk_profile,
            trigger_type=request.trigger_type,
            actions=request.actions,
            total_turnover=request.total_turnover,
            estimated_cost=request.estimated_cost,
            status=request.status,
            summary=request.summary,
            notes=request.notes,
            plan_id=request.plan_id,
            executed_at=request.executed_at,
        )
        return {"id": record_id}

    return await run_in_threadpool(_add)


@router.get("/rebalance", response_model=RebalanceHistoryResponse)
async def list_rebalance_history(
    plan_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
):
    """获取调仓历史"""
    def _list():
        records = Database.list_rebalance_history(
            plan_id=plan_id,
            status=status,
            limit=limit,
        )
        return records

    records = await run_in_threadpool(_list)
    return RebalanceHistoryResponse(
        history=[
            RebalanceHistoryItem(
                entry_id=r["id"],
                executed_at=r["executed_at"],
                risk_profile=r["risk_profile"],
                trigger_type=r["trigger_type"],
                actions_count=len(r["actions"]),
                total_turnover=r["total_turnover"],
                estimated_cost=r["estimated_cost"],
                status=r["status"],
                summary=r["summary"],
            )
            for r in records
        ]
    )


@router.get("/rebalance/stats", response_model=RebalanceStatsResponse)
async def get_rebalance_stats():
    """获取调仓统计"""
    stats = await run_in_threadpool(Database.get_rebalance_stats)
    return RebalanceStatsResponse(**stats)


# ─── Report Generation ───

@router.get("/report/{plan_id}", response_class=HTMLResponse)
async def generate_plan_report(plan_id: str, request: Request):
    """生成配置方案报告 (HTML)"""
    user = _require_user(request)
    plan = await run_in_threadpool(Database.get_plan, plan_id, owner_user_id=user["id"])
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    html = await run_in_threadpool(generate_allocation_report, plan["response"])
    return HTMLResponse(content=html)


@router.get("/report/compare", response_class=HTMLResponse)
async def generate_comparison_report_endpoint(
    request: Request,
    plan_ids: str = Query(..., description="方案ID列表(逗号分隔)"),
):
    """生成方案对比报告 (HTML)"""
    user = _require_user(request)
    def _get_plans():
        plans = []
        for pid in plan_ids.split(",")[:5]:  # 最多对比5个方案
            plan = Database.get_plan(pid.strip(), owner_user_id=user["id"])
            if plan:
                plans.append(plan)
        return plans

    plans = await run_in_threadpool(_get_plans)
    if not plans:
        raise HTTPException(status_code=404, detail="No valid plans found")
    html = await run_in_threadpool(generate_comparison_report, plans)
    return HTMLResponse(content=html)


# ─── Portfolio Performance Tracking ───

@router.get("/portfolio/track/{plan_id}")
async def track_portfolio_performance(plan_id: str):
    """Track realized portfolio performance for a saved plan.

    Fetches actual ETF NAV data and computes cumulative returns,
    drawdown, and performance metrics.
    """
    plan = await run_in_threadpool(Database.get_plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    from ..allocation.portfolio_tracker import compute_portfolio_performance, extract_weights_from_plan

    def _compute():
        response = plan["response"]
        weights = extract_weights_from_plan(response)
        if not weights:
            return {"error": "No allocation weights found in plan"}

        start_date = plan.get("created_at", "")[:10]
        if not start_date:
            from datetime import datetime
            start_date = datetime.now().strftime("%Y-%m-%d")

        result = compute_portfolio_performance(
            weights=weights,
            start_date=start_date,
        )
        return result

    result = await run_in_threadpool(_compute)
    if result is None:
        raise HTTPException(status_code=500, detail="Failed to compute performance (insufficient data)")
    return result


@router.post("/portfolio/track")
async def track_custom_performance(body: dict):
    """Track performance for custom weights (no saved plan needed)."""
    from ..allocation.portfolio_tracker import compute_portfolio_performance

    weights = body.get("weights", {})
    start_date = body.get("start_date", "2023-01-01")
    end_date = body.get("end_date")
    initial_capital = body.get("initial_capital", 1_000_000)

    if not weights:
        raise HTTPException(status_code=400, detail="weights required")

    def _compute():
        return compute_portfolio_performance(
            weights=weights,
            start_date=start_date,
            end_date=end_date,
            initial_capital=initial_capital,
        )

    result = await run_in_threadpool(_compute)
    if result is None:
        raise HTTPException(status_code=500, detail="Failed to compute performance")
    return result


# ─── Alert / Notification ───

@router.post("/alerts/check")
async def check_portfolio_alerts(body: dict):
    """Check portfolio state against alert thresholds.

    Accepts target/current weights, portfolio return, vol ratio,
    and last rebalance date; returns triggered alerts.
    """
    target_weights = body.get("target_weights", {})
    if not target_weights:
        raise HTTPException(status_code=400, detail="target_weights required")

    current_weights = body.get("current_weights")
    portfolio_return = body.get("portfolio_return")
    vol_ratio = body.get("vol_ratio")
    last_rebalance_date = body.get("last_rebalance_date")
    thresholds = body.get("thresholds")

    alerts = await run_in_threadpool(
        check_alerts,
        target_weights=target_weights,
        current_weights=current_weights,
        portfolio_return=portfolio_return,
        vol_ratio=vol_ratio,
        last_rebalance_date=last_rebalance_date,
        thresholds=thresholds,
    )
    return {
        "alerts": alerts,
        "count": len(alerts),
        "thresholds_used": {**DEFAULT_THRESHOLDS, **(thresholds or {})},
    }


@router.post("/alerts/check/{plan_id}")
async def check_plan_alerts(plan_id: str, body: dict = None):
    """Check alerts for a saved plan automatically.

    Loads the plan's target weights and computes current state from
    portfolio tracker, then runs alert checks.
    """
    from ..allocation.portfolio_tracker import compute_portfolio_performance, extract_weights_from_plan

    plan = await run_in_threadpool(Database.get_plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    body = body or {}
    thresholds = body.get("thresholds")

    def _check():
        response = plan["response"]
        target_weights = extract_weights_from_plan(response)
        if not target_weights:
            return {"error": "No allocation weights found in plan", "alerts": []}

        start_date = plan.get("created_at", "")[:10]
        perf = compute_portfolio_performance(weights=target_weights, start_date=start_date)

        current_weights = None
        portfolio_return = None
        if perf:
            portfolio_return = perf["metrics"].get("cumulative_return", 0) * 100
            contributions = perf.get("asset_contributions", {})
            if contributions:
                total_val = sum(abs(v.get("current_value", 0)) for v in contributions.values())
                if total_val > 0:
                    current_weights = {
                        k: abs(v.get("current_value", 0)) / total_val
                        for k, v in contributions.items()
                    }

        records = Database.list_rebalance_history(plan_id=plan_id, limit=1)
        last_rebal = records[0]["executed_at"] if records else None

        alerts = check_alerts(
            target_weights=target_weights,
            current_weights=current_weights,
            portfolio_return=portfolio_return,
            last_rebalance_date=last_rebal,
            thresholds=thresholds,
        )
        return {
            "plan_id": plan_id,
            "plan_name": plan.get("name", ""),
            "alerts": alerts,
            "count": len(alerts),
            "portfolio_return": portfolio_return,
        }

    return await run_in_threadpool(_check)


@router.get("/alerts")
async def list_alerts():
    """Get all active (unread) alerts."""
    alerts = await run_in_threadpool(get_active_alerts)
    return {
        "alerts": alerts,
        "count": len(alerts),
        "unread_critical": sum(1 for a in alerts if a.get("severity") == "critical"),
        "unread_warning": sum(1 for a in alerts if a.get("severity") == "warning"),
    }


@router.post("/alerts/{alert_id}/read")
async def mark_read(alert_id: str):
    """Mark a specific alert as read."""
    success = await run_in_threadpool(mark_alert_read, alert_id)
    if success:
        return {"success": True, "alert_id": alert_id}
    raise HTTPException(status_code=404, detail="Alert not found")


@router.post("/alerts/clear")
async def clear_all_alerts():
    """Clear all alerts (both read and unread)."""
    await run_in_threadpool(clear_alerts)
    return {"success": True}


@router.get("/alerts/thresholds")
async def get_alert_thresholds():
    """Get current default alert thresholds."""
    return {"thresholds": DEFAULT_THRESHOLDS}
