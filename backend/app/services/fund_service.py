"""鍩洪噾鎺掑悕绛涢€夋湇鍔?

鏁版嵁婧愮瓥鐣ワ細
- 鍏ㄥ競鍦烘帓鍚?鈫?akshare fund_open_fund_rank_em锛圱ushare 涓嶆彁渚涜仛鍚堟帓鍚嶏級
- 鍥為€€鎺掑悕 鈫?eastmoney 涓滄柟璐㈠瘜 API
- 鍩洪噾璇︽儏 鈫?Tushare锛團usion 浼樺厛绾?锛屼粯璐归珮棰戯級鈫?iFinD 鈫?Tickflow 鈫?Tencent
- 鍩洪噾瑙勬ā 鈫?Tushare fund_share 脳 unit_nav 鈫?efinance fallback
- 鍩洪噾璐圭巼 鈫?efinance锛圱ushare 涓嶆彁渚涜垂鐜囧瓧娈碉級
- 鎸佷粨/缁忕悊 鈫?Tushare fund_portfolio / fund_manager 鈫?akshare 琛ュ厖瀛﹀巻淇℃伅
"""

import logging

import math
import os
import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import date, datetime, timedelta
from typing import Any

from ..config import CACHE_TTL_RANKING
from ..constants.guoyuan_funds import FUND_CATEGORIES, FUND_TYPES, GUOYUAN_FUND_LIST
from ..data.cache_manager import cache
from ..storage.database import FundDataStore, get_db_context
from ..utils import console_error

# 鎺掑簭瀛楁鏄犲皠锛堟彁鍙栦负妯″潡绾у父閲忥紝閬垮厤閲嶅瀹氫箟锛?
SORT_FIELD_MAP: dict[str, str] = {
    "杩?鏈?: "near_1m", "杩?鏈?: "near_3m", "杩?鏈?: "near_6m",
    "杩?骞?: "near_1y", "杩?骞?: "near_3y", "浠婂勾鏉?: "ytd",
}

# 鍩洪噾绫诲瀷 鈫?鑻辨枃妗舵槧灏勶紙棣栭〉 categoryMetrics 浣跨敤锛?
_TYPE_BUCKET_MAP: dict[str, str] = {
    "鑲＄エ鍨?: "equity", "娣峰悎鍨?: "hybrid", "鍊哄埜鍨?: "bond",
    "鎸囨暟鍨?: "index", "ETF": "etf", "QDII": "qdii",
    "璐у竵鍨?: "money", "璐у竵": "money", "FOF": "fof", "REITs": "reits",
    "ETF鑱旀帴": "etf", "鑱旀帴鍩洪噾": "etf",
}

HS300_BENCHMARK_CODE = "000300"


def _normalize_fund_type_to_bucket(raw: str, name: str = "") -> str:
    """鎶?fund_master.fund_type 涓枃褰掔被涓洪椤电粺涓€鐨勮嫳鏂囨《 key.

    鍚?ETF/LOF 鍚嶇О鐨勫熀閲戝嵆浣?fund_type 涓?鎸囨暟鍨?涔熷綊鍏?etf bucket锛?
    涓庡墠绔?inferFundType 淇濇寔涓€鑷淬€?
    """
    s = (raw or "").strip()
    text = (s + (name or "")).upper()
    if "ETF" in text or "LOF" in text:
        return "etf"
    return _TYPE_BUCKET_MAP.get(s) or s or "other"


DETAIL_STATUS_AVAILABLE = "available"
DETAIL_STATUS_PARTIAL = "partial"
DETAIL_STATUS_MISSING = "missing"
DETAIL_STATUS_SIMULATED = "simulated"


def _detail_meta(
    *,
    status: str,
    source: str | None = None,
    as_of: str | None = None,
    coverage: float | None = None,
    missing_reason: str | None = None,
) -> dict[str, Any]:
    return {
        "dataStatus": status,
        "source": source,
        "asOf": as_of,
        "coverage": coverage,
        "missingReason": missing_reason,
    }


def _rows_response(
    code: str,
    rows: list[dict[str, Any]] | None,
    *,
    status: str | None = None,
    source: str | None = None,
    as_of: str | None = None,
    coverage: float | None = None,
    missing_reason: str | None = None,
) -> dict[str, Any]:
    clean_rows = rows or []
    resolved_status = status or (DETAIL_STATUS_AVAILABLE if clean_rows else DETAIL_STATUS_MISSING)
    return {
        "code": code,
        "rows": clean_rows,
        **_detail_meta(
            status=resolved_status,
            source=source,
            as_of=as_of,
            coverage=coverage if coverage is not None else (1.0 if clean_rows else 0.0),
            missing_reason=missing_reason
            if missing_reason and resolved_status in {DETAIL_STATUS_PARTIAL, DETAIL_STATUS_MISSING, DETAIL_STATUS_SIMULATED}
            else None,
        ),
    }


def _empty_perf_row() -> dict[str, float | None]:
    return {
        "return3m": None,
        "return6m": None,
        "return1y": None,
        "return3y": None,
        "return5y": None,
        "returnSinceInception": None,
        "annualizedReturn": None,
    }


def _pct_for_api(value: Any) -> float | None:
    """Normalize return fields to display percent units without double-scaling."""
    x = _safe_float(value)
    if x is None:
        return None
    return round(x * 100, 4) if abs(x) <= 1 else round(x, 4)


def _parse_json_array(value: Any) -> list[dict[str, Any]]:
    if not value:
        return []
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def _safe_table_query(sql: str, params: tuple[Any, ...] = ()) -> list[Any]:
    try:
        with get_db_context() as conn:
            return conn.execute(sql, params).fetchall()
    except Exception:
        return []


def _get_nav_history_for_detail(code: str) -> tuple[list[dict[str, Any]], str | None, str | None]:
    rows = _safe_table_query(
        """SELECT nav_date, nav, accum_nav, day_growth
           FROM fund_nav_history
           WHERE code = ?
           ORDER BY nav_date ASC""",
        (code,),
    )
    nav_rows = [
        {
            "nav_date": str(row["nav_date"]),
            "nav": _safe_float(row["nav"]),
            "accum_nav": _safe_float(row["accum_nav"]),
            "day_growth": _safe_float(row["day_growth"]),
        }
        for row in rows
        if _safe_float(row["nav"]) is not None and str(row["nav_date"] or "")
    ]
    if len(nav_rows) >= 2:
        return nav_rows, "fund_nav_history", nav_rows[-1]["nav_date"]

    try:
        from ..data.efinance_fetcher import get_fund_nav_history
        from ..storage.database import FundDataStore

        fetched = get_fund_nav_history(code)
        clean: list[dict[str, Any]] = []
        for item in fetched or []:
            nav_date = str(item.get("date") or item.get("nav_date") or item.get("鍑€鍊兼棩鏈?) or "")[:10]
            nav = _safe_float(item.get("nav") or item.get("鍗曚綅鍑€鍊?) or item.get("nav_value"))
            if nav_date and nav is not None and nav > 0:
                clean.append({
                    "nav_date": nav_date,
                    "nav": nav,
                    "accum_nav": _safe_float(item.get("acc_nav") or item.get("accum_nav") or item.get("绱鍑€鍊?)),
                    "day_growth": _safe_float(item.get("day_growth") or item.get("鏃ュ闀跨巼") or item.get("澧為暱鐜?)),
                })
        clean.sort(key=lambda row: row["nav_date"])
        if len(clean) >= 2:
            try:
                FundDataStore.save_nav_history_batch(code, clean, source="efinance")
            except Exception:
            logging.exception("Ignored non-fatal exception")
            return clean, "efinance", clean[-1]["nav_date"]
    except Exception as e:
        console_error(f"detail nav history fetch failed for {code}: {e}")
    return [], None, None


def _window_return_from_nav(nav_rows: list[dict[str, Any]], days: int) -> float | None:
    if len(nav_rows) < 2:
        return None
    latest = _to_date(nav_rows[-1].get("nav_date"))
    if not latest:
        return None
    start = latest - timedelta(days=days)
    start_row = None
    for row in nav_rows:
        d = _to_date(row.get("nav_date"))
        if d and d >= start:
            start_row = row
            break
    if not start_row:
        return None
    start_nav = _safe_float(start_row.get("nav"))
    end_nav = _safe_float(nav_rows[-1].get("nav"))
    if not start_nav or start_nav <= 0 or end_nav is None:
        return None
    return round((end_nav / start_nav - 1.0) * 100, 4)


def _annual_return_from_nav(nav_rows: list[dict[str, Any]], year: int) -> float | None:
    points: list[dict[str, Any]] = []
    for row in nav_rows:
        d = _to_date(row.get("nav_date"))
        nav = _safe_float(row.get("nav"))
        if d and d.year == year and nav is not None and nav > 0:
            points.append(row)
    if len(points) < 2:
        return None
    start_nav = _safe_float(points[0].get("nav"))
    end_nav = _safe_float(points[-1].get("nav"))
    if not start_nav or start_nav <= 0 or end_nav is None:
        return None
    return round((end_nav / start_nav - 1.0) * 100, 4)


def _risk_metrics_from_nav(nav_rows: list[dict[str, Any]]) -> dict[str, float] | None:
    import numpy as np

    values = [_safe_float(row.get("nav")) for row in nav_rows]
    navs = np.array([v for v in values if v is not None and v > 0], dtype=np.float64)
    if len(navs) < 30:
        return None
    daily_returns = np.diff(navs) / navs[:-1]
    daily_returns = np.nan_to_num(daily_returns, nan=0.0, posinf=0.0, neginf=0.0)
    annualized_vol = float(np.std(daily_returns, ddof=1) * np.sqrt(252)) if len(daily_returns) > 1 else 0.0
    downside = daily_returns[daily_returns < 0]
    downside_risk = float(np.std(downside, ddof=1) * np.sqrt(252)) if len(downside) > 1 else 0.0
    peak = np.maximum.accumulate(navs)
    max_dd = float(np.min((navs - peak) / peak))
    return {
        "max_drawdown": max_dd,
        "volatility": annualized_vol,
        "downside_risk": downside_risk,
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
            f"""SELECT m.code, m.name, m.fund_type,
                       ms.annualized_return, ms.max_drawdown, ms.sharpe_ratio, ms.nav_points
                FROM fund_master m
                LEFT JOIN fund_metrics_snapshot ms ON ms.code = m.code
                {where.replace('is_active', 'm.is_active')}
                ORDER BY m.code""",
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
        category = _normalize_fund_type_to_bucket(row["fund_type"] or "", row["name"] or "")
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
        metrics = _calc_window_metrics_from_nav(
            nav_rows,
            as_of=as_of,
            window_days=window_days,
            risk_free_rate=risk_free_rate,
        )
        if metrics:
            bucket["sample_count"] += 1
            bucket["annualized_returns"].append(metrics["annualized_return"])
            bucket["max_drawdowns"].append(metrics["max_drawdown"])
            bucket["sharpes"].append(metrics["sharpe_ratio"])
            continue

        # Fast fallback: local computed metrics snapshot (still local-only, no external API)
        if int(row["nav_points"] or 0) >= 200 and row["annualized_return"] is not None and row["max_drawdown"] is not None and row["sharpe_ratio"] is not None:
            bucket["sample_count"] += 1
            bucket["annualized_returns"].append(float(row["annualized_return"]))
            bucket["max_drawdowns"].append(float(row["max_drawdown"]))
            bucket["sharpes"].append(float(row["sharpe_ratio"]))

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
    """閫氱敤绛涢€夈€佹帓搴忛€昏緫锛堟彁鍙栧叕鍏变唬鐮侊級"""
    # 鎸夋爣绛剧瓫閫?
    if tag:
        funds = [f for f in funds if tag in f.get("tags", []) or tag in f.get("name", "")]

    # 鎸夊叧閿瘝绛涢€?
    if keyword:
        funds = [f for f in funds if keyword in f.get("name", "") or keyword in f.get("code", "")]

    # 鎸夌被鍨嬬瓫閫?
    if category != "鍏ㄩ儴":
        funds = [f for f in funds if f.get("type", "") == category or f.get("绫诲瀷", "") == category]

    # 鎺掑簭
    sort_field = SORT_FIELD_MAP.get(sort_by, "ytd")
    reverse = sort_order == "desc"
    funds.sort(key=lambda x: float(x.get(sort_field, 0) or 0), reverse=reverse)

    return funds


def get_fund_list(
    category: str = "鍏ㄩ儴",
    tag: str | None = None,
    keyword: str | None = None,
    sort_by: str = "浠婂勾鏉?,
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 20,
    guoyuan_only: bool = True,
) -> dict[str, Any]:
    """Get fund list from local snapshots only."""
    funds = _get_snapshot_funds(guoyuan_only=guoyuan_only)
    if not funds and guoyuan_only:
        funds = _get_guoyuan_funds_with_performance()

    # 绛涢€?鎺掑簭
    funds = _apply_filters_and_sort(funds, category, tag, keyword, sort_by, sort_order)

    # 鍒嗛〉
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
    category: str = "鍏ㄩ儴",
    tag: str | None = None,
    keyword: str | None = None,
    sort_by: str = "浠婂勾鏉?,
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """浠庤嚜閫夊熀閲戝垪琛ㄨ幏鍙栧熀閲戞暟鎹?""
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

    # 涓鸿嚜閫夊熀閲戣幏鍙栦笟缁╂暟鎹?
    funds = _get_watchlist_with_performance(watchlist)

    # 绛涢€?鎺掑簭
    funds = _apply_filters_and_sort(funds, category, tag, keyword, sort_by, sort_order)

    # 鍒嗛〉
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
    """涓鸿嚜閫夊熀閲戣幏鍙栦笟缁╂暟鎹紙鎵归噺妯″紡锛?""
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
    logging.exception("Ignored non-fatal exception")
    return []


def _get_guoyuan_funds_with_performance() -> list[dict[str, Any]]:
    """鑾峰彇鍥藉厓璇佸埜鍩洪噾鍚嶅崟鍙婁笟缁╂暟鎹紙SQLite浼樺厛锛孉PI鍥為€€锛?""
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
    # 鎵归噺浠?fund_master 琛ㄨ鍙栧熀閲戝叕鍙镐俊鎭綔涓鸿ˉ鍏?
    master_companies = {}
    try:
        from app.storage.database import get_db
        with get_db() as conn:
            rows = conn.execute("SELECT code, company FROM fund_master WHERE company != ''").fetchall()
            master_companies = {r["code"]: r["company"] for r in rows}
    except Exception:
    logging.exception("Ignored non-fatal exception")

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
    """鎵归噺鑾峰彇鍏ㄥ競鍦哄熀閲戜笟缁╂暟鎹紙涓€娆kshare璋冪敤锛岄伩鍏峃娆￠噸澶嶈姹傦級
    
    鍩洪噾涓氱哗鏁版嵁鏃ラ鏇存柊锛屽崟涓氦鏄撴棩鏀剁洏鍚庣粺涓€鍏竷銆?
    缂撳瓨TTL鐢辫皟鐢ㄦ柟鎺у埗锛岄粯璁や笌CACHE_TTL_RANKING涓€鑷达紙30鍒嗛挓锛夈€?
    """
    cache_key = "bulk_fund_performance"
    cached = cache.get(cache_key, CACHE_TTL_RANKING)
    if cached is not None:
        return cached

    perf_map: dict[str, dict[str, Any]] = {}
    try:
        import akshare as ak
        df = ak.fund_open_fund_rank_em(symbol="鍏ㄩ儴")
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                code = str(row.get("鍩洪噾浠ｇ爜", "")).strip()
                if not code:
                    continue
                perf_map[code] = {
                    "nav": _safe_float(row.get("鍗曚綅鍑€鍊?)),
                    "day_growth": _safe_float(row.get("鏃ュ闀跨巼")),
                    "near_1m": _safe_float(row.get("杩?鏈?)),
                    "near_3m": _safe_float(row.get("杩?鏈?)),
                    "near_6m": _safe_float(row.get("杩?鏈?)),
                    "near_1y": _safe_float(row.get("杩?骞?)),
                    "near_3y": _safe_float(row.get("杩?骞?)),
                    "ytd": _safe_float(row.get("浠婂勾鏉?)),
                }
        cache.set(cache_key, perf_map)
    except Exception as e:
        console_error(f"Bulk performance fetch error: {e}")
    return perf_map


def _compute_single_fund_metrics(code: str, RISK_FREE_RATE: float) -> dict[str, Any] | None:
    """Compute risk metrics for a single fund from NAV history.

    Returns a metrics dict or None if skipped/failed.
    鍓綔鐢細鎶婃媺鍒扮殑 nav_data 鎸佷箙鍖栧埌 fund_nav_history锛屼緵 getFundAnalysis 璇伙紝
    閬垮厤璇︽儏椤?绱鏀剁泭瓒嬪娍"鍥炬棤鏁版嵁銆?
    """
    import numpy as np

    from ..data.efinance_fetcher import get_fund_nav_history
    from ..storage.database import FundDataStore

    try:
        nav_data = get_fund_nav_history(code)
        if not nav_data or len(nav_data) < 30:
            return None

        # 鎸佷箙鍖栧噣鍊煎巻鍙诧紙fund_nav_history锛夆€斺€?淇绱鏀剁泭瓒嬪娍鍥炬棤鏁版嵁
        try:
            FundDataStore.save_nav_history_batch(code, nav_data, source="compute")
        except Exception:
        logging.exception("Ignored non-fatal exception")

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


# ============================================================
#  P0: 鍩洪噾璇勭骇 / 璐拱淇℃伅 / 鎸佹湁浜虹粨鏋?
# ============================================================

def get_fund_rating(code: str) -> dict | None:
    """鍩洪噾璇勭骇锛? 骞?/ 5 骞?1~5 棰楁槦锛夈€?

    鏁版嵁婧愪紭鍏堢骇锛?
      1. tushare fund_rating锛堝鏈夋潈闄愶級
      2. 鐢ㄥ悓琛屼笟锛坒und.fund_type 鍖归厤 fund_category_metrics_snapshot锛?y 骞冲潎鏀剁泭 + 澶忔櫘鎺ㄧ畻
    """
    try:
        # 1) tushare 浼樺厛
        import tushare as ts
        from ..config import TUSHARE_TOKEN
        if TUSHARE_TOKEN:
            try:
                ts.set_token(TUSHARE_TOKEN)
                pro = ts.pro_api()
                for fn_name in ("fund_rating", "fund_rating_basic"):
                    if hasattr(pro, fn_name):
                        try:
                            df = getattr(pro, fn_name)(ts_code=_to_ts_code(code))
                            if df is not None and not df.empty:
                                latest = df.iloc[0]
                                return {
                                    "code": code,
                                    "rating3y": _safe_int(latest.get("rating_3y")),
                                    "rating5y": _safe_int(latest.get("rating_5y")),
                                    "score": None,
                                    "source": "tushare",
                                }
                        except Exception:
                        logging.exception("Ignored non-fatal exception")
            except Exception:
            logging.exception("Ignored non-fatal exception")

        # 2) 浠庡悓绫诲潎鍊?+ 鏈熀閲?1y 鏀剁泭鎺ㄧ畻鏄熺骇
        with get_db_context() as conn:
            # 鎷挎湰鍩洪噾 fund_type
            row = conn.execute(
                "SELECT fund_type FROM fund_master WHERE code = ?",
                (code,),
            ).fetchone()
            if not row:
                return None
            fund_type = row["fund_type"]
            # 鍚岀被鍧囧€硷紙鏈€鏂颁竴澶╋級
            cat = conn.execute(
                """SELECT avg_annual_return_eq, avg_sharpe_eq
                   FROM fund_category_metrics_snapshot
                   WHERE category = ? AND window_days = 365
                   ORDER BY as_of_date DESC LIMIT 1""",
                (fund_type,),
            ).fetchone()
            # 鏈熀閲?1y
            fund = conn.execute(
                """SELECT near_1y FROM fund_quote_snapshot WHERE code = ?""",
                (code,),
            ).fetchone()
        if not cat or not fund:
            return None
        # 瑙勫垯锛?y 鏀剁泭 / 鍚岀被 1y 鏀剁泭 鈮?1.5 鈫?5鈽咃紱1.2~1.5 鈫?4鈽咃紱0.8~1.2 鈫?3鈽咃紱0.5~0.8 鈫?2鈽咃紱<0.5 鈫?1鈽?
        try:
            fund_1y = float(fund["near_1y"] or 0)
            cat_1y = float(cat["avg_annual_return_eq"] or 0)
        except Exception:
            return None
        ratio = (fund_1y + 1) / (cat_1y + 1) if cat_1y > -1 else 1.0
        if ratio >= 1.5:
            r1y = 5
        elif ratio >= 1.2:
            r1y = 4
        elif ratio >= 0.8:
            r1y = 3
        elif ratio >= 0.5:
            r1y = 2
        else:
            r1y = 1
        # 3y 璇勭骇锛氬悓绫诲鏅?2.0+ 鍔犲垎
        cat_sharpe = float(cat["avg_sharpe_eq"] or 0)
        r3y = 5 if cat_sharpe > 2 else 4 if cat_sharpe > 1 else 3 if cat_sharpe > 0 else 2
        return {
            "code": code,
            "rating3y": r3y,
            "rating5y": r1y,  # 5y 娌℃暟鎹紝鐢?1y 鏇夸唬
            "score": round(ratio * 50, 1),
            "source": "computed",
        }
    except Exception:
        return None


def get_fund_purchase_info(code: str) -> dict | None:
    """璐拱淇℃伅锛堢敵璐?璧庡洖鐘舵€併€佽捣璐€? 绫昏垂鐜囥€佹€昏垂鐜囷級銆?

    鏁版嵁婧愶細
      - 璐圭巼锛歠und_metrics_snapshot.fee_manage / fee_custody
      - 璧疯喘 / 鐘舵€侊細琛屼笟鏍囧噯锛堝亸鑲℃贩鍚?/ 鑲＄エ / 娣峰悎鍨?璧疯喘 1.00 鍏冿級
    """
    try:
        with get_db_context() as conn:
            row = conn.execute(
                """SELECT fee_manage, fee_custody
                   FROM fund_metrics_snapshot
                   WHERE code = ? ORDER BY updated_at DESC LIMIT 1""",
                (code,),
            ).fetchone()
            master = conn.execute(
                "SELECT fund_type FROM fund_master WHERE code = ?",
                (code,),
            ).fetchone()
        if not row and not master:
            return None
        # 璐圭巼锛氬熀閲戣涓氭暟鎹簱閲?0.012 / 0.002 杩欐牱鐨勬暟鍊硷紙宸茬粡鏄?1.2% / 0.2% 鐨勫皬鏁帮級
        mgmt = _safe_float(row["fee_manage"]) if row else None
        cust = _safe_float(row["fee_custody"]) if row else None
        fund_type = master["fund_type"] if master else ""
        # 琛屼笟鏍囧噯璧疯喘鍜岃垂鐜?
        if "璐у竵" in fund_type:
            min_amt = 0.01
            sub_fee = "0.00%"
            red_fee = "0.00%"
        else:
            min_amt = 1.00
            sub_fee = "0.30%~1.50%"
            red_fee = "0.00%~1.50%"
        # mgmt/cust 鏄?0.012 / 0.002 杩欑灏忔暟锛堝凡鏄櫨鍒嗘瘮灏忔暟锛夆啋 脳 100 寰?1.20% / 0.20%
        mgmt_pct = f"{mgmt * 100:.2f}%" if mgmt and mgmt < 1 else f"{mgmt:.2f}%" if mgmt else "1.20%"
        cust_pct = f"{cust * 100:.2f}%" if cust and cust < 1 else f"{cust:.2f}%" if cust else "0.20%"
        try:
            total = (mgmt or 0.012) * 100 + (cust or 0.002) * 100
        except Exception:
            total = 1.4
        return {
            "code": code,
            "purchaseStatus": "寮€鏀剧敵璐?,
            "redeemStatus": "寮€鏀捐祹鍥?,
            "minPurchaseAmount": min_amt,
            "subscriptionFeeRate": sub_fee,
            "redemptionFeeRate": red_fee,
            "managementFeeRate": mgmt_pct,
            "custodyFeeRate": cust_pct,
            "serviceFeeRate": "鈥?,
            "totalFeeRate1y": f"{total:.2f}",
        }
    except Exception:
        return None


def get_fund_holder_structure(code: str, periods: int = 40) -> dict:
    """鎸佹湁浜虹粨鏋勶細鍙繑鍥炲凡鍏ュ簱鐨勫鎶ョ湡瀹炴暟鎹紝涓嶅啀鐢熸垚琛屼笟妯℃澘銆?""
    rows = _safe_table_query(
        """SELECT report_date, holder_structure_json, source, data_quality, updated_at
           FROM fund_detail_quarterly_snapshot
           WHERE code = ? AND holder_structure_json IS NOT NULL AND holder_structure_json != ''
           ORDER BY report_date DESC
           LIMIT ?""",
        (code, max(1, min(periods, 80))),
    )
    out: list[dict[str, Any]] = []
    source = None
    as_of = None
    for row in reversed(rows):
        items = _parse_json_array(row["holder_structure_json"])
        if items:
            source = row["source"] or source
            as_of = row["report_date"] or as_of
        for item in items:
            quarter = str(item.get("quarter") or item.get("report_date") or row["report_date"] or "")
            inst = _safe_float(item.get("institution") or item.get("institution_ratio"))
            indiv = _safe_float(item.get("individual") or item.get("individual_ratio"))
            if quarter and inst is not None and indiv is not None:
                out.append({"quarter": quarter, "institution": inst, "individual": indiv})
    return _rows_response(
        code,
        out[-periods:],
        source=source,
        as_of=as_of,
        missing_reason="缂哄皯鐪熷疄鎸佹湁浜虹粨鏋勫鎶ユ暟鎹紱涓嶅啀浣跨敤琛屼笟妯℃澘妯℃嫙銆?,
    )


# ============================================================
#  P1: 鍒哥閰嶇疆 / 閲嶄粨鍊哄埜 / 鍘嗗彶鍥炴姤 / 鍋忚偂娣峰悎鍧囧€间笌鍩哄噯
# ============================================================

def get_fund_bond_allocation(code: str) -> dict:
    """鍒哥閰嶇疆锛氬彧杩斿洖瀛ｆ姤蹇収涓殑鐪熷疄鍒哥鍗犳瘮銆?""
    rows = _safe_table_query(
        """SELECT report_date, bond_allocation_json, source, updated_at
           FROM fund_detail_quarterly_snapshot
           WHERE code = ? AND bond_allocation_json IS NOT NULL AND bond_allocation_json != ''
           ORDER BY report_date DESC
           LIMIT 1""",
        (code,),
    )
    if not rows:
        return _rows_response(
            code,
            [],
            missing_reason="缂哄皯鐪熷疄鍒哥閰嶇疆瀛ｆ姤鏁版嵁锛涗笉鍐嶄娇鐢ㄦ寜鍩洪噾绫诲瀷鐢熸垚鐨勬ā鎷熼厤缃€?,
        )
    row = rows[0]
    out: list[dict[str, Any]] = []
    for item in _parse_json_array(row["bond_allocation_json"]):
        bond_type = str(item.get("bondType") or item.get("bond_type") or item.get("name") or "")
        ratio = _safe_float(item.get("ratio") or item.get("navRatio") or item.get("nav_ratio"))
        if bond_type and ratio is not None:
            out.append({
                "bondType": bond_type,
                "ratio": ratio,
                "changeRatio": _safe_float(item.get("changeRatio") or item.get("change_ratio")),
            })
    return _rows_response(
        code,
        out,
        source=row["source"] or "fund_detail_quarterly_snapshot",
        as_of=row["report_date"],
        missing_reason="鍒哥閰嶇疆蹇収涓虹┖銆?,
    )


def get_fund_bond_holdings(code: str) -> dict:
    """閲嶄粨鍊哄埜锛氫紭鍏堣鍙栧揩鐓э紝鍏舵灏濊瘯 AkShare 涓滄柟璐㈠瘜鐪熷疄鍊哄埜鎸佷粨銆?""
    snapshot_rows = _safe_table_query(
        """SELECT report_date, bond_holdings_json, source, updated_at
           FROM fund_detail_quarterly_snapshot
           WHERE code = ? AND bond_holdings_json IS NOT NULL AND bond_holdings_json != ''
           ORDER BY report_date DESC
           LIMIT 1""",
        (code,),
    )
    if snapshot_rows:
        row = snapshot_rows[0]
        out = []
        for item in _parse_json_array(row["bond_holdings_json"]):
            name = str(item.get("bondName") or item.get("bond_name") or item.get("name") or "")
            ratio = _safe_float(item.get("navRatio") or item.get("nav_ratio") or item.get("ratio"))
            if name:
                out.append({
                    "bondName": name,
                    "marketValue": _safe_float(item.get("marketValue") or item.get("market_value")),
                    "navRatio": ratio,
                    "couponRate": _safe_float(item.get("couponRate") or item.get("coupon_rate")),
                    "issuer": item.get("issuer"),
                    "bondType": item.get("bondType") or item.get("bond_type"),
                    "creditRating": item.get("creditRating") or item.get("credit_rating"),
                })
        return _rows_response(
            code,
            out,
            source=row["source"] or "fund_detail_quarterly_snapshot",
            as_of=row["report_date"],
            missing_reason="鍊哄埜鎸佷粨蹇収涓虹┖銆?,
        )

    try:
        from ..data.akshare_fetcher import get_fund_bond_portfolio

        portfolio = get_fund_bond_portfolio(code) or {}
        holdings = portfolio.get("bond_holdings") or []
        out = []
        as_of = None
        for item in holdings:
            name = str(item.get("name") or item.get("bondName") or "")
            ratio = _safe_float(item.get("ratio") or item.get("navRatio"))
            if not name:
                continue
            as_of = str(item.get("quarter") or item.get("updated_at") or as_of or "")
            out.append({
                "bondName": name,
                "marketValue": None,
                "navRatio": ratio,
                "couponRate": None,
                "issuer": None,
                "bondType": None,
                "creditRating": None,
            })
        if out:
            return _rows_response(
                code,
                out,
                status=DETAIL_STATUS_PARTIAL,
                source="AkShare 涓滄柟璐㈠瘜F10 鍊哄埜鎸佷粨",
                as_of=as_of or None,
                coverage=0.45,
                missing_reason="鍊哄埜鍚嶇О鍜屽崰鍑€鍊兼瘮鍙敤锛岀エ鎭?鍙戣涓讳綋/璇勭骇鏆傜己銆?,
            )
    except Exception as e:
        console_error(f"bond holdings fetch failed for {code}: {e}")

    return _rows_response(
        code,
        [],
        missing_reason="缂哄皯鐪熷疄閲嶄粨鍊哄埜鏁版嵁锛汚kShare/Tushare 褰撳墠鏈繑鍥炲彲鐢ㄦ寔浠撱€?,
    )


def _peer_year_return(code: str, year: int) -> float | None:
    """P2.1: 璁＄畻鎸囧畾鍩洪噾鎵€鍦?fund_type 鍚岀被鍦ㄦ煇骞寸殑鍧囧€煎勾鍖栨敹鐩婏紙鐧惧垎鏁帮級銆?

    鏁版嵁婧愶細fund_nav_history + fund_master.fund_type銆備紭鍏堢敤棣栨湯鏃ュ噣鍊肩畻骞村害 return锛?
    鍚岀被鍙栫畻鏈钩鍧囥€傚け璐?鏃犳牱鏈椂杩斿洖 None銆?
    """
    type_rows = _safe_table_query(
        "SELECT fund_type FROM fund_master WHERE code = ? AND fund_type IS NOT NULL",
        (code,),
    )
    if not type_rows or not type_rows[0]["fund_type"]:
        return None
    fund_type = type_rows[0]["fund_type"]
    # 鍚?fund_type 鍩洪噾闆嗗悎锛堜粎娲昏穬涓旀湁 nav锛?
    peer_rows = _safe_table_query(
        """SELECT DISTINCT n.code
           FROM fund_nav_history n
           JOIN fund_master m ON m.code = n.code
           WHERE m.fund_type = ? AND m.is_active = 1
           LIMIT 500""",
        (fund_type,),
    )
    if not peer_rows:
        return None
    peer_codes = [r["code"] for r in peer_rows if r["code"] and r["code"] != code]
    if not peer_codes:
        peer_codes = [r["code"] for r in peer_rows if r["code"]]
    if not peer_codes:
        return None
    # 鍚岀被鍩洪噾棣栨湯鍑€鍊硷紙鎸夊勾搴︾獥鍙ｏ級
    year_start = f"{year}-01-01"
    year_end = f"{year}-12-31"
    placeholders = ",".join("?" for _ in peer_codes)
    nav_rows = _safe_table_query(
        f"""SELECT n.code,
                   (SELECT nav FROM fund_nav_history
                    WHERE code = n.code AND nav_date >= ?
                      AND nav IS NOT NULL AND nav > 0
                    ORDER BY nav_date ASC LIMIT 1) AS start_nav,
                   (SELECT nav FROM fund_nav_history
                    WHERE code = n.code AND nav_date <= ?
                      AND nav IS NOT NULL AND nav > 0
                    ORDER BY nav_date DESC LIMIT 1) AS end_nav
            FROM fund_nav_history n
            WHERE n.code IN ({placeholders})
            GROUP BY n.code""",
        (year_start, year_end, *peer_codes),
    )
    rets: list[float] = []
    for r in nav_rows or []:
        s = _safe_float(r["start_nav"])
        e = _safe_float(r["end_nav"])
        if s is None or e is None or s <= 0:
            continue
        rets.append((e / s - 1.0) * 100.0)
    if len(rets) < 3:
        return None
    # 鐢?trim-mean锛堝幓鎺夋渶楂樻渶浣庡悇 10%锛夊噺灏戞瀬绔€煎共鎵?
    rets.sort()
    n = len(rets)
    k = max(1, n // 10)
    trimmed = rets[k : n - k] if n - k > k else rets
    return round(sum(trimmed) / len(trimmed), 4)


def get_fund_year_returns(code: str) -> dict:
    """鍘嗗勾鍥炴姤锛氫粠鐪熷疄鍑€鍊煎巻鍙茶绠楁湰鍩洪噾骞村害鏀剁泭锛屽悓鏃惰绠楁勃娣?00鍚屾湡骞村害鏀剁泭鍜屽悓绫诲潎鍊笺€?""
    nav_rows, source, as_of = _get_nav_history_for_detail(code)
    if len(nav_rows) < 2:
        return _rows_response(
            code,
            [],
            missing_reason="缂哄皯鍑€鍊煎巻鍙诧紝鏃犳硶璁＄畻骞村害鏀剁泭銆?,
        )
    years = sorted({_to_date(row.get("nav_date")).year for row in nav_rows if _to_date(row.get("nav_date"))})
    latest_years = years[-5:]

    # 鑾峰彇娌繁300鍑€鍊煎巻鍙茬敤浜庤绠楀悓鏈熷勾搴︽敹鐩?
    index_nav_rows = []
    try:
        index_nav_rows = _get_index_nav_history(HS300_BENCHMARK_CODE)
    except Exception as e:
        console_error(f"yearReturns: index nav fetch failed: {e}")

    rows = [
        {
            "year": year,
            "fundReturn": _annual_return_from_nav(nav_rows, year),
            "hs300Return": _annual_return_from_nav(index_nav_rows, year) if index_nav_rows else None,
            "peerReturn": _peer_year_return(code, year),
            "rank": None,
        }
        for year in latest_years
    ]
    has_hs300 = any(r["hs300Return"] is not None for r in rows)
    has_peer = any(r["peerReturn"] is not None for r in rows)
    coverage = 0.5 if has_hs300 else 0.35
    if has_peer:
        coverage = min(1.0, coverage + 0.2)
    if has_hs300 and has_peer:
        missing_reason = "鏈熀閲?娌繁300/鍚岀被鍧囧€煎潎鎸夌湡瀹炴暟鎹绠楋紱鎺掑悕闇€琛ュ熀鍑?鍚岀被鍘嗗彶琛ㄣ€?
    elif has_peer:
        missing_reason = "鏈熀閲?鍚岀被鍧囧€兼寜鐪熷疄鏁版嵁璁＄畻锛涙勃娣?00 鍚屾湡鏀剁泭缂哄け锛屾帓鍚嶉渶琛ュ悓绫诲巻鍙茶〃銆?
    else:
        missing_reason = "鏈熀閲戝勾搴︽敹鐩婂凡鎸夌湡瀹炲噣鍊艰绠楋紱娌繁300鍚屾湡鏀剁泭鏉ヨ嚜鎸囨暟鍑€鍊硷紱鍚岀被鍧囧€笺€佹帓鍚嶉渶琛ュ熀鍑?鍚岀被鍘嗗彶琛ㄣ€?
    return _rows_response(
        code,
        rows,
        status=DETAIL_STATUS_PARTIAL,
        source=source,
        as_of=as_of,
        coverage=coverage,
        missing_reason=missing_reason,
    )


def _get_index_nav_history(benchmark_code: str = HS300_BENCHMARK_CODE) -> list[dict[str, Any]]:
    """鑾峰彇鎸囨暟锛堥粯璁ゆ勃娣?00锛夌殑鏀剁洏浠峰巻鍙诧紝浼樺厛浠?fund_benchmark_nav_history 琛ㄨ鍙栵紝
    鍥為€€鍒?efinance / akshare 鍦ㄧ嚎鑾峰彇骞舵寔涔呭寲銆?

    杩斿洖 [{"nav_date": str, "nav": float}, ...] 鎸?nav_date 鍗囧簭銆?
    """
    # 1. 浠?fund_benchmark_nav_history 璇诲彇
    rows = _safe_table_query(
        """SELECT nav_date, nav
           FROM fund_benchmark_nav_history
           WHERE benchmark_code = ?
           ORDER BY nav_date ASC""",
        (benchmark_code,),
    )
    if len(rows) >= 50:
        return [{"nav_date": str(r["nav_date"]), "nav": _safe_float(r["nav"])} for r in rows if _safe_float(r["nav"]) is not None]

    # 2. efinance 鍥為€€锛堟勃娣?00 鐢?stock.get_quote_history锛?
    try:
        import efinance as ef
        df = ef.stock.get_quote_history(benchmark_code, klt=101)
        if df is not None and not df.empty:
            rename_map = {"鏃ユ湡": "date", "鏀剁洏": "close", "close": "close"}
            df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})
            if "date" in df.columns and "close" in df.columns:
                records = []
                for _, row in df.iterrows():
                    d = str(row.get("date", ""))[:10]
                    v = _safe_float(row.get("close"))
                    if d and v is not None and v > 0:
                        records.append({"nav_date": d, "nav": v})
                records.sort(key=lambda x: x["nav_date"])
                if len(records) >= 50:
                    # 鎸佷箙鍖栧埌 fund_benchmark_nav_history
                    try:
                        from ..storage.database import get_db_context
                        now = datetime.now().isoformat()
                        with get_db_context() as conn:
                            conn.executemany(
                                """INSERT INTO fund_benchmark_nav_history
                                   (benchmark_code, nav_date, nav, source, fetched_at)
                                   VALUES (?, ?, ?, 'efinance', ?)
                                   ON CONFLICT(benchmark_code, nav_date) DO UPDATE SET
                                     nav = excluded.nav, source = excluded.source, fetched_at = excluded.fetched_at""",
                                [(benchmark_code, r["nav_date"], r["nav"], now) for r in records],
                            )
                    except Exception:
                    logging.exception("Ignored non-fatal exception")
                    return records
    except Exception as e:
        console_error(f"efinance index nav fetch failed for {benchmark_code}: {e}")

    # 3. akshare 鍥為€€
    try:
        import akshare as ak
        import pandas as pd
        df = ak.stock_zh_index_daily(symbol=f"sh{benchmark_code}")
        if df is not None and not df.empty:
            for col in ["close", "鏀剁洏"]:
                if col in df.columns:
                    date_col = "date" if "date" in df.columns else df.columns[0]
                    records = []
                    for _, row in df.iterrows():
                        d = str(row.get(date_col, ""))[:10]
                        v = _safe_float(pd.to_numeric(row.get(col), errors="coerce"))
                        if d and v is not None and v > 0:
                            records.append({"nav_date": d, "nav": v})
                    records.sort(key=lambda x: x["nav_date"])
                    if len(records) >= 50:
                        try:
                            from ..storage.database import get_db_context
                            now = datetime.now().isoformat()
                            with get_db_context() as conn:
                                conn.executemany(
                                    """INSERT INTO fund_benchmark_nav_history
                                       (benchmark_code, nav_date, nav, source, fetched_at)
                                       VALUES (?, ?, ?, 'akshare', ?)
                                       ON CONFLICT(benchmark_code, nav_date) DO UPDATE SET
                                         nav = excluded.nav, source = excluded.source, fetched_at = excluded.fetched_at""",
                                    [(benchmark_code, r["nav_date"], r["nav"], now) for r in records],
                                )
                        except Exception:
                        logging.exception("Ignored non-fatal exception")
                        return records
    except Exception as e:
        console_error(f"akshare index nav fetch failed for {benchmark_code}: {e}")

    return []


def _calc_cumulative_return_series(
    nav_rows: list[dict[str, Any]],
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict[str, Any]]:
    """浠庡噣鍊煎簭鍒楄绠楃疮璁℃敹鐩婄巼搴忓垪 [{"date": str, "return": float}, ...]銆?

    浠?start_date 瀵瑰簲鐨勫噣鍊间负鍩哄噯锛堝鏋?start_date 涓?None 鍒欑敤棣栨潯锛夛紝
    return = (nav / base_nav - 1) * 100銆?
    """
    if not nav_rows:
        return []
    filtered = nav_rows
    if start_date:
        filtered = [r for r in filtered if r.get("nav_date", "") >= start_date]
    if end_date:
        filtered = [r for r in filtered if r.get("nav_date", "") <= end_date]
    if not filtered:
        return []
    base_nav = _safe_float(filtered[0].get("nav"))
    if not base_nav or base_nav <= 0:
        return []
    return [
        {
            "date": str(r["nav_date"]),
            "return": round((_safe_float(r["nav"]) / base_nav - 1.0) * 100, 4),
        }
        for r in filtered
        if _safe_float(r.get("nav")) is not None
    ]


def _calc_drawdown_series(
    nav_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """浠庡噣鍊煎簭鍒楄绠楅€愭棩鍥炴挙搴忓垪 [{"date": str, "drawdown": float, "peak_nav": float, "current_nav": float}, ...]銆?

    drawdown = (current_nav / peak_nav - 1) * 100锛宲eak_nav 涓哄巻鍙叉渶楂樺噣鍊笺€?
    """
    if not nav_rows:
        return []
    # 鎸夋棩鏈熷崌搴忔帓鍒?
    sorted_rows = sorted(nav_rows, key=lambda r: str(r.get("nav_date", "")))
    peak_nav = None
    result = []
    for r in sorted_rows:
        nav = _safe_float(r.get("nav"))
        if nav is None or nav <= 0:
            continue
        if peak_nav is None or nav > peak_nav:
            peak_nav = nav
        drawdown = (nav / peak_nav - 1.0) * 100
        result.append(
            {
                "date": str(r["nav_date"]),
                "drawdown": round(drawdown, 4),
                "peak_nav": round(peak_nav, 6),
                "current_nav": round(nav, 6),
            }
        )
    return result


def get_fund_peer_performance(code: str) -> dict:
    """鍚岀被/鎸囨暟/鍩哄噯鍚屾湡鏀剁泭鐜囥€傚彧杩斿洖鐪熷疄鎴栧彲杩芥函蹇収锛岀己鍙ｄ繚鐣?null銆?""
    empty = _empty_perf_row()
    try:
        with get_db_context() as conn:
            master = conn.execute(
                "SELECT fund_type FROM fund_master WHERE code = ?",
                (code,),
            ).fetchone()
            quote = conn.execute(
                "SELECT near_3m, near_6m, near_1y, near_3y, ytd, nav_date, updated_at FROM fund_quote_snapshot WHERE code = ?",
                (code,),
            ).fetchone()
            cat = conn.execute(
                """SELECT avg_annual_return_eq, avg_max_drawdown_eq, avg_sharpe_eq, as_of_date, coverage_ratio
                   FROM fund_category_metrics_snapshot
                   WHERE category = ? AND window_days = 365
                   ORDER BY as_of_date DESC LIMIT 1""",
                (master["fund_type"] if master else "",),
            ).fetchone()
            # 鏌ヨ娌繁300鍦?fund_quote_snapshot 涓殑鏀剁泭鐜囷紙濡傛灉瀛樺湪锛?
            index_quote = conn.execute(
                "SELECT near_3m, near_6m, near_1y, near_3y FROM fund_quote_snapshot WHERE code = '000300'",
                (),
            ).fetchone()

        peer_1y = _pct_for_api(cat["avg_annual_return_eq"]) if cat else None
        source = "fund_quote_snapshot"
        coverage = 0.25 + (0.25 if peer_1y is not None else 0)

        # 濉厖 peer 瀛楁锛氫粠鍚岀被鍧囧€艰幏鍙栨洿澶氭湡闄愭暟鎹?
        peer_row = {
            "return3m": None,
            "return6m": None,
            "return1y": peer_1y,
            "return3y": None,
            "return5y": None,
            "returnSinceInception": None,
            "annualizedReturn": None,
        }
        # 濡傛灉鍚岀被鍧囧€兼湁 3y 鏁版嵁锛岀敤 avg_annual_return_eq 杩戜技
        if cat and cat["avg_annual_return_eq"] is not None:
            peer_row["annualizedReturn"] = _pct_for_api(cat["avg_annual_return_eq"])

        # 濉厖 index 瀛楁锛氭勃娣?00鏀剁泭鐜?
        index_row = {
            "return3m": _pct_for_api(index_quote["near_3m"]) if index_quote else None,
            "return6m": _pct_for_api(index_quote["near_6m"]) if index_quote else None,
            "return1y": _pct_for_api(index_quote["near_1y"]) if index_quote else None,
            "return3y": _pct_for_api(index_quote["near_3y"]) if index_quote else None,
            "return5y": None,
            "returnSinceInception": None,
            "annualizedReturn": None,
        }
        if index_quote:
            coverage += 0.25

        # === 璁＄畻 series 鏇茬嚎鏁版嵁 ===
        series_data: dict[str, list[dict[str, Any]]] = {
            "fund": [],
            "peer": [],
            "index": [],
            "benchmark": [],
        }

        # 1) 鏈熀閲戠疮璁℃敹鐩婂簭鍒?
        try:
            fund_nav_rows, _, _ = _get_nav_history_for_detail(code)
            if fund_nav_rows:
                fund_series = _calc_cumulative_return_series(fund_nav_rows)
                series_data["fund"] = fund_series
        except Exception as e:
            console_error(f"fund series calc failed for {code}: {e}")

        # 2) 娌繁300绱鏀剁泭搴忓垪锛堜笌鏈熀閲戝悓鏈燂級
        try:
            index_nav_rows = _get_index_nav_history(HS300_BENCHMARK_CODE)
            if index_nav_rows and series_data["fund"]:
                # 鎴彇涓庢湰鍩洪噾鍚屾湡鐨勫尯闂?
                fund_start = series_data["fund"][0]["date"] if series_data["fund"] else None
                fund_end = series_data["fund"][-1]["date"] if series_data["fund"] else None
                index_series = _calc_cumulative_return_series(index_nav_rows, start_date=fund_start, end_date=fund_end)
                series_data["index"] = index_series
        except Exception as e:
            console_error(f"index series calc failed: {e}")

        # 3) peer锛堝悓绫诲潎鍊硷級鈥斺€?鐢ㄥ悓绫?1y 骞村寲鏀剁泭浣滀负甯搁噺绾匡紙鎵€鏈夌偣杩斿洖鐩稿悓鍊硷級
        if peer_1y is not None and series_data["fund"]:
            try:
                # 鍚岀被鍧囧€?1y 鏀剁泭浣滀负姘村钩绾?
                series_data["peer"] = [
                    {"date": pt["date"], "return": round(peer_1y, 4)}
                    for pt in series_data["fund"]
                ]
            except Exception as e:
                console_error(f"peer series calc failed: {e}")

        # 4) 鏈熀閲戝洖鎾ゅ簭鍒?
        try:
            if fund_nav_rows:
                dd_series = _calc_drawdown_series(fund_nav_rows)
                series_data["fund_drawdown"] = [
                    {"date": d["date"], "drawdown": d["drawdown"]}
                    for d in dd_series
                ]
                # 鎸佷箙鍖栧埌 SQLite
                try:
                    FundDataStore.save_drawdown_series_batch(code, dd_series, window_days=365)
                except Exception:
                logging.exception("Ignored non-fatal exception")
        except Exception as e:
            console_error(f"drawdown series calc failed for {code}: {e}")

        status = DETAIL_STATUS_PARTIAL if quote or peer_1y is not None else DETAIL_STATUS_MISSING
        if series_data["index"]:
            coverage = min(1.0, coverage + 0.15)

        return {
            "code": code,
            "peer": peer_row,
            "index": index_row,
            "benchmark": empty.copy(),
            "fund": {
                "return3m": _pct_for_api(quote["near_3m"]) if quote else None,
                "return6m": _pct_for_api(quote["near_6m"]) if quote else None,
                "return1y": _pct_for_api(quote["near_1y"]) if quote else None,
                "return3y": _pct_for_api(quote["near_3y"]) if quote else None,
                "return5y": None,
                "returnSinceInception": None,
                "annualizedReturn": None,
            },
            "series": series_data,
            **_detail_meta(
                status=status,
                source=source if quote else None,
                as_of=(quote["nav_date"] if quote else None) or (cat["as_of_date"] if cat else None),
                coverage=coverage if status != DETAIL_STATUS_MISSING else 0.0,
                missing_reason="鏈熀閲戝拰1骞村悓绫诲潎鍊兼潵鑷揩鐓э紱鎸囨暟鏇茬嚎鏉ヨ嚜娌繁300鍑€鍊硷紱涓氱哗鍩哄噯闇€琛ョ湡瀹炲熀鍑嗗噣鍊艰〃銆?,
            ),
        }
    except Exception:
        return {
            "code": code,
            "peer": empty.copy(),
            "index": empty.copy(),
            "benchmark": empty.copy(),
            "fund": empty.copy(),
            "series": {"fund": [], "peer": [], "index": [], "benchmark": []},
            **_detail_meta(
                status=DETAIL_STATUS_MISSING,
                missing_reason="鍚屾湡鏀剁泭璇诲彇澶辫触銆?,
            ),
        }


# ============================================================
#  P2: 鍘嗗勾瑙勬ā鍙樺寲 / 鍩洪噾鎹㈡墜鐜?/ 鍩洪噾缁忕悊鍙樻洿
# ============================================================

def _backfill_scale_history_from_tushare(
    code: str, periods: int, existing_rows: list
) -> list[dict[str, Any]]:
    """P2.1: 浠?tushare fund_share 脳 unit_nav 璇诲彇鍘嗗彶瑙勬ā锛屽洖濉苟鍏ュ簱銆?

    杩斿洖涓?get_fund_scale_history 涓€鑷寸殑 [{quarter, totalScale, peer25Scale}] 琛屻€?
    澶辫触 / 鏃犳暟鎹椂杩斿洖绌哄垪琛紙涓嶆姏寮傚父锛夈€?
    """
    try:
        from ..data.providers.tushare_provider import TushareProvider
    except Exception:
        return []

    existing_dates = {str(r["report_date"])[:10] for r in (existing_rows or [])}
    try:
        provider = TushareProvider()
        pro = provider._get_pro()  # type: ignore[attr-defined]
        if pro is None:
            return []
        ts_code = f"{code}.OF"
        share_df = provider._safe_call(pro.fund_share, ts_code=ts_code)  # type: ignore[attr-defined]
        if share_df is None or share_df.empty:
            return []
    except Exception:
        return []

    out: list[dict[str, Any]] = []
    persist_rows: list[tuple[str, float]] = []
    try:
        # 鎸?trade_date 鍊掑簭閬嶅巻锛屽彇鏈€杩?periods 涓?
        share_df = share_df.sort_values(by="trade_date", ascending=False).head(periods)
        for _, srow in share_df.iterrows():
            trade_date = str(srow.get("trade_date", ""))[:10]
            fd_share = provider._safe_float(srow.get("fd_share"))  # type: ignore[attr-defined]
            if not trade_date or fd_share is None or fd_share <= 0:
                continue
            # 鍙栧悓鏈?unit_nav
            nav_df = provider._safe_call(pro.fund_nav, ts_code=ts_code, end_date=trade_date)  # type: ignore[attr-defined]
            unit_nav: float | None = None
            if nav_df is not None and not nav_df.empty:
                nav_df = nav_df.sort_values(by="nav_date", ascending=False)
                unit_nav = provider._safe_float(nav_df.iloc[0].get("unit_nav"))  # type: ignore[attr-defined]
            if unit_nav is None or unit_nav <= 0:
                continue
            total_scale = round(fd_share * unit_nav / 100000.0, 4)  # 涓囦唤脳鍑€鍊?1e5=浜垮厓
            out.append({"quarter": trade_date, "totalScale": total_scale, "peer25Scale": None})
            persist_rows.append((trade_date, total_scale))
    except Exception:
        return out

    # 鍏ュ簱锛堜粎鎻掑叆 DB 娌℃湁鐨勫搴︼級
    if persist_rows:
        try:
            from ..storage.database import get_db
            now = datetime.now().isoformat()
            with get_db() as conn:
                for qdate, scale in persist_rows:
                    if qdate in existing_dates:
                        continue
                    conn.execute(
                        """INSERT OR IGNORE INTO fund_detail_quarterly_snapshot
                           (code, report_date, total_scale, source, data_quality, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (code, qdate, scale, "tushare:fund_share", "backfill", now),
                    )
        except Exception:
        logging.exception("Ignored non-fatal exception")
    return out


def get_fund_scale_history(code: str, periods: int = 40) -> dict:
    """瑙勬ā鍘嗗彶锛氳鍙栫湡瀹炲鎶ュ揩鐓э紱DB 涓嶈冻 4 瀛ｅ害鏃讹紝鐢?tushare fund_share脳fund_nav 鍥炲～骞跺叆搴撱€?""
    snapshot_rows = _safe_table_query(
        """SELECT report_date, total_scale, source, updated_at
           FROM fund_detail_quarterly_snapshot
           WHERE code = ? AND total_scale IS NOT NULL
           ORDER BY report_date DESC
           LIMIT ?""",
        (code, max(1, min(periods, 80))),
    )
    out = [
        {"quarter": str(row["report_date"]), "totalScale": _safe_float(row["total_scale"]), "peer25Scale": None}
        for row in reversed(snapshot_rows)
        if _safe_float(row["total_scale"]) is not None
    ]
    # DB 鐪熷疄鏍锋湰 < 4 鏃讹紝鐢?tushare fund_share脳unit_nav 鍘嗗彶鍥炲～锛堜粎鏈湡鏂板啓鍏ワ級
    if len(out) < min(4, periods):
        tushare_rows = _backfill_scale_history_from_tushare(code, periods, snapshot_rows)
        if tushare_rows:
            # 鐢?(quarter, totalScale) 鍘婚噸锛屼繚鐣?DB 浼樺厛
            db_keys = {(r["quarter"], round(r["totalScale"], 4) if r["totalScale"] else None) for r in out}
            for trow in tushare_rows:
                tq = trow["quarter"]
                tscale = round(trow["totalScale"], 4) if trow["totalScale"] else None
                if tq and tscale and (tq, tscale) not in db_keys:
                    out.append(trow)
                    db_keys.add((tq, tscale))
            out.sort(key=lambda r: r["quarter"])
            # 鎴柇鍒?periods
            out = out[-periods:]
    if out:
        return _rows_response(
            code,
            out,
            source=snapshot_rows[0]["source"] or "fund_detail_quarterly_snapshot" if snapshot_rows else "tushare:fund_share",
            as_of=snapshot_rows[0]["report_date"] if snapshot_rows else (out[-1]["quarter"] if out else None),
            coverage=min(1.0, len(out) / max(1, periods)),
            missing_reason=None if len(out) >= 4 else "瑙勬ā鍘嗗彶鏍锋湰涓嶈冻锛屽凡鐢?tushare fund_share脳unit_nav 琛ラ綈閮ㄥ垎瀛ｅ害銆?,
        )

    rows = _safe_table_query(
        """SELECT total_scale, updated_at, source
           FROM fund_metrics_snapshot
           WHERE code = ? AND total_scale IS NOT NULL
           ORDER BY updated_at DESC LIMIT 1""",
        (code,),
    )
    if rows:
        total_scale = _safe_float(rows[0]["total_scale"])
        if total_scale is not None and total_scale > 0:
            return _rows_response(
                code,
                [{"quarter": str(rows[0]["updated_at"])[:10], "totalScale": total_scale, "peer25Scale": None}],
                status=DETAIL_STATUS_PARTIAL,
                source=rows[0]["source"] or "fund_metrics_snapshot",
                as_of=str(rows[0]["updated_at"])[:10],
                coverage=0.1,
                missing_reason="浠呮湁鏈€鏂扮湡瀹炶妯★紝缂哄皯瀛ｅ害鍘嗗彶鍜屽悓绫?5%鍒嗕綅銆?,
            )
    return _rows_response(
        code,
        [],
        missing_reason="缂哄皯鐪熷疄瑙勬ā鍘嗗彶鏁版嵁锛涗笉鍐嶇敓鎴愭ā鎷熻妯℃洸绾裤€?,
    )


def get_fund_turnover_history(code: str, periods: int = 40) -> dict:
    """鍩洪噾鎹㈡墜鐜囷細鍙鍙栫湡瀹炲鎶ュ揩鐓с€?""
    rows = _safe_table_query(
        """SELECT report_date, turnover_rate, source, updated_at
           FROM fund_detail_quarterly_snapshot
           WHERE code = ? AND turnover_rate IS NOT NULL
           ORDER BY report_date DESC
           LIMIT ?""",
        (code, max(1, min(periods, 80))),
    )
    out = [
        {"quarter": str(row["report_date"]), "turnoverRate": _safe_float(row["turnover_rate"])}
        for row in reversed(rows)
        if _safe_float(row["turnover_rate"]) is not None
    ]
    return _rows_response(
        code,
        out,
        source=rows[0]["source"] if rows else None,
        as_of=rows[0]["report_date"] if rows else None,
        coverage=min(1.0, len(out) / max(1, periods)) if out else 0.0,
        missing_reason="缂哄皯鐪熷疄鍩洪噾鎹㈡墜鐜囧鎶ユ暟鎹紱涓嶅啀鐢熸垚鍛ㄦ湡娉㈠姩妯℃嫙鍊笺€?,
    )


def get_fund_manager_history(code: str) -> dict:
    """鍩洪噾缁忕悊鍙樻洿锛氳鍙栫湡瀹炲揩鐓ф垨 provider 褰撳墠缁忕悊锛屼笉鐢熸垚鍘嗕换缁忕悊銆?""
    rows = _safe_table_query(
        """SELECT manager_name, start_date, end_date, total_return, annualized_return, rank_json, source, updated_at
           FROM fund_manager_history_snapshot
           WHERE code = ?
           ORDER BY COALESCE(start_date, '') ASC""",
        (code,),
    )
    out = []
    for row in rows:
        rank = None
        if row["rank_json"]:
            try:
                rank = json.loads(row["rank_json"])
            except Exception:
                rank = None
        out.append({
            "managerName": row["manager_name"],
            "startDate": row["start_date"],
            "endDate": row["end_date"],
            "totalReturn": _safe_float(row["total_return"]),
            "annualizedReturn": _safe_float(row["annualized_return"]),
            "rank": rank,
        })
    if out:
        return _rows_response(
            code,
            out,
            source=rows[-1]["source"] or "fund_manager_history_snapshot",
            as_of=rows[-1]["updated_at"],
        )

    try:
        from ..data.providers.tushare_provider import TushareProvider

        manager = TushareProvider().get_fund_manager(code) or {}
        if manager.get("name"):
            return _rows_response(
                code,
                [{
                    "managerName": manager.get("name"),
                    "startDate": manager.get("begin_date") or None,
                    "endDate": manager.get("end_date") or None,
                    "totalReturn": _safe_float(manager.get("reward")),
                    "annualizedReturn": None,
                    "rank": None,
                }],
                status=DETAIL_STATUS_PARTIAL,
                source="Tushare fund_manager",
                coverage=0.35,
                missing_reason="浠呰幏鍙栧埌褰撳墠/鏈€杩戝熀閲戠粡鐞嗭紝鍘嗕换缁忕悊鍜屽悓绫绘帓鍚嶉渶琛ュ揩鐓ц〃銆?,
            )
    except Exception as e:
        console_error(f"manager history fetch failed for {code}: {e}")
    return _rows_response(
        code,
        [],
        missing_reason="缂哄皯鐪熷疄鍩洪噾缁忕悊鍙樻洿鏁版嵁锛涗笉鍐嶇敓鎴愯櫄鎷熷巻浠荤粡鐞嗐€?,
    )


# ============================================================
#  P3: 杩愪綔鍒嗘瀽
# ============================================================

def get_fund_manager_report(code: str) -> dict | None:
    """杩愪綔鍒嗘瀽锛氫粎杩斿洖鐪熷疄瀹氭湡鎶ュ憡鏂囨湰锛屼笉鍐嶇敓鎴愭ā鏉块暱鏂囥€?""
    rows = _safe_table_query(
        """SELECT report_date, report_text, source, updated_at
           FROM fund_report_snapshot
           WHERE code = ? AND report_text IS NOT NULL AND report_text != ''
           ORDER BY report_date DESC
           LIMIT 1""",
        (code,),
    )
    if not rows:
        return {
            "code": code,
            "report": None,
            "period": None,
            **_detail_meta(
                status=DETAIL_STATUS_MISSING,
                missing_reason="缂哄皯鐪熷疄鍩洪噾瀹氭湡鎶ュ憡鍘熸枃锛涗笉鍐嶇敓鎴愭ā鏉垮寲杩愪綔鍒嗘瀽銆?,
            ),
        }
    row = rows[0]
    return {
        "code": code,
        "report": row["report_text"],
        "period": row["report_date"],
        **_detail_meta(
            status=DETAIL_STATUS_AVAILABLE,
            source=row["source"] or "fund_report_snapshot",
            as_of=row["report_date"],
            coverage=1.0,
        ),
    }


# ============================================================
#  鍐呴儴杈呭姪
# ============================================================

def _to_ts_code(code: str) -> str:
    """6 浣嶄唬鐮?鈫?tushare ts_code 鏍煎紡锛堝 000020 鈫?000020.OF锛夈€?""
    return f"{code}.OF"


def _safe_int(v) -> int | None:
    try:
        return int(v) if v not in (None, "") else None
    except Exception:
        return None


def _safe_float(v) -> float | None:
    try:
        if v in (None, "", "鈥?, "--"):
            return None
        return float(v)
    except Exception:
        return None


def _format_fee(v) -> str:
    """鍩洪噾璐圭巼 0~1 鎴?0~100 鏁板€?鈫?'0.30%~1.50%' 鍖洪棿瀛楃涓层€?""
    f = _safe_float(v)
    if f is None:
        return "鈥?
    # 0~1 鈫?脳 100
    if 0 < f < 1:
        return f"{f * 100:.2f}%"
    return f"{f:.2f}%"


# ============================================================
#  椋庨櫓鎽樿锛坮ule-based 妯℃澘锛?
# ============================================================

def get_fund_risk_summary(code: str, window: str = "1y") -> dict | None:
    """椋庨櫓鎽樿锛堝熀浜?fund_metrics_snapshot + 鍚岀被鍧囧€肩敓鎴愯鍒欐ā鏉匡級銆?

    杈撳嚭瀛楁锛?
      - code
      - window锛?y / 3y / 5y / inception
      - level锛歭ow / medium / high
      - downsideRisk銆乵axDrawdown銆乸eerDownsideRisk銆乸eerMaxDrawdown
      - summary锛氳嚜鐒惰瑷€鎽樿锛堜腑鏂囷級
      - source锛氳鍒欏紩鎿?
    """
    try:
        with get_db_context() as conn:
            row = conn.execute(
                """SELECT max_drawdown, volatility, sharpe_ratio, fee_manage, fee_custody, updated_at, source
                   FROM fund_metrics_snapshot WHERE code = ?""",
                (code,),
            ).fetchone()
            master = conn.execute(
                "SELECT fund_type, name FROM fund_master WHERE code = ?",
                (code,),
            ).fetchone()
            cat = conn.execute(
                """SELECT avg_max_drawdown_eq, avg_sharpe_eq, as_of_date
                   FROM fund_category_metrics_snapshot
                   WHERE category = ? AND window_days = 365
                   ORDER BY as_of_date DESC LIMIT 1""",
                (master["fund_type"] if master else "",),
            ).fetchone()
        if not master:
            return None
        fund_name = master["name"] or "鏈熀閲?
        fund_type = master["fund_type"] or "鍩洪噾"
        window_days = {"1y": 365, "3y": 365 * 3, "5y": 365 * 5}.get(window)
        nav_rows, nav_source, nav_as_of = _get_nav_history_for_detail(code)
        if window_days and nav_rows:
            latest = _to_date(nav_rows[-1].get("nav_date"))
            if latest:
                start = latest - timedelta(days=window_days)
                nav_rows = [r for r in nav_rows if (_to_date(r.get("nav_date")) or latest) >= start]
        nav_metrics = _risk_metrics_from_nav(nav_rows)
        max_dd = nav_metrics["max_drawdown"] if nav_metrics else (_safe_float(row["max_drawdown"]) if row else None)
        volatility = nav_metrics["volatility"] if nav_metrics else (_safe_float(row["volatility"]) if row else None)
        downside_risk = nav_metrics["downside_risk"] if nav_metrics else None
        sharpe = _safe_float(row["sharpe_ratio"]) if row else None
        peer_max_dd = _safe_float(cat["avg_max_drawdown_eq"]) if cat else None

        # 绛夌骇
        if max_dd is None or peer_max_dd is None:
            level = "low"
            compare = "鏃犳硶涓庡悓绫绘瘮杈?
        else:
            # 娉ㄦ剰锛歱eer_max_dd 閫氬父鏄礋鏁帮紙-0.06 浠ｈ〃 -6%锛?
            if abs(max_dd) < abs(peer_max_dd) * 0.8:
                level = "low"
                compare_verb = "灏忎簬鍚岀被骞冲潎"
            elif abs(max_dd) > abs(peer_max_dd) * 1.2:
                level = "high"
                compare_verb = "澶т簬鍚岀被骞冲潎"
            else:
                level = "medium"
                compare_verb = "涓庡悓绫诲钩鍧囩浉杩?
            compare = f"璇ュ熀閲戠殑鏈€澶у洖鎾?{compare_verb}"

        # 4 娈靛紡鏈烘瀯椋庢帶瀹樺彛寰?
        level_zh = {"low": "浣?, "medium": "涓?, "high": "楂?}[level]
        peer_compare = compare
        downside = _format_pct(downside_risk) if downside_risk is not None else "鏆傛棤"
        sharpe_str = f"{sharpe:.2f}" if sharpe is not None else "鏆傛棤"
        if level == "high":
            suitability = "閫傚悎 C4 鍙婁互涓婇闄╁亸濂界殑鎶曡祫鑰呴厤缃紝寤鸿浣滀负鏉冪泭缁勫悎鐨勫崼鏄熶粨浣嶃€?
        elif level == "medium":
            suitability = "閫傚悎 C3 椋庨櫓鍋忛珮鐨勬姇璧勮€呬綔涓烘牳蹇冮厤缃€?
        else:
            suitability = "閫傚悎 C1-C2 椋庨櫓鍋忓ソ鎶曡祫鑰呬綔涓哄簳浠撻厤缃€?
        summary = (
            f"銆愰闄╁畾绾с€憑window} 绐楀彛涓嬫湰鍩洪噾 {fund_name}锛坽fund_type}锛夌患鍚堥闄╃瓑绾т负銆恵level_zh}銆戙€俓n"
            f"銆愭牳蹇冩寚鏍囥€戞渶澶у洖鎾?{_format_pct(max_dd)}锛?
            f"涓嬭椋庨櫓浠ｇ悊鎸囨爣 {downside}锛?
            f"澶忔櫘姣旂巼 {sharpe_str}銆俓n"
            f"銆愬悓涓氬鏍囥€戜笌鍚岀被锛坽fund_type}锛夊钩鍧囨渶澶у洖鎾?{_format_pct(peer_max_dd)} 鐩告瘮锛寋peer_compare}銆俓n"
            f"銆愰€傚綋鎬у缓璁€戞湰浜у搧椋庨櫓绛夌骇{level_zh}锛寋suitability}"
        )
        return {
            "code": code,
            "window": window,
            "level": level,
            "maxDrawdown": max_dd,
            "peerMaxDrawdown": peer_max_dd,
            "downsideRisk": downside_risk,
            "peerDownsideRisk": None,
            "summary": summary,
            "volatility": volatility,
            **_detail_meta(
                status=DETAIL_STATUS_PARTIAL if nav_metrics else DETAIL_STATUS_PARTIAL if row else DETAIL_STATUS_MISSING,
                source=nav_source or (row["source"] if row else None) or "rule-engine",
                as_of=nav_as_of or (row["updated_at"] if row else None),
                coverage=0.7 if nav_metrics else 0.35 if row else 0.0,
                missing_reason=None if nav_metrics else "缂哄皯瓒抽噺鍑€鍊煎巻鍙诧紝浠呰兘浣跨敤鎸囨爣蹇収鐢熸垚鎽樿銆?,
            ),
        }
    except Exception:
        return None


def _format_dd(v) -> str:
    if v is None:
        return "鏆傛棤鏁版嵁"
    return f"{v:.4f}%"


def _format_pct(v) -> str:
    if v is None:
        return "鏆傛棤鏁版嵁"
    if abs(v) < 1:
        return f"{v * 100:.2f}%"
    return f"{v:.2f}%"


def risk_downside_estimate(metrics_row, peer_max_dd) -> float:
    """绮楃暐浼扮畻涓嬭椋庨櫓锛堢敤鏈€澶у洖鎾ゅ仛 proxy锛夈€?""
    if metrics_row is None:
        return 0.0
    md = _safe_float(metrics_row["max_drawdown"]) or 0
    return abs(md) * 0.8  # 澶ц嚧

