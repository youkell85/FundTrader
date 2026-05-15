"""智能推荐服务"""
from typing import Dict, Any, List
from ..data.akshare_fetcher import get_market_index, get_fund_industry_board
from ..data.cache_manager import cache
from ..constants.guoyuan_funds import GUOYUAN_FUND_LIST
from ..config import CACHE_TTL_RANKING


def generate_recommendation(
    risk_level: str = "稳健",
    investment_horizon: str = "中期",
    amount: float = 100000,
    preferences: List[str] = [],
) -> Dict[str, Any]:
    """生成智能推荐方案"""
    # 获取市场行情
    market = cache.get("market_index", 1800)
    if market is None:
        market = get_market_index()
        cache.set("market_index", market)

    # 获取行业热度
    industries = cache.get("industry_board", 1800)
    if industries is None:
        industries = get_fund_industry_board()
        cache.set("industry_board", industries)

    # 根据风险偏好配置方案
    allocation = _get_risk_allocation(risk_level, amount, preferences)

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
        "market_overview": market,
        "analysis_summary": _generate_summary(risk_level, allocation, market),
    }


def _get_risk_allocation(
    risk_level: str, amount: float, preferences: List[str]
) -> List[Dict[str, Any]]:
    """根据风险偏好生成配置方案"""
    # 风险配置模板
    templates = {
        "保守": {"债券": 0.6, "货币": 0.2, "混合": 0.15, "股票": 0.05},
        "稳健": {"债券": 0.3, "混合": 0.4, "股票": 0.2, "指数": 0.1},
        "积极": {"混合": 0.3, "股票": 0.35, "指数": 0.25, "QDII": 0.1},
        "激进": {"股票": 0.4, "指数": 0.3, "QDII": 0.2, "混合": 0.1},
    }

    template = templates.get(risk_level, templates["稳健"])

    # 从国元名单中按类型匹配
    allocation = []
    used_codes = set()

    type_to_fund_type = {
        "债券": "债券型", "货币": "货币", "混合": "混合型",
        "股票": "股票型", "指数": "指数型", "QDII": "QDII",
    }

    for asset_type, ratio in template.items():
        fund_type = type_to_fund_type.get(asset_type, "")
        candidates = [f for f in GUOYUAN_FUND_LIST
                      if f["type"] == fund_type and f["code"] not in used_codes]

        # 如果有偏好，优先匹配
        if preferences:
            pref_candidates = [f for f in candidates
                              if any(p in f.get("tags", []) for p in preferences)]
            if pref_candidates:
                candidates = pref_candidates

        if candidates:
            fund = candidates[0]
            used_codes.add(fund["code"])
            allocation.append({
                "code": fund["code"],
                "name": fund["name"],
                "type": fund["type"],
                "tags": fund["tags"],
                "ratio": ratio,
                "amount": round(amount * ratio, 2),
            })

    return allocation


def _estimate_return(allocation: List[Dict], risk_level: str) -> float:
    """估算预期年化收益"""
    return_map = {"保守": 4.0, "稳健": 8.0, "积极": 12.0, "激进": 18.0}
    return return_map.get(risk_level, 8.0)


def _estimate_risk(allocation: List[Dict], risk_level: str) -> float:
    """估算预期风险（波动率）"""
    risk_map = {"保守": 3.0, "稳健": 8.0, "积极": 15.0, "激进": 25.0}
    return risk_map.get(risk_level, 8.0)


def _generate_summary(
    risk_level: str, allocation: List[Dict], market: List[Dict]
) -> str:
    """生成推荐摘要"""
    fund_names = "、".join([f["name"] for f in allocation[:3]])
    market_status = "震荡" if not market else (
        "偏强" if sum(1 for m in market if m.get("change", 0) > 0) > len(market) / 2 else "偏弱"
    )
    return f"基于{risk_level}风险偏好，当前市场{market_status}，建议配置{fund_names}等基金，通过分散投资降低风险，追求稳健收益。"
