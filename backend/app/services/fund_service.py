"""基金排名筛选服务

数据源策略：
- 全市场排名 → akshare fund_open_fund_rank_em（Tushare 不提供聚合排名）
- 回退排名 → eastmoney 东方财富 API
- 基金详情 → Tushare（Fusion 优先级5，付费高频）→ iFinD → Tickflow → Tencent
- 基金规模 → Tushare fund_share × unit_nav → efinance fallback
- 基金费率 → efinance（Tushare 不提供费率字段）
- 持仓/经理 → Tushare fund_portfolio / fund_manager → akshare 补充学历信息
"""
import math
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import date, datetime, timedelta
from typing import Any

from ..config import CACHE_TTL_RANKING
from ..constants.guoyuan_funds import FUND_CATEGORIES, FUND_TYPES, GUOYUAN_FUND_LIST
from ..data.cache_manager import cache
from ..storage.database import get_db_context
from ..utils import console_error

# 排序字段映射（提取为模块级常量，避免重复定义）
SORT_FIELD_MAP: dict[str, str] = {
    "近1月": "near_1m", "近3月": "near_3m", "近6月": "near_6m",
    "近1年": "near_1y", "近3年": "near_3y", "今年来": "ytd",
}

BULK_PERFORMANCE_TIMEOUT_SECONDS = float(os.getenv("FUNDTRADER_BULK_PERFORMANCE_TIMEOUT_SECONDS", "8"))
_bulk_performance_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fund-perf")


def _to_date(value: Any) -> date | None:
    if not value:
        return None
    text = str(value)[:10]
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def _calc_window_metrics_from_nav(
    nav_rows: list[dict[str, Any]],
    *,
    as_of: date,
    window_days: int = 365,
    risk_free_rate: float = 0.02,
) -> dict[str, float] | None:
    import numpy as np

    start_date = as_of - timedelta(days=window_days)
    points: list[tuple[date, float]] = []
    for row in nav_rows:
        d = _to_date(row.get("nav_date") or row.get("date"))
        if not d or d < start_date or d > as_of:
            continue
        try:
            nav = float(row.get("nav", 0) or 0)
        except (TypeError, ValueError):
            continue
        if nav > 0:
            points.append((d, nav))
    if len(points) < 200:
        return None
    points.sort(key=lambda x: x[0])
    navs = np.array([p[1] for p in points], dtype=np.float64)
    if len(navs) < 2 or navs[0] <= 0:
        return None
    daily_returns = np.diff(navs) / navs[:-1]
    daily_returns = np.nan_to_num(daily_returns, nan=0.0, posinf=0.0, neginf=0.0)
    elapsed_days = max(1, (points[-1][0] - points[0][0]).days)
    annualized_return = (navs[-1] / navs[0]) ** (365.0 / elapsed_days) - 1.0
    annualized_vol = float(np.std(daily_returns, ddof=1) * np.sqrt(252)) if len(daily_returns) > 1 else 0.0
    excess_daily = daily_returns - risk_free_rate / 252.0
    std_excess = float(np.std(excess_daily, ddof=1))
    sharpe = float(np.mean(excess_daily) / std_excess * np.sqrt(252)) if std_excess > 0 else 0.0
    peak = np.maximum.accumulate(navs)
    drawdown = (navs - peak) / peak
    max_dd = float(np.min(drawdown))
    return {
        "annualized_return": float(annualized_return),
        "max_drawdown": max_dd,
        "sharpe_ratio": sharpe,
    }


def compute_category_metrics_1y(
    *,
    window_days: int = 365,
    risk_free_rate: float = 0.02,
    xinjihui_only: bool = False,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Compute 1Y category average annual return/max drawdown/sharpe and snapshot to SQLite."""
    from ..data.efinance_fetcher import get_fund_nav_history
    from ..storage.database import FundDataStore

    as_of = datetime.now().date()
    as_of_text = as_of.isoformat()

    # Fast path: reuse latest snapshot for today unless force_refresh
    if not force_refresh:
        latest = FundDataStore.get_latest_category_metrics(window_days=window_days)
        if latest.get("as_of_date") == as_of_text and latest.get("rows"):
            return latest

    with get_db_context() as conn:
        where = "WHERE is_active = 1"
        params: list[Any] = []
        if xinjihui_only:
            where += " AND (is_xinjihui = 1 OR is_preferred = 1)"
        masters = conn.execute(
            f"SELECT code, fund_type FROM fund_master {where} ORDER BY code",
            params,
        ).fetchall()
        nav_map: dict[str, list[dict[str, Any]]] = {}
        for row in conn.execute(
            "SELECT code, nav_date, nav FROM fund_nav_history WHERE nav_date >= ?",
            ((as_of - timedelta(days=window_days + 30)).isoformat(),),
        ).fetchall():
            nav_map.setdefault(row["code"], []).append(dict(row))

    category_bucket: dict[str, dict[str, Any]] = {}
    for row in masters:
        code = row["code"]
        category = (row["fund_type"] or "unknown").strip() or "unknown"
        bucket = category_bucket.setdefault(category, {
            "category": category,
            "annualized_returns": [],
            "max_drawdowns": [],
            "sharpes": [],
            "sample_count": 0,
            "total_count": 0,
        })
        bucket["total_count"] += 1

        nav_rows = nav_map.get(code) or []
        if len(nav_rows) < 200:
            fetched = get_fund_nav_history(code)
            if fetched:
                nav_rows = fetched

        metrics = _calc_window_metrics_from_nav(
            nav_rows,
            as_of=as_of,
            window_days=window_days,
            risk_free_rate=risk_free_rate,
        )
        if not metrics:
            continue
        bucket["sample_count"] += 1
        bucket["annualized_returns"].append(metrics["annualized_return"])
        bucket["max_drawdowns"].append(metrics["max_drawdown"])
        bucket["sharpes"].append(metrics["sharpe_ratio"])

    rows: list[dict[str, Any]] = []
    for category, bucket in category_bucket.items():
        sample = int(bucket["sample_count"])
        total = int(bucket["total_count"])
        cov = (sample / total) if total > 0 else 0.0
        ann = sum(bucket["annualized_returns"]) / sample if sample > 0 else None
        mdd = sum(bucket["max_drawdowns"]) / sample if sample > 0 else None
        shp = sum(bucket["sharpes"]) / sample if sample > 0 else None
        rows.append({
            "category": category,
            "avg_annual_return_eq": ann,
            "avg_max_drawdown_eq": mdd,
            "avg_sharpe_eq": shp,
            "sample_count": sample,
            "total_count": total,
            "coverage_ratio": cov,
        })

    FundDataStore.save_category_metrics_snapshot(
        rows,
        as_of_date=as_of_text,
        window_days=window_days,
        risk_free_rate=risk_free_rate,
        calc_version="v1.0-1y-nav",
    )
    return FundDataStore.get_latest_category_metrics(window_days=window_days)


def _safe_float(value: Any, default: float = 0.0) -> float:
    """Return a JSON-safe finite float."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    return num if math.isfinite(num) else default


def _json_safe(value: Any) -> Any:
    """Recursively remove non-finite floats before FastAPI JSON serialization."""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, float):
        return value if math.isfinite(value) else 0.0
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _apply_filters_and_sort(
    funds: list[dict[str, Any]],
    category: str,
    tag: str | None,
    keyword: str | None,
    sort_by: str,
    sort_order: str,
) -> list[dict[str, Any]]:
    """通用筛选、排序逻辑（提取公共代码）"""
    # 按标签筛选
    if tag:
        funds = [f for f in funds if tag in f.get("tags", []) or tag in f.get("name", "")]

    # 按关键词筛选
    if keyword:
        funds = [f for f in funds if keyword in f.get("name", "") or keyword in f.get("code", "")]

    # 按类型筛选
    if category != "全部":
        funds = [f for f in funds if f.get("type", "") == category or f.get("类型", "") == category]

    # 排序
    sort_field = SORT_FIELD_MAP.get(sort_by, "ytd")
    reverse = sort_order == "desc"
    funds.sort(key=lambda x: float(x.get(sort_field, 0) or 0), reverse=reverse)

    return funds


def get_fund_list(
    category: str = "全部",
    tag: str | None = None,
    keyword: str | None = None,
    sort_by: str = "今年来",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 20,
    guoyuan_only: bool = True,
) -> dict[str, Any]:
    """Get fund list from local snapshots only."""
    funds = _get_snapshot_funds(guoyuan_only=guoyuan_only)
    if not funds and guoyuan_only:
        funds = _get_guoyuan_funds_with_performance()

    # 筛选+排序
    funds = _apply_filters_and_sort(funds, category, tag, keyword, sort_by, sort_order)

    # 分页
    total = len(funds)
    start = (page - 1) * page_size
    end = start + page_size
    page_funds = funds[start:end]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "funds": _json_safe(page_funds),
        "categories": FUND_CATEGORIES,
        "types": FUND_TYPES,
    }


def get_fund_list_from_watchlist(
    category: str = "全部",
    tag: str | None = None,
    keyword: str | None = None,
    sort_by: str = "今年来",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """从自选基金列表获取基金数据"""
    from ..services.watchlist_service import get_watchlist
    watchlist = get_watchlist()

    if not watchlist:
        return {
            "total": 0,
            "page": page,
            "page_size": page_size,
            "funds": [],
            "categories": FUND_CATEGORIES,
            "types": FUND_TYPES,
        }

    # 为自选基金获取业绩数据
    funds = _get_watchlist_with_performance(watchlist)

    # 筛选+排序
    funds = _apply_filters_and_sort(funds, category, tag, keyword, sort_by, sort_order)

    # 分页
    total = len(funds)
    start = (page - 1) * page_size
    end = start + page_size
    page_funds = funds[start:end]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "funds": _json_safe(page_funds),
        "categories": FUND_CATEGORIES,
        "types": FUND_TYPES,
    }


def _get_watchlist_with_performance(watchlist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """为自选基金获取业绩数据（批量模式）"""
    result = []
    for fund in watchlist:
        fund_data = dict(fund)
        perf = _get_snapshot_by_code(str(fund.get("code", "")))
        if perf:
            fund_data.update(perf)
        result.append(fund_data)
    return result


def _get_snapshot_by_code(code: str) -> dict[str, Any] | None:
    try:
        from app.storage.database import FundDataStore
        return FundDataStore.get_snapshot(code)
    except Exception:
        return None


def _get_snapshot_funds(guoyuan_only: bool = True) -> list[dict[str, Any]]:
    try:
        from app.storage.database import FundDataStore
        result = FundDataStore.list_snapshots(xinjihui_only=guoyuan_only, limit=5000, offset=0)
        funds = result.get("funds") or []
        if funds:
            return _json_safe(funds)
    except Exception:
        pass
    return []


def _get_guoyuan_funds_with_performance() -> list[dict[str, Any]]:
    """获取国元证券基金名单及业绩数据（SQLite优先，API回退）"""
    snapshot = _get_snapshot_funds(guoyuan_only=True)
    if snapshot:
        return snapshot

    # 2. Fallback to in-memory cache
    cache_key = "guoyuan_funds_performance"
    result = cache.get(cache_key, CACHE_TTL_RANKING)
    if result is not None:
        return result

    # 3. Fast fallback. The home page must not wait for AkShare; snapshots are
    # refreshed by the scheduler and this static pool is enough to render list.
    result = _get_static_guoyuan_funds()
    cache.set(cache_key, result)
    return result


def _get_static_guoyuan_funds() -> list[dict[str, Any]]:
    """Return the local fund pool with JSON-safe default metrics."""
    # 批量从 fund_master 表读取基金公司信息作为补充
    master_companies = {}
    try:
        from app.storage.database import get_db
        with get_db() as conn:
            rows = conn.execute("SELECT code, company FROM fund_master WHERE company != ''").fetchall()
            master_companies = {r["code"]: r["company"] for r in rows}
    except Exception:
        pass

    result = []
    for fund in GUOYUAN_FUND_LIST:
        fund_data = dict(fund)
        code = str(fund_data.get("code", ""))
        fund_data.setdefault("nav", 0.0)
        fund_data.setdefault("day_growth", 0.0)
        fund_data.setdefault("near_1m", 0.0)
        fund_data.setdefault("near_3m", 0.0)
        fund_data.setdefault("near_6m", 0.0)
        fund_data.setdefault("near_1y", 0.0)
        fund_data.setdefault("near_3y", 0.0)
        fund_data.setdefault("ytd", 0.0)
        fund_data.setdefault("company", master_companies.get(code, ""))
        fund_data["is_xinjihui"] = True
        result.append(fund_data)
    return _json_safe(result)


def _fetch_all_fund_performance_with_timeout() -> dict[str, dict[str, Any]]:
    cached = cache.get("bulk_fund_performance", CACHE_TTL_RANKING)
    if cached is not None:
        return cached
    future = _bulk_performance_executor.submit(_fetch_all_fund_performance)
    try:
        return future.result(timeout=BULK_PERFORMANCE_TIMEOUT_SECONDS)
    except TimeoutError:
        console_error(f"Bulk performance fetch timed out after {BULK_PERFORMANCE_TIMEOUT_SECONDS}s; using basic fund list")
        return {}
    except Exception as e:
        console_error(f"Bulk performance fetch failed: {e}")
        return {}


def _fetch_all_fund_performance() -> dict[str, dict[str, Any]]:
    """批量获取全市场基金业绩数据（一次akshare调用，避免N次重复请求）
    
    基金业绩数据日频更新，单个交易日收盘后统一公布。
    缓存TTL由调用方控制，默认与CACHE_TTL_RANKING一致（30分钟）。
    """
    cache_key = "bulk_fund_performance"
    cached = cache.get(cache_key, CACHE_TTL_RANKING)
    if cached is not None:
        return cached

    perf_map: dict[str, dict[str, Any]] = {}
    try:
        import akshare as ak
        df = ak.fund_open_fund_rank_em(symbol="全部")
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                code = str(row.get("基金代码", "")).strip()
                if not code:
                    continue
                perf_map[code] = {
                    "nav": _safe_float(row.get("单位净值")),
                    "day_growth": _safe_float(row.get("日增长率")),
                    "near_1m": _safe_float(row.get("近1月")),
                    "near_3m": _safe_float(row.get("近3月")),
                    "near_6m": _safe_float(row.get("近6月")),
                    "near_1y": _safe_float(row.get("近1年")),
                    "near_3y": _safe_float(row.get("近3年")),
                    "ytd": _safe_float(row.get("今年来")),
                }
        cache.set(cache_key, perf_map)
    except Exception as e:
        console_error(f"Bulk performance fetch error: {e}")
    return perf_map


def _compute_single_fund_metrics(code: str, RISK_FREE_RATE: float) -> dict[str, Any] | None:
    """Compute risk metrics for a single fund from NAV history.

    Returns a metrics dict or None if skipped/failed.
    """
    import numpy as np

    from ..data.efinance_fetcher import get_fund_nav_history

    try:
        nav_data = get_fund_nav_history(code)
        if not nav_data or len(nav_data) < 30:
            return None

        navs = []
        for item in nav_data:
            try:
                v = float(item.get("nav", 0) or 0)
                if v > 0:
                    navs.append(v)
            except (ValueError, TypeError):
                continue

        if len(navs) < 30:
            return None

        arr = np.array(navs, dtype=np.float64)
        daily_returns = np.diff(arr) / arr[:-1]
        daily_returns = np.nan_to_num(daily_returns, nan=0.0, posinf=0.0, neginf=0.0)

        n_years = len(navs) / 252.0
        total_return = arr[-1] / arr[0] - 1.0
        ann_return = (1 + total_return) ** (1.0 / n_years) - 1.0 if n_years > 0 else 0.0

        ann_vol = float(np.std(daily_returns, ddof=1) * np.sqrt(252)) if len(daily_returns) > 1 else 0.0

        excess_daily = daily_returns - RISK_FREE_RATE / 252.0
        std_excess = np.std(excess_daily, ddof=1)
        sharpe = float(np.mean(excess_daily) / std_excess * np.sqrt(252)) if std_excess > 0 else 0.0

        peak = np.maximum.accumulate(arr)
        drawdown = (arr - peak) / peak
        max_dd = float(np.min(drawdown))

        return {
            "code": code,
            "sharpe_ratio": round(sharpe, 4),
            "max_drawdown": round(max_dd, 4),
            "volatility": round(ann_vol, 4),
            "annualized_return": round(ann_return, 4),
            "nav_points": len(navs),
            "data_quality": "computed",
        }
    except Exception:
        return None


def compute_and_save_metrics(
    codes: list[str] | None = None,
    limit: int = 0,
    skip_existing: bool = True,
    batch_size: int = 100,
    max_workers: int = 8,
) -> dict[str, Any]:
    """Compute risk metrics (sharpe, max_drawdown, volatility) from NAV history
    and save to fund_metrics_snapshot table.

    Uses ThreadPoolExecutor for concurrent NAV history fetching.

    Args:
        codes: Optional list of fund codes. If None, computes for all funds in fund_master.
        limit: Max number of funds to process (0 = all).
        skip_existing: Skip funds that already have metrics in the table.
        batch_size: Save to DB every N computed results.
        max_workers: Number of concurrent workers for fetching NAV history.

    Returns:
        Summary dict with counts and errors.
    """
    from ..storage.database import FundDataStore

    RISK_FREE_RATE = 0.02

    if codes is None:
        with get_db_context() as conn:
            rows = conn.execute(
                "SELECT code FROM fund_master WHERE is_active = 1 ORDER BY code"
            ).fetchall()
            codes = [r["code"] for r in rows]

    if skip_existing:
        with get_db_context() as conn:
            existing = conn.execute(
                "SELECT code FROM fund_metrics_snapshot WHERE data_quality = 'computed'"
            ).fetchall()
            existing_codes = {r["code"] for r in existing}
        codes = [c for c in codes if c not in existing_codes]

    if limit > 0:
        codes = codes[:limit]

    if not codes:
        return {
            "total_codes": 0,
            "computed": 0,
            "saved": 0,
            "skipped": 0,
            "errors": 0,
            "error_details": [],
        }

    results = []
    errors = []
    skipped = 0
    saved_total = 0

    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="metrics") as executor:
        futures = {executor.submit(_compute_single_fund_metrics, code, RISK_FREE_RATE): code for code in codes}

        for future in futures:
            code = futures[future]
            try:
                result = future.result(timeout=30)
                if result is None:
                    skipped += 1
                else:
                    results.append(result)
            except Exception as e:
                errors.append({"code": code, "error": str(e)[:100]})

            if len(results) >= batch_size:
                saved_total += FundDataStore.save_metrics_batch(results, source="compute")
                results = []

    if results:
        saved_total += FundDataStore.save_metrics_batch(results, source="compute")

    return {
        "total_codes": len(codes),
        "computed": saved_total,
        "saved": saved_total,
        "skipped": skipped,
        "errors": len(errors),
        "error_details": errors[:10],
    }
