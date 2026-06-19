"""智能推荐服务"""
import re
from typing import Dict, Any, List
from ..data.akshare_fetcher import get_market_index, get_fund_industry_board
from ..data.cache_manager import cache
from ..config import CACHE_TTL_RANKING
from ..storage.database import FundDataStore
from ..utils import console_error


SNAPSHOT_SOURCE = "fund_snapshot"


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

    expected_return = _estimate_return(allocation)
    expected_risk = _estimate_risk(allocation)
    missing_reasons = _recommendation_missing_reasons(allocation)
    data_status = "real"
    if not allocation:
        data_status = "missing"
        missing_reasons.insert(0, "基金快照为空或无可用真实指标，未生成静态推荐。")
    elif missing_reasons:
        data_status = "partial"
    if data_status != "real":
        expected_return = None
        expected_risk = None

    return {
        "risk_level": risk_level,
        "investment_horizon": investment_horizon,
        "total_amount": amount,
        "funds": allocation,
        "expected_return": expected_return,
        "expected_risk": expected_risk,
        "data_status": data_status,
        "source": SNAPSHOT_SOURCE,
        "missing_reason": "；".join(missing_reasons) if missing_reasons else None,
        "metric_basis": "weighted_snapshot_metrics",
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

    allocation = []
    used_codes = set()
    used_families = set()

    type_to_fund_type = {
        "债券": ["债券型"], "货币": ["货币"], "混合": ["混合型", "股票型"],
        "股票": ["股票型", "混合型"], "指数": ["指数型", "ETF"], "QDII": ["QDII"],
    }

    all_funds = _load_snapshot_candidates()
    if not all_funds:
        return []

    for asset_type, ratio in template.items():
        fund_types = type_to_fund_type.get(asset_type, [])
        candidates = [
            f for f in all_funds
            if _matches_asset_type(f, fund_types)
            and f["code"] not in used_codes
            and _fund_family_key(f) not in used_families
        ]

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
                "tags": fund.get("tags", []),
                "ratio": ratio,
                "amount": round(amount * ratio, 2),
                "source": SNAPSHOT_SOURCE,
                "as_of": fund.get("nav_date") or fund.get("updated_at"),
                "return_1y": fund.get("near_1y"),
                "annualized_return": fund.get("annualized_return"),
                "max_drawdown": fund.get("max_drawdown"),
                "volatility": fund.get("volatility"),
                "metric_status": _fund_metric_status(fund),
            })

    return allocation


def _load_snapshot_candidates(limit: int = 5000) -> List[Dict[str, Any]]:
    try:
        result = FundDataStore.list_snapshots(
            xinjihui_only=True,
            limit=limit,
            offset=0,
            sort_field="near_1y",
            sort_order="desc",
        )
    except Exception as e:
        console_error(f"Recommendation snapshot fetch failed: {e}")
        return []

    funds = result.get("funds") or []
    return [
        fund for fund in funds
        if isinstance(fund, dict)
        and fund.get("code")
        and fund.get("name")
        and _to_float(fund.get("nav")) is not None
    ]


def _matches_asset_type(fund: Dict[str, Any], accepted_types: List[str]) -> bool:
    fund_type = str(fund.get("type") or "")
    tags = " ".join(str(tag) for tag in fund.get("tags") or [])
    return any(kind and (kind in fund_type or kind in tags) for kind in accepted_types)


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


def _estimate_return(allocation: List[Dict]) -> float | None:
    """Compute expected return from available snapshot metrics only."""
    values = []
    for item in allocation:
        value = _first_number(item.get("annualized_return"), item.get("return_1y"))
        if value is not None:
            values.append((value, float(item.get("ratio") or 0)))
    if len(values) < len(allocation):
        return None
    return _weighted_average(values)


def _estimate_risk(allocation: List[Dict]) -> float | None:
    """Compute risk from available snapshot volatility or drawdown metrics."""
    values = []
    for item in allocation:
        value = _first_number(item.get("volatility"), item.get("max_drawdown"))
        if value is not None:
            values.append((abs(value), float(item.get("ratio") or 0)))
    if len(values) < len(allocation):
        return None
    return _weighted_average(values)


def _first_number(*values: Any) -> float | None:
    for value in values:
        number = _to_float(value)
        if number is not None:
            return number
    return None


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace("%", ""))
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def _weighted_average(values: List[tuple[float, float]]) -> float | None:
    total_weight = sum(weight for _, weight in values if weight > 0)
    if total_weight <= 0:
        return None
    return round(sum(value * weight for value, weight in values) / total_weight, 2)


def _fund_metric_status(fund: Dict[str, Any]) -> str:
    has_return = _first_number(fund.get("annualized_return"), fund.get("near_1y")) is not None
    has_risk = _first_number(fund.get("volatility"), fund.get("max_drawdown")) is not None
    if has_return and has_risk:
        return "real"
    if has_return or has_risk:
        return "partial"
    return "missing"


def _recommendation_missing_reasons(allocation: List[Dict[str, Any]]) -> List[str]:
    if not allocation:
        return []
    missing = [item["code"] for item in allocation if item.get("metric_status") != "real"]
    if not missing:
        return []
    return [f"{len(missing)}/{len(allocation)} 只推荐基金缺少完整收益或风险快照指标: {', '.join(missing)}"]


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
