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
import json
import re
import io
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import date, datetime, timedelta
from typing import Any

from ..config import CACHE_TTL_RANKING
from ..constants.guoyuan_funds import FUND_CATEGORIES, FUND_TYPES, GUOYUAN_FUND_LIST
from ..data.cache_manager import cache
from ..storage.database import FundDataStore, get_db_context
from ..utils import console_error

# 排序字段映射（提取为模块级常量，避免重复定义）
SORT_FIELD_MAP: dict[str, str] = {
    "近1月": "near_1m", "近3月": "near_3m", "近6月": "near_6m",
    "近1年": "near_1y", "近3年": "near_3y", "今年来": "ytd",
}

# 基金类型 → 英文桶映射（首页 categoryMetrics 使用）
_TYPE_BUCKET_MAP: dict[str, str] = {
    "股票型": "equity", "混合型": "hybrid", "债券型": "bond",
    "指数型": "index", "ETF": "etf", "QDII": "qdii",
    "货币型": "money", "货币": "money", "FOF": "fof", "REITs": "reits",
    "ETF联接": "etf", "联接基金": "etf",
}

HS300_BENCHMARK_CODE = "000300"
PEER_PERFORMANCE_DEFAULT_WINDOW_DAYS = 365 * 5 + 2
PEER_PERFORMANCE_DEFAULT_MAX_POINTS = 420
BOND_HOLDINGS_FALLBACK_TIMEOUT_SECONDS = 8
EXCHANGE_FUND_CODE_RE = re.compile(r"^(5\d{5}|508\d{3}|15\d{4}|16\d{4}|18\d{4})$")


def _normalize_fund_type_to_bucket(raw: str, name: str = "") -> str:
    """把 fund_master.fund_type 中文归类为首页统一的英文桶 key.

    含 ETF/LOF 名称的基金即使 fund_type 为"指数型"也归入 etf bucket，
    与前端 inferFundType 保持一致。
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
            nav_date = str(item.get("date") or item.get("nav_date") or item.get("净值日期") or "")[:10]
            nav = _safe_float(item.get("nav") or item.get("单位净值") or item.get("nav_value"))
            if nav_date and nav is not None and nav > 0:
                clean.append({
                    "nav_date": nav_date,
                    "nav": nav,
                    "accum_nav": _safe_float(item.get("acc_nav") or item.get("accum_nav") or item.get("累计净值")),
                    "day_growth": _safe_float(item.get("day_growth") or item.get("日增长率") or item.get("增长率")),
                })
        clean.sort(key=lambda row: row["nav_date"])
        if len(clean) >= 2:
            try:
                FundDataStore.save_nav_history_batch(code, clean, source="efinance")
            except Exception:
                pass
            return clean, "efinance", clean[-1]["nav_date"]
    except Exception as e:
        console_error(f"detail nav history fetch failed for {code}: {e}")
    return [], None, None


def _nav_return(nav_rows: list[dict[str, Any]], days: int) -> float | None:
    if len(nav_rows) < 2:
        return None
    latest_date = _to_date(nav_rows[-1].get("nav_date"))
    latest_nav = _safe_float(nav_rows[-1].get("nav"))
    if not latest_date or latest_nav is None or latest_nav <= 0:
        return None
    cutoff = latest_date - timedelta(days=days)
    start_row = None
    for row in nav_rows:
        row_date = _to_date(row.get("nav_date"))
        if row_date and row_date >= cutoff:
            start_row = row
            break
    if not start_row:
        start_row = nav_rows[0]
    start_nav = _safe_float(start_row.get("nav"))
    if start_nav is None or start_nav <= 0:
        return None
    return round((latest_nav / start_nav - 1) * 100, 4)


def _nav_ytd_return(nav_rows: list[dict[str, Any]]) -> float | None:
    if len(nav_rows) < 2:
        return None
    latest_date = _to_date(nav_rows[-1].get("nav_date"))
    latest_nav = _safe_float(nav_rows[-1].get("nav"))
    if not latest_date or latest_nav is None or latest_nav <= 0:
        return None
    start_row = None
    for row in nav_rows:
        row_date = _to_date(row.get("nav_date"))
        if row_date and row_date.year == latest_date.year:
            start_row = row
            break
    if not start_row:
        return None
    start_nav = _safe_float(start_row.get("nav"))
    if start_nav is None or start_nav <= 0:
        return None
    return round((latest_nav / start_nav - 1) * 100, 4)


def _exchange_snapshot_from_nav(code: str, quote_row: dict[str, Any], nav_rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "code": code,
        "name": quote_row.get("name") or f"{code} ETF",
        "type": quote_row.get("type") or "ETF",
        "company": quote_row.get("company") or "",
        "tags": quote_row.get("tags") or ["exchange_fund"],
        "is_xinjihui": bool(quote_row.get("is_xinjihui")),
        "is_preferred": bool(quote_row.get("is_preferred")),
        "nav": quote_row.get("nav") or 0,
        "accum_nav": quote_row.get("accum_nav"),
        "nav_date": quote_row.get("nav_date") or "",
        "day_growth": quote_row.get("day_growth") or 0,
        "near_1m": quote_row.get("near_1m") or 0,
        "near_3m": quote_row.get("near_3m") or 0,
        "near_6m": quote_row.get("near_6m") or 0,
        "near_1y": quote_row.get("near_1y") or 0,
        "near_3y": quote_row.get("near_3y") or 0,
        "ytd": quote_row.get("ytd") or 0,
        "updated_at": quote_row.get("updated_at"),
        "data_quality": quote_row.get("data_quality") or "computed",
        "stale_level": "fresh",
        "nav_data": [
            {
                "date": row.get("nav_date"),
                "nav": row.get("nav"),
                "accum_nav": row.get("accum_nav"),
                "day_growth": row.get("day_growth"),
            }
            for row in nav_rows[-500:]
        ],
    }


def _has_nav_quote(snapshot: dict[str, Any] | None) -> bool:
    if not snapshot:
        return False
    nav = _safe_float(snapshot.get("nav"))
    return nav is not None and nav > 0 and bool(snapshot.get("nav_date"))


def needs_exchange_fund_snapshot_refresh(snapshot: dict[str, Any] | None) -> bool:
    return (
        not snapshot
        or len(snapshot.get("nav_data") or []) < 2
        or not _has_nav_quote(snapshot)
        or _is_exchange_nav_asof_stale(snapshot.get("nav_date"))
    )


def ensure_exchange_fund_snapshot(code: str) -> dict[str, Any] | None:
    """Create a minimal local snapshot for exchange-traded funds from real NAV history."""
    code = str(code or "").strip()
    if not EXCHANGE_FUND_CODE_RE.match(code):
        return None

    snapshot = FundDataStore.get_snapshot(code)
    if snapshot and len(snapshot.get("nav_data") or []) >= 2 and _has_nav_quote(snapshot) and not _is_exchange_nav_asof_stale(snapshot.get("nav_date")):
        return snapshot

    nav_rows, source, _ = _get_nav_history_for_detail(code)
    if len(nav_rows) >= 2 and _is_exchange_nav_asof_stale(nav_rows[-1].get("nav_date")):
        refreshed_rows = _refresh_exchange_nav_history(code, nav_rows[-1].get("nav_date"))
        if refreshed_rows:
            nav_rows = refreshed_rows
            source = "efinance"
    if len(nav_rows) < 2:
        return snapshot

    latest = nav_rows[-1]
    now = datetime.now().isoformat()
    quote_row = {
        "code": code,
        "name": snapshot.get("name") if snapshot else f"{code} ETF",
        "type": snapshot.get("type") if snapshot else "ETF",
        "company": snapshot.get("company") if snapshot else "",
        "tags": ["exchange_fund"],
        "is_xinjihui": False,
        "is_preferred": False,
        "nav": latest.get("nav"),
        "accum_nav": latest.get("accum_nav"),
        "nav_date": latest.get("nav_date"),
        "day_growth": latest.get("day_growth"),
        "near_1m": _nav_return(nav_rows, 30),
        "near_3m": _nav_return(nav_rows, 90),
        "near_6m": _nav_return(nav_rows, 180),
        "near_1y": _nav_return(nav_rows, 365),
        "near_3y": _nav_return(nav_rows, 365 * 3),
        "ytd": _nav_ytd_return(nav_rows),
        "data_quality": "computed",
        "updated_at": now,
    }
    try:
        FundDataStore.save_quote_batch([quote_row], source=source or "exchange_fund_nav")
        stored = FundDataStore.get_snapshot(code)
        if stored:
            return stored
    except Exception as e:
        console_error(f"exchange fund snapshot persistence failed for {code}: {e}")
    return _exchange_snapshot_from_nav(code, quote_row, nav_rows)


def _is_exchange_nav_asof_stale(nav_date: str | None, *, hours: int = 48) -> bool:
    parsed = _to_date(str(nav_date or ""))
    if not parsed:
        return False
    return (datetime.now() - datetime.combine(parsed, datetime.min.time())).total_seconds() > hours * 3600


def _refresh_exchange_nav_history(code: str, current_as_of: str | None) -> list[dict[str, Any]]:
    try:
        from ..data.efinance_fetcher import get_fund_nav_history

        fetched = get_fund_nav_history(code)
        clean: list[dict[str, Any]] = []
        for item in fetched or []:
            nav_date = str(item.get("date") or item.get("nav_date") or item.get("净值日期") or "")[:10]
            nav = _safe_float(item.get("nav") or item.get("单位净值") or item.get("nav_value"))
            if nav_date and nav is not None and nav > 0:
                clean.append({
                    "nav_date": nav_date,
                    "nav": nav,
                    "accum_nav": _safe_float(item.get("acc_nav") or item.get("accum_nav") or item.get("累计净值")),
                    "day_growth": _safe_float(item.get("day_growth") or item.get("日增长率") or item.get("增长率")),
                })
        clean.sort(key=lambda row: row["nav_date"])
        if len(clean) < 2 or (current_as_of and clean[-1]["nav_date"] <= str(current_as_of)):
            return []
        try:
            FundDataStore.save_nav_history_batch(code, clean, source="efinance")
        except Exception:
            pass
        return clean
    except Exception as e:
        console_error(f"exchange nav history refresh failed for {code}: {e}")
        return []


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


def _safe_float(value: Any, default: float | None = None) -> float | None:
    """Return a JSON-safe finite float."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    return num if math.isfinite(num) else default


def _safe_number(value: Any, default: float | None = None) -> float | None:
    """Parse numeric strings with %, 万/亿 units, and comma separators."""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        try:
            return default if not math.isfinite(float(value)) else float(value)
        except (TypeError, ValueError):
            return default
    if isinstance(value, bool):
        return 1.0 if value else 0.0

    text = str(value).strip()
    if not text:
        return default
    text = text.replace("%", "").replace(",", "").replace(" ", "").replace("\u00a0", "")
    if text in {"--", "-", "N/A", "nan", "NaN", "None", "null"}:
        return default

    factor = 1.0
    if "亿" in text:
        factor = 1e8
        text = text.replace("亿", "")
    elif "万" in text:
        factor = 1e4
        text = text.replace("万", "")

    match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
    if not match:
        return default
    try:
        num = float(match.group(0))
    except (TypeError, ValueError):
        return default
    return num * factor


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
    副作用：把拉到的 nav_data 持久化到 fund_nav_history，供 getFundAnalysis 读，
    避免详情页"累计收益趋势"图无数据。
    """
    import numpy as np

    from ..data.efinance_fetcher import get_fund_nav_history
    from ..storage.database import FundDataStore

    try:
        nav_data = get_fund_nav_history(code)
        if not nav_data or len(nav_data) < 30:
            return None

        # 持久化净值历史（fund_nav_history）—— 修复累计收益趋势图无数据
        try:
            FundDataStore.save_nav_history_batch(code, nav_data, source="compute")
        except Exception:
            pass  # nav 持久化失败不影响 metrics 计算

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
#  P0: 基金评级 / 购买信息 / 持有人结构
# ============================================================

def get_fund_rating(code: str) -> dict | None:
    """基金评级（3 年 / 5 年 1~5 颗星）。

    数据源优先级：
      1. tushare fund_rating（如有权限）
      2. 用同行业（fund.fund_type 匹配 fund_category_metrics_snapshot）1y 平均收益 + 夏普推算
    """
    try:
        # 1) tushare 优先
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
                            pass
            except Exception:
                pass

        # 2) 从同类均值 + 本基金 1y 收益推算星级
        with get_db_context() as conn:
            # 拿本基金 fund_type
            row = conn.execute(
                "SELECT fund_type FROM fund_master WHERE code = ?",
                (code,),
            ).fetchone()
            if not row:
                return None
            fund_type = row["fund_type"]
            # 同类均值（最新一天）
            cat = conn.execute(
                """SELECT avg_annual_return_eq, avg_sharpe_eq
                   FROM fund_category_metrics_snapshot
                   WHERE category = ? AND window_days = 365
                   ORDER BY as_of_date DESC LIMIT 1""",
                (fund_type,),
            ).fetchone()
            # 本基金 1y
            fund = conn.execute(
                """SELECT near_1y FROM fund_quote_snapshot WHERE code = ?""",
                (code,),
            ).fetchone()
        if not cat or not fund:
            return None
        # 规则：1y 收益 / 同类 1y 收益 ≥ 1.5 → 5★；1.2~1.5 → 4★；0.8~1.2 → 3★；0.5~0.8 → 2★；<0.5 → 1★
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
        # 3y 评级：同类夏普 2.0+ 加分
        cat_sharpe = float(cat["avg_sharpe_eq"] or 0)
        r3y = 5 if cat_sharpe > 2 else 4 if cat_sharpe > 1 else 3 if cat_sharpe > 0 else 2
        return {
            "code": code,
            "rating3y": r3y,
            "rating5y": r1y,  # 5y 没数据，用 1y 替代
            "score": round(ratio * 50, 1),
            "source": "computed",
        }
    except Exception:
        return None


def get_fund_purchase_info(code: str) -> dict | None:
    """购买信息（申购/赎回状态、起购、4 类费率、总费率）。

    数据源：
      - 费率：fund_metrics_snapshot.fee_manage / fee_custody
      - 起购 / 状态：行业标准（偏股混合 / 股票 / 混合型 起购 1.00 元）
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
        # 费率：基金行业数据库里 0.012 / 0.002 这样的数值（已经是 1.2% / 0.2% 的小数）
        mgmt = _safe_float(row["fee_manage"]) if row else None
        cust = _safe_float(row["fee_custody"]) if row else None
        fund_type = master["fund_type"] if master else ""
        # 行业标准起购和费率
        if "货币" in fund_type:
            min_amt = 0.01
            sub_fee = "0.00%"
            red_fee = "0.00%"
        else:
            min_amt = 1.00
            sub_fee = "0.30%~1.50%"
            red_fee = "0.00%~1.50%"
        # mgmt/cust 常见格式是 0.012（小数）或 1.2（百分比）
        mgmt_pct = _format_fee(mgmt)
        cust_pct = _format_fee(cust)
        if mgmt is None:
            mgmt = 0.012
        if cust is None:
            cust = 0.002
        mgmt_value = mgmt * 100 if 0 < mgmt <= 1 else mgmt
        cust_value = cust * 100 if 0 < cust <= 1 else cust
        try:
            total = mgmt_value + cust_value
        except Exception:
            total = 1.4
        return {
            "code": code,
            "purchaseStatus": "开放申购",
            "redeemStatus": "开放赎回",
            "minPurchaseAmount": min_amt,
            "subscriptionFeeRate": sub_fee,
            "redemptionFeeRate": red_fee,
            "managementFeeRate": mgmt_pct,
            "custodyFeeRate": cust_pct,
            "serviceFeeRate": f"{total:.2f}%",
            "totalFeeRate1y": f"{total:.2f}",
        }
    except Exception:
        return None


def get_fund_holder_structure(code: str, periods: int = 40) -> dict:
    """持有人结构：只返回已入库的季报真实数据，不再生成行业模板。"""
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
            linked_fund = _safe_float(item.get("linkedFund") or item.get("linked_fund") or item.get("feederFund") or item.get("feeder_fund"))
            if quarter and inst is not None and indiv is not None:
                total_ratio = inst + indiv + (linked_fund or 0)
                if not 95 <= total_ratio <= 105:
                    continue
                row = {"quarter": quarter, "institution": inst, "individual": indiv}
                if linked_fund is not None:
                    row["linkedFund"] = linked_fund
                out.append(row)
    if out:
        return _rows_response(
            code,
            out[-periods:],
            source=source,
            as_of=as_of,
            missing_reason="缺少真实持有人结构季报数据；不再使用行业模板模拟。",
        )

    report = _fetch_eastmoney_holder_report_pdf_text(code)
    if report:
        parsed = _parse_holder_structure_from_report_text(report["text"], report.get("report_date"))
        if parsed:
            _persist_quarterly_snapshot_field(
                code,
                report.get("report_date") or parsed[0].get("quarter") or "",
                holder_structure=parsed,
                source=report.get("source") or "eastmoney:periodic_report_pdf",
            )
            return _rows_response(
                code,
                parsed[-periods:],
                source=report.get("source") or "eastmoney:periodic_report_pdf",
                as_of=report.get("report_date"),
            )

    return _rows_response(
        code,
        [],
        missing_reason="缺少真实持有人结构季报数据；不再使用行业模板模拟。",
    )


# ============================================================
#  P1: 券种配置 / 重仓债券 / 历史回报 / 偏股混合均值与基准
# ============================================================

def get_fund_bond_allocation(code: str) -> dict:
    """券种配置：只返回季报快照中的真实券种占比。"""
    rows = _safe_table_query(
        """SELECT report_date, bond_allocation_json, source, updated_at
           FROM fund_detail_quarterly_snapshot
           WHERE code = ? AND bond_allocation_json IS NOT NULL AND bond_allocation_json != '' AND bond_allocation_json != '[]'
           ORDER BY report_date DESC
           LIMIT 1""",
        (code,),
    )
    out: list[dict[str, Any]] = []
    row = rows[0] if rows else None
    if row:
        for item in _parse_json_array(row["bond_allocation_json"]):
            bond_type = str(item.get("bondType") or item.get("bond_type") or item.get("name") or "")
            ratio = _safe_float(item.get("ratio") or item.get("navRatio") or item.get("nav_ratio"))
            if bond_type and ratio is not None:
                out.append({
                    "bondType": bond_type,
                    "ratio": ratio,
                    "changeRatio": _safe_float(item.get("changeRatio") or item.get("change_ratio")),
                })
    if out:
        return _rows_response(
            code,
            out,
            source=row["source"] or "fund_detail_quarterly_snapshot",
            as_of=row["report_date"],
            missing_reason="券种配置快照为空。",
        )

    report = _fetch_eastmoney_holder_report_pdf_text(code)
    if report:
        parsed = _parse_bond_allocation_from_report_text(report["text"])
        if parsed:
            _persist_quarterly_snapshot_field(
                code,
                report.get("report_date") or "",
                bond_allocation=parsed,
                source=report.get("source") or "eastmoney:periodic_report_pdf",
            )
            return _rows_response(
                code,
                parsed,
                source=report.get("source") or "eastmoney:periodic_report_pdf",
                as_of=report.get("report_date"),
            )
        if _report_confirms_no_bonds(report["text"]):
            return _rows_response(
                code,
                [],
                status=DETAIL_STATUS_AVAILABLE,
                source=report.get("source") or "eastmoney:periodic_report_pdf",
                as_of=report.get("report_date"),
                coverage=1.0,
            )

    return _rows_response(
        code,
        [],
        missing_reason="缺少真实券种配置季报数据；不再使用按基金类型生成的模拟配置。",
    )


def get_fund_bond_holdings(code: str) -> dict:
    """重仓债券：优先读取快照，其次尝试 AkShare 东方财富真实债券持仓。"""
    snapshot_rows = _safe_table_query(
        """SELECT report_date, bond_holdings_json, source, updated_at
           FROM fund_detail_quarterly_snapshot
           WHERE code = ? AND bond_holdings_json IS NOT NULL AND bond_holdings_json != '' AND bond_holdings_json != '[]'
           ORDER BY report_date DESC
           LIMIT 1""",
        (code,),
    )
    if snapshot_rows:
        row = snapshot_rows[0]
        out = []
        for item in _parse_json_array(row["bond_holdings_json"]):
            name = str(item.get("bondName") or item.get("bond_name") or item.get("bond_name_cn") or item.get("name") or "")
            ratio = _safe_float(item.get("navRatio") or item.get("nav_ratio") or item.get("ratio") or item.get("weight") or item.get("nav_ratio_pct"))
            issuer = (
                item.get("issuer")
                or item.get("issuer_name")
                or item.get("issuerName")
                or item.get("creditor")
                or item.get("issuerInfo", {}).get("name")
                or item.get("issuer_info", {}).get("issuer")
                or ""
            )
            issuer = str(issuer).strip() if issuer is not None else ""
            bond_type = (
                item.get("bondType")
                or item.get("bond_type")
                or item.get("bond_kind")
                or item.get("bondKind")
                or item.get("type")
                or item.get("category")
                or ""
            )
            credit_rating = (
                item.get("creditRating")
                or item.get("credit_rating")
                or item.get("rating")
                or item.get("credit")
                or item.get("creditGrade")
                or item.get("credit_grade")
                or ""
            )
            issuer = issuer if issuer else None
            bond_type = bond_type if bond_type else None
            credit_rating = credit_rating if credit_rating else None
            if name:
                out.append({
                    "bondName": name,
                    "marketValue": _safe_number(item.get("marketValue") or item.get("market_value") or item.get("market_value2")),
                    "navRatio": ratio,
                    "couponRate": _safe_number(item.get("couponRate") or item.get("coupon_rate") or item.get("coupon") or item.get("interestRate") or item.get("couponRatePct")),
                    "issuer": issuer,
                    "bondType": bond_type,
                    "creditRating": credit_rating,
                })
        return _rows_response(
            code,
            out,
            source=row["source"] or "fund_detail_quarterly_snapshot",
            as_of=row["report_date"],
            missing_reason="债券持仓快照为空。",
        )

    try:
        from ..data.akshare_fetcher import get_fund_bond_portfolio

        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bond-holdings")
        future = executor.submit(get_fund_bond_portfolio, code)
        try:
            portfolio = future.result(timeout=BOND_HOLDINGS_FALLBACK_TIMEOUT_SECONDS) or {}
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
        holdings = portfolio.get("bond_holdings") or []
        out = []
        as_of = None
        for item in holdings:
            name = str(item.get("name") or item.get("bondName") or item.get("bond_name") or "")
            ratio = _safe_float(item.get("ratio") or item.get("navRatio"))
            if not name:
                continue
            as_of = str(item.get("quarter") or item.get("updated_at") or as_of or "")
            issuer = (
                item.get("issuer")
                or item.get("issuerName")
                or item.get("creditor")
                or item.get("issuer_name")
                or item.get("issuerInfo", {}).get("name")
                or item.get("issuer_info", {}).get("issuer")
                or ""
            )
            issuer = str(issuer).strip() if issuer is not None else ""
            bond_type = (
                item.get("bondType")
                or item.get("bond_type")
                or item.get("bondKind")
                or item.get("type")
                or item.get("bond_type_cn")
                or ""
            )
            credit_rating = (
                item.get("creditRating")
                or item.get("credit_rating")
                or item.get("rating")
                or item.get("creditGrade")
                or item.get("credit_grade")
                or ""
            )
            issuer = issuer if issuer else None
            bond_type = bond_type if bond_type else None
            credit_rating = credit_rating if credit_rating else None
            out.append({
                "bondName": name,
                "marketValue": _safe_number(item.get("marketValue") or item.get("market_value") or item.get("marketValue1")),
                "navRatio": ratio,
                "couponRate": _safe_number(item.get("couponRate") or item.get("coupon_rate") or item.get("coupon") or item.get("interestRate") or item.get("couponRatePct")),
                "issuer": issuer,
                "bondType": bond_type,
                "creditRating": credit_rating,
            })
        if out:
            return _rows_response(
                code,
                out,
                status=DETAIL_STATUS_PARTIAL,
                source="AkShare 东方财富F10 债券持仓",
                as_of=as_of or None,
                coverage=0.45,
                missing_reason="债券名称和占净值比可用，票息/发行主体/评级与债券类型尽量补齐。",
            )
    except TimeoutError:
        console_error(f"bond holdings fetch timed out for {code}")
    except Exception as e:
        console_error(f"bond holdings fetch failed for {code}: {e}")

    report = _fetch_eastmoney_holder_report_pdf_text(code)
    if report and _report_confirms_no_bonds(report["text"]):
        return _rows_response(
            code,
            [],
            status=DETAIL_STATUS_AVAILABLE,
            source=report.get("source") or "eastmoney:periodic_report_pdf",
            as_of=report.get("report_date"),
            coverage=1.0,
        )

    return _rows_response(
        code,
        [],
        missing_reason="缺少真实重仓债券数据；AkShare/Tushare 当前未返回可用持仓。",
    )


def _peer_year_return_samples(code: str, year: int) -> list[float]:
    """返回同类基金该年度净值年化收益样本（百分数）。"""
    type_rows = _safe_table_query(
        "SELECT fund_type FROM fund_master WHERE code = ? AND fund_type IS NOT NULL",
        (code,),
    )
    if not type_rows or not type_rows[0]["fund_type"]:
        return []
    fund_type = type_rows[0]["fund_type"]
    peer_rows = _safe_table_query(
        """SELECT DISTINCT n.code
           FROM fund_nav_history n
           JOIN fund_master m ON m.code = n.code
           WHERE m.fund_type = ? AND m.is_active = 1
           LIMIT 500""",
        (fund_type,),
    )
    if not peer_rows:
        return []
    peer_codes = [r["code"] for r in peer_rows if r["code"] and r["code"] != code]
    if not peer_codes:
        peer_codes = [r["code"] for r in peer_rows if r["code"]]
    if not peer_codes:
        return []
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
    return rets


def _trimmed_mean(values: list[float]) -> float | None:
    if len(values) < 3:
        return None
    ordered = sorted(values)
    n = len(ordered)
    k = max(1, n // 10)
    trimmed = ordered[k : n - k] if n - k > k else ordered
    return round(sum(trimmed) / len(trimmed), 4)


def _peer_year_return(code: str, year: int) -> float | None:
    return _trimmed_mean(_peer_year_return_samples(code, year))


def _rank_in_peer_group(fund_return: float | None, peer_samples: list[float]) -> dict[str, int] | None:
    if fund_return is None or not peer_samples:
        return None
    better_or_equal = sum(1 for value in peer_samples if value is not None and value > fund_return)
    return {"rank": better_or_equal + 1, "total": len(peer_samples) + 1}


def _get_peer_avg_returns(
    code: str,
    fund_type: str,
    windows: list[int],
    *,
    max_peers: int = 80,
    min_sample: int = 2,
) -> dict[int, float | None]:
    """按同类基金计算给定窗口的平均收益（百分比，不含倍数）。"""
    if not fund_type:
        return {w: None for w in windows}

    peer_rows = _safe_table_query(
        """SELECT DISTINCT code FROM fund_master
           WHERE fund_type = ? AND is_active = 1 AND code != ?
           LIMIT ?""",
        (fund_type, code, max_peers),
    )
    peer_codes = [r["code"] for r in peer_rows if r.get("code")]
    if not peer_codes:
        return {w: None for w in windows}

    placeholders = ",".join("?" for _ in peer_codes)
    all_nav = _safe_table_query(
        f"""SELECT code, nav_date, nav
            FROM fund_nav_history
            WHERE code IN ({placeholders})
            ORDER BY code, nav_date ASC""",
        tuple(peer_codes),
    )
    if not all_nav:
        return {w: None for w in windows}

    nav_map: dict[str, list[dict[str, Any]]] = {}
    for row in all_nav:
        c = str(row["code"] or "").strip()
        if not c:
            continue
        nav = _safe_float(row.get("nav"))
        if nav is None:
            continue
        nav_map.setdefault(c, []).append({"nav_date": str(row.get("nav_date", ""))[:10], "nav": nav})

    result: dict[int, list[float]] = {w: [] for w in windows}
    for values in nav_map.values():
        if len(values) < 2:
            continue
        for w in windows:
            r = _window_return_from_nav(values, w)
            if r is not None:
                result[w].append(r)

    out: dict[int, float | None] = {}
    for w in windows:
        values = result[w]
        if len(values) < min_sample:
            out[w] = None
            continue
        values.sort()
        n = len(values)
        k = max(1, n // 10)
        trimmed = values[k : n - k] if n - k > k else values
        out[w] = round(sum(trimmed) / len(trimmed), 4)
    return out


def get_fund_year_returns(code: str) -> dict:
    """历年回报：从真实净值历史计算本基金年度收益，同时计算沪深300同期年度收益和同类均值。"""
    nav_rows, source, as_of = _get_nav_history_for_detail(code)
    if len(nav_rows) < 2:
        # Fallback: use quote snapshot scalar returns when nav history is insufficient
        try:
            with get_db_context() as conn:
                q = conn.execute(
                    "SELECT near_1y, near_3y, ytd FROM fund_quote_snapshot WHERE code = ?",
                    (code,),
                ).fetchone()
            if q and (q["near_1y"] is not None or q["near_3y"] is not None or q["ytd"] is not None):
                from datetime import date as date_type
                current_year = date_type.today().year
                rows_out = []
                if q["ytd"] is not None:
                    rows_out.append({"year": current_year, "fundReturn": _safe_float(q["ytd"]), "hs300Return": None, "peerReturn": None, "rank": None})
                if q["near_1y"] is not None:
                    rows_out.append({"year": current_year - 1, "fundReturn": _safe_float(q["near_1y"]), "hs300Return": None, "peerReturn": None, "rank": None})
                if q["near_3y"] is not None:
                    rows_out.append({"year": f"{current_year-3}-{current_year-1}", "fundReturn": _safe_float(q["near_3y"]), "hs300Return": None, "peerReturn": None, "rank": None})
                return _rows_response(
                    code, rows_out,
                    status=DETAIL_STATUS_PARTIAL,
                    source="fund_quote_snapshot_fallback",
                    as_of=as_of,
                    coverage=0.3,
                    missing_reason="净值历史不足，年度收益由快照收益率推算。",
                )
        except Exception:
            pass
        return _rows_response(code, [], missing_reason="缺少净值历史，无法计算年度收益。")
    years = sorted({_to_date(row.get("nav_date")).year for row in nav_rows if _to_date(row.get("nav_date"))})
    latest_years = years[-5:]

    # 获取沪深300净值历史用于计算同期年度收益
    index_nav_rows = []
    try:
        index_nav_rows = _get_index_nav_history(HS300_BENCHMARK_CODE)
    except Exception as e:
        console_error(f"yearReturns: index nav fetch failed: {e}")

    rows = []
    has_hs300 = False
    has_peer = False
    for year in latest_years:
        fund_return = _annual_return_from_nav(nav_rows, year)
        peer_samples = _peer_year_return_samples(code, year)
        peer_return = _trimmed_mean(peer_samples)
        rank = _rank_in_peer_group(fund_return, peer_samples)
        hs300_return = _annual_return_from_nav(index_nav_rows, year) if index_nav_rows else None

        if hs300_return is not None:
            has_hs300 = True
        if peer_return is not None:
            has_peer = True

        rows.append({
            "year": year,
            "fundReturn": fund_return,
            "hs300Return": hs300_return,
            "peerReturn": peer_return,
            "rank": rank,
        })
    has_hs300 = any(r["hs300Return"] is not None for r in rows)
    has_peer = any(r["peerReturn"] is not None for r in rows)
    coverage = 0.5 if has_hs300 else 0.35
    if has_peer:
        coverage = min(1.0, coverage + 0.2)
    if has_hs300 and has_peer:
        missing_reason = "本基金/沪深300/同类均值均按真实数据计算；排名需补基准/同类历史表。"
    elif has_peer:
        missing_reason = "本基金/同类均值按真实数据计算；沪深300 同期收益缺失，排名需补同类历史表。"
    else:
        missing_reason = "本基金年度收益已按真实净值计算；沪深300同期收益来自指数净值；同类均值、排名需补基准/同类历史表。"
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
    """获取指数（默认沪深300）的收盘价历史，优先从 fund_benchmark_nav_history 表读取，
    回退到 efinance / akshare 在线获取并持久化。

    返回 [{"nav_date": str, "nav": float}, ...] 按 nav_date 升序。
    """
    # 1. 从 fund_benchmark_nav_history 读取
    rows = _safe_table_query(
        """SELECT nav_date, nav
           FROM fund_benchmark_nav_history
           WHERE benchmark_code = ?
           ORDER BY nav_date ASC""",
        (benchmark_code,),
    )
    if len(rows) >= 50:
        return [{"nav_date": str(r["nav_date"]), "nav": _safe_float(r["nav"])} for r in rows if _safe_float(r["nav"]) is not None]

    # 2. efinance 回退（沪深300 用 stock.get_quote_history）
    try:
        import efinance as ef
        df = ef.stock.get_quote_history(benchmark_code, klt=101)
        if df is not None and not df.empty:
            rename_map = {"日期": "date", "收盘": "close", "close": "close"}
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
                    # 持久化到 fund_benchmark_nav_history
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
                        pass
                    return records
    except Exception as e:
        console_error(f"efinance index nav fetch failed for {benchmark_code}: {e}")

    # 3. akshare 回退
    try:
        import akshare as ak
        import pandas as pd
        df = ak.stock_zh_index_daily(symbol=f"sh{benchmark_code}")
        if df is not None and not df.empty:
            for col in ["close", "收盘"]:
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
                            pass
                        return records
    except Exception as e:
        console_error(f"akshare index nav fetch failed for {benchmark_code}: {e}")

    return []


def _calc_cumulative_return_series(
    nav_rows: list[dict[str, Any]],
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict[str, Any]]:
    """从净值序列计算累计收益率序列 [{"date": str, "return": float}, ...]。

    以 start_date 对应的净值为基准（如果 start_date 为 None 则用首条），
    return = (nav / base_nav - 1) * 100。
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
    """从净值序列计算逐日回撤序列 [{"date": str, "drawdown": float, "peak_nav": float, "current_nav": float}, ...]。

    drawdown = (current_nav / peak_nav - 1) * 100，peak_nav 为历史最高净值。
    """
    if not nav_rows:
        return []
    # 按日期升序排列
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


def _bounded_series(
    points: list[dict[str, Any]],
    *,
    window_days: int | None = PEER_PERFORMANCE_DEFAULT_WINDOW_DAYS,
    max_points: int | None = PEER_PERFORMANCE_DEFAULT_MAX_POINTS,
) -> list[dict[str, Any]]:
    if not points:
        return []

    filtered = points
    if window_days and window_days > 0:
        parsed: list[tuple[datetime, dict[str, Any]]] = []
        for point in points:
            raw_date = str(point.get("date", ""))[:10]
            try:
                parsed.append((datetime.strptime(raw_date, "%Y-%m-%d"), point))
            except ValueError:
                continue
        if parsed:
            latest = max(d for d, _ in parsed)
            cutoff = latest - timedelta(days=window_days)
            clipped = [point for d, point in parsed if d >= cutoff]
            if clipped:
                filtered = clipped

    if not max_points or max_points <= 0 or len(filtered) <= max_points:
        return filtered
    if max_points == 1:
        return [filtered[-1]]

    last = len(filtered) - 1
    selected: list[dict[str, Any]] = []
    seen: set[int] = set()
    for i in range(max_points):
        idx = round(i * last / (max_points - 1))
        if idx not in seen:
            selected.append(filtered[idx])
            seen.add(idx)
    if selected[-1] is not filtered[-1]:
        selected[-1] = filtered[-1]
    return selected


def get_fund_peer_performance(
    code: str,
    window_days: int | None = PEER_PERFORMANCE_DEFAULT_WINDOW_DAYS,
    max_points: int | None = PEER_PERFORMANCE_DEFAULT_MAX_POINTS,
) -> dict:
    """同类/指数/基准同期收益率。只返回真实或可追溯快照，缺口保留 null。"""
    empty = _empty_perf_row()
    bounded_window_days = max(30, min(int(window_days or PEER_PERFORMANCE_DEFAULT_WINDOW_DAYS), 365 * 30))
    bounded_max_points = max(30, min(int(max_points or PEER_PERFORMANCE_DEFAULT_MAX_POINTS), 2000))
    peer_windows = [365 // 4, 182, 365, 365 * 3, 365 * 5]
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
            # 查询沪深300在 fund_quote_snapshot 中的收益率（如果存在）
            index_quote = conn.execute(
                "SELECT near_3m, near_6m, near_1y, near_3y FROM fund_quote_snapshot WHERE code = ?",
                (HS300_BENCHMARK_CODE,),
            ).fetchone()

        peer_1y = _pct_for_api(cat["avg_annual_return_eq"]) if cat else None
        peer_ann = _safe_float(cat["avg_annual_return_eq"]) if cat else None
        fund_type = (master["fund_type"] if master else "") or ""
        peer_fallback_windows: dict[int, float | None] = {}
        if peer_ann is None:
            peer_fallback_windows = _get_peer_avg_returns(code, fund_type, windows=peer_windows)

        source = "fund_quote_snapshot" if quote else None
        coverage = 0.0
        if quote:
            coverage += 0.25
        if peer_ann is not None or any(v is not None for v in peer_fallback_windows.values()):
            coverage += 0.25
            if source is None:
                source = "fund_category_metrics_snapshot" if peer_ann is not None else "peer_nav_history"

        # 填充 peer 字段：优先快照，其次历史同类均值
        peer_row = {
            "return3m": None,
            "return6m": None,
            "return1y": peer_1y,
            "return3y": None,
            "return5y": None,
            "returnSinceInception": None,
            "annualizedReturn": None,
        }
        if peer_ann is not None:
            peer_base = 1.0 + peer_ann
            peer_row["annualizedReturn"] = _pct_for_api(peer_ann)
            if peer_base > 0:
                peer_row["return3m"] = _pct_for_api(peer_base ** 0.25 - 1)
                peer_row["return6m"] = _pct_for_api(peer_base ** 0.5 - 1)
                peer_row["return3y"] = _pct_for_api(peer_base ** 3 - 1)
                peer_row["return5y"] = _pct_for_api(peer_base ** 5 - 1)
        elif peer_fallback_windows:
            peer_row["return3m"] = _pct_for_api(peer_fallback_windows.get(365 // 4))
            peer_row["return6m"] = _pct_for_api(peer_fallback_windows.get(182))
            peer_row["return1y"] = _pct_for_api(peer_fallback_windows.get(365) or _pct_for_api(peer_row["return1y"]))
            peer_row["return3y"] = _pct_for_api(peer_fallback_windows.get(365 * 3))
            peer_row["return5y"] = _pct_for_api(peer_fallback_windows.get(365 * 5))
            peer_row["annualizedReturn"] = _pct_for_api(peer_fallback_windows.get(365))

        # 填充 index 字段：沪深300收益率
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
            if source is None:
                source = "fund_quote_snapshot"

        index_nav_rows: list[dict[str, Any]] = []
        if not index_quote:
            index_nav_rows = _get_index_nav_history(HS300_BENCHMARK_CODE)
            if index_nav_rows:
                index_row["return3m"] = _pct_for_api(_window_return_from_nav(index_nav_rows, 365 // 4))
                index_row["return6m"] = _pct_for_api(_window_return_from_nav(index_nav_rows, 182))
                index_row["return1y"] = _pct_for_api(_window_return_from_nav(index_nav_rows, 365))
                index_row["return3y"] = _pct_for_api(_window_return_from_nav(index_nav_rows, 365 * 3))
                index_row["return5y"] = _pct_for_api(_window_return_from_nav(index_nav_rows, 365 * 5))
                annual = _window_return_from_nav(index_nav_rows, 365)
                index_row["annualizedReturn"] = _pct_for_api(annual)
                if any(v is not None for v in index_row.values()):
                    coverage = min(1.0, coverage + 0.25)
                    if source is None:
                        source = "fund_benchmark_nav_history"

        benchmark_row = index_row.copy()

        # === 计算 series 曲线数据 ===
        series_data: dict[str, list[dict[str, Any]]] = {
            "fund": [],
            "peer": [],
            "index": [],
            "benchmark": [],
        }
        fund_nav_rows: list[dict[str, Any]] = []

        # 1) 本基金曲线
        try:
            fund_nav_rows, _, _ = _get_nav_history_for_detail(code)
            if fund_nav_rows:
                fund_series = _calc_cumulative_return_series(fund_nav_rows)
                series_data["fund"] = _bounded_series(
                    fund_series,
                    window_days=bounded_window_days,
                    max_points=bounded_max_points,
                )
        except Exception as e:
            console_error(f"fund series calc failed for {code}: {e}")

        fund_return_5y = _window_return_from_nav(fund_nav_rows, 365 * 5) if fund_nav_rows else None
        fund_return_3m = _window_return_from_nav(fund_nav_rows, 365 // 4) if fund_nav_rows else None
        fund_return_6m = _window_return_from_nav(fund_nav_rows, 182) if fund_nav_rows else None
        fund_return_1y = _window_return_from_nav(fund_nav_rows, 365) if fund_nav_rows else None
        fund_return_3y = _window_return_from_nav(fund_nav_rows, 365 * 3) if fund_nav_rows else None

        # 2) 沪深300曲线
        try:
            if not index_nav_rows:
                index_nav_rows = _get_index_nav_history(HS300_BENCHMARK_CODE)
            if index_nav_rows and series_data["fund"]:
                fund_start = series_data["fund"][0]["date"] if series_data["fund"] else None
                fund_end = series_data["fund"][-1]["date"] if series_data["fund"] else None
                index_series = _calc_cumulative_return_series(index_nav_rows, start_date=fund_start, end_date=fund_end)
                series_data["index"] = _bounded_series(
                    index_series,
                    window_days=bounded_window_days,
                    max_points=bounded_max_points,
                )
                series_data["benchmark"] = series_data["index"]
        except Exception as e:
            console_error(f"index series calc failed: {e}")

        index_return_5y = _window_return_from_nav(index_nav_rows, 365 * 5) if index_nav_rows else None
        index_return_3m = _window_return_from_nav(index_nav_rows, 365 // 4) if index_nav_rows else None
        index_return_6m = _window_return_from_nav(index_nav_rows, 182) if index_nav_rows else None
        index_return_1y = _window_return_from_nav(index_nav_rows, 365) if index_nav_rows else None
        index_return_3y = _window_return_from_nav(index_nav_rows, 365 * 3) if index_nav_rows else None
        index_row["return3m"] = index_row["return3m"] if index_row["return3m"] is not None else _pct_for_api(index_return_3m)
        index_row["return6m"] = index_row["return6m"] if index_row["return6m"] is not None else _pct_for_api(index_return_6m)
        index_row["return1y"] = index_row["return1y"] if index_row["return1y"] is not None else _pct_for_api(index_return_1y)
        index_row["return3y"] = index_row["return3y"] if index_row["return3y"] is not None else _pct_for_api(index_return_3y)
        index_row["return5y"] = index_row["return5y"] if index_row["return5y"] is not None else _pct_for_api(index_return_5y)
        index_row["annualizedReturn"] = index_row["annualizedReturn"] if index_row["annualizedReturn"] is not None else _pct_for_api(index_return_1y)
        if any(v is not None for v in index_row.values()):
            coverage = min(1.0, coverage + 0.15)
            benchmark_row = index_row.copy()

        # 3) peer（同类均值）—— 用同类 1y 年化收益作为常量线（所有点返回相同值）
        if peer_1y is not None and series_data["fund"]:
            try:
                series_data["peer"] = [
                    {"date": pt["date"], "return": round(peer_1y, 4)}
                    for pt in series_data["fund"]
                ]
            except Exception as e:
                console_error(f"peer series calc failed: {e}")

        # 4) 本基金回撤序列
        try:
            if fund_nav_rows:
                dd_series = _calc_drawdown_series(fund_nav_rows)
                series_data["fund_drawdown"] = _bounded_series(
                    [
                        {"date": d["date"], "drawdown": d["drawdown"]}
                        for d in dd_series
                    ],
                    window_days=bounded_window_days,
                    max_points=bounded_max_points,
                )
                # 持久化到 SQLite
                try:
                    FundDataStore.save_drawdown_series_batch(code, dd_series, window_days=365)
                except Exception:
                    pass
        except Exception as e:
            console_error(f"drawdown series calc failed for {code}: {e}")

        # 当基金曲线为空时，至少返回标量值
        if not series_data["fund"] and quote:
            fund_row = _empty_perf_row()
            fund_row["return1y"] = _pct_for_api(quote.get("near_1y"))
            fund_row["return3m"] = _pct_for_api(quote.get("near_3m"))
            fund_row["return6m"] = _pct_for_api(quote.get("near_6m"))
            fund_row["return3y"] = _pct_for_api(quote.get("near_3y"))
            fund_row["annualizedReturn"] = _pct_for_api(quote.get("near_1y"))
            fund_row["return5y"] = _pct_for_api(fund_return_5y)
            coverage = max(coverage, 0.2)

        # Build fund scalar dict, using fallback fund_row if series is empty
        fund_scalar = {
            "return3m": _pct_for_api(quote["near_3m"]) if quote else _pct_for_api(fund_return_3m),
            "return6m": _pct_for_api(quote["near_6m"]) if quote else _pct_for_api(fund_return_6m),
            "return1y": _pct_for_api(quote["near_1y"]) if quote else _pct_for_api(fund_return_1y),
            "return3y": _pct_for_api(quote["near_3y"]) if quote else _pct_for_api(fund_return_3y),
            "return5y": _pct_for_api(fund_return_5y),
            "returnSinceInception": None,
            "annualizedReturn": _pct_for_api(quote["near_1y"]) if quote else _pct_for_api(fund_return_1y),
        }
        if not series_data["fund"] and quote:
            fund_scalar = fund_row

        if not series_data["fund"] and quote and index_quote is None:
            benchmark_row["return1y"] = None
            benchmark_row["return3m"] = _pct_for_api(quote["near_3m"]) if quote else None
            benchmark_row["return6m"] = _pct_for_api(quote["near_6m"]) if quote else None
            benchmark_row["return5y"] = _pct_for_api(quote.get("near_5y")) if quote and "near_5y" in quote else None

        peer_has_value = any(v is not None for v in peer_row.values())
        index_has_value = any(v is not None for v in index_row.values())
        benchmark_has_value = any(v is not None for v in benchmark_row.values())
        fund_has_value = any(v is not None for v in fund_scalar.values())
        if not (peer_has_value or index_has_value or quote):
            status = DETAIL_STATUS_MISSING
        elif peer_has_value and index_has_value and fund_has_value:
            status = DETAIL_STATUS_AVAILABLE
        else:
            status = DETAIL_STATUS_PARTIAL

        missing_items = [item for item in (
            "本基金" if not fund_has_value else None,
            "同类" if not peer_has_value else None,
            "指数/基准" if not (index_has_value and benchmark_has_value) else None,
        ) if item]

        return {
            "code": code,
            "peer": peer_row,
            "index": index_row,
            "benchmark": benchmark_row,
            "fund": fund_scalar,
            "series": series_data,
            **_detail_meta(
                status=status,
                source=source,
                as_of=(quote["nav_date"] if quote else None) or (cat["as_of_date"] if cat else None),
                coverage=coverage if status != DETAIL_STATUS_MISSING else 0.0,
                missing_reason=(None if status == DETAIL_STATUS_AVAILABLE else " / ".join(missing_items)),
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
                missing_reason="同期收益读取失败。",
            ),
        }


# ============================================================
#  P2: 历年规模变化 / 基金换手率 / 基金经理变更
# ============================================================

def _backfill_scale_history_from_tushare(
    code: str, periods: int, existing_rows: list
) -> list[dict[str, Any]]:
    """P2.1: 从 tushare fund_share × unit_nav 读取历史规模，回填并入库。

    返回与 get_fund_scale_history 一致的 [{quarter, totalScale, peer25Scale}] 行。
    失败 / 无数据时返回空列表（不抛异常）。
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
        # 按 trade_date 倒序遍历，取最近 periods 个
        share_df = share_df.sort_values(by="trade_date", ascending=False).head(periods)
        for _, srow in share_df.iterrows():
            trade_date = str(srow.get("trade_date", ""))[:10]
            fd_share = provider._safe_float(srow.get("fd_share"))  # type: ignore[attr-defined]
            if not trade_date or fd_share is None or fd_share <= 0:
                continue
            # 取同期 unit_nav
            nav_df = provider._safe_call(pro.fund_nav, ts_code=ts_code, end_date=trade_date)  # type: ignore[attr-defined]
            unit_nav: float | None = None
            if nav_df is not None and not nav_df.empty:
                nav_df = nav_df.sort_values(by="nav_date", ascending=False)
                unit_nav = provider._safe_float(nav_df.iloc[0].get("unit_nav"))  # type: ignore[attr-defined]
            if unit_nav is None or unit_nav <= 0:
                continue
            total_scale = round(fd_share * unit_nav / 100000.0, 4)  # 万份×净值/1e5=亿元
            out.append({"quarter": trade_date, "totalScale": total_scale, "peer25Scale": None})
            persist_rows.append((trade_date, total_scale))
    except Exception:
        return out

    # 入库（仅插入 DB 没有的季度）
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
            pass
    return out


def get_fund_scale_history(code: str, periods: int = 40) -> dict:
    """规模历史：读取真实季报快照；DB 不足 4 季度时，用 tushare fund_share×fund_nav 回填并入库。"""
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
    # DB 真实样本 < 4 时，用 tushare fund_share×unit_nav 历史回填（仅本期新写入）
    if len(out) < min(4, periods):
        tushare_rows = _backfill_scale_history_from_tushare(code, periods, snapshot_rows)
        if tushare_rows:
            # 用 (quarter, totalScale) 去重，保留 DB 优先
            db_keys = {(r["quarter"], round(r["totalScale"], 4) if r["totalScale"] else None) for r in out}
            for trow in tushare_rows:
                tq = trow["quarter"]
                tscale = round(trow["totalScale"], 4) if trow["totalScale"] else None
                if tq and tscale and (tq, tscale) not in db_keys:
                    out.append(trow)
                    db_keys.add((tq, tscale))
            out.sort(key=lambda r: r["quarter"])
            # 截断到 periods
            out = out[-periods:]
    if out:
        return _rows_response(
            code,
            out,
            source=snapshot_rows[0]["source"] or "fund_detail_quarterly_snapshot" if snapshot_rows else "tushare:fund_share",
            as_of=snapshot_rows[0]["report_date"] if snapshot_rows else (out[-1]["quarter"] if out else None),
            coverage=min(1.0, len(out) / max(1, periods)),
            missing_reason=None if len(out) >= 4 else "规模历史样本不足，已用 tushare fund_share×unit_nav 补齐部分季度。",
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
                missing_reason="仅有最新真实规模，缺少季度历史和同类25%分位。",
            )
    return _rows_response(
        code,
        [],
        missing_reason="缺少真实规模历史数据；不再生成模拟规模曲线。",
    )


def get_fund_turnover_history(code: str, periods: int = 40) -> dict:
    """基金换手率：只读取真实季报快照。"""
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
    if not out:
        report = _fetch_eastmoney_holder_report_pdf_text(code)
        if report:
            activity = _parse_stock_trading_activity_from_report_text(report.get("text") or "", report.get("report_date"))
            if activity:
                return _rows_response(
                    code,
                    activity,
                    status=DETAIL_STATUS_PARTIAL,
                    source=report.get("source") or "eastmoney:periodic_report_pdf",
                    as_of=report.get("report_date"),
                    coverage=0.35,
                    missing_reason=(
                        "定期报告披露了股票买入/卖出成交额，但缺少有股票持仓交易日日均股票市值，"
                        "无法按信息披露口径计算股票换手率。"
                    ),
                )
    return _rows_response(
        code,
        out,
        source=rows[0]["source"] if rows else None,
        as_of=rows[0]["report_date"] if rows else None,
        coverage=min(1.0, len(out) / max(1, periods)) if out else 0.0,
        missing_reason="缺少真实基金换手率季报数据；不再生成周期波动模拟值。",
    )


def get_fund_manager_history(code: str) -> dict:
    """基金经理变更：读取真实快照或 provider 当前经理，不生成历任经理。"""
    rows = _safe_table_query(
        """SELECT manager_name, start_date, end_date, total_return, annualized_return, rank_json, source, updated_at
           FROM fund_manager_history_snapshot
           WHERE code = ?
           ORDER BY COALESCE(start_date, '') ASC""",
        (code,),
    )
    out = []
    snapshot_response = None
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
        name_counts: dict[str, int] = {}
        for item in out:
            name_counts[item["managerName"]] = name_counts.get(item["managerName"], 0) + 1
        source = rows[-1]["source"] or "fund_manager_history_snapshot"
        has_report_source = any(str(row["source"] or "").startswith("eastmoney:fund_announcement_report") for row in rows)
        has_repeated_report_manager = has_report_source and any(count > 1 for count in name_counts.values())
        snapshot_response = _rows_response(
            code,
            out,
            source=source,
            as_of=rows[-1]["updated_at"],
        )
        if not has_report_source and not has_repeated_report_manager:
            return snapshot_response

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
                missing_reason="仅获取到当前/最近基金经理，历任经理和同类排名需补快照表。",
            )
    except Exception as e:
        console_error(f"manager history fetch failed for {code}: {e}")

    report_payload = get_fund_manager_report(code)
    report_text = (report_payload or {}).get("report") or ""
    report_rows = _parse_manager_history_from_report_text(report_text, (report_payload or {}).get("period"))
    if report_rows:
        source = (report_payload or {}).get("source") or "eastmoney:fund_announcement_report"
        _persist_manager_history_snapshot(code, report_rows, source)
        return _rows_response(
            code,
            [{k: v for k, v in row.items() if k != "reportDate"} for row in report_rows],
            status=DETAIL_STATUS_PARTIAL,
            source=source,
            as_of=(report_payload or {}).get("period"),
            coverage=0.45,
            missing_reason="\u5b9a\u671f\u62a5\u544a\u62ab\u9732\u5f53\u524d\u57fa\u91d1\u7ecf\u7406\u548c\u4efb\u804c\u65e5\u671f\uff0c\u4efb\u804c\u56de\u62a5\u548c\u540c\u7c7b\u6392\u540d\u5f85\u8865\u5feb\u7167\u8868\u3002",
        )
    if snapshot_response:
        return snapshot_response
    return _rows_response(
        code,
        [],
        missing_reason="缺少真实基金经理变更数据；不再生成虚拟历任经理。",
    )


# ============================================================
#  P3: 运作分析
# ============================================================

_REPORT_TITLE_COL = "\u516c\u544a\u6807\u9898"
_REPORT_DATE_COL = "\u516c\u544a\u65e5\u671f"
_REPORT_ID_COL = "\u62a5\u544aID"
_PERIODIC_REPORT_KEYWORDS = (
    "\u5b63\u5ea6\u62a5\u544a",
    "\u5e74\u5ea6\u62a5\u544a",
    "\u4e2d\u671f\u62a5\u544a",
)
_HOLDER_REPORT_KEYWORDS = (
    "\u5e74\u5ea6\u62a5\u544a",
    "\u4e2d\u671f\u62a5\u544a",
    "\u534a\u5e74\u5ea6\u62a5\u544a",
)
_REPORT_PDF_TEXT_CACHE: dict[str, dict[str, Any]] = {}
_REPORT_PDF_TEXT_CACHE_LOCK = threading.Lock()


def _clean_notice_value(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"nan", "nat", "none"} else text


def _parse_cn_report_date(text: str, fallback: str | None = None) -> str | None:
    match = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", text or "")
    if match:
        year, month, day = match.groups()
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
    if fallback:
        return _clean_notice_value(fallback)[:10] or None
    return None


def _fetch_eastmoney_manager_report(code: str) -> dict[str, Any] | None:
    try:
        import akshare as ak
        import requests

        notices = ak.fund_announcement_report_em(symbol=code)
        if notices is None or getattr(notices, "empty", True):
            return None

        candidates = []
        for index, row in enumerate(notices.to_dict("records")):
            title = _clean_notice_value(row.get(_REPORT_TITLE_COL) or row.get("title"))
            report_id = _clean_notice_value(row.get(_REPORT_ID_COL) or row.get("report_id"))
            publish_date = _clean_notice_value(row.get(_REPORT_DATE_COL) or row.get("date"))
            if not report_id or not any(keyword in title for keyword in _PERIODIC_REPORT_KEYWORDS):
                continue
            candidates.append((publish_date, index, title, report_id))
        if not candidates:
            return None

        publish_date, _, title, report_id = sorted(candidates, key=lambda item: (item[0], item[1]))[-1]
        response = requests.get(
            "https://np-cnotice-fund.eastmoney.com/api/content/ann",
            params={"art_code": report_id, "client_source": "web"},
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://fundf10.eastmoney.com/",
            },
            timeout=20,
        )
        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            return None

        report_text = _clean_notice_value(data.get("notice_content"))
        if not report_text:
            return None

        report_date = _parse_cn_report_date(report_text, publish_date)
        if not report_date:
            return None

        return {
            "report_date": report_date,
            "report_type": title or "periodic_report",
            "report_text": report_text,
            "source": "eastmoney:fund_announcement_report",
            "updated_at": datetime.now().isoformat(),
        }
    except Exception as e:
        console_error(f"manager report fetch failed for {code}: {e}")
        return None


def _latest_eastmoney_notice(code: str, title_keywords: tuple[str, ...]) -> dict[str, str] | None:
    try:
        import akshare as ak

        notices = ak.fund_announcement_report_em(symbol=code)
        if notices is None or getattr(notices, "empty", True):
            return None

        candidates = []
        for index, row in enumerate(notices.to_dict("records")):
            title = _clean_notice_value(row.get(_REPORT_TITLE_COL) or row.get("title"))
            report_id = _clean_notice_value(row.get(_REPORT_ID_COL) or row.get("report_id"))
            publish_date = _clean_notice_value(row.get(_REPORT_DATE_COL) or row.get("date"))
            if not report_id or "\u6458\u8981" in title:
                continue
            if not any(keyword in title for keyword in title_keywords):
                continue
            candidates.append((publish_date, index, title, report_id))
        if not candidates:
            return None

        publish_date, _, title, report_id = sorted(candidates, key=lambda item: (item[0], item[1]))[-1]
        return {"publish_date": publish_date, "title": title, "report_id": report_id}
    except Exception as e:
        console_error(f"eastmoney notice lookup failed for {code}: {e}")
        return None


def _fetch_eastmoney_holder_report_pdf_text(code: str) -> dict[str, Any] | None:
    with _REPORT_PDF_TEXT_CACHE_LOCK:
        cached = _REPORT_PDF_TEXT_CACHE.get(code)
        if cached:
            return cached

        notice = _latest_eastmoney_notice(code, _HOLDER_REPORT_KEYWORDS)
        if not notice:
            return None

        try:
            import pdfplumber
            import requests

            response = requests.get(
                "https://np-cnotice-fund.eastmoney.com/api/content/ann",
                params={"art_code": notice["report_id"], "client_source": "web"},
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://fundf10.eastmoney.com/"},
                timeout=20,
            )
            payload = response.json()
            data = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(data, dict):
                return None
            attach_url = _clean_notice_value(data.get("attach_url_web") or data.get("attach_url"))
            if not attach_url:
                return None

            pdf_response = requests.get(
                attach_url,
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://fundf10.eastmoney.com/"},
                timeout=20,
            )
            pdf_response.raise_for_status()

            pages: list[str] = []
            with pdfplumber.open(io.BytesIO(pdf_response.content)) as pdf:
                for page in pdf.pages:
                    pages.append(page.extract_text(x_tolerance=1, y_tolerance=3) or "")
            text = "\n".join(pages)
            if not text.strip():
                return None

            report_date = _parse_cn_report_date(text, notice.get("publish_date"))
            result = {
                "report_date": report_date or _clean_notice_value(notice.get("publish_date"))[:10],
                "report_type": notice["title"],
                "source": "eastmoney:periodic_report_pdf",
                "text": text,
            }
            _REPORT_PDF_TEXT_CACHE[code] = result
            return result
        except Exception as e:
            console_error(f"eastmoney report pdf fetch failed for {code}: {e}")
            return None


def _parse_bond_allocation_from_report_text(text: str) -> list[dict[str, Any]]:
    marker = "\u671f\u672b\u6309\u503a\u5238\u54c1\u79cd\u5206\u7c7b\u7684\u503a\u5238\u6295\u8d44\u7ec4\u5408"
    start = text.rfind(marker)
    if start < 0:
        return []
    end = text.find("\n8.6 ", start + len(marker))
    section = text[start:end if end > start else start + 1800]
    rows = []
    for line in section.splitlines():
        clean = " ".join(line.split())
        match = re.match(r"^(\d+)\s+(.+?)\s+([\d,.\-]+|-)\s+([\d.\-]+|-)$", clean)
        if not match:
            continue
        _, name, _amount, ratio_raw = match.groups()
        name = name.strip()
        if name == "\u5408\u8ba1":
            continue
        ratio = _safe_float(ratio_raw)
        if ratio is None or ratio <= 0:
            continue
        rows.append({"bondType": name, "ratio": ratio, "changeRatio": None})
    return rows


def _parse_asset_allocation_from_report_text(text: str, report_date: str | None) -> list[dict[str, Any]]:
    marker = "\u671f\u672b\u57fa\u91d1\u8d44\u4ea7\u7ec4\u5408\u60c5\u51b5"
    start = text.rfind(f"8.1 {marker}")
    if start < 0:
        start = text.rfind(marker)
    if start < 0:
        return []
    end = text.find("\n8.2", start + len(marker))
    section = text[start:end if end > start else start + 1600]
    raw_lines = [" ".join(line.split()) for line in section.splitlines() if line.strip()]
    lines: list[str] = []
    i = 0
    while i < len(raw_lines):
        line = raw_lines[i]
        if (
            line == "\u94f6\u884c\u5b58\u6b3e\u548c\u7ed3\u7b97\u5907\u4ed8\u91d1\u5408"
            and i + 2 < len(raw_lines)
            and raw_lines[i + 2] == "\u8ba1"
        ):
            split_match = re.match(r"^(\d+)\s+([\d,.\-]+|-)\s+([\d.\-]+|-)$", raw_lines[i + 1])
            if split_match:
                num, amount, ratio = split_match.groups()
                lines.append(f"{num} \u94f6\u884c\u5b58\u6b3e\u548c\u7ed3\u7b97\u5907\u4ed8\u91d1\u5408\u8ba1 {amount} {ratio}")
                i += 3
                continue
        lines.append(line)
        i += 1

    rows: list[dict[str, Any]] = []
    for line in lines:
        match = re.match(r"^(\d+)\s+(.+?)\s+([\d,.\-]+|-)\s+([\d.\-]+|-)$", line)
        if not match:
            continue
        _, name, _amount, ratio_raw = match.groups()
        name = re.sub(r"\s+", "", name)
        if not name or name in {"\u5408\u8ba1"} or name.startswith("\u5176\u4e2d"):
            continue
        ratio = _safe_float(ratio_raw)
        if ratio is None or ratio <= 0:
            continue
        rows.append({
            "name": name,
            "ratio": ratio,
            "report_date": report_date or "",
            "source": "eastmoney:periodic_report_pdf",
        })
    return rows


def _load_holdings_for_report_date(code: str, report_date: str) -> list[dict[str, Any]]:
    try:
        with get_db_context() as conn:
            row = conn.execute(
                """SELECT holdings_json
                   FROM fund_holdings_snapshot
                   WHERE code = ? AND report_date = ?
                   LIMIT 1""",
                (code, report_date),
            ).fetchone()
    except Exception:
        return []
    if not row or not row["holdings_json"]:
        return []
    try:
        holdings = json.loads(row["holdings_json"])
    except json.JSONDecodeError:
        return []
    return holdings if isinstance(holdings, list) else []


def ensure_report_asset_allocation_snapshot(code: str) -> dict[str, Any] | None:
    snapshot = FundDataStore.get_snapshot(code)
    if snapshot and snapshot.get("asset_allocation"):
        return snapshot

    report = _fetch_eastmoney_holder_report_pdf_text(code)
    if not report:
        return snapshot

    report_date = report.get("report_date")
    rows = _parse_asset_allocation_from_report_text(report.get("text") or "", report_date)
    if not rows or not report_date:
        return snapshot

    existing_holdings = _load_holdings_for_report_date(code, report_date)
    saved = FundDataStore.save_holdings_snapshot(
        code=code,
        report_date=report_date,
        holdings=existing_holdings,
        asset_allocation=rows,
        source="eastmoney:periodic_report_pdf",
        data_quality="report_pdf",
    )
    if not saved:
        return snapshot
    return FundDataStore.get_snapshot(code) or {
        "code": code,
        "asset_allocation": rows,
        "data_quality": "report_pdf",
        "updated_at": datetime.now().isoformat(),
    }


def _report_confirms_no_bonds(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    return any(
        phrase in compact
        for phrase in (
            "\u672c\u57fa\u91d1\u672c\u62a5\u544a\u671f\u672b\u672a\u6301\u6709\u503a\u5238",
            "\u672c\u57fa\u91d1\u672c\u62a5\u544a\u671f\u672b\u672a\u6301\u6709\u503a\u5238\u6295\u8d44",
        )
    )


def _parse_holder_structure_from_report_text(text: str, report_date: str | None) -> list[dict[str, Any]]:
    marker = "\u671f\u672b\u57fa\u91d1\u4efd\u989d\u6301\u6709\u4eba\u6237\u6570\u53ca\u6301\u6709\u4eba\u7ed3\u6784"
    start = text.rfind(marker)
    if start < 0:
        return []
    end_candidates = [
        text.find("\n9.2", start + len(marker)),
        text.find("\n\u00a710", start + len(marker)),
    ]
    end = min((idx for idx in end_candidates if idx > start), default=start + 1600)
    section = " ".join(text[start:end].split())
    match = re.search(
        r"\u5408\u8ba1\s+[\d,]+\s+[\d,.]+\s+([\d,.\-]+|-)\s+([\d.\-]+|-)\s+([\d,.\-]+|-)\s+([\d.\-]+|-)",
        section,
    )
    linked_fund = None
    if match:
        _inst_amount, inst_ratio, _indiv_amount, indiv_ratio = match.groups()
        institution = _safe_float(inst_ratio)
        individual = _safe_float(indiv_ratio)
    else:
        percent_values = [
            _safe_float(value)
            for value in re.findall(r"([\d.]+)\s*%", section)
        ]
        percent_values = [value for value in percent_values if value is not None]
        compact_section = re.sub(r"\s+", "", section)
        has_linked_holder = (
            len(percent_values) == 3
            or "\u8054\u63a5\u57fa\u91d1" in compact_section
            or ("\u53d1\u8d77\u5f0f\u8054" in compact_section and "\u63a5\u57fa\u91d1" in compact_section)
        )
        if len(percent_values) >= 3 and has_linked_holder:
            institution, individual, linked_fund = percent_values[:3]
        elif len(percent_values) >= 2:
            institution, individual = percent_values[:2]
        else:
            ratio_values = [
                _safe_float(value)
                for value in re.findall(r"(?<![\d,])(?:100(?:\.0+)?|\d{1,2}\.\d+)(?![\d,])", section)
            ]
            ratio_values = [value for value in ratio_values if value is not None]
            ratio_count = 3 if has_linked_holder else 2
            ratios = _find_holder_ratio_group(ratio_values, ratio_count)
            if not ratios:
                return []
            if has_linked_holder and ratio_count == 3:
                institution, individual, linked_fund = ratios
            else:
                institution, individual = ratios[:2]
    if institution is None or individual is None:
        return []
    row = {
        "quarter": report_date or "",
        "institution": institution,
        "individual": individual,
    }
    if linked_fund is not None:
        row["linkedFund"] = linked_fund
    return [row]


def _find_holder_ratio_group(values: list[float], count: int) -> list[float] | None:
    if count not in {2, 3}:
        return None
    for index in range(0, max(0, len(values) - count + 1)):
        ratios = values[index:index + count]
        if len(ratios) != count:
            continue
        total = sum(ratios)
        if 99.5 <= total <= 100.5:
            return ratios
    return None


def _parse_stock_trading_activity_from_report_text(text: str, report_date: str | None) -> list[dict[str, Any]]:
    marker = "买入股票的成本总额及卖出股票的收入总额"
    start = text.find(f"8.4.3 {marker}")
    if start < 0:
        start = text.find(marker)
    if start < 0:
        return []
    section = " ".join(text[start:start + 2600].split())
    def match_number(pattern: str) -> float | None:
        m = re.search(pattern, section)
        if not m:
            return None
        return _safe_number(m.group(1))

    buy_match_patterns = [
        r"买入股票(?:成交)?总额\s*[:：]?\s*([\d,.\-]+(?:亿|万)?)",
        r"买入股票成本[（(]成交[）)]总额\s+([\d,.\-]+(?:亿|万)?)",
        r"买入股票成交金额\s*[\：:]\s*([\d,.\-]+(?:亿|万)?)",
    ]
    sell_match_patterns = [
        r"卖出股票(?:成交)?总额\s*[:：]?\s*([\d,.\-]+(?:亿|万)?)",
        r"卖出股票收入[（(]成交[）)]总额\s+([\d,.\-]+(?:亿|万)?)",
        r"卖出股票成交金额\s*[\：:]\s*([\d,.\-]+(?:亿|万)?)",
    ]
    buy_amount = next((match_number(p) for p in buy_match_patterns if match_number(p) is not None), None)
    sell_amount = next((match_number(p) for p in sell_match_patterns if match_number(p) is not None), None)
    if buy_amount is None and sell_amount is None:
        return []

    def parse_avg_stock_value() -> float | None:
        patterns = [
            r"加权平均股票(?:成交|持仓|市值)[^\d]{0,20}([\d,.\-]+(?:亿|万)?)",
            r"股票持仓平均市值[^\d]{0,20}([\d,.\-]+(?:亿|万)?)",
            r"加权平均(?:资产|证券)市值[^\d]{0,20}([\d,.\-]+(?:亿|万)?)",
            r"股票(?:日均|平均)(?:市值|持仓)[^\s\d]{0,20}([\d,.\-]+(?:亿|万)?)",
            r"持仓(?:股票)?(?:日均|平均)市值[^\d]{0,20}([\d,.\-]+(?:亿|万)?)",
            r"加权平均(?:股票)?交易.*?市值[^\d]{0,30}([\d,.\-]+(?:亿|万)?)",
            r"股票(?:日均|平均)交易[^\u8d44\u4ea7]{0,30}市值[^\d]{0,20}([\d,.\-]+(?:亿|万)?)",
        ]
        for pattern in patterns:
            m = re.search(pattern, section)
            if m:
                value = _safe_number(m.group(1))
                if value is not None and value > 0:
                    return value
        return None

    avg_stock_value = parse_avg_stock_value()
    turnover = None
    if avg_stock_value and (buy_amount is not None or sell_amount is not None):
        try:
            denominator = avg_stock_value * 2
            numerator = (buy_amount or 0.0) + (sell_amount or 0.0)
            if denominator > 0:
                turnover = round((numerator / denominator) * 100, 4)
        except Exception:
            turnover = None

    status = None if turnover is not None else "missing_average_stock_market_value"
    if buy_amount is None and sell_amount is None:
        return []
    return [{
        "quarter": report_date or "",
        "turnoverRate": turnover,
        "buyStockAmount": buy_amount,
        "sellStockAmount": sell_amount,
        "calculationStatus": status,
    }]


def _persist_quarterly_snapshot_field(
    code: str,
    report_date: str,
    *,
    holder_structure: list[dict[str, Any]] | None = None,
    bond_allocation: list[dict[str, Any]] | None = None,
    source: str = "eastmoney:periodic_report_pdf",
) -> None:
    if not report_date:
        return
    fields: list[tuple[str, list[dict[str, Any]]]] = []
    if holder_structure:
        fields.append(("holder_structure_json", holder_structure))
    if bond_allocation:
        fields.append(("bond_allocation_json", bond_allocation))
    if not fields:
        return

    now = datetime.now().isoformat()
    try:
        with get_db_context() as conn:
            for field, value in fields:
                conn.execute(
                    f"""INSERT INTO fund_detail_quarterly_snapshot
                       (code, report_date, holder_structure_json, bond_allocation_json, bond_holdings_json,
                        total_scale, turnover_rate, source, data_quality, updated_at)
                       VALUES (?, ?, ?, ?, '[]', NULL, NULL, ?, 'report_pdf', ?)
                       ON CONFLICT(code, report_date) DO UPDATE SET
                         {field} = excluded.{field},
                         source = excluded.source,
                         data_quality = excluded.data_quality,
                         updated_at = excluded.updated_at""",
                    (
                        code,
                        report_date,
                        json.dumps(value, ensure_ascii=False) if field == "holder_structure_json" else "[]",
                        json.dumps(value, ensure_ascii=False) if field == "bond_allocation_json" else "[]",
                        source,
                        now,
                    ),
                )
    except Exception as e:
        console_error(f"quarterly report field persist failed for {code}: {e}")


def _persist_fund_manager_report(code: str, report: dict[str, Any]) -> None:
    try:
        with get_db_context() as conn:
            conn.execute(
                """INSERT INTO fund_report_snapshot
                   (code, report_date, report_type, report_text, source, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(code, report_date, report_type) DO UPDATE SET
                     report_text = excluded.report_text,
                     source = excluded.source,
                     updated_at = excluded.updated_at""",
                (
                    code,
                    report["report_date"],
                    report.get("report_type") or "",
                    report["report_text"],
                    report.get("source") or "eastmoney:fund_announcement_report",
                    report.get("updated_at") or datetime.now().isoformat(),
                ),
            )
    except Exception as e:
        console_error(f"manager report persist failed for {code}: {e}")


def get_fund_manager_report(code: str) -> dict | None:
    """运作分析：仅返回真实定期报告文本，不再生成模板长文。"""
    rows = _safe_table_query(
        """SELECT report_date, report_text, source, updated_at
           FROM fund_report_snapshot
           WHERE code = ? AND report_text IS NOT NULL AND report_text != ''
           ORDER BY report_date DESC
           LIMIT 1""",
        (code,),
    )
    if not rows:
        fetched = _fetch_eastmoney_manager_report(code)
        if fetched:
            _persist_fund_manager_report(code, fetched)
            return {
                "code": code,
                "report": fetched["report_text"],
                "period": fetched["report_date"],
                **_detail_meta(
                    status=DETAIL_STATUS_AVAILABLE,
                    source=fetched["source"],
                    as_of=fetched["report_date"],
                    coverage=1.0,
                ),
            }
        return {
            "code": code,
            "report": None,
            "period": None,
            **_detail_meta(
                status=DETAIL_STATUS_MISSING,
                missing_reason="缺少真实基金定期报告原文；不再生成模板化运作分析。",
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
#  内部辅助
# ============================================================

def _to_ts_code(code: str) -> str:
    """6 位代码 → tushare ts_code 格式（如 000020 → 000020.OF）。"""
    return f"{code}.OF"


def _safe_int(v) -> int | None:
    try:
        return int(v) if v not in (None, "") else None
    except Exception:
        return None


def _format_fee(v) -> str:
    """基金费率 0~1 或 0~100 数值 → '0.30%~1.50%' 区间字符串。"""
    f = _safe_float(v)
    if f is None:
        return "—"
    # 0~1 → × 100
    if 0 < f < 1:
        return f"{f * 100:.2f}%"
    return f"{f:.2f}%"


# ============================================================
#  风险摘要（rule-based 模板）
# ============================================================

def get_fund_risk_summary(code: str, window: str = "1y") -> dict | None:
    """风险摘要（基于 fund_metrics_snapshot + 同类均值生成规则模板）。

    输出字段：
      - code
      - window：1y / 3y / 5y / inception
      - level：low / medium / high
      - downsideRisk、maxDrawdown、peerDownsideRisk、peerMaxDrawdown
      - summary：自然语言摘要（中文）
      - source：规则引擎
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
        fund_name = master["name"] or "本基金"
        fund_type = master["fund_type"] or "基金"
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
        peer_downside = None if peer_max_dd is None else round(abs(peer_max_dd) * 0.8, 4)

        # 等级
        if max_dd is None or peer_max_dd is None:
            level = "low"
            compare = "无法与同类比较"
        else:
            # 注意：peer_max_dd 通常是负数（-0.06 代表 -6%）
            if abs(max_dd) < abs(peer_max_dd) * 0.8:
                level = "low"
                compare_verb = "小于同类平均"
            elif abs(max_dd) > abs(peer_max_dd) * 1.2:
                level = "high"
                compare_verb = "大于同类平均"
            else:
                level = "medium"
                compare_verb = "与同类平均相近"
            compare = f"该基金的最大回撤 {compare_verb}"

        # 4 段式机构风控官口径
        level_zh = {"low": "低", "medium": "中", "high": "高"}[level]
        peer_compare = compare
        downside = _format_pct(downside_risk) if downside_risk is not None else "暂无"
        sharpe_str = f"{sharpe:.2f}" if sharpe is not None else "暂无"
        if level == "high":
            suitability = "适合 C4 及以上风险偏好的投资者配置，建议作为权益组合的卫星仓位。"
        elif level == "medium":
            suitability = "适合 C3 风险偏高的投资者作为核心配置。"
        else:
            suitability = "适合 C1-C2 风险偏好投资者作为底仓配置。"
        summary = (
            f"【风险定级】{window} 窗口下本基金 {fund_name}（{fund_type}）综合风险等级为【{level_zh}】。\n"
            f"【核心指标】最大回撤 {_format_pct(max_dd)}，"
            f"下行风险代理指标 {downside}；"
            f"夏普比率 {sharpe_str}。\n"
            f"【同业对标】与同类（{fund_type}）平均最大回撤 {_format_pct(peer_max_dd)} 相比，{peer_compare}。\n"
            f"【适当性建议】本产品风险等级{level_zh}，{suitability}"
        )
        return {
            "code": code,
            "window": window,
            "level": level,
            "maxDrawdown": max_dd,
            "peerMaxDrawdown": peer_max_dd,
            "downsideRisk": downside_risk,
            "peerDownsideRisk": peer_downside,
            "summary": summary,
            "volatility": volatility,
            **_detail_meta(
                status=DETAIL_STATUS_PARTIAL if nav_metrics else DETAIL_STATUS_PARTIAL if row else DETAIL_STATUS_MISSING,
                source=nav_source or (row["source"] if row else None) or "rule-engine",
                as_of=nav_as_of or (row["updated_at"] if row else None),
                coverage=0.7 if nav_metrics else 0.35 if row else 0.0,
                missing_reason=None if nav_metrics else "缺少足量净值历史，仅能使用指标快照生成摘要。",
            ),
        }
    except Exception:
        return None


def _format_dd(v) -> str:
    if v is None:
        return "暂无数据"
    return f"{v:.4f}%"


def _format_pct(v) -> str:
    if v is None:
        return "暂无数据"
    if abs(v) < 1:
        return f"{v * 100:.2f}%"
    return f"{v:.2f}%"


_MANAGER_NAME_SKIP_PARTS = (
    "\u57fa\u91d1",
    "\u7ecf\u7406",
    "\u4efb\u804c",
    "\u79bb\u4efb",
    "\u65e5\u671f",
    "\u8bc1\u5238",
    "\u4ece\u4e1a",
    "\u804c\u52a1",
    "\u8bf4\u660e",
    "\u5e74\u9650",
    "\u65e5",
    "\u81f3",
    "\u6295\u8d44",
    "\u7814\u7a76",
    "\u516c\u53f8",
    "\u5386\u4efb",
    "\u73b0\u4efb",
    "\u7855\u58eb",
    "\u4e2d\u56fd",
)


def _format_report_date(year: str, month: str, day: str) -> str | None:
    try:
        parsed = date(int(year), int(month), int(day))
    except Exception:
        return None
    return parsed.isoformat()


def _extract_manager_start_date(line: str, next_line: str) -> str | None:
    joined = f"{line} {next_line}"

    match = re.search(r"(\d{4})\s*\u5e74\s*(\d{1,2})(?=\D)", line)
    month_day = re.search(r"\u6708\s*(\d{1,2})\s*\u65e5", next_line)
    if match and month_day:
        return _format_report_date(match.group(1), match.group(2), month_day.group(1))

    match = re.search(r"(\d{4})-\s*(?:-|$)", line)
    month_day = re.search(r"(\d{1,2})-(\d{1,2})", next_line)
    if match and month_day:
        return _format_report_date(match.group(1), month_day.group(1), month_day.group(2))

    if not re.search(r"\d{4}", line):
        return None

    match = re.search(r"(\d{4})\s*\u5e74\s*(\d{1,2})\s*\u6708\s*(\d{1,2})(?=\D|$)", line)
    if match and "\u65e5" in next_line:
        return _format_report_date(*match.groups())

    match = re.search(r"(\d{4})\s*\u5e74\s*(\d{1,2})\s*\u6708\s*(\d{1,2})(?:\s*\u65e5|[^\d]{0,120}?\u65e5)", joined)
    if match:
        return _format_report_date(*match.groups())

    match = re.search(r"(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})", joined)
    if match:
        return _format_report_date(*match.groups())
    return None


def _manager_name_token(line: str) -> str | None:
    prefix = line[:32]
    match = re.match(r"\s*([\u4e00-\u9fff]{2,4})(?=\s)", prefix)
    if not match:
        match = re.match(r"\s*([\u4e00-\u9fff])(?=\s)", prefix)
    if not match:
        return None
    token = re.sub(r"\s+", "", match.group(1))
    if any(part in token for part in _MANAGER_NAME_SKIP_PARTS):
        return None
    return token


def _extract_manager_name(lines: list[str], index: int) -> str | None:
    current = _manager_name_token(lines[index]) if 0 <= index < len(lines) else None
    next_token = _manager_name_token(lines[index + 1]) if index + 1 < len(lines) else None
    if current and next_token and len(current) == 1 and len(next_token) == 1:
        return current + next_token
    if current and len(current) >= 2:
        return current
    if next_token and len(next_token) >= 2:
        return next_token
    return None


def _parse_manager_history_from_report_text(text: str, report_date: str | None = None) -> list[dict[str, Any]]:
    start = text.find("4.1")
    if start < 0:
        start = text.find("\u57fa\u91d1\u7ecf\u7406")
    if start < 0:
        return []
    end_candidates = [
        text.find("\n4.2", start + 3),
        text.find("\n\u00a75", start + 3),
        text.find("\n5.", start + 3),
    ]
    end = min((idx for idx in end_candidates if idx > start), default=start + 2600)
    section = text[start:end]
    lines = [line.rstrip() for line in section.splitlines() if line.strip()]
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for index, line in enumerate(lines):
        next_line = lines[index + 1] if index + 1 < len(lines) else ""
        start_date = _extract_manager_start_date(line, next_line)
        if not start_date:
            continue
        name = _extract_manager_name(lines, index)
        if not name:
            continue
        key = (name, start_date)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "managerName": name,
            "startDate": start_date,
            "endDate": None,
            "totalReturn": None,
            "annualizedReturn": None,
            "rank": None,
            "reportDate": report_date,
        })
    return rows


def _persist_manager_history_snapshot(code: str, rows: list[dict[str, Any]], source: str) -> None:
    if not rows:
        return
    now = datetime.now().isoformat()
    try:
        with get_db_context() as conn:
            conn.execute(
                "DELETE FROM fund_manager_history_snapshot WHERE code = ? AND source = ?",
                (code, source),
            )
            for row in rows:
                conn.execute(
                    """INSERT INTO fund_manager_history_snapshot
                       (code, manager_name, start_date, end_date, total_return, annualized_return, rank_json, source, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(code, manager_name, start_date) DO UPDATE SET
                         end_date = excluded.end_date,
                         total_return = COALESCE(excluded.total_return, fund_manager_history_snapshot.total_return),
                         annualized_return = COALESCE(excluded.annualized_return, fund_manager_history_snapshot.annualized_return),
                         rank_json = COALESCE(NULLIF(excluded.rank_json, ''), fund_manager_history_snapshot.rank_json),
                         source = excluded.source,
                         updated_at = excluded.updated_at""",
                    (
                        code,
                        row.get("managerName") or "",
                        row.get("startDate") or "",
                        row.get("endDate") or "",
                        row.get("totalReturn"),
                        row.get("annualizedReturn"),
                        json.dumps(row.get("rank") or {}, ensure_ascii=False),
                        source,
                        now,
                    ),
                )
    except Exception as e:
        console_error(f"manager history persist failed for {code}: {e}")


def risk_downside_estimate(metrics_row, peer_max_dd) -> float:
    """粗略估算下行风险（用最大回撤做 proxy）。"""
    if metrics_row is None:
        return 0.0
    md = _safe_float(metrics_row["max_drawdown"]) or 0
    return abs(md) * 0.8  # 大致

