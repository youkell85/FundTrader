"""基金排名筛选服务

数据源策略：
- 全市场排名 → akshare fund_open_fund_rank_em（Tushare 不提供聚合排名）
- 回退排名 → eastmoney 东方财富 API
- 基金详情 → Tushare（Fusion 优先级5，付费高频）→ iFinD → Tickflow → Tencent
- 基金规模 → Tushare fund_share × unit_nav → efinance fallback
- 基金费率 → efinance（Tushare 不提供费率字段）
- 持仓/经理 → Tushare fund_portfolio / fund_manager → akshare 补充学历信息
"""
from typing import List, Dict, Any, Optional
from ..utils import console_error
from ..data.akshare_fetcher import get_fund_ranking, get_fund_info
from ..data.eastmoney_fetcher import get_fund_ranking_em
from ..data.cache_manager import cache
from ..constants.guoyuan_funds import GUOYUAN_FUND_LIST, FUND_CATEGORIES, FUND_TYPES
from ..config import CACHE_TTL_RANKING


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
    """获取基金列表"""
    # 如果只看国元名单
    if guoyuan_only:
        funds = _get_guoyuan_funds_with_performance()
    else:
        # 从缓存或API获取全量排名
        cache_key = f"ranking_{category}"
        funds = cache.get(cache_key, CACHE_TTL_RANKING)
        if funds is None:
            funds = get_fund_ranking(category)
            if not funds:
                funds = get_fund_ranking_em(category)
            cache.set(cache_key, funds)

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
    sort_field_map = {
        "近1月": "near_1m", "近3月": "near_3m", "近6月": "near_6m",
        "近1年": "near_1y", "近3年": "near_3y", "今年来": "ytd",
    }
    sort_field = sort_field_map.get(sort_by, "ytd")
    reverse = sort_order == "desc"
    funds.sort(key=lambda x: float(x.get(sort_field, 0) or 0), reverse=reverse)

    # 分页
    total = len(funds)
    start = (page - 1) * page_size
    end = start + page_size
    page_funds = funds[start:end]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "funds": page_funds,
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
        # 自选为空时回退到国元名单
        return get_fund_list(category, tag, keyword, sort_by, sort_order, page, page_size, guoyuan_only=True)

    # 为自选基金获取业绩数据
    funds = _get_watchlist_with_performance(watchlist)

    # 按标签筛选
    if tag:
        funds = [f for f in funds if tag in f.get("tags", []) or tag in f.get("name", "")]

    # 按关键词筛选
    if keyword:
        funds = [f for f in funds if keyword in f.get("name", "") or keyword in f.get("code", "")]

    # 按类型筛选
    if category != "全部":
        funds = [f for f in funds if f.get("type", "") == category]

    # 排序
    sort_field_map = {
        "近1月": "near_1m", "近3月": "near_3m", "近6月": "near_6m",
        "近1年": "near_1y", "近3年": "near_3y", "今年来": "ytd",
    }
    sort_field = sort_field_map.get(sort_by, "ytd")
    reverse = sort_order == "desc"
    funds.sort(key=lambda x: float(x.get(sort_field, 0) or 0), reverse=reverse)

    # 分页
    total = len(funds)
    start = (page - 1) * page_size
    end = start + page_size
    page_funds = funds[start:end]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "funds": page_funds,
        "categories": FUND_CATEGORIES,
        "types": FUND_TYPES,
    }


def _get_watchlist_with_performance(watchlist: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """为自选基金获取业绩数据（批量模式）"""
    all_perf = _fetch_all_fund_performance()
    result = []
    for fund in watchlist:
        fund_data = dict(fund)
        perf = all_perf.get(fund["code"])
        if perf:
            fund_data.update(perf)
        result.append(fund_data)
    return result


def _get_guoyuan_funds_with_performance() -> List[Dict[str, Any]]:
    """获取国元证券基金名单及业绩数据（批量模式）"""
    cache_key = "guoyuan_funds_performance"
    result = cache.get(cache_key, CACHE_TTL_RANKING)
    if result is not None:
        return result

    # 一次akshare调用获取全市场业绩，然后按需匹配
    all_perf = _fetch_all_fund_performance()

    result = []
    for fund in GUOYUAN_FUND_LIST:
        fund_data = dict(fund)
        perf = all_perf.get(fund["code"])
        if perf:
            fund_data.update(perf)
        result.append(fund_data)

    cache.set(cache_key, result)
    return result


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
                    "nav": float(row.get("单位净值", 0) or 0),
                    "day_growth": float(row.get("日增长率", 0) or 0),
                    "near_1m": float(row.get("近1月", 0) or 0),
                    "near_3m": float(row.get("近3月", 0) or 0),
                    "near_6m": float(row.get("近6月", 0) or 0),
                    "near_1y": float(row.get("近1年", 0) or 0),
                    "near_3y": float(row.get("近3年", 0) or 0),
                    "ytd": float(row.get("今年来", 0) or 0),
                }
        cache.set(cache_key, perf_map)
    except Exception as e:
        console_error(f"Bulk performance fetch error: {e}")
    return perf_map
