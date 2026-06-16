"""定投回测服务"""
from typing import Dict, Any, List
from ..data.efinance_fetcher import (
    _calc_fixed_dca,
    _calc_ma_dca,
    _calc_martingale_dca,
    _calc_ratio_dca,
    _calc_max_drawdown,
    _calc_curve_sharpe,
    _calc_xirr,
    get_fund_names,
)
from ..data.cache_manager import cache
from ..config import CACHE_TTL_NAV


def _get_nav_history(code: str, start_date: str = "", end_date: str = "") -> List[Dict[str, Any]]:
    """优先使用融合层获取净值历史，失败回退到efinance"""
    try:
        from ..data.providers.fusion import get_fusion
        fusion = get_fusion()
        nav_list = fusion.get_fund_nav(code)
        if nav_list:
            result = [
                {"date": n.date, "nav": n.nav, "acc_nav": n.accum_nav, "day_growth": n.day_growth}
                for n in nav_list if n.nav
            ]
            if start_date:
                result = [r for r in result if r["date"] >= start_date]
            if end_date:
                result = [r for r in result if r["date"] <= end_date]
            if result:
                return result
    except Exception as e:
        from ..utils import console_error
        console_error(f"Fusion nav history fallback for {code}: {e}")
    from ..data.efinance_fetcher import get_fund_nav_history
    return get_fund_nav_history(code, start_date, end_date)


def _calc_buy_and_hold_curve(nav_data: List[Dict], total_amount: float) -> Dict[str, Any]:
    """计算一次性买入并持有（buy-and-hold）基准曲线。
    完全在起始日一次性投入 total_amount，及后不再追加。返回逐点市值。"""
    if not nav_data:
        return {"curve": [], "final_value": 0, "profit_rate": 0}
    first_nav = next((p.get("nav") for p in nav_data if p.get("nav", 0) > 0), 0)
    if not first_nav or first_nav <= 0:
        return {"curve": [], "final_value": 0, "profit_rate": 0}
    shares = total_amount / first_nav
    curve = []
    cash_flows = []
    for p in nav_data:
        nav = p.get("nav", 0) or 0
        if nav <= 0:
            continue
        value = shares * nav
        curve.append({
            "date": p["date"],
            "value": round(value, 2),
            "profit_rate": round((value - total_amount) / total_amount * 100, 2),
        })
    final_value = curve[-1]["value"] if curve else 0
    if curve and total_amount > 0:
        cash_flows = [(curve[0]["date"], -total_amount), (curve[-1]["date"], final_value)]
    annual_return = _calc_xirr(cash_flows) * 100 if cash_flows else 0
    max_drawdown = _calc_max_drawdown(curve)
    sharpe_ratio = _calc_curve_sharpe(curve)
    result = {
        "curve": curve,
        "final_value": round(final_value, 2),
        "profit_rate": round((final_value - total_amount) / total_amount * 100, 2) if total_amount > 0 else 0,
        "total_return": round((final_value - total_amount) / total_amount * 100, 2) if total_amount > 0 else 0,
        "annual_return": round(annual_return, 2),
        "max_drawdown": round(max_drawdown, 2),
        "sharpe_ratio": round(sharpe_ratio, 2),
        "total_invested": total_amount,
    }
    _attach_curve_diagnostics(result, curve_key="curve")
    return result


def _curve_drawdown_duration(curve: List[Dict[str, Any]], *, value_key: str = "value") -> int:
    peak = 0.0
    peak_idx = 0
    max_duration = 0
    current_duration = 0
    for idx, point in enumerate(curve):
        value = float(point.get(value_key) or 0)
        if value >= peak:
            peak = value
            peak_idx = idx
            max_duration = max(max_duration, current_duration)
            current_duration = 0
        elif peak > 0:
            current_duration = idx - peak_idx
    return max(max_duration, current_duration)


def _monthly_extremes(curve: List[Dict[str, Any]], *, value_key: str = "value") -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if len(curve) < 2:
        return None, None
    monthly: dict[str, dict[str, float]] = {}
    for point in curve:
        date = str(point.get("date") or "")
        value = float(point.get(value_key) or 0)
        if not date or value <= 0:
            continue
        month = date[:7]
        bucket = monthly.setdefault(month, {"start": value, "end": value})
        bucket["end"] = value
    returns = {
        month: round((item["end"] / item["start"] - 1) * 100, 2)
        for month, item in monthly.items()
        if item["start"] > 0
    }
    if not returns:
        return None, None
    best_month, best_value = max(returns.items(), key=lambda item: item[1])
    worst_month, worst_value = min(returns.items(), key=lambda item: item[1])
    return (
        {"month": best_month, "return": best_value},
        {"month": worst_month, "return": worst_value},
    )


def _attach_curve_diagnostics(
    result: Dict[str, Any],
    *,
    benchmark: Dict[str, Any] | None = None,
    curve_key: str = "nav_curve",
) -> None:
    curve = result.get(curve_key)
    if not isinstance(curve, list):
        return
    best_month, worst_month = _monthly_extremes(curve)
    result["cagr"] = result.get("annual_return", 0)
    result["max_drawdown_duration_days"] = _curve_drawdown_duration(curve)
    result["best_month"] = best_month
    result["worst_month"] = worst_month
    if benchmark and isinstance(benchmark, dict):
        result["benchmark_return"] = benchmark.get("annual_return")
        if result.get("annual_return") is not None and benchmark.get("annual_return") is not None:
            result["benchmark_excess"] = round(float(result.get("annual_return") or 0) - float(benchmark.get("annual_return") or 0), 2)
        result["benchmark_status"] = "available" if benchmark.get("curve") else "missing"


def _calculate_dca_backtest(
    code: str,
    amount: float = 1000,
    frequency: str = "monthly",
    strategy: str = "compare",
    start_date: str = "",
    end_date: str = "",
    ma_window: int = 200,
) -> Dict[str, Any]:
    """基于融合层数据的定投回测计算"""
    nav_data = _get_nav_history(code, start_date, end_date)
    if not nav_data:
        return {"error": f"无法获取基金 {code} 的净值数据"}

    nav_data.sort(key=lambda x: x["date"])

    results = {}
    if strategy in ("fixed", "compare"):
        results["fixed"] = _calc_fixed_dca(nav_data, amount, frequency)
    if strategy in ("ratio", "compare"):
        results["ratio"] = _calc_ratio_dca(nav_data, amount, frequency)
    if strategy in ("ma", "compare"):
        results["ma"] = _calc_ma_dca(nav_data, amount, frequency, ma_window)
    if strategy in ("martingale", "compare"):
        results["martingale"] = _calc_martingale_dca(nav_data, amount, frequency)

    # 每个策略使用自身累计投入生成一次性买入基准，保证资金量可比。
    for strategy_result in results.values():
        total_invested = strategy_result.get("total_invested", 0)
        strategy_result["benchmark"] = _calc_buy_and_hold_curve(nav_data, total_invested)
        _attach_curve_diagnostics(strategy_result, benchmark=strategy_result["benchmark"])

    primary = results.get("fixed") or results.get("ma") or next(iter(results.values()), {})
    benchmark = primary.get("benchmark", _calc_buy_and_hold_curve(nav_data, amount * 12))

    if strategy == "compare":
        return {
            "fund_code": code,
            "strategies": results,
            "benchmark": benchmark,
        }

    out = results.get(strategy, {})
    out["benchmark"] = benchmark
    return out


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
        amount_key = f"{float(amount):.6f}"
        cache_key = f"dca_{code}_{strategy}_{frequency}_{amount_key}_{start_date}_{end_date}"
        result = cache.get(cache_key, CACHE_TTL_NAV)
        if result is None:
            result = _calculate_dca_backtest(
                code, amount, frequency, strategy, start_date, end_date
            )
            if "error" not in result:
                cache.set(cache_key, result)
        result["fund_code"] = code
        results.append(result)

    # 组合回测
    if len(codes) > 1:
        combined = _calc_combined_backtest(results, len(codes), strategy)
        return {"individual": results, "combined": combined}

    return {"individual": results}


def _merge_curves(curves: List[List[Dict]]) -> List[Dict[str, Any]]:
    dates = sorted({str(point.get("date", "")) for curve in curves for point in curve if point.get("date")})
    cursors = [0 for _ in curves]
    last_points = [None for _ in curves]
    merged = []

    for date in dates:
        invested = 0.0
        value = 0.0
        for index, curve in enumerate(curves):
            while cursors[index] < len(curve) and str(curve[cursors[index]].get("date", "")) <= date:
                last_points[index] = curve[cursors[index]]
                cursors[index] += 1
            point = last_points[index]
            if not point:
                continue
            invested += float(point.get("invested") or 0)
            value += float(point.get("value") or 0)
        if invested > 0 or value > 0:
            merged.append({
                "date": date,
                "invested": round(invested, 2),
                "value": round(value, 2),
                "profit_rate": round((value - invested) / invested * 100, 2) if invested > 0 else 0,
            })
    return merged


def _merge_benchmarks(results: List[Dict]) -> Dict[str, Any]:
    benchmark_curves = [
        r.get("benchmark", {}).get("curve", [])
        for r in results
        if isinstance(r.get("benchmark", {}).get("curve"), list)
    ]
    dates = sorted({str(point.get("date", "")) for curve in benchmark_curves for point in curve if point.get("date")})
    cursors = [0 for _ in benchmark_curves]
    last_points = [None for _ in benchmark_curves]
    curve = []

    for date in dates:
        value = 0.0
        for index, fund_curve in enumerate(benchmark_curves):
            while cursors[index] < len(fund_curve) and str(fund_curve[cursors[index]].get("date", "")) <= date:
                last_points[index] = fund_curve[cursors[index]]
                cursors[index] += 1
            point = last_points[index]
            if point:
                value += float(point.get("value") or 0)
        if value > 0:
            curve.append({"date": date, "value": round(value, 2)})

    total_invested = sum(float(r.get("benchmark", {}).get("total_invested") or 0) for r in results)
    final_value = curve[-1]["value"] if curve else 0
    cash_flows = []
    if curve and total_invested > 0:
        cash_flows = [(curve[0]["date"], -total_invested), (curve[-1]["date"], final_value)]

    result = {
        "curve": curve,
        "final_value": round(final_value, 2),
        "profit_rate": round((final_value - total_invested) / total_invested * 100, 2) if total_invested > 0 else 0,
        "total_return": round((final_value - total_invested) / total_invested * 100, 2) if total_invested > 0 else 0,
        "annual_return": round(_calc_xirr(cash_flows) * 100, 2) if cash_flows else 0,
        "max_drawdown": round(_calc_max_drawdown(curve), 2),
        "sharpe_ratio": round(_calc_curve_sharpe(curve), 2),
        "total_invested": round(total_invested, 2),
    }
    _attach_curve_diagnostics(result, curve_key="curve")
    return result


def _combine_strategy_results(results: List[Dict], fund_count: int, strategy_name: str) -> Dict[str, Any]:
    curves = [r.get("nav_curve", []) for r in results if isinstance(r.get("nav_curve"), list)]
    curve = _merge_curves(curves)
    if not curve:
        return {"error": "无有效回测结果"}

    total_invested = curve[-1]["invested"]
    total_value = curve[-1]["value"]
    total_profit = total_value - total_invested
    cash_flows = []
    previous_invested = 0.0
    for point in curve:
        added = point["invested"] - previous_invested
        if added > 0:
            cash_flows.append((point["date"], -added))
        previous_invested = point["invested"]
    if total_value > 0:
        cash_flows.append((curve[-1]["date"], total_value))

    benchmark = _merge_benchmarks(results)
    result = {
        "strategy": strategy_name,
        "fund_count": fund_count,
        "start_date": curve[0]["date"],
        "end_date": curve[-1]["date"],
        "total_invested": round(total_invested, 2),
        "total_value": round(total_value, 2),
        "total_profit": round(total_profit, 2),
        "total_profit_rate": round(total_profit / total_invested * 100, 2) if total_invested > 0 else 0,
        "annual_return": round(_calc_xirr(cash_flows) * 100, 2) if cash_flows else 0,
        "max_drawdown": round(_calc_max_drawdown(curve), 2),
        "sharpe_ratio": round(_calc_curve_sharpe(curve), 2),
        "trade_count": sum(int(r.get("trade_count") or 0) for r in results),
        "nav_curve": curve,
        "benchmark": benchmark,
    }
    _attach_curve_diagnostics(result, benchmark=benchmark)
    return result


def _calc_combined_backtest(results: List[Dict], fund_count: int, strategy: str = "compare") -> Dict[str, Any]:
    """计算组合回测结果"""
    valid_results = [r for r in results if isinstance(r, dict) and "error" not in r]
    if strategy == "compare":
        keys = [key for key in ("fixed", "ratio", "ma", "martingale") if any(key in r.get("strategies", {}) for r in valid_results)]
        combined_strategies = {}
        for key in keys:
            strategy_results = [
                r.get("strategies", {}).get(key)
                for r in valid_results
                if isinstance(r.get("strategies", {}).get(key), dict)
            ]
            combined = _combine_strategy_results(strategy_results, fund_count, f"组合{key}定投")
            if "error" not in combined:
                combined_strategies[key] = combined
        if not combined_strategies:
            return {"error": "无有效回测结果"}
        primary = combined_strategies.get("fixed") or next(iter(combined_strategies.values()))
        return {
            **{k: v for k, v in primary.items() if k not in {"nav_curve"}},
            "strategy": "组合定投",
            "strategies": combined_strategies,
        }

    valid = valid_results
    if not valid:
        return {"error": "无有效回测结果"}
    return _combine_strategy_results(valid, fund_count, "组合定投")


def get_dca_suggestion(code: str) -> Dict[str, Any]:
    """获取定投建议"""
    # 获取近期净值判断当前时点
    nav_data = _get_nav_history(code)
    if not nav_data or len(nav_data) < 60:
        return {"score": 50, "suggestion": "数据不足，建议观察"}

    navs = [p.get("nav", 0) for p in nav_data if p.get("nav", 0) > 0]
    if not navs:
        return {"score": 50, "suggestion": "数据异常"}

    current = navs[-1]
    ma60 = sum(navs[-60:]) / 60
    ma20 = sum(navs[-20:]) / 20

    # 位置评分
    low_60 = min(navs[-60:])
    high_60 = max(navs[-60:])
    position = (current - low_60) / (high_60 - low_60) * 100 if high_60 > low_60 else 50

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
