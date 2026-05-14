"""定投回测服务"""
from typing import Dict, Any, List
from ..data.efinance_fetcher import calculate_dca_backtest, get_fund_names
from ..data.cache_manager import cache
from ..config import CACHE_TTL_NAV


def run_dca_backtest(
    codes: List[str],
    amount: float = 1000,
    frequency: str = "monthly",
    strategy: str = "compare",
    start_date: str = "",
    end_date: str = "",
) -> Dict[str, Any]:
    """执行定投回测"""
    if not codes:
        return {"error": "请至少选择一只基金"}

    # 默认回测5年
    if not start_date:
        from datetime import datetime, timedelta
        start_date = (datetime.now() - timedelta(days=365 * 5)).strftime("%Y-%m-%d")
    if not end_date:
        from datetime import datetime
        end_date = datetime.now().strftime("%Y-%m-%d")

    results = []
    for code in codes:
        cache_key = f"dca_{code}_{strategy}_{frequency}_{start_date}_{end_date}"
        result = cache.get(cache_key, CACHE_TTL_NAV)
        if result is None:
            result = calculate_dca_backtest(
                code, amount, frequency, strategy, start_date, end_date
            )
            if "error" not in result:
                cache.set(cache_key, result)
        result["fund_code"] = code
        results.append(result)

    # 组合回测
    if len(codes) > 1:
        combined = _calc_combined_backtest(results, len(codes))
        return {"individual": results, "combined": combined}

    return {"individual": results}


def _calc_combined_backtest(results: List[Dict], fund_count: int) -> Dict[str, Any]:
    """计算组合回测结果"""
    valid = [r for r in results if "error" not in r and "strategies" not in r]
    if not valid:
        return {"error": "无有效回测结果"}

    # 简单平均
    avg_profit_rate = sum(r.get("total_profit_rate", 0) for r in valid) / len(valid)
    avg_annual = sum(r.get("annual_return", 0) for r in valid) / len(valid)
    avg_drawdown = sum(r.get("max_drawdown", 0) for r in valid) / len(valid)
    avg_invested = sum(r.get("total_invested", 0) for r in valid) / len(valid)
    avg_value = sum(r.get("total_value", 0) for r in valid) / len(valid)

    return {
        "strategy": "组合定投",
        "fund_count": fund_count,
        "total_invested": round(avg_invested, 2),
        "total_value": round(avg_value, 2),
        "total_profit_rate": round(avg_profit_rate, 2),
        "annual_return": round(avg_annual, 2),
        "max_drawdown": round(avg_drawdown, 2),
    }


def get_dca_suggestion(code: str) -> Dict[str, Any]:
    """获取定投建议"""
    # 获取近期净值判断当前时点
    from ..data.efinance_fetcher import get_fund_nav_history
    nav_data = get_fund_nav_history(code)
    if not nav_data or len(nav_data) < 60:
        return {"score": 50, "suggestion": "数据不足，建议观察"}

    navs = [p.get("nav", 0) for p in nav_data if p.get("nav", 0) > 0]
    if not navs:
        return {"score": 50, "suggestion": "数据异常"}

    current = navs[-1]
    ma60 = sum(navs[-60:]) / 60
    ma20 = sum(navs[-20:]) / 20

    # 位置评分
    position = (current - min(navs[-60:])) / (max(navs[-60:]) - min(navs[-60:])) * 100

    score = 50
    suggestion = ""

    if current < ma60 * 0.9:
        score = 85
        suggestion = "当前净值显著低于60日均线，处于低位，适合加大定投"
    elif current < ma20:
        score = 70
        suggestion = "当前净值低于20日均线，可适当增加定投金额"
    elif current > ma60 * 1.1:
        score = 30
        suggestion = "当前净值显著高于60日均线，建议减少定投金额"
    elif current > ma20:
        score = 45
        suggestion = "当前净值高于20日均线，可维持正常定投"
    else:
        score = 55
        suggestion = "当前净值处于均线附近，建议正常定投"

    return {
        "score": score,
        "suggestion": suggestion,
        "current_nav": current,
        "ma20": round(ma20, 4),
        "ma60": round(ma60, 4),
        "position": round(position, 1),
    }
