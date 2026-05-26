"""智能推荐服务"""
import re
from typing import Dict, Any, List
from ..data.akshare_fetcher import get_market_index, get_fund_industry_board
from ..data.cache_manager import cache
from ..constants.guoyuan_funds import GUOYUAN_FUND_LIST
from ..constants.xinjihui_pool import XINJIHUI_POOL
from ..config import CACHE_TTL_RANKING
from ..utils import console_error


def generate_recommendation(
    risk_level: str = "稳健",
    investment_horizon: str = "中期",
    amount: float = 100000,
    preferences: List[str] = None,
) -> Dict[str, Any]:
    """生成智能推荐方案"""
    preferences = preferences or []
    # 获取市场行情（带异常保护）
    market = None
    try:
        market = cache.get("market_index", 1800)
        if market is None:
            market = get_market_index()
            if market is not None:
                cache.set("market_index", market)
    except Exception as e:
        console_error(f"Market index fetch error: {e}")
        market = []

    # 获取行业热度（带异常保护）
    industries = None
    try:
        industries = cache.get("industry_board", 1800)
        if industries is None:
            industries = get_fund_industry_board()
            if industries is not None:
                cache.set("industry_board", industries)
    except Exception as e:
        console_error(f"Industry board fetch error: {e}")
        industries = []

    # 根据风险偏好配置方案
    allocation = _get_risk_allocation(risk_level, amount, preferences, investment_horizon)

    # 计算预期收益和风险
    expected_return = _estimate_return(allocation, risk_level)
    expected_risk = _estimate_risk(allocation, risk_level)

    return {
        "risk_level": risk_level,
        "investment_horizon": investment_horizon,
        "total_amount": amount,
        "funds": allocation,
        "expected_return": expected_return,
        "expected_risk": expected_risk,
        "market_overview": market or [],
        "analysis_summary": _generate_summary(risk_level, allocation, market or []),
    }


def _get_risk_allocation(
    risk_level: str, amount: float, preferences: List[str], investment_horizon: str = "中期"
) -> List[Dict[str, Any]]:
    """根据风险偏好生成配置方案"""
    # 风险配置模板
    templates = {
        "保守": {"债券": 0.6, "货币": 0.2, "混合": 0.15, "股票": 0.05},
        "稳健": {"债券": 0.3, "混合": 0.4, "股票": 0.2, "指数": 0.1},
        "积极": {"混合": 0.3, "股票": 0.35, "指数": 0.25, "QDII": 0.1},
        "激进": {"股票": 0.4, "指数": 0.3, "QDII": 0.2, "混合": 0.1},
    }

    template = _adjust_template_by_horizon(templates.get(risk_level, templates["稳健"]), investment_horizon)

    # 优先从鑫基荟优选池中按类型匹配，回退到国元名单
    allocation = []
    used_codes = set()
    used_families = set()

    type_to_fund_type = {
        "债券": ["债券型"], "货币": ["货币"], "混合": ["混合型", "股票型"],
        "股票": ["股票型", "混合型"], "指数": ["指数型", "ETF"], "QDII": ["QDII"],
    }

    # 合并优选池和国元名单，优选池优先
    all_funds = XINJIHUI_POOL + [f for f in GUOYUAN_FUND_LIST if f["code"] not in {x["code"] for x in XINJIHUI_POOL}]

    for asset_type, ratio in template.items():
        fund_types = type_to_fund_type.get(asset_type, [])
        candidates = [f for f in all_funds
                      if f["type"] in fund_types and f["code"] not in used_codes and _fund_family_key(f) not in used_families]

        # 如果有偏好，优先匹配
        if preferences:
            pref_candidates = [f for f in candidates
                              if any(p in f.get("tags", []) for p in preferences)]
            if pref_candidates:
                candidates = pref_candidates

        if candidates:
            fund = candidates[0]
            used_codes.add(fund["code"])
            used_families.add(_fund_family_key(fund))
            allocation.append({
                "code": fund["code"],
                "name": fund["name"],
                "type": fund["type"],
                "asset_type": asset_type,
                "tags": fund["tags"],
                "ratio": ratio,
                "amount": round(amount * ratio, 2),
            })

    return allocation


def _adjust_template_by_horizon(template: Dict[str, float], investment_horizon: str) -> Dict[str, float]:
    adjusted = dict(template)
    horizon = investment_horizon or ""
    if "短" in horizon or "6" in horizon:
        adjusted["债券"] = adjusted.get("债券", 0) + 0.08
        adjusted["货币"] = adjusted.get("货币", 0) + 0.05
        for key in ("股票", "指数", "QDII"):
            adjusted[key] = max(0, adjusted.get(key, 0) - 0.04)
    elif "长" in horizon or "3" in horizon or "5" in horizon or "10" in horizon:
        adjusted["股票"] = adjusted.get("股票", 0) + 0.05
        adjusted["指数"] = adjusted.get("指数", 0) + 0.05
        adjusted["货币"] = max(0, adjusted.get("货币", 0) - 0.05)
        adjusted["债券"] = max(0, adjusted.get("债券", 0) - 0.05)

    total = sum(adjusted.values()) or 1
    return {key: value / total for key, value in adjusted.items() if value > 0}


def _fund_family_key(fund: Dict[str, Any]) -> str:
    name = re.sub(r"\s+", "", str(fund.get("name", "")))
    if not name:
        return str(fund.get("code", ""))
    return re.sub(r"(?:A|B|C|D|E|I)$", "", name, flags=re.I)


def _estimate_return(allocation: List[Dict], risk_level: str) -> float:
    """估算预期年化收益"""
    if not allocation:
        return {"保守": 4.0, "稳健": 8.0, "积极": 12.0, "激进": 18.0}.get(risk_level, 8.0)
    return_map = {"货币": 2.0, "债券": 4.0, "混合": 7.5, "股票": 11.0, "指数": 9.0, "QDII": 8.5}
    return round(sum(return_map.get(item.get("asset_type"), 7.0) * item.get("ratio", 0) for item in allocation), 2)


def _estimate_risk(allocation: List[Dict], risk_level: str) -> float:
    """估算预期风险（波动率）"""
    if not allocation:
        return {"保守": 3.0, "稳健": 8.0, "积极": 15.0, "激进": 25.0}.get(risk_level, 8.0)
    risk_map = {"货币": 1.0, "债券": 4.0, "混合": 12.0, "股票": 22.0, "指数": 18.0, "QDII": 20.0}
    weighted = sum(risk_map.get(item.get("asset_type"), 10.0) * item.get("ratio", 0) for item in allocation)
    diversification = 0.85 if len(allocation) >= 3 else 1.0
    return round(weighted * diversification, 2)


def _generate_summary(
    risk_level: str, allocation: List[Dict], market: List[Dict]
) -> str:
    """生成推荐摘要"""
    fund_names = "、".join([f["name"] for f in allocation[:3]])
    if not market:
        market_status = "震荡"
    else:
        up_count = sum(1 for m in market if isinstance(m, dict) and m.get("change", 0) > 0)
        market_status = "偏强" if up_count > len(market) / 2 else "偏弱"
    return f"基于{risk_level}风险偏好，当前市场{market_status}，建议配置{fund_names}等基金，通过分散投资降低风险，追求稳健收益。"
