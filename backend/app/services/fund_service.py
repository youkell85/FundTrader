"""基金排名筛选服务"""
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


def _get_guoyuan_funds_with_performance() -> List[Dict[str, Any]]:
    """获取国元证券基金名单及业绩数据"""
    cache_key = "guoyuan_funds_performance"
    result = cache.get(cache_key, CACHE_TTL_RANKING)
    if result is not None:
        return result

    result = []
    for fund in GUOYUAN_FUND_LIST:
        fund_data = dict(fund)
        # 尝试从缓存获取业绩
        perf_cache_key = f"fund_perf_{fund['code']}"
        perf = cache.get(perf_cache_key, CACHE_TTL_RANKING)
        if perf is None:
            perf = _fetch_fund_performance(fund["code"])
            if perf:
                cache.set(perf_cache_key, perf)
        if perf:
            fund_data.update(perf)
        result.append(fund_data)

    cache.set(cache_key, result)
    return result


def _fetch_fund_performance(code: str) -> Optional[Dict[str, Any]]:
    """获取单只基金业绩数据"""
    try:
        import akshare as ak
        df = ak.fund_open_fund_rank_em(symbol="全部")
        if df is not None and not df.empty:
            row = df[df["基金代码"] == code]
            if not row.empty:
                r = row.iloc[0]
                return {
                    "nav": float(r.get("单位净值", 0) or 0),
                    "day_growth": float(r.get("日增长率", 0) or 0),
                    "near_1m": float(r.get("近1月", 0) or 0),
                    "near_3m": float(r.get("近3月", 0) or 0),
                    "near_6m": float(r.get("近6月", 0) or 0),
                    "near_1y": float(r.get("近1年", 0) or 0),
                    "near_3y": float(r.get("近3年", 0) or 0),
                    "ytd": float(r.get("今年来", 0) or 0),
                }
    except Exception as e:
        console_error(f"Performance fetch error for {code}: {e}")
    return None
