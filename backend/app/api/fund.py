"""基金排名筛选API"""
import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..constants.guoyuan_funds import FUND_CATEGORIES, FUND_TYPES, GUOYUAN_FUND_LIST
from ..services.analysis_service import ensure_exchange_fund_holdings_snapshot
from ..services.fund_service import (
    compute_category_metrics_1y,
    ensure_exchange_fund_snapshot,
    ensure_report_asset_allocation_snapshot,
    get_fund_list,
    get_fund_list_from_watchlist,
    needs_exchange_fund_snapshot_refresh,
)
from ..services.llm_service import call_astorn_llm

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fund", tags=["基金排名筛选"])


class FundAgentPlanRequest(BaseModel):
    template: str = Field(default="single_fund_diagnosis")
    code: str = Field(..., min_length=4, max_length=10)
    context: dict | None = None

# ── 排序参数白名单 ──
ALLOWED_SORT_FIELDS = frozenset({
    "今年来", "近1月", "近3月", "近6月", "近1年", "近3年",
    "ytd", "day_growth", "nav", "near_1m", "near_3m",
    "near_6m", "near_1y", "near_3y", "code", "name", "type",
})
ALLOWED_SORT_ORDERS = frozenset({"asc", "desc"})

DEFAULT_CATEGORY = "全部"
DEFAULT_SORT_BY = "今年来"
DEFAULT_SORT_ORDER = "desc"
DEFAULT_TAG = "鑫基荟"

FUND_DETAIL_FIELD_GROUPS = {
    "basic": {
        "fields": ["name", "type", "company", "manager", "establish_date", "benchmark"],
        "source": "tushare.fund_basic/fund_master",
        "fallback": "eastmoney/efinance/sqlite",
        "section": "overview",
    },
    "nav": {
        "fields": ["nav", "adj_nav", "daily_return", "nav_date"],
        "source": "tushare.fund_nav/efinance",
        "fallback": "TickFlow for ETF",
        "section": "performance",
    },
    "scale": {
        "fields": ["fund_scale", "fund_share", "share_date"],
        "source": "tushare.fund_share*tushare.fund_nav",
        "fallback": "eastmoney/sqlite",
        "section": "scaleHistory",
    },
    "holdings": {
        "fields": ["top_holdings", "industry_exposure"],
        "source": "tushare.fund_portfolio",
        "fallback": "eastmoney periodic report pdf",
        "section": "holdings",
    },
    "bondHoldings": {
        "fields": ["bond_name", "bond_code", "bond_nav_ratio", "bond_coupon_rate", "bond_issuer", "bond_type", "bond_credit_rating"],
        "source": "akshare.fund_portfolio_bond_hold_em/eastmoney periodic report pdf",
        "fallback": "confirmed empty periodic report",
        "section": "bondHoldings",
    },
    "dividend": {
        "fields": ["dividend_date", "dividend_amount", "registration_date"],
        "source": "tushare.fund_div",
        "fallback": "eastmoney/sqlite",
        "section": "performance",
    },
    "rating": {
        "fields": ["rating", "rating_org", "rating_date"],
        "source": "tushare.fund_rating",
        "fallback": "fund_metrics_snapshot score",
        "section": "rating",
    },
    "purchase": {
        "fields": ["purchase_limit", "fee_rate", "redemption_fee"],
        "source": "eastmoney sales document",
        "fallback": "fund_metrics_snapshot fee partial",
        "section": "purchaseInfo",
    },
    "risk": {
        "fields": ["volatility", "max_drawdown", "sharpe", "tracking_error"],
        "source": "local nav metrics/ifind",
        "fallback": "historical cache",
        "section": "riskSummary",
    },
}


def _field_sources_from_sections(sections: dict[str, dict]) -> dict[str, dict]:
    field_sources: dict[str, dict] = {}
    for group, config in FUND_DETAIL_FIELD_GROUPS.items():
        section_key = config["section"]
        section = sections.get(section_key, {})
        for field in config["fields"]:
            field_sources[field] = {
                "field": field,
                "group": group,
                "source": section.get("source") or config["source"],
                "preferredSource": config["source"],
                "fallback": config["fallback"],
                "asOf": section.get("asOf"),
                "status": section.get("dataStatus", "missing"),
                "coverage": section.get("coverage", 0.0),
                "missingReason": section.get("missingReason"),
            }
    return field_sources


def _detail_rows_payload(code: str, data, *, default_reason: str = "") -> dict:
    if isinstance(data, dict):
        return {"code": code, **data}
    rows = data if isinstance(data, list) else []
    return {
        "code": code,
        "rows": rows,
        "dataStatus": "available" if rows else "missing",
        "source": None,
        "asOf": None,
        "coverage": 1.0 if rows else 0.0,
        "missingReason": None if rows else default_reason,
    }


def _empty_rows_payload(code: str, error: Exception, reason: str) -> dict:
    return {
        "code": code,
        "rows": [],
        "dataStatus": "missing",
        "source": None,
        "asOf": None,
        "coverage": 0.0,
        "missingReason": reason,
        "error": str(error)[:120],
    }


def _rating_score_fallback(code: str) -> dict | None:
    try:
        from ..storage.database import get_db_context

        with get_db_context() as conn:
            row = conn.execute(
                """SELECT score, updated_at AS as_of
                   FROM fund_metrics_snapshot
                   WHERE code = ? AND score IS NOT NULL
                   ORDER BY updated_at DESC LIMIT 1""",
                (code,),
            ).fetchone()
    except Exception:
        return None
    if not row:
        return None
    score = row["score"]
    if score is None:
        return None
    try:
        score_value = float(score)
    except Exception:
        score_value = None
    if score_value is None:
        return None
    if score_value <= 5:
        star = None
    else:
        star = None
    return {
        "code": code,
        "rating3y": star,
        "rating5y": star,
        "score": score,
        "source": "fund_metrics_snapshot",
        "dataStatus": "partial",
        "asOf": row["as_of"],
        "coverage": 0.5,
        "missingReason": "缺少真实评级星级，仅返回本地指标分数。",
    }


@router.get("/list")
async def fund_list(
    category: str = Query(DEFAULT_CATEGORY, description="基金类型"),
    tag: str | None = Query(None, description="标签筛选"),
    keyword: str | None = Query(None, description="关键词搜索"),
    sort_by: str = Query(DEFAULT_SORT_BY, description="排序字段"),
    sort_order: str = Query(DEFAULT_SORT_ORDER, description="排序方向"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=5000, description="每页数量"),
    guoyuan_only: bool = Query(True, description="仅国元名单"),
    use_watchlist: bool = Query(False, description="使用自选基金列表"),
):
    if sort_by not in ALLOWED_SORT_FIELDS:
        raise HTTPException(400, f"不支持的排序字段: {sort_by}")
    if sort_order not in ALLOWED_SORT_ORDERS:
        raise HTTPException(400, f"不支持的排序方向: {sort_order}")
    if use_watchlist:
        return await run_in_threadpool(
            get_fund_list_from_watchlist,
            category,
            tag,
            keyword,
            sort_by,
            sort_order,
            page,
            page_size,
        )
    return await run_in_threadpool(
        get_fund_list,
        category,
        tag,
        keyword,
        sort_by,
        sort_order,
        page,
        page_size,
        guoyuan_only,
    )


@router.get("/categories")
async def fund_categories():
    return {"categories": FUND_CATEGORIES, "types": FUND_TYPES}


@router.get("/snapshot/list")
async def fund_snapshot_list(
    category: str = Query(DEFAULT_CATEGORY),
    keyword: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=5000),
    xinjihui_only: bool = Query(True),
    sort_by: str = Query("ytd"),
    sort_order: str = Query(DEFAULT_SORT_ORDER),
):
    if sort_by not in ALLOWED_SORT_FIELDS:
        raise HTTPException(400, f"不支持的排序字段: {sort_by}")
    if sort_order not in ALLOWED_SORT_ORDERS:
        raise HTTPException(400, f"不支持的排序方向: {sort_order}")
    """Read paged fund quote snapshots from SQLite only."""
    from ..storage.database import FundDataStore

    result = await run_in_threadpool(
        FundDataStore.list_snapshots,
        category,
        keyword,
        xinjihui_only,
        page_size,
        (page - 1) * page_size,
        sort_by,
        sort_order,
    )
    return {
        "total": result["total"],
        "page": page,
        "page_size": page_size,
        "funds": result["funds"],
    }


@router.get("/snapshot/{code}")
async def fund_snapshot_detail(code: str, enqueue_missing: bool = Query(True)):
    """Return a local fund snapshot and optionally enqueue a backfill job."""
    from ..storage.database import FundDataStore

    snapshot = await run_in_threadpool(FundDataStore.get_snapshot, code)
    if needs_exchange_fund_snapshot_refresh(snapshot):
        exchange_snapshot = await run_in_threadpool(ensure_exchange_fund_snapshot, code)
        if exchange_snapshot:
            snapshot = exchange_snapshot
    if snapshot and (not snapshot.get("holdings") or not snapshot.get("asset_allocation")):
        holdings_snapshot = await run_in_threadpool(ensure_exchange_fund_holdings_snapshot, code)
        if holdings_snapshot:
            snapshot = holdings_snapshot
    if snapshot and not snapshot.get("asset_allocation"):
        asset_snapshot = await run_in_threadpool(ensure_report_asset_allocation_snapshot, code)
        if asset_snapshot:
            snapshot = asset_snapshot
    job_id = None
    if enqueue_missing and (not snapshot or snapshot.get("data_quality") in {"partial", "missing", "unknown"}):
        job_id = await run_in_threadpool(
            FundDataStore.create_job,
            "single_fund_backfill",
            code,
            {"reason": "snapshot_detail_missing"},
            8,
        )
    if not snapshot:
        return {
            "code": code,
            "data_quality": "missing",
            "stale_level": "missing",
            "job_id": job_id,
        }
    return {**snapshot, "job_id": job_id}


@router.get("/metrics/{code}")
async def fund_metrics_snapshot(code: str):
    """Return local metrics fields from the snapshot facade."""
    from ..storage.database import FundDataStore

    snapshot = await run_in_threadpool(FundDataStore.get_snapshot, code)
    if not snapshot:
        return {"code": code, "data_quality": "missing"}
    return {
        "code": code,
        "sharpe_ratio": snapshot.get("sharpe_ratio"),
        "max_drawdown": snapshot.get("max_drawdown"),
        "annualized_return": snapshot.get("annualized_return"),
        "volatility": snapshot.get("volatility"),
        "score": snapshot.get("score"),
        "feeManage": snapshot.get("feeManage"),
        "feeCustody": snapshot.get("feeCustody"),
        "total_scale": snapshot.get("total_scale"),
        "updated_at": snapshot.get("metrics_updated_at"),
        "data_quality": snapshot.get("data_quality"),
    }


@router.get("/detail-completeness")
async def fund_detail_completeness(code: str = Query(..., min_length=4, max_length=10, description="基金代码")):
    """Return local real-data coverage by detail-page section without external fetches.

    Each section returns the full contract:
      { dataStatus, missingReason, source, asOf, coverage }
    """
    from ..storage.database import FundDataStore, get_db_context

    snapshot = await run_in_threadpool(FundDataStore.get_snapshot, code)
    if needs_exchange_fund_snapshot_refresh(snapshot):
        exchange_snapshot = await run_in_threadpool(ensure_exchange_fund_snapshot, code)
        if exchange_snapshot:
            snapshot = exchange_snapshot
    if snapshot and (not snapshot.get("holdings") or not snapshot.get("asset_allocation")):
        holdings_snapshot = await run_in_threadpool(ensure_exchange_fund_holdings_snapshot, code)
        if holdings_snapshot:
            snapshot = holdings_snapshot
    if snapshot and not snapshot.get("asset_allocation"):
        asset_snapshot = await run_in_threadpool(ensure_report_asset_allocation_snapshot, code)
        if asset_snapshot:
            snapshot = asset_snapshot

    # ---- stale helpers -------------------------------------------------------
    # 交易日场景下净值/净值快照通常有周末或节假日间断，避免将近期无更新误判为脏数据。
    # 使用较宽松窗口减少误报 stale，优先保障页面“可展示”能力。
    NAV_STALE_HOURS = 168
    QUOTE_STALE_HOURS = 168
    METRICS_STALE_DAYS = 180
    QUARTERLY_STALE_DAYS = 180

    def is_stale(dt_str: str | None, *, hours: int | None = None, days: int | None = None) -> bool:
        if not dt_str:
            return False
        try:
            dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            now = datetime.now(dt.tzinfo)
            if hours is not None:
                return (now - dt).total_seconds() > hours * 3600
            if days is not None:
                return (now - dt).total_seconds() > days * 86400
            return False
        except Exception:
            return False

    nav_date = snapshot.get("nav_date") if snapshot else None
    if snapshot is None or (snapshot and (not snapshot.get("nav_data") or len(snapshot.get("nav_data") or []) < 2)):
        from ..services.fund_service import _get_nav_history_for_detail
        fallback_nav_rows, fallback_nav_source, fallback_nav_as_of = await run_in_threadpool(
            _get_nav_history_for_detail,
            code,
        )
        if len(fallback_nav_rows) >= 2:
            if not snapshot:
                snapshot = {}
            snapshot = {
                **snapshot,
                "nav_data": fallback_nav_rows,
                "source": fallback_nav_source or snapshot.get("source") if snapshot else fallback_nav_source,
            }
            if fallback_nav_as_of:
                snapshot["nav_date"] = fallback_nav_as_of
    nav_date = snapshot.get("nav_date") if snapshot else nav_date
    nav_stale = is_stale(nav_date, hours=NAV_STALE_HOURS)

    # ---- DB queries ----------------------------------------------------------
    try:
        with get_db_context() as conn:
            quarterly = conn.execute(
                """SELECT
                      SUM(CASE WHEN holder_structure_json IS NOT NULL AND holder_structure_json != '' AND holder_structure_json != '[]' THEN 1 ELSE 0 END) AS holder_count,
                      SUM(CASE WHEN bond_allocation_json IS NOT NULL AND bond_allocation_json != '' AND bond_allocation_json != '[]' THEN 1 ELSE 0 END) AS bond_alloc_count,
                      SUM(CASE WHEN bond_holdings_json IS NOT NULL AND bond_holdings_json != '' AND bond_holdings_json != '[]' THEN 1 ELSE 0 END) AS bond_hold_count,
                      SUM(CASE WHEN total_scale IS NOT NULL THEN 1 ELSE 0 END) AS scale_count,
                      SUM(CASE WHEN turnover_rate IS NOT NULL THEN 1 ELSE 0 END) AS turnover_count,
                      MAX(updated_at) AS quarterly_updated
                   FROM fund_detail_quarterly_snapshot
                   WHERE code = ?""",
                (code,),
            ).fetchone()
            manager_count = conn.execute(
                "SELECT COUNT(*) AS c FROM fund_manager_history_snapshot WHERE code = ?",
                (code,),
            ).fetchone()["c"]
            report_count = conn.execute(
                "SELECT COUNT(*) AS c FROM fund_report_snapshot WHERE code = ? AND report_text != ''",
                (code,),
            ).fetchone()["c"]
            rating_row = conn.execute(
                "SELECT score, metrics_updated_at FROM fund_metrics_snapshot WHERE code = ? AND score IS NOT NULL",
                (code,),
            ).fetchone()
            rating_count = 1 if rating_row else 0
            purchase_row = conn.execute(
                "SELECT fee_manage, fee_custody, metrics_updated_at FROM fund_metrics_snapshot WHERE code = ? AND (fee_manage IS NOT NULL OR fee_custody IS NOT NULL)",
                (code,),
            ).fetchone()
            purchase_count = 1 if purchase_row else 0
            quote_row = conn.execute(
                "SELECT near_1y, near_3y, updated_at FROM fund_quote_snapshot WHERE code = ?",
                (code,),
            ).fetchone()
    except Exception:
        quarterly = None
        manager_count = 0
        report_count = 0
        rating_row = None
        purchase_row = None
        quote_row = None
        purchase_count = 0
        rating_count = 0

    # ---- raw counts ----------------------------------------------------------
    nav_count = len(snapshot.get("nav_data") or []) if snapshot else 0
    holdings_count = len(snapshot.get("holdings") or []) if snapshot else 0
    asset_count = len(snapshot.get("asset_allocation") or []) if snapshot else 0

    # ---- JSON depth validation -----------------------------------------------
    # SQL counts only check if JSON columns are non-empty strings;
    # we also need to verify the JSON is parseable and contains required fields.
    def _validate_json_field(code: str, field: str) -> int:
        """Check JSON field is parseable and contains non-empty list."""
        import json as _json
        try:
            with get_db_context() as vconn:
                rows = vconn.execute(
                    f"SELECT {field} FROM fund_detail_quarterly_snapshot "
                    f"WHERE code = ? AND {field} IS NOT NULL AND {field} != ''",
                    (code,),
                ).fetchall()
            count = 0
            for row in rows:
                try:
                    parsed = _json.loads(row[field])
                    if isinstance(parsed, list) and len(parsed) > 0:
                        count += 1
                except (_json.JSONDecodeError, TypeError):
                    pass
            return count
        except Exception:
            return 0

    # peerPerformance: quote has priority; nav_count>=250 is fallback
    quote_has_peer_data = quote_row is not None and (quote_row.get("near_1y") is not None or quote_row.get("near_3y") is not None)
    peer_has_data = quote_has_peer_data or nav_count >= 250
    quote_updated = quote_row.get("updated_at") if quote_row else None
    quote_stale = is_stale(quote_updated, hours=QUOTE_STALE_HOURS)

    # riskSummary: metrics snapshot has priority; nav_count>=30 is fallback
    metrics_has_risk_data = snapshot is not None and (
        snapshot.get("max_drawdown") is not None
        or snapshot.get("sharpe_ratio") is not None
        or snapshot.get("volatility") is not None
    )
    risk_has_data = metrics_has_risk_data or nav_count >= 30
    risk_partial = (not metrics_has_risk_data) and nav_count >= 30

    def qcount(name: str) -> int:
        try:
            return int(quarterly[name] or 0) if quarterly else 0
        except Exception:
            return 0

    holder_count = _validate_json_field(code, "holder_structure_json") or qcount("holder_count")
    scale_count = qcount("scale_count")
    turnover_count = qcount("turnover_count")
    bond_alloc_count = _validate_json_field(code, "bond_allocation_json") or qcount("bond_alloc_count")
    bond_hold_count = _validate_json_field(code, "bond_holdings_json") or qcount("bond_hold_count")

    # ---- asOf sources --------------------------------------------------------
    nav_as_of = nav_date or (snapshot.get("updated_at") if snapshot else None)
    quarterly_updated = quarterly.get("quarterly_updated") if quarterly else None
    metrics_updated = (
        rating_row.get("metrics_updated_at") if rating_row
        else (purchase_row.get("metrics_updated_at") if purchase_row
        else (snapshot.get("metrics_updated_at") if snapshot else None))
    )

    # independent stale flags
    quarterly_stale = is_stale(quarterly_updated, days=QUARTERLY_STALE_DAYS)
    metrics_stale = is_stale(metrics_updated, days=METRICS_STALE_DAYS)

    # holdings / assetAllocation asOf fallback
    snapshot_updated = snapshot.get("updated_at") if snapshot else None
    holdings_as_of = snapshot_updated or nav_as_of
    asset_as_of = snapshot_updated or nav_as_of

    # ---- section builder -----------------------------------------------------
    def build(
        ok: bool,
        *,
        partial: bool = False,
        stale: bool = False,
        reason: str | None = None,
        source: str | None = None,
        as_of: str | None = None,
        coverage: float | None = None,
    ) -> dict:
        if stale and ok:
            status = "stale"
        elif ok and partial:
            status = "partial"
        elif ok:
            status = "available"
        else:
            status = "missing"
        resolved_coverage = coverage if coverage is not None else (1.0 if status == "available" else 0.5 if status == "partial" else 0.25 if status == "stale" else 0.0)
        return {
            "dataStatus": status,
            "missingReason": reason if status in ("missing", "partial", "stale") else None,
            "source": source,
            "asOf": as_of,
            "coverage": resolved_coverage,
        }

    def section_from_payload(payload: object) -> dict | None:
        if not isinstance(payload, dict):
            return None
        status = payload.get("dataStatus")
        if status not in {"available", "partial", "stale", "missing", "simulated"}:
            return None
        coverage = payload.get("coverage")
        if not isinstance(coverage, (int, float)):
            coverage = 1.0 if status == "available" else 0.5 if status == "partial" else 0.25 if status == "stale" else 0.0
        return {
            "dataStatus": status,
            "missingReason": payload.get("missingReason") if status in {"partial", "stale", "missing"} else None,
            "source": payload.get("source"),
            "asOf": payload.get("asOf"),
            "coverage": float(coverage),
        }

    sections = {
        # 1. overview — from snapshot
        "overview": build(
            nav_count >= 2,
            stale=nav_stale,
            reason="缺少基金基本快照" if nav_count < 2 else "净值快照已陈旧",
            source="fund_quote_snapshot",
            as_of=nav_as_of,
        ),
        # 2. performance — from snapshot
        "performance": build(
            nav_count >= 2,
            stale=nav_stale,
            reason="缺少净值历史" if nav_count < 2 else "净值数据已陈旧",
            source="fund_quote_snapshot",
            as_of=nav_as_of,
        ),
        # 3. navDrawdown — from snapshot
        "navDrawdown": build(
            nav_count >= 30,
            stale=nav_stale,
            reason="缺少净值历史（需 ≥30 点计算回撤）" if nav_count < 30 else "净值数据已陈旧",
            source="fund_quote_snapshot",
            as_of=nav_as_of,
        ),
        # 4. holdings — from snapshot
        "holdings": build(
            holdings_count > 0,
            reason="缺少真实重仓股票",
            source="fund_portfolio_snapshot",
            as_of=holdings_as_of,
        ),
        # 5. bondAllocation
        "bondAllocation": build(
            bond_alloc_count > 0,
            stale=bond_alloc_count > 0 and quarterly_stale,
            reason="缺少真实券种配置",
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 6. bondHoldings
        "bondHoldings": build(
            bond_hold_count > 0,
            stale=bond_hold_count > 0 and quarterly_stale,
            reason="缺少真实重仓债券",
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 7. managerHistory
        "managerHistory": build(
            manager_count > 0,
            reason="缺少真实经理变更",
            source="fund_manager_history_snapshot",
            as_of=None,  # 当前表无独立 updated_at
        ),
        # 8. scaleHistory
        "scaleHistory": build(
            scale_count > 0,
            partial=scale_count > 0 and scale_count < 4,
            stale=scale_count > 0 and quarterly_stale,
            reason="缺少真实规模历史",
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 9. turnoverHistory
        "turnoverHistory": build(
            turnover_count > 0,
            partial=turnover_count > 0 and turnover_count < 4,
            stale=turnover_count > 0 and quarterly_stale,
            reason="缺少真实换手率历史",
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 10. peerPerformance — quote first, then nav fallback
        "peerPerformance": build(
            peer_has_data,
            stale=peer_has_data and (quote_stale if quote_has_peer_data else nav_stale),
            reason="缺少同期同类 / 指数 / 基准数据",
            source="fund_quote_snapshot" if quote_has_peer_data else ("fund_nav_history" if nav_count >= 250 else None),
            as_of=quote_updated if quote_has_peer_data else nav_as_of,
        ),
        # 11. purchaseInfo
        "purchaseInfo": build(
            purchase_count > 0,
            stale=purchase_count > 0 and metrics_stale,
            partial=purchase_count > 0,
            reason="缺少真实销售文件；仅有已入库管理费/托管费时不视为完整购买信息",
            source="fund_metrics_snapshot",
            as_of=metrics_updated,
            coverage=0.35 if purchase_count > 0 else 0.0,
        ),
        # 12. rating
        "rating": build(
            rating_count > 0,
            stale=rating_count > 0 and metrics_stale,
            partial=rating_count == 0 and nav_count > 0,
            reason="缺少真实评级星级；本地指标分数不替代 3 年 / 5 年评级",
            source="fund_metrics_snapshot",
            as_of=metrics_updated,
        ),
        # 13. assetAllocation
        "assetAllocation": build(
            asset_count > 0,
            reason="缺少真实资产配置",
            source="fund_portfolio_snapshot",
            as_of=asset_as_of,
        ),
        # 14. holderStructure
        "holderStructure": build(
            holder_count > 0,
            stale=holder_count > 0 and quarterly_stale,
            reason="缺少真实持有人结构",
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 15. yearReturns
        "yearReturns": build(
            nav_count >= 250,
            partial=nav_count >= 2 and nav_count < 250,
            stale=nav_count >= 250 and nav_stale,
            reason="净值历史不足 1 年，年度收益仅有部分年份" if nav_count < 250 else "净值数据已陈旧",
            source="fund_quote_snapshot",
            as_of=nav_as_of,
        ),
        # 16. riskSummary — metrics first, then nav fallback
        "riskSummary": build(
            risk_has_data,
            partial=False,
            stale=risk_has_data and (metrics_stale if metrics_has_risk_data else nav_stale),
            reason="缺 max_drawdown / sharpe，规则引擎无法定级",
            source="fund_metrics_snapshot" if metrics_has_risk_data else ("fund_nav_history_rule_engine" if nav_count >= 30 else None),
            as_of=metrics_updated if metrics_has_risk_data else nav_as_of,
        ),
        # 17. managerReport
        "managerReport": build(
            report_count > 0,
            reason="缺少真实定期报告原文",
            source="fund_report_snapshot",
            as_of=None,
        ),
    }

    # Align missing coverage rows with the detail endpoints used by the page.
    # If an endpoint fails or also reports missing, keep the lightweight snapshot
    # judgment above.
    detail_checks = []
    if sections["purchaseInfo"]["dataStatus"] in {"missing", "partial", "stale"}:
        detail_checks.append(("purchaseInfo", fund_purchase_info(code=code)))
    if snapshot:
        if sections["holderStructure"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("holderStructure", fund_holder_structure(code=code, periods=8)))
        if sections["bondAllocation"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("bondAllocation", fund_bond_allocation(code=code)))
        if sections["bondHoldings"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("bondHoldings", fund_bond_holdings(code=code)))
        if sections["scaleHistory"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("scaleHistory", fund_scale_history(code=code, periods=8)))
        if sections["turnoverHistory"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("turnoverHistory", fund_turnover_history(code=code, periods=8)))
        if sections["managerHistory"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("managerHistory", fund_manager_history(code=code)))
        if sections["rating"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("rating", fund_rating(code=code)))
        if sections["yearReturns"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("yearReturns", fund_year_returns(code=code)))
        if sections["riskSummary"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("riskSummary", fund_risk_summary(code=code, window="1y")))
        if sections["managerReport"]["dataStatus"] == "missing":
            detail_checks.append(("managerReport", fund_manager_report(code=code)))
        if sections["peerPerformance"]["dataStatus"] in {"missing", "partial"}:
            detail_checks.append(("peerPerformance", fund_peer_performance(code=code, window_days=200, max_points=50)))

    if detail_checks:
        detail_payloads = await asyncio.gather(
            *(call for _, call in detail_checks),
            return_exceptions=True,
        )
        for (key, _), payload in zip(detail_checks, detail_payloads):
            section = section_from_payload(payload)
            if section and section["dataStatus"] != "missing":
                sections[key] = section

    total = len(sections)
    available = sum(1 for s in sections.values() if s["dataStatus"] == "available")
    partial = sum(1 for s in sections.values() if s["dataStatus"] == "partial")
    stale_count = sum(1 for s in sections.values() if s["dataStatus"] == "stale")
    missing = sum(1 for s in sections.values() if s["dataStatus"] == "missing")
    coverage = round((available + partial * 0.5 + stale_count * 0.25) / total, 4) if total else 0.0
    field_sources = _field_sources_from_sections(sections)
    field_total = len(field_sources)
    field_coverage = round(
        sum(float(item.get("coverage") or 0.0) for item in field_sources.values()) / field_total,
        4,
    ) if field_total else 0.0

    return {
        "code": code,
        "dataStatus": "available" if available == total else "partial" if available + partial + stale_count > 0 else "missing",
        "missingReason": None if available == total else "部分 section 数据缺失或陈旧",
        "source": "local_snapshot",
        "asOf": nav_as_of,
        "coverage": coverage,
        "sections": sections,
        "available": available,
        "partial": partial,
        "stale": stale_count,
        "missing": missing,
        "total": total,
        "fieldSources": field_sources,
        "fieldCoverage": field_coverage,
        "fieldGroups": FUND_DETAIL_FIELD_GROUPS,
    }


@router.get("/detail-fields")
async def fund_detail_fields(code: str = Query(..., min_length=4, max_length=10, description="基金代码")):
    """Return the P0 field matrix with field-level source/status metadata."""
    completeness = await fund_detail_completeness(code=code)
    return {
        "code": code,
        "dataStatus": completeness.get("dataStatus"),
        "coverage": completeness.get("fieldCoverage", completeness.get("coverage", 0.0)),
        "fieldGroups": FUND_DETAIL_FIELD_GROUPS,
        "fieldSources": completeness.get("fieldSources", {}),
        "sections": completeness.get("sections", {}),
    }


@router.get("/{code}/market-context")
async def fund_market_context(code: str):
    """ETF/fund market-context panel data with structured per-section status."""
    from ..data.market_context_fetcher import get_fund_market_context

    return await run_in_threadpool(get_fund_market_context, code)


@router.get("/{code}/evidence-pack")
async def fund_evidence_pack(code: str):
    """Unified evidence pack for AI diagnosis and report generation."""
    from ..reports.fund_research_report import build_fund_evidence_pack

    return await run_in_threadpool(build_fund_evidence_pack, code)


@router.get("/agent-templates")
async def fund_agent_templates():
    """Fixed prompt templates and whitelisted tools for the lightweight fund agent."""
    from ..agents.fund_agent import list_fund_agent_templates

    return list_fund_agent_templates()


@router.post("/agent-plan")
async def fund_agent_plan(payload: FundAgentPlanRequest):
    """Build an auditable fixed-template agent plan from the fund evidence pack."""
    from ..agents.fund_agent import build_fund_agent_plan

    return await run_in_threadpool(
        build_fund_agent_plan,
        payload.template,
        payload.code,
        payload.context,
    )


@router.get("/{code}/research-report")
async def fund_research_report(
    code: str,
    format: str = Query("markdown", pattern="^(markdown|md|docx|pdf)$"),
):
    """Deterministic backend research report, with optional DOCX/PDF export."""
    from ..reports.fund_research_report import render_fund_research_report

    selected_format = format if isinstance(format, str) else "markdown"
    payload = await run_in_threadpool(render_fund_research_report, code)
    if selected_format == "markdown":
        return payload

    from ..reports.exporters import export_markdown_docx, export_markdown_pdf

    markdown = str(payload.get("markdown") or "")
    title = f"fund-{code}-research-report"
    if selected_format == "md":
        return Response(
            content=markdown.encode("utf-8"),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{title}.md"'},
        )
    metadata = {
        "code": code,
        "dataStatus": payload.get("dataStatus"),
        "asOf": payload.get("asOf"),
        "source": payload.get("source"),
    }
    export = (
        await run_in_threadpool(export_markdown_docx, markdown, title=title, metadata=metadata)
        if selected_format == "docx"
        else await run_in_threadpool(export_markdown_pdf, markdown, title=title, metadata=metadata)
    )
    return Response(
        content=export.data,
        media_type=export.content_type,
        headers={"Content-Disposition": f'attachment; filename="{title}.{selected_format}"'},
    )


@router.get("/data-status")
async def fund_data_status():
    """Expose data center freshness, job and external-call status."""
    from ..storage.database import FundDataStore

    return await run_in_threadpool(FundDataStore.data_status)


@router.get("/jobs")
async def fund_jobs(
    limit: int = Query(20, ge=1, le=100),
    status: str | None = Query(None, description="pending/running/succeeded/failed/cancelled"),
):
    """List resumable fund data jobs for BFF polling."""
    from ..storage.database import FundDataStore

    return {"jobs": await run_in_threadpool(FundDataStore.list_jobs, limit, status)}


@router.get("/jobs/{job_id}")
async def fund_job_status(job_id: str):
    """Return a single fund data job status."""
    from ..storage.database import FundDataStore

    job = await run_in_threadpool(FundDataStore.get_job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.get("/category-metrics")
async def fund_category_metrics(
    window_days: int = Query(365, ge=180, le=730),
    risk_free_rate: float = Query(0.02, ge=0.0, le=0.1),
    xinjihui_only: bool = Query(False),
    force_refresh: bool = Query(False),
):
    """Compute/read 1Y category metrics from NAV history and return daily snapshot."""
    return await run_in_threadpool(
        compute_category_metrics_1y,
        window_days=window_days,
        risk_free_rate=risk_free_rate,
        xinjihui_only=xinjihui_only,
        force_refresh=force_refresh,
    )


def _sync_fund_companies_to_master(codes: list[str]) -> int:
    """通过 Tushare fund_basic 批量获取基金公司信息，写入 fund_master 表。

    返回成功更新的记录数。
    """
    try:
        from ..data.providers.tushare_provider import TushareProvider
        from ..storage.database import get_db

        provider = TushareProvider()
        if not provider.is_available():
            logger.warning("Tushare not available, skipping fund company sync")
            return 0

        # 批量获取 fund_basic（全市场场外基金），使用分页获取全量数据
        fund_list = provider.get_fund_list(market="O", fetch_all=True)
        if not fund_list:
            logger.warning("Tushare fund_basic returned empty, skipping fund company sync")
            return 0

        # 构建 code -> management 映射
        company_map = {}
        for fb in fund_list:
            code = fb.code.replace(".OF", "").replace(".SH", "").replace(".SZ", "")
            mgmt = fb.management or ""
            if code and mgmt:
                company_map[code] = mgmt

        # 同时获取 ETF/LOF（场内）
        etf_list = provider.get_fund_list(market="E")
        for fb in etf_list:
            code = fb.code.replace(".OF", "").replace(".SH", "").replace(".SZ", "")
            mgmt = fb.management or ""
            if code and mgmt:
                company_map[code] = mgmt

        # 从 GUOYUAN_FUND_LIST 构建 code -> name 映射
        name_map = {str(f["code"]): str(f.get("name", "")) for f in GUOYUAN_FUND_LIST}

        # 写入 fund_master 表
        updated = 0
        now = datetime.now().isoformat()
        with get_db() as conn:
            for code in codes:
                company = company_map.get(code, "")
                if not company:
                    continue
                name = name_map.get(code, code)
                conn.execute(
                    """INSERT INTO fund_master
                       (code, name, fund_type, company, tags_json, is_xinjihui, is_preferred,
                        is_active, data_quality, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 1, 1, 1, 'synced', ?, ?)
                       ON CONFLICT(code) DO UPDATE SET
                         company = COALESCE(NULLIF(excluded.company, ''), fund_master.company),
                         updated_at = excluded.updated_at""",
                    (code, name, "", company, "[]", now, now),
                )
                updated += 1

        logger.info(f"Fund company sync: {updated} funds updated")
        return updated
    except Exception as e:
        logger.error(f"Fund company sync failed: {e}")
        return 0


def _build_snapshot_rows(df, codes, cached, now):
    """Build SQLite row tuples and quote dicts from akshare DataFrame.

    Returns (snapshot_rows, quote_dicts) where snapshot_rows matches
    FundSnapshotCache.save_batch signature and quote_dicts feeds
    FundDataStore.save_quote_batch.
    """
    # 批量从 fund_master 表读取基金公司信息作为补充
    master_companies = {}
    try:
        from ..storage.database import get_db
        with get_db() as conn:
            rows_db = conn.execute("SELECT code, company FROM fund_master WHERE company != ''").fetchall()
            master_companies = {r["code"]: r["company"] for r in rows_db}
    except Exception:
        pass

    rows = []
    quote_rows = []
    for _, row in df.iterrows():
        code = str(row.get("基金代码", "")).strip()
        if code not in codes and code not in cached:
            continue
        try:
            company = master_companies.get(code, "")
            item = {
                "code": code,
                "name": str(row.get("基金简称", "")),
                "type": str(row.get("基金类型", "")),
                "nav": float(row.get("单位净值", 0) or 0),
                "day_growth": float(row.get("日增长率", 0) or 0),
                "near_1m": float(row.get("近1月", 0) or 0),
                "near_3m": float(row.get("近3月", 0) or 0),
                "near_6m": float(row.get("近6月", 0) or 0),
                "near_1y": float(row.get("近1年", 0) or 0),
                "near_3y": float(row.get("近3年", 0) or 0),
                "ytd": float(row.get("今年以来", 0) or 0),
                "tags": [DEFAULT_TAG],
                "company": company,
                "is_xinjihui": True,
                "is_preferred": True,
                "updated_at": now,
            }
            quote_rows.append(item)
            rows.append((
                item["code"],
                item["name"],
                item["type"],
                item["nav"],
                item["day_growth"],
                item["near_1m"],
                item["near_3m"],
                item["near_6m"],
                item["near_1y"],
                item["near_3y"],
                item["ytd"],
                json.dumps([DEFAULT_TAG], ensure_ascii=False),
                company,
                now,
            ))
        except (ValueError, TypeError):
            continue
    return rows, quote_rows


@router.post("/refresh-snapshot")
async def refresh_fund_snapshot():
    """Refresh all fund data to SQLite (called after market close)."""
    from ..data.data_gateway import data_gateway
    from ..storage.database import FundDataStore, FundSnapshotCache

    try:
        logger.info("Starting fund snapshot refresh...")
        codes = [f["code"] for f in GUOYUAN_FUND_LIST]
        cached = FundSnapshotCache.get_codes()

        def _fetch_rank():
            import akshare as ak
            return ak.fund_open_fund_rank_em(symbol="全部")

        gateway_result = data_gateway.call(
            "akshare",
            "fund_open_fund_rank_em",
            _fetch_rank,
            cache_key="akshare:fund_open_fund_rank_em:all",
            ttl_seconds=24 * 60 * 60,
        )
        if gateway_result.error:
            return {"status": "error", "message": gateway_result.error}
        df = gateway_result.data
        if df is None or df.empty:
            return {"status": "error", "message": "akshare返回空数据"}

        now = datetime.now().isoformat()

        # 先通过 Tushare 批量获取基金公司信息并写入 fund_master
        _sync_fund_companies_to_master(codes)

        rows, quote_rows = _build_snapshot_rows(df, codes, cached, now)

        if rows:
            FundSnapshotCache.save_batch(rows)
            FundDataStore.save_quote_batch(quote_rows, source="akshare_rank_refresh")
            logger.info(f"Fund snapshot refreshed: {len(rows)} funds")

        return {"status": "ok", "count": len(rows), "updated_at": now}
    except Exception as e:
        logger.error(f"Fund snapshot refresh failed: {e}")
        return {"status": "error", "message": str(e)[:200]}


@router.post("/metrics/compute")
async def compute_fund_metrics(
    limit: int = Query(0, ge=0, description="Max funds to process (0=all)"),
    skip_existing: bool = Query(True, description="Skip funds already having computed metrics"),
    max_workers: int = Query(8, ge=1, le=20, description="Concurrent workers for NAV fetching"),
):
    """Compute risk metrics (sharpe, max_drawdown, volatility) from NAV history
    and save to fund_metrics_snapshot table. Uses concurrent fetching for speed."""
    from ..services.fund_service import compute_and_save_metrics

    try:
        result = await run_in_threadpool(
            compute_and_save_metrics,
            limit=limit,
            skip_existing=skip_existing,
            max_workers=max_workers,
        )
        return {"status": "ok", **result}
    except Exception as e:
        logger.error(f"Metrics compute failed: {e}")
        return {"status": "error", "message": str(e)[:200]}


# ============================================================
#  P0: 基金评级（3y / 5y 1~5 颗星）/ 购买信息 / 持有人结构
# ============================================================

@router.get("/rating")
async def fund_rating(code: str = Query(..., min_length=4, max_length=10, description="基金代码")):
    """基金评级：3 年 / 5 年 1~5 颗星。来自 tushare fund_rating。"""
    from ..services.fund_service import get_fund_rating

    try:
        data = await run_in_threadpool(get_fund_rating, code=code)
        if data:
            has_rating = (
                data.get("rating3y") is not None
                or data.get("rating5y") is not None
                or data.get("ratingOverall") is not None
            )
            is_official_not_rated = data.get("ratingStatus") == "not_rated" and data.get("source") == "eastmoney:fund_rating"
            has_score = data.get("score") is not None
            if is_official_not_rated:
                return {
                    **data,
                    "dataStatus": "available",
                    "asOf": data.get("asOf"),
                    "coverage": 1.0,
                    "missingReason": data.get("missingReason") or "官方评级源当前无该基金评级记录。",
                }
            if not has_rating and has_score:
                return {
                    **data,
                    "dataStatus": "partial",
                    "asOf": data.get("asOf"),
                    "coverage": 0.5,
                    "missingReason": "缺少真实评级星级，仅返回本地指标分数。",
                }
            return {
                **data,
                "dataStatus": "available" if has_rating else "missing",
                "asOf": data.get("asOf") or None,
                "coverage": 1.0 if data.get("source") == "tushare" else 0.8 if has_rating else 0.0,
                "missingReason": None if has_rating else "缺少真实评级数据",
            }
        fallback = await run_in_threadpool(_rating_score_fallback, code)
        if fallback:
            fallback["dataStatus"] = "partial"
            fallback["missingReason"] = fallback.get("missingReason") or "缺少真实评级数据，使用本地指标分数兜底"
            fallback["coverage"] = fallback.get("coverage", 0.7) if fallback.get("coverage", 0.0) <= 0.0 else fallback.get("coverage")
            return fallback
        return {
            "code": code,
            "rating3y": None,
            "rating5y": None,
            "score": None,
            "source": None,
            "dataStatus": "missing",
            "asOf": None,
            "coverage": 0.0,
            "missingReason": "缺少真实评级数据",
        }
    except Exception as e:
        logger.error(f"fund.rating failed for {code}: {e}")
        return {"code": code, "rating3y": None, "rating5y": None, "score": None, "source": None, "dataStatus": "missing", "asOf": None, "coverage": 0.0, "missingReason": "评级读取失败", "error": str(e)[:120]}


@router.get("/purchase-info")
async def fund_purchase_info(code: str = Query(..., min_length=4, max_length=10, description="基金代码")):
    """购买信息：申购/赎回状态、起购、4类费率、总费率。"""
    from ..services.fund_service import get_fund_purchase_info

    try:
        data = await run_in_threadpool(get_fund_purchase_info, code=code)
        if data and isinstance(data, dict):
            status = data.get("dataStatus", "partial")
            if status not in {"available", "partial", "stale", "missing", "simulated", "error", "pending"}:
                status = "partial"
            return {
                "code": code,
                **data,
                "dataStatus": status,
                "source": data.get("source"),
                "asOf": data.get("asOf"),
                "coverage": data.get("coverage") if data.get("coverage") is not None else (1.0 if status == "available" else 0.5),
                "missingReason": data.get("missingReason") if status in {"missing", "partial", "stale"} else None,
            }
        return {
            "code": code,
            "purchaseStatus": None,
            "redeemStatus": None,
            "minPurchaseAmount": None,
            "subscriptionFeeRate": None,
            "redemptionFeeRate": None,
            "managementFeeRate": None,
            "custodyFeeRate": None,
            "serviceFeeRate": None,
            "totalFeeRate1y": None,
            "dataStatus": "missing",
            "source": None,
            "asOf": None,
            "coverage": 0.0,
            "missingReason": "缺少购买信息",
        }
    except Exception as e:
        logger.error(f"fund.purchaseInfo failed for {code}: {e}")
        return {"code": code, "dataStatus": "missing", "source": None, "asOf": None, "coverage": 0.0, "missingReason": "购买信息读取失败", "error": str(e)[:120]}


@router.get("/holder-structure")
async def fund_holder_structure(
    code: str = Query(..., min_length=4, max_length=10, description="基金代码"),
    periods: int = Query(40, ge=1, le=80, description="返回最近多少个季度"),
):
    """持有人结构：季度机构/个人占比堆叠柱数据。来自 tushare fund_portfolio 季报。"""
    from ..services.fund_service import get_fund_holder_structure

    try:
        data = await run_in_threadpool(get_fund_holder_structure, code=code, periods=periods)
        return _detail_rows_payload(code, data, default_reason="缺少真实持有人结构数据")
    except Exception as e:
        logger.error(f"fund.holderStructure failed for {code}: {e}")
        return _empty_rows_payload(code, e, "持有人结构读取失败")


# ============================================================
#  P1: 券种配置 / 重仓债券 / 历史回报 / 偏股混合均值与基准
# ============================================================

@router.get("/bond-allocation")
async def fund_bond_allocation(code: str = Query(..., min_length=4, max_length=10, description="基金代码")):
    """券种配置：11 类债券占净值比 + 较上期。来自 tushare fund_portfolio。"""
    from ..services.fund_service import get_fund_bond_allocation

    try:
        data = await run_in_threadpool(get_fund_bond_allocation, code=code)
        return _detail_rows_payload(code, data, default_reason="缺少真实券种配置数据")
    except Exception as e:
        logger.error(f"fund.bondAllocation failed for {code}: {e}")
        return _empty_rows_payload(code, e, "券种配置读取失败")


@router.get("/bond-holdings")
async def fund_bond_holdings(code: str = Query(..., min_length=4, max_length=10, description="基金代码")):
    """重仓债券：7 列（证券简称/持仓市值/占净值比/票面利率/发行主体/债券类型/发行信用评级）。"""
    from ..services.fund_service import get_fund_bond_holdings

    try:
        data = await run_in_threadpool(get_fund_bond_holdings, code=code)
        return _detail_rows_payload(code, data, default_reason="缺少真实重仓债券数据")
    except Exception as e:
        logger.error(f"fund.bondHoldings failed for {code}: {e}")
        return _empty_rows_payload(code, e, "重仓债券读取失败")


@router.get("/year-returns")
async def fund_year_returns(code: str = Query(..., min_length=4, max_length=10, description="基金代码")):
    """历年回报：每年本基金/沪深300/偏股混合均值/同类排名。"""
    from ..services.fund_service import get_fund_year_returns

    try:
        data = await run_in_threadpool(get_fund_year_returns, code=code)
        return _detail_rows_payload(code, data, default_reason="缺少净值历史，无法计算年度收益")
    except Exception as e:
        logger.error(f"fund.yearReturns failed for {code}: {e}")
        return _empty_rows_payload(code, e, "历史回报读取失败")


@router.get("/peer-performance")
async def fund_peer_performance(
    code: str = Query(..., min_length=4, max_length=10, description="基金代码"),
    window_days: int = Query(365 * 5 + 2, ge=30, le=365 * 30, description="曲线窗口天数"),
    max_points: int = Query(420, ge=30, le=2000, description="每条曲线最多点数"),
):
    """偏股混合均值 / 沪深300 / 业绩比较基准 同期收益率（3m/6m/1y/3y/5y/成立至今/年化）。"""
    from ..services.fund_service import get_fund_peer_performance

    try:
        data = await run_in_threadpool(
            get_fund_peer_performance,
            code=code,
            window_days=window_days,
            max_points=max_points,
        )
        return {"code": code, **(data or {})}
    except Exception as e:
        logger.error(f"fund.peerPerformance failed for {code}: {e}")
        return {
            "code": code,
            "peer": {"return3m": None, "return6m": None, "return1y": None, "return3y": None, "return5y": None, "returnSinceInception": None, "annualizedReturn": None},
            "index": {"return3m": None, "return6m": None, "return1y": None, "return3y": None, "return5y": None, "returnSinceInception": None, "annualizedReturn": None},
            "benchmark": {"return3m": None, "return6m": None, "return1y": None, "return3y": None, "return5y": None, "returnSinceInception": None, "annualizedReturn": None},
            "fund": {"return3m": None, "return6m": None, "return1y": None, "return3y": None, "return5y": None, "returnSinceInception": None, "annualizedReturn": None},
            "dataStatus": "missing",
            "source": None,
            "asOf": None,
            "coverage": 0.0,
            "missingReason": "同期收益读取失败",
            "error": str(e)[:120],
        }


# ============================================================
#  P2: 历年规模变化 / 基金换手率 / 基金经理变更
# ============================================================

@router.get("/scale-history")
async def fund_scale_history(
    code: str = Query(..., min_length=4, max_length=10, description="基金代码"),
    periods: int = Query(40, ge=1, le=80, description="返回最近多少个季度"),
):
    """历年规模变化：本基金净资产 + 同类 25% 分位（季度）。"""
    from ..services.fund_service import get_fund_scale_history

    try:
        data = await run_in_threadpool(get_fund_scale_history, code=code, periods=periods)
        return _detail_rows_payload(code, data, default_reason="缺少真实规模历史数据")
    except Exception as e:
        logger.error(f"fund.scaleHistory failed for {code}: {e}")
        return _empty_rows_payload(code, e, "规模历史读取失败")


@router.get("/turnover-history")
async def fund_turnover_history(
    code: str = Query(..., min_length=4, max_length=10, description="基金代码"),
    periods: int = Query(40, ge=1, le=80, description="返回最近多少个季度"),
):
    """基金换手率（季度）。"""
    from ..services.fund_service import get_fund_turnover_history

    try:
        data = await run_in_threadpool(get_fund_turnover_history, code=code, periods=periods)
        return _detail_rows_payload(code, data, default_reason="缺少真实换手率数据")
    except Exception as e:
        logger.error(f"fund.turnoverHistory failed for {code}: {e}")
        return _empty_rows_payload(code, e, "换手率读取失败")


@router.get("/manager-history")
async def fund_manager_history(code: str = Query(..., min_length=4, max_length=10, description="基金代码")):
    """基金经理变更：历任经理任职/离职日期/任职总回报/年化回报/同类排名。"""
    from ..services.fund_service import get_fund_manager_history

    try:
        data = await run_in_threadpool(get_fund_manager_history, code=code)
        payload = _detail_rows_payload(code, data, default_reason="缺少真实基金经理变更数据")
        return {**payload, "managerCount": len(payload.get("rows") or [])}
    except Exception as e:
        logger.error(f"fund.managerHistory failed for {code}: {e}")
        payload = _empty_rows_payload(code, e, "基金经理变更读取失败")
        return {**payload, "managerCount": 0}


# ============================================================
#  P3: 运作分析（基金定期报告全文）
# ============================================================

@router.get("/manager-report")
async def fund_manager_report(code: str = Query(..., min_length=4, max_length=10, description="基金代码")):
    """运作分析：返回真实定期报告文本；不再用模板或 LLM 编造报告。"""
    from ..services.fund_service import get_fund_manager_report

    try:
        base = await run_in_threadpool(get_fund_manager_report, code=code)
        return base or {
            "code": code,
            "report": None,
            "period": None,
            "dataStatus": "missing",
            "source": None,
            "asOf": None,
            "coverage": 0.0,
            "missingReason": "缺少真实基金定期报告原文",
        }
    except Exception as e:
        logger.error(f"fund.managerReport failed for {code}: {e}")
        return {
            "code": code,
            "report": None,
            "period": None,
            "dataStatus": "missing",
            "source": None,
            "asOf": None,
            "coverage": 0.0,
            "missingReason": "运作分析读取失败",
            "error": str(e)[:120],
        }


# ============================================================
#  风险摘要（规则引擎生成）
# ============================================================

@router.get("/risk-summary")
async def fund_risk_summary(
    code: str = Query(..., min_length=4, max_length=10, description="基金代码"),
    window: str = Query("1y", description="时间窗口：1y / 3y / 5y / inception"),
):
    """风险摘要：基于 fund_metrics_snapshot + 同类均值，用规则模板生成中文自然语言摘要，可选LLM深度解读。"""
    from ..services.fund_service import get_fund_risk_summary

    try:
        base = await run_in_threadpool(get_fund_risk_summary, code=code, window=window)
        if not base or not base.get("summary"):
            return {
                "code": code,
                "window": window,
                "level": None,
                "maxDrawdown": None,
                "peerMaxDrawdown": None,
                "downsideRisk": None,
                "peerDownsideRisk": None,
                "summary": None,
                "source": None,
                "dataStatus": "missing",
                "asOf": None,
                "coverage": 0.0,
                "missingReason": "缺少风险指标或净值历史，无法生成风险摘要",
            }
        # 用 LLM 对风险摘要进行深度解读（机构风控官视角，强制 JSON Schema 输出）
        llm_prompt = f"""你是一家头部公募基金管理公司的首席风控官（CRO），请基于以下产品风险数据，输出**严格的 JSON**（不要任何额外说明文字）。

【产品信息】
· 产品代码：{base.get('code')}
· 考察周期：{base.get('window')}
· 风险等级：{base.get('level')}
· 最大回撤：{base.get('maxDrawdown')}
· 同类平均最大回撤：{base.get('peerMaxDrawdown')}
· 夏普比率：{base.get('sharpeRatio', '暂无')}

【输出 JSON Schema（严格遵守，不要多余字段）】
{{
  "core_conclusion": "string, 30-50字，一句话风控结论",
  "risk_sources": ["string", "string", "string"],
  "quantitative_positioning": "string, 30-50字，定量对标（回撤为同类 X 倍）",
  "suitability_advice": "string, 30-60字，明确适合/不适合何种风险偏好投资者",
  "monitoring_focus": "string, 20-40字，后续重点监控的指标"
}}

【硬性约束】
1. 严禁编造数据，所有数值必须基于上述产品信息
2. 严禁客套话、严禁"综上所述"
3. 中文输出，专业机构口吻
"""
        llm_summary: str | None = None
        source = "rule-engine"
        llm_summary_raw = ""
        try:
            llm_summary_raw = await asyncio.wait_for(
                call_astorn_llm(llm_prompt, max_tokens=600, temperature=0.2),
                timeout=20.0,
            )
        except asyncio.TimeoutError:
            logger.warning(f"riskSummary LLM timeout for {code}")
            llm_summary_raw = ""

        # 解析 + 类型校验
        candidate = None
        if llm_summary_raw:
            try:
                candidate = json.loads(llm_summary_raw)
            except json.JSONDecodeError:
                logger.warning(f"riskSummary LLM 非JSON输出, 回落规则引擎: {code}")
                candidate = None

        if isinstance(candidate, dict):
            core = str(candidate.get("core_conclusion") or "").strip()[:200]
            sources = candidate.get("risk_sources")
            if not isinstance(sources, list):
                sources = []
            sources = [str(s)[:200] for s in sources if s][:5]
            positioning = str(candidate.get("quantitative_positioning") or "").strip()[:200]
            suitability = str(candidate.get("suitability_advice") or "").strip()[:200]
            monitoring = str(candidate.get("monitoring_focus") or "").strip()[:200]
            # 至少要有 core_conclusion 非空才视为有效 LLM 输出
            if core:
                llm_summary = (
                    f"【风险定级】{core}\n"
                    f"【风险来源】{'；'.join(sources) if sources else '暂无'}\n"
                    f"【同业对标】{positioning or '暂无'}\n"
                    f"【适当性建议】{suitability or '暂无'}\n"
                    f"【监控重点】{monitoring or '暂无'}"
                )
                source = "astorn-llm"
            else:
                llm_summary = base.get("summary")
                source = "rule-engine"
        else:
            llm_summary = base.get("summary")
            source = "rule-engine"
        return {**base, "summary": llm_summary, "source": source}
    except Exception as e:
        logger.error(f"fund.riskSummary failed for {code}: {e}")
        return {
            "code": code,
            "window": window,
            "level": None,
            "maxDrawdown": None,
            "peerMaxDrawdown": None,
            "downsideRisk": None,
            "peerDownsideRisk": None,
            "summary": None,
            "source": None,
            "dataStatus": "missing",
            "asOf": None,
            "coverage": 0.0,
            "missingReason": "风险摘要读取失败",
            "error": str(e)[:120],
        }

