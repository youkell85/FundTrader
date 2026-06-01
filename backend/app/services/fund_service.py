"""基金排名筛选服务

数据源策略：
- 全市场排名 → akshare fund_open_fund_rank_em（Tushare 不提供聚合排名）
- 回退排名 → eastmoney 东方财富 API
- 基金详情 → Tushare（Fusion 优先级5，付费高频）→ iFinD → Tickflow → Tencent
- 基金规模 → Tushare fund_share × unit_nav → efinance fallback
- 基金费率 → efinance（Tushare 不提供费率字段）
- 持仓/经理 → Tushare fund_portfolio / fund_manager → akshare 补充学历信息
"""
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import date, datetime
from typing import List, Dict, Any, Optional
from ..utils import console_error
from ..data.akshare_fetcher import get_fund_ranking, get_fund_info
from ..data.eastmoney_fetcher import get_fund_ranking_em
from ..data.cache_manager import cache
from ..constants.guoyuan_funds import GUOYUAN_FUND_LIST, FUND_CATEGORIES, FUND_TYPES
from ..config import CACHE_TTL_RANKING

# 排序字段映射（提取为模块级常量，避免重复定义）
SORT_FIELD_MAP: Dict[str, str] = {
    "近1月": "near_1m", "近3月": "near_3m", "近6月": "near_6m",
    "近1年": "near_1y", "近3年": "near_3y", "今年来": "ytd",
}

BULK_PERFORMANCE_TIMEOUT_SECONDS = float(os.getenv("FUNDTRADER_BULK_PERFORMANCE_TIMEOUT_SECONDS", "8"))
_bulk_performance_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fund-perf")


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
    funds: List[Dict[str, Any]],
    category: str,
    tag: Optional[str],
    keyword: Optional[str],
    sort_by: str,
    sort_order: str,
) -> List[Dict[str, Any]]:
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
    tag: Optional[str] = None,
    keyword: Optional[str] = None,
    sort_by: str = "今年来",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 20,
    guoyuan_only: bool = True,
) -> Dict[str, Any]:
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
    tag: Optional[str] = None,
    keyword: Optional[str] = None,
    sort_by: str = "今年来",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
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


def _get_watchlist_with_performance(watchlist: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """为自选基金获取业绩数据（批量模式）"""
    result = []
    for fund in watchlist:
        fund_data = dict(fund)
        perf = _get_snapshot_by_code(str(fund.get("code", "")))
        if perf:
            fund_data.update(perf)
        result.append(fund_data)
    return result


def _get_snapshot_by_code(code: str) -> Dict[str, Any] | None:
    try:
        from app.storage.database import FundDataStore
        return FundDataStore.get_snapshot(code)
    except Exception:
        return None


def _get_snapshot_funds(guoyuan_only: bool = True) -> List[Dict[str, Any]]:
    try:
        from app.storage.database import FundDataStore
        result = FundDataStore.list_snapshots(xinjihui_only=guoyuan_only, limit=5000, offset=0)
        funds = result.get("funds") or []
        if funds:
            return _json_safe(funds)
    except Exception:
        pass
    return []


def _get_guoyuan_funds_with_performance() -> List[Dict[str, Any]]:
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


def _get_static_guoyuan_funds() -> List[Dict[str, Any]]:
    """Return the local fund pool with JSON-safe default metrics."""
    result = []
    for fund in GUOYUAN_FUND_LIST:
        fund_data = dict(fund)
        fund_data.setdefault("nav", 0.0)
        fund_data.setdefault("day_growth", 0.0)
        fund_data.setdefault("near_1m", 0.0)
        fund_data.setdefault("near_3m", 0.0)
        fund_data.setdefault("near_6m", 0.0)
        fund_data.setdefault("near_1y", 0.0)
        fund_data.setdefault("near_3y", 0.0)
        fund_data.setdefault("ytd", 0.0)
        fund_data.setdefault("company", "")
        fund_data["is_xinjihui"] = True
        result.append(fund_data)
    return _json_safe(result)


def _fetch_all_fund_performance_with_timeout() -> Dict[str, Dict[str, Any]]:
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


def _fetch_all_fund_performance() -> Dict[str, Dict[str, Any]]:
    """批量获取全市场基金业绩数据（一次akshare调用，避免N次重复请求）
    
    基金业绩数据日频更新，单个交易日收盘后统一公布。
    缓存TTL由调用方控制，默认与CACHE_TTL_RANKING一致（30分钟）。
    """
    cache_key = "bulk_fund_performance"
    cached = cache.get(cache_key, CACHE_TTL_RANKING)
    if cached is not None:
        return cached

    perf_map: Dict[str, Dict[str, Any]] = {}
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
