"""基金排名筛选API"""
import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Query, HTTPException
from starlette.concurrency import run_in_threadpool
from typing import Optional

from ..services.fund_service import get_fund_list, get_fund_list_from_watchlist
from ..constants.guoyuan_funds import GUOYUAN_FUND_LIST, FUND_CATEGORIES, FUND_TYPES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fund", tags=["基金排名筛选"])

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


@router.get("/list")
async def fund_list(
    category: str = Query(DEFAULT_CATEGORY, description="基金类型"),
    tag: Optional[str] = Query(None, description="标签筛选"),
    keyword: Optional[str] = Query(None, description="关键词搜索"),
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
    keyword: Optional[str] = Query(None),
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


@router.get("/data-status")
async def fund_data_status():
    """Expose data center freshness, job and external-call status."""
    from ..storage.database import FundDataStore

    return await run_in_threadpool(FundDataStore.data_status)


def _build_snapshot_rows(df, codes, cached, now):
    """Build SQLite row tuples and quote dicts from akshare DataFrame.

    Returns (snapshot_rows, quote_dicts) where snapshot_rows matches
    FundSnapshotCache.save_batch signature and quote_dicts feeds
    FundDataStore.save_quote_batch.
    """
    rows = []
    quote_rows = []
    for _, row in df.iterrows():
        code = str(row.get("基金代码", "")).strip()
        if code not in codes and code not in cached:
            continue
        try:
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
                "company": "",
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
                "",
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
