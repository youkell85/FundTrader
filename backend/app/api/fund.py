"""鍩洪噾鎺掑悕绛涢€堿PI"""
import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from ..constants.guoyuan_funds import FUND_CATEGORIES, FUND_TYPES, GUOYUAN_FUND_LIST
from ..services.fund_service import compute_category_metrics_1y, get_fund_list, get_fund_list_from_watchlist
from ..services.llm_service import call_astorn_llm

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fund", tags=["鍩洪噾鎺掑悕绛涢€?])

# 鈹€鈹€ 鎺掑簭鍙傛暟鐧藉悕鍗?鈹€鈹€
ALLOWED_SORT_FIELDS = frozenset({
    "浠婂勾鏉?, "杩?鏈?, "杩?鏈?, "杩?鏈?, "杩?骞?, "杩?骞?,
    "ytd", "day_growth", "nav", "near_1m", "near_3m",
    "near_6m", "near_1y", "near_3y", "code", "name", "type",
})
ALLOWED_SORT_ORDERS = frozenset({"asc", "desc"})

DEFAULT_CATEGORY = "鍏ㄩ儴"
DEFAULT_SORT_BY = "浠婂勾鏉?
DEFAULT_SORT_ORDER = "desc"
DEFAULT_TAG = "閼熀鑽?


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


@router.get("/list")
async def fund_list(
    category: str = Query(DEFAULT_CATEGORY, description="鍩洪噾绫诲瀷"),
    tag: str | None = Query(None, description="鏍囩绛涢€?),
    keyword: str | None = Query(None, description="鍏抽敭璇嶆悳绱?),
    sort_by: str = Query(DEFAULT_SORT_BY, description="鎺掑簭瀛楁"),
    sort_order: str = Query(DEFAULT_SORT_ORDER, description="鎺掑簭鏂瑰悜"),
    page: int = Query(1, ge=1, description="椤电爜"),
    page_size: int = Query(20, ge=1, le=5000, description="姣忛〉鏁伴噺"),
    guoyuan_only: bool = Query(True, description="浠呭浗鍏冨悕鍗?),
    use_watchlist: bool = Query(False, description="浣跨敤鑷€夊熀閲戝垪琛?),
):
    if sort_by not in ALLOWED_SORT_FIELDS:
        raise HTTPException(400, f"涓嶆敮鎸佺殑鎺掑簭瀛楁: {sort_by}")
    if sort_order not in ALLOWED_SORT_ORDERS:
        raise HTTPException(400, f"涓嶆敮鎸佺殑鎺掑簭鏂瑰悜: {sort_order}")
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
        raise HTTPException(400, f"涓嶆敮鎸佺殑鎺掑簭瀛楁: {sort_by}")
    if sort_order not in ALLOWED_SORT_ORDERS:
        raise HTTPException(400, f"涓嶆敮鎸佺殑鎺掑簭鏂瑰悜: {sort_order}")
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


@router.get("/detail-completeness")
async def fund_detail_completeness(code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜")):
    """Return local real-data coverage by detail-page section without external fetches.

    Each section returns the full contract:
      { dataStatus, missingReason, source, asOf, coverage }
    """
    from ..storage.database import FundDataStore, get_db_context

    snapshot = await run_in_threadpool(FundDataStore.get_snapshot, code)

    # ---- stale helpers -------------------------------------------------------
    NAV_STALE_HOURS = 48
    QUOTE_STALE_HOURS = 48
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

    def qcount(name: str) -> int:
        try:
            return int(quarterly[name] or 0) if quarterly else 0
        except Exception:
            return 0

    holder_count = qcount("holder_count")
    scale_count = qcount("scale_count")
    turnover_count = qcount("turnover_count")
    bond_alloc_count = qcount("bond_alloc_count")
    bond_hold_count = qcount("bond_hold_count")

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

    sections = {
        # 1. overview 鈥?from snapshot
        "overview": build(
            nav_count >= 2,
            stale=nav_stale,
            reason="缂哄皯鍩洪噾鍩烘湰蹇収" if nav_count < 2 else "鍑€鍊煎揩鐓у凡闄堟棫",
            source="fund_quote_snapshot",
            as_of=nav_as_of,
        ),
        # 2. performance 鈥?from snapshot
        "performance": build(
            nav_count >= 2,
            stale=nav_stale,
            reason="缂哄皯鍑€鍊煎巻鍙? if nav_count < 2 else "鍑€鍊兼暟鎹凡闄堟棫",
            source="fund_quote_snapshot",
            as_of=nav_as_of,
        ),
        # 3. navDrawdown 鈥?from snapshot
        "navDrawdown": build(
            nav_count >= 30,
            stale=nav_stale,
            reason="缂哄皯鍑€鍊煎巻鍙诧紙闇€ 鈮?0 鐐硅绠楀洖鎾わ級" if nav_count < 30 else "鍑€鍊兼暟鎹凡闄堟棫",
            source="fund_quote_snapshot",
            as_of=nav_as_of,
        ),
        # 4. holdings 鈥?from snapshot
        "holdings": build(
            holdings_count > 0,
            reason="缂哄皯鐪熷疄閲嶄粨鑲＄エ",
            source="fund_portfolio_snapshot",
            as_of=holdings_as_of,
        ),
        # 5. bondAllocation
        "bondAllocation": build(
            bond_alloc_count > 0,
            stale=bond_alloc_count > 0 and quarterly_stale,
            reason="缂哄皯鐪熷疄鍒哥閰嶇疆",
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 6. bondHoldings
        "bondHoldings": build(
            bond_hold_count > 0,
            stale=bond_hold_count > 0 and quarterly_stale,
            reason="缂哄皯鐪熷疄閲嶄粨鍊哄埜",
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 7. managerHistory
        "managerHistory": build(
            manager_count > 0,
            reason="缂哄皯鐪熷疄缁忕悊鍙樻洿",
            source="fund_manager_history_snapshot",
            as_of=None,  # 褰撳墠琛ㄦ棤鐙珛 updated_at
        ),
        # 8. scaleHistory
        "scaleHistory": build(
            scale_count > 0,
            partial=scale_count > 0 and scale_count < 4,
            stale=scale_count > 0 and quarterly_stale,
            reason="缂哄皯鐪熷疄瑙勬ā鍘嗗彶",
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 9. turnoverHistory
        "turnoverHistory": build(
            turnover_count > 0,
            partial=turnover_count > 0 and turnover_count < 4,
            stale=turnover_count > 0 and quarterly_stale,
            reason="缂哄皯鐪熷疄鎹㈡墜鐜囧巻鍙?,
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 10. peerPerformance 鈥?quote first, then nav fallback
        "peerPerformance": build(
            peer_has_data,
            stale=peer_has_data and (quote_stale if quote_has_peer_data else nav_stale),
            reason="缂哄皯鍚屾湡鍚岀被 / 鎸囨暟 / 鍩哄噯鏁版嵁",
            source="fund_quote_snapshot" if quote_has_peer_data else ("fund_nav_history" if nav_count >= 250 else None),
            as_of=quote_updated if quote_has_peer_data else nav_as_of,
        ),
        # 11. purchaseInfo
        "purchaseInfo": build(
            purchase_count > 0,
            stale=purchase_count > 0 and metrics_stale,
            partial=purchase_count == 0 and nav_count > 0,
            reason="缂虹湡瀹為攢鍞枃浠讹紝璇︽儏椤电敤琛屼笟榛樿鍊?,
            source="fund_metrics_snapshot",
            as_of=metrics_updated,
        ),
        # 12. rating
        "rating": build(
            rating_count > 0,
            stale=rating_count > 0 and metrics_stale,
            partial=rating_count == 0 and nav_count > 0,
            reason="缂?tushare fund_rating锛岃鎯呴〉浼氱敤 score 鍏滃簳",
            source="fund_metrics_snapshot",
            as_of=metrics_updated,
        ),
        # 13. assetAllocation
        "assetAllocation": build(
            asset_count > 0,
            reason="缂哄皯鐪熷疄璧勪骇閰嶇疆",
            source="fund_portfolio_snapshot",
            as_of=asset_as_of,
        ),
        # 14. holderStructure
        "holderStructure": build(
            holder_count > 0,
            stale=holder_count > 0 and quarterly_stale,
            reason="缂哄皯鐪熷疄鎸佹湁浜虹粨鏋?,
            source="fund_detail_quarterly_snapshot",
            as_of=quarterly_updated,
        ),
        # 15. yearReturns
        "yearReturns": build(
            nav_count >= 250,
            partial=nav_count >= 2 and nav_count < 250,
            stale=nav_count >= 250 and nav_stale,
            reason="鍑€鍊煎巻鍙蹭笉瓒?1 骞达紝骞村害鏀剁泭浠呮湁閮ㄥ垎骞翠唤" if nav_count < 250 else "鍑€鍊兼暟鎹凡闄堟棫",
            source="fund_quote_snapshot",
            as_of=nav_as_of,
        ),
        # 16. riskSummary 鈥?metrics first, then nav fallback
        "riskSummary": build(
            risk_has_data,
            stale=risk_has_data and (metrics_stale if metrics_has_risk_data else nav_stale),
            reason="缂?max_drawdown / sharpe锛岃鍒欏紩鎿庢棤娉曞畾绾?,
            source="fund_metrics_snapshot" if metrics_has_risk_data else ("fund_nav_history_rule_engine" if nav_count >= 30 else None),
            as_of=metrics_updated if metrics_has_risk_data else nav_as_of,
        ),
        # 17. managerReport
        "managerReport": build(
            report_count > 0,
            reason="缂哄皯鐪熷疄瀹氭湡鎶ュ憡鍘熸枃",
            source="fund_report_snapshot",
            as_of=None,
        ),
    }

    total = len(sections)
    available = sum(1 for s in sections.values() if s["dataStatus"] == "available")
    partial = sum(1 for s in sections.values() if s["dataStatus"] == "partial")
    stale_count = sum(1 for s in sections.values() if s["dataStatus"] == "stale")
    missing = sum(1 for s in sections.values() if s["dataStatus"] == "missing")
    coverage = round((available + partial * 0.5 + stale_count * 0.25) / total, 4) if total else 0.0

    return {
        "code": code,
        "dataStatus": "available" if available == total else "partial" if available + partial + stale_count > 0 else "missing",
        "missingReason": None if available == total else "閮ㄥ垎 section 鏁版嵁缂哄け鎴栭檲鏃?,
        "source": "local_snapshot",
        "asOf": nav_as_of,
        "coverage": coverage,
        "sections": sections,
        "available": available,
        "partial": partial,
        "stale": stale_count,
        "missing": missing,
        "total": total,
    }


@router.get("/data-status")
async def fund_data_status():
    """Expose data center freshness, job and external-call status."""
    from ..storage.database import FundDataStore

    return await run_in_threadpool(FundDataStore.data_status)


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
    """閫氳繃 Tushare fund_basic 鎵归噺鑾峰彇鍩洪噾鍏徃淇℃伅锛屽啓鍏?fund_master 琛ㄣ€?

    杩斿洖鎴愬姛鏇存柊鐨勮褰曟暟銆?
    """
    try:
        from ..data.providers.tushare_provider import TushareProvider
        from ..storage.database import get_db

        provider = TushareProvider()
        if not provider.is_available():
            logger.warning("Tushare not available, skipping fund company sync")
            return 0

        # 鎵归噺鑾峰彇 fund_basic锛堝叏甯傚満鍦哄鍩洪噾锛夛紝浣跨敤鍒嗛〉鑾峰彇鍏ㄩ噺鏁版嵁
        fund_list = provider.get_fund_list(market="O", fetch_all=True)
        if not fund_list:
            logger.warning("Tushare fund_basic returned empty, skipping fund company sync")
            return 0

        # 鏋勫缓 code -> management 鏄犲皠
        company_map = {}
        for fb in fund_list:
            code = fb.code.replace(".OF", "").replace(".SH", "").replace(".SZ", "")
            mgmt = fb.management or ""
            if code and mgmt:
                company_map[code] = mgmt

        # 鍚屾椂鑾峰彇 ETF/LOF锛堝満鍐咃級
        etf_list = provider.get_fund_list(market="E")
        for fb in etf_list:
            code = fb.code.replace(".OF", "").replace(".SH", "").replace(".SZ", "")
            mgmt = fb.management or ""
            if code and mgmt:
                company_map[code] = mgmt

        # 浠?GUOYUAN_FUND_LIST 鏋勫缓 code -> name 鏄犲皠
        name_map = {str(f["code"]): str(f.get("name", "")) for f in GUOYUAN_FUND_LIST}

        # 鍐欏叆 fund_master 琛?
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
    # 鎵归噺浠?fund_master 琛ㄨ鍙栧熀閲戝叕鍙镐俊鎭綔涓鸿ˉ鍏?
    master_companies = {}
    try:
        from ..storage.database import get_db
        with get_db() as conn:
            rows_db = conn.execute("SELECT code, company FROM fund_master WHERE company != ''").fetchall()
            master_companies = {r["code"]: r["company"] for r in rows_db}
    except Exception:
    logger.exception("Ignored non-fatal exception")

    rows = []
    quote_rows = []
    for _, row in df.iterrows():
        code = str(row.get("鍩洪噾浠ｇ爜", "")).strip()
        if code not in codes and code not in cached:
            continue
        try:
            company = master_companies.get(code, "")
            item = {
                "code": code,
                "name": str(row.get("鍩洪噾绠€绉?, "")),
                "type": str(row.get("鍩洪噾绫诲瀷", "")),
                "nav": float(row.get("鍗曚綅鍑€鍊?, 0) or 0),
                "day_growth": float(row.get("鏃ュ闀跨巼", 0) or 0),
                "near_1m": float(row.get("杩?鏈?, 0) or 0),
                "near_3m": float(row.get("杩?鏈?, 0) or 0),
                "near_6m": float(row.get("杩?鏈?, 0) or 0),
                "near_1y": float(row.get("杩?骞?, 0) or 0),
                "near_3y": float(row.get("杩?骞?, 0) or 0),
                "ytd": float(row.get("浠婂勾浠ユ潵", 0) or 0),
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
            return ak.fund_open_fund_rank_em(symbol="鍏ㄩ儴")

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
            return {"status": "error", "message": "akshare杩斿洖绌烘暟鎹?}

        now = datetime.now().isoformat()

        # 鍏堥€氳繃 Tushare 鎵归噺鑾峰彇鍩洪噾鍏徃淇℃伅骞跺啓鍏?fund_master
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
#  P0: 鍩洪噾璇勭骇锛?y / 5y 1~5 棰楁槦锛? 璐拱淇℃伅 / 鎸佹湁浜虹粨鏋?
# ============================================================

@router.get("/rating")
async def fund_rating(code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜")):
    """鍩洪噾璇勭骇锛? 骞?/ 5 骞?1~5 棰楁槦銆傛潵鑷?tushare fund_rating銆?""
    from ..services.fund_service import get_fund_rating

    try:
        data = await run_in_threadpool(get_fund_rating, code=code)
        if data:
            has_rating = data.get("rating3y") is not None or data.get("rating5y") is not None
            return {
                **data,
                "dataStatus": "available" if data.get("source") == "tushare" else "partial" if has_rating else "missing",
                "asOf": None,
                "coverage": 1.0 if data.get("source") == "tushare" else 0.5 if has_rating else 0.0,
                "missingReason": None if has_rating else "缂哄皯鐪熷疄璇勭骇鏁版嵁",
            }
        return {
            "code": code,
            "rating3y": None,
            "rating5y": None,
            "score": None,
            "source": None,
            "dataStatus": "missing",
            "asOf": None,
            "coverage": 0.0,
            "missingReason": "缂哄皯鐪熷疄璇勭骇鏁版嵁",
        }
    except Exception as e:
        logger.error(f"fund.rating failed for {code}: {e}")
        return {"code": code, "rating3y": None, "rating5y": None, "score": None, "source": None, "dataStatus": "missing", "asOf": None, "coverage": 0.0, "missingReason": "璇勭骇璇诲彇澶辫触", "error": str(e)[:120]}


@router.get("/purchase-info")
async def fund_purchase_info(code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜")):
    """璐拱淇℃伅锛氱敵璐?璧庡洖鐘舵€併€佽捣璐噾棰濄€? 绫昏垂鐜囥€佹€昏垂鐜囥€傛潵鑷熀閲戦攢鍞枃浠?澶╁ぉ鍩洪噾銆?""
    from ..services.fund_service import get_fund_purchase_info

    try:
        data = await run_in_threadpool(get_fund_purchase_info, code=code)
        if data:
            return {
                **data,
                "dataStatus": "partial",
                "source": "fund_metrics_snapshot+industry-defaults",
                "asOf": None,
                "coverage": 0.5,
                "missingReason": "鐢宠祹鐘舵€佸拰璧疯喘閲戦鍚涓氶粯璁ゅ€硷紝寰呮帴鍏ョ湡瀹為攢鍞枃浠躲€?,
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
            "missingReason": "缂哄皯璐拱淇℃伅",
        }
    except Exception as e:
        logger.error(f"fund.purchaseInfo failed for {code}: {e}")
        return {"code": code, "dataStatus": "missing", "source": None, "asOf": None, "coverage": 0.0, "missingReason": "璐拱淇℃伅璇诲彇澶辫触", "error": str(e)[:120]}


@router.get("/holder-structure")
async def fund_holder_structure(
    code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜"),
    periods: int = Query(40, ge=1, le=80, description="杩斿洖鏈€杩戝灏戜釜瀛ｅ害"),
):
    """鎸佹湁浜虹粨鏋勶細瀛ｅ害鏈烘瀯/涓汉鍗犳瘮鍫嗗彔鏌辨暟鎹€傛潵鑷?tushare fund_portfolio 瀛ｆ姤銆?""
    from ..services.fund_service import get_fund_holder_structure

    try:
        data = await run_in_threadpool(get_fund_holder_structure, code=code, periods=periods)
        return _detail_rows_payload(code, data, default_reason="缂哄皯鐪熷疄鎸佹湁浜虹粨鏋勬暟鎹?)
    except Exception as e:
        logger.error(f"fund.holderStructure failed for {code}: {e}")
        return _empty_rows_payload(code, e, "鎸佹湁浜虹粨鏋勮鍙栧け璐?)


# ============================================================
#  P1: 鍒哥閰嶇疆 / 閲嶄粨鍊哄埜 / 鍘嗗彶鍥炴姤 / 鍋忚偂娣峰悎鍧囧€间笌鍩哄噯
# ============================================================

@router.get("/bond-allocation")
async def fund_bond_allocation(code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜")):
    """鍒哥閰嶇疆锛?1 绫诲€哄埜鍗犲噣鍊兼瘮 + 杈冧笂鏈熴€傛潵鑷?tushare fund_portfolio銆?""
    from ..services.fund_service import get_fund_bond_allocation

    try:
        data = await run_in_threadpool(get_fund_bond_allocation, code=code)
        return _detail_rows_payload(code, data, default_reason="缂哄皯鐪熷疄鍒哥閰嶇疆鏁版嵁")
    except Exception as e:
        logger.error(f"fund.bondAllocation failed for {code}: {e}")
        return _empty_rows_payload(code, e, "鍒哥閰嶇疆璇诲彇澶辫触")


@router.get("/bond-holdings")
async def fund_bond_holdings(code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜")):
    """閲嶄粨鍊哄埜锛? 鍒楋紙璇佸埜绠€绉?鎸佷粨甯傚€?鍗犲噣鍊兼瘮/绁ㄩ潰鍒╃巼/鍙戣涓讳綋/鍊哄埜绫诲瀷/鍙戣淇＄敤璇勭骇锛夈€?""
    from ..services.fund_service import get_fund_bond_holdings

    try:
        data = await run_in_threadpool(get_fund_bond_holdings, code=code)
        return _detail_rows_payload(code, data, default_reason="缂哄皯鐪熷疄閲嶄粨鍊哄埜鏁版嵁")
    except Exception as e:
        logger.error(f"fund.bondHoldings failed for {code}: {e}")
        return _empty_rows_payload(code, e, "閲嶄粨鍊哄埜璇诲彇澶辫触")


@router.get("/year-returns")
async def fund_year_returns(code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜")):
    """鍘嗗勾鍥炴姤锛氭瘡骞存湰鍩洪噾/娌繁300/鍋忚偂娣峰悎鍧囧€?鍚岀被鎺掑悕銆?""
    from ..services.fund_service import get_fund_year_returns

    try:
        data = await run_in_threadpool(get_fund_year_returns, code=code)
        return _detail_rows_payload(code, data, default_reason="缂哄皯鍑€鍊煎巻鍙诧紝鏃犳硶璁＄畻骞村害鏀剁泭")
    except Exception as e:
        logger.error(f"fund.yearReturns failed for {code}: {e}")
        return _empty_rows_payload(code, e, "鍘嗗彶鍥炴姤璇诲彇澶辫触")


@router.get("/peer-performance")
async def fund_peer_performance(
    code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜"),
):
    """鍋忚偂娣峰悎鍧囧€?/ 娌繁300 / 涓氱哗姣旇緝鍩哄噯 鍚屾湡鏀剁泭鐜囷紙3m/6m/1y/3y/5y/鎴愮珛鑷充粖/骞村寲锛夈€?""
    from ..services.fund_service import get_fund_peer_performance

    try:
        data = await run_in_threadpool(get_fund_peer_performance, code=code)
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
            "missingReason": "鍚屾湡鏀剁泭璇诲彇澶辫触",
            "error": str(e)[:120],
        }


# ============================================================
#  P2: 鍘嗗勾瑙勬ā鍙樺寲 / 鍩洪噾鎹㈡墜鐜?/ 鍩洪噾缁忕悊鍙樻洿
# ============================================================

@router.get("/scale-history")
async def fund_scale_history(
    code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜"),
    periods: int = Query(40, ge=1, le=80, description="杩斿洖鏈€杩戝灏戜釜瀛ｅ害"),
):
    """鍘嗗勾瑙勬ā鍙樺寲锛氭湰鍩洪噾鍑€璧勪骇 + 鍚岀被 25% 鍒嗕綅锛堝搴︼級銆?""
    from ..services.fund_service import get_fund_scale_history

    try:
        data = await run_in_threadpool(get_fund_scale_history, code=code, periods=periods)
        return _detail_rows_payload(code, data, default_reason="缂哄皯鐪熷疄瑙勬ā鍘嗗彶鏁版嵁")
    except Exception as e:
        logger.error(f"fund.scaleHistory failed for {code}: {e}")
        return _empty_rows_payload(code, e, "瑙勬ā鍘嗗彶璇诲彇澶辫触")


@router.get("/turnover-history")
async def fund_turnover_history(
    code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜"),
    periods: int = Query(40, ge=1, le=80, description="杩斿洖鏈€杩戝灏戜釜瀛ｅ害"),
):
    """鍩洪噾鎹㈡墜鐜囷紙瀛ｅ害锛夈€?""
    from ..services.fund_service import get_fund_turnover_history

    try:
        data = await run_in_threadpool(get_fund_turnover_history, code=code, periods=periods)
        return _detail_rows_payload(code, data, default_reason="缂哄皯鐪熷疄鎹㈡墜鐜囨暟鎹?)
    except Exception as e:
        logger.error(f"fund.turnoverHistory failed for {code}: {e}")
        return _empty_rows_payload(code, e, "鎹㈡墜鐜囪鍙栧け璐?)


@router.get("/manager-history")
async def fund_manager_history(code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜")):
    """鍩洪噾缁忕悊鍙樻洿锛氬巻浠荤粡鐞嗕换鑱?绂昏亴鏃ユ湡/浠昏亴鎬诲洖鎶?骞村寲鍥炴姤/鍚岀被鎺掑悕銆?""
    from ..services.fund_service import get_fund_manager_history

    try:
        data = await run_in_threadpool(get_fund_manager_history, code=code)
        payload = _detail_rows_payload(code, data, default_reason="缂哄皯鐪熷疄鍩洪噾缁忕悊鍙樻洿鏁版嵁")
        return {**payload, "managerCount": len(payload.get("rows") or [])}
    except Exception as e:
        logger.error(f"fund.managerHistory failed for {code}: {e}")
        payload = _empty_rows_payload(code, e, "鍩洪噾缁忕悊鍙樻洿璇诲彇澶辫触")
        return {**payload, "managerCount": 0}


# ============================================================
#  P3: 杩愪綔鍒嗘瀽锛堝熀閲戝畾鏈熸姤鍛婂叏鏂囷級
# ============================================================

@router.get("/manager-report")
async def fund_manager_report(code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜")):
    """杩愪綔鍒嗘瀽锛氳繑鍥炵湡瀹炲畾鏈熸姤鍛婃枃鏈紱涓嶅啀鐢ㄦā鏉挎垨 LLM 缂栭€犳姤鍛娿€?""
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
            "missingReason": "缂哄皯鐪熷疄鍩洪噾瀹氭湡鎶ュ憡鍘熸枃",
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
            "missingReason": "杩愪綔鍒嗘瀽璇诲彇澶辫触",
            "error": str(e)[:120],
        }


# ============================================================
#  椋庨櫓鎽樿锛堣鍒欏紩鎿庣敓鎴愶級
# ============================================================

@router.get("/risk-summary")
async def fund_risk_summary(
    code: str = Query(..., min_length=4, max_length=10, description="鍩洪噾浠ｇ爜"),
    window: str = Query("1y", description="鏃堕棿绐楀彛锛?y / 3y / 5y / inception"),
):
    """椋庨櫓鎽樿锛氬熀浜?fund_metrics_snapshot + 鍚岀被鍧囧€硷紝鐢ㄨ鍒欐ā鏉跨敓鎴愪腑鏂囪嚜鐒惰瑷€鎽樿锛屽彲閫塋LM娣卞害瑙ｈ銆?""
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
                "missingReason": "缂哄皯椋庨櫓鎸囨爣鎴栧噣鍊煎巻鍙诧紝鏃犳硶鐢熸垚椋庨櫓鎽樿",
            }
        # 鐢?LLM 瀵归闄╂憳瑕佽繘琛屾繁搴﹁В璇伙紙鏈烘瀯椋庢帶瀹樿瑙掞紝寮哄埗 JSON Schema 杈撳嚭锛?
        llm_prompt = f"""浣犳槸涓€瀹跺ご閮ㄥ叕鍕熷熀閲戠鐞嗗叕鍙哥殑棣栧腑椋庢帶瀹橈紙CRO锛夛紝璇峰熀浜庝互涓嬩骇鍝侀闄╂暟鎹紝杈撳嚭**涓ユ牸鐨?JSON**锛堜笉瑕佷换浣曢澶栬鏄庢枃瀛楋級銆?

銆愪骇鍝佷俊鎭€?
路 浜у搧浠ｇ爜锛歿base.get('code')}
路 鑰冨療鍛ㄦ湡锛歿base.get('window')}
路 椋庨櫓绛夌骇锛歿base.get('level')}
路 鏈€澶у洖鎾わ細{base.get('maxDrawdown')}
路 鍚岀被骞冲潎鏈€澶у洖鎾わ細{base.get('peerMaxDrawdown')}
路 澶忔櫘姣旂巼锛歿base.get('sharpeRatio', '鏆傛棤')}

銆愯緭鍑?JSON Schema锛堜弗鏍奸伒瀹堬紝涓嶈澶氫綑瀛楁锛夈€?
{{
  "core_conclusion": "string, 30-50瀛楋紝涓€鍙ヨ瘽椋庢帶缁撹",
  "risk_sources": ["string", "string", "string"],
  "quantitative_positioning": "string, 30-50瀛楋紝瀹氶噺瀵规爣锛堝洖鎾や负鍚岀被 X 鍊嶏級",
  "suitability_advice": "string, 30-60瀛楋紝鏄庣‘閫傚悎/涓嶉€傚悎浣曠椋庨櫓鍋忓ソ鎶曡祫鑰?,
  "monitoring_focus": "string, 20-40瀛楋紝鍚庣画閲嶇偣鐩戞帶鐨勬寚鏍?
}}

銆愮‖鎬х害鏉熴€?
1. 涓ョ缂栭€犳暟鎹紝鎵€鏈夋暟鍊煎繀椤诲熀浜庝笂杩颁骇鍝佷俊鎭?
2. 涓ョ瀹㈠璇濄€佷弗绂?缁间笂鎵€杩?
3. 涓枃杈撳嚭锛屼笓涓氭満鏋勫彛鍚?
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

        # 瑙ｆ瀽 + 绫诲瀷鏍￠獙
        candidate = None
        if llm_summary_raw:
            try:
                candidate = json.loads(llm_summary_raw)
            except json.JSONDecodeError:
                logger.warning(f"riskSummary LLM 闈濲SON杈撳嚭, 鍥炶惤瑙勫垯寮曟搸: {code}")
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
            # 鑷冲皯瑕佹湁 core_conclusion 闈炵┖鎵嶈涓烘湁鏁?LLM 杈撳嚭
            if core:
                llm_summary = (
                    f"銆愰闄╁畾绾с€憑core}\n"
                    f"銆愰闄╂潵婧愩€憑'锛?.join(sources) if sources else '鏆傛棤'}\n"
                    f"銆愬悓涓氬鏍囥€憑positioning or '鏆傛棤'}\n"
                    f"銆愰€傚綋鎬у缓璁€憑suitability or '鏆傛棤'}\n"
                    f"銆愮洃鎺ч噸鐐广€憑monitoring or '鏆傛棤'}"
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
            "missingReason": "椋庨櫓鎽樿璇诲彇澶辫触",
            "error": str(e)[:120],
        }

