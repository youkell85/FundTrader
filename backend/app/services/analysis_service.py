"""深度产品分析服务"""
from typing import Dict, Any, Optional, List
from ..data.akshare_fetcher import get_fund_info, get_fund_manager_info, get_fund_portfolio
from ..data.efinance_fetcher import get_fund_nav_history
from ..data.cache_manager import cache
from ..config import CACHE_TTL_NAV, CACHE_TTL_INFO


def analyze_fund(code: str) -> Dict[str, Any]:
    """深度分析单只基金"""
    # 基本信息
    cache_key = f"fund_info_{code}"
    info = cache.get(cache_key, CACHE_TTL_INFO)
    if info is None:
        info = get_fund_info(code)
        if info:
            cache.set(cache_key, info)

    # 净值历史
    nav_cache_key = f"fund_nav_{code}"
    nav_data = cache.get(nav_cache_key, CACHE_TTL_NAV)
    if nav_data is None:
        nav_data = get_fund_nav_history(code)
        if nav_data:
            cache.set(nav_cache_key, nav_data)

    # 基金经理
    manager = get_fund_manager_info(code)

    # 持仓
    portfolio = get_fund_portfolio(code)

    # 计算策略信号
    score, signal, confidence, reasons = _calc_strategy_signal(
        info, nav_data, manager, portfolio
    )

    # 雷达图评分
    radar = _calc_radar_scores(info, nav_data, portfolio)

    return {
        "code": code,
        "name": info.get("基金简称", code) if info else code,
        "signal": signal,
        "confidence": confidence,
        "score": score,
        "reasons": reasons,
        "manager": manager,
        "holdings": portfolio.get("stock_holdings", []) if portfolio else [],
        "nav_data": nav_data[-120:] if nav_data else [],
        "radar_scores": radar,
        "style_analysis": None,  # LLM分析需要单独调用
    }


def _calc_strategy_signal(
    info: Optional[Dict], nav_data: Optional[List], manager: Optional[Dict], portfolio: Optional[Dict]
) -> tuple:
    """计算策略信号"""
    score = 50  # 基准分
    reasons = []

    # 基金经理评分
    if manager:
        tenure = manager.get("tenure_days", 0) or 0
        if tenure > 365 * 5:
            score += 10
            reasons.append(f"基金经理任职超5年，经验丰富")
        elif tenure > 365 * 2:
            score += 5
            reasons.append(f"基金经理任职超2年")
        else:
            score -= 5
            reasons.append(f"基金经理任职不足2年，需关注")

    # 净值趋势评分
    if nav_data and len(nav_data) > 20:
        recent = nav_data[-20:]
        navs = [p.get("nav", 0) for p in recent if p.get("nav", 0) > 0]
        if navs:
            recent_return = (navs[-1] - navs[0]) / navs[0] * 100
            if recent_return > 10:
                score += 5
                reasons.append(f"近20日涨幅{recent_return:.1f}%，短期表现强势")
            elif recent_return < -10:
                score -= 5
                reasons.append(f"近20日跌幅{recent_return:.1f}%，短期承压")
            else:
                reasons.append(f"近20日涨跌{recent_return:+.1f}%，走势平稳")

    # 持仓集中度
    if portfolio:
        holdings = portfolio.get("stock_holdings", [])
        if holdings:
            top_ratio = sum(h.get("ratio", 0) for h in holdings[:3])
            if top_ratio > 40:
                score -= 5
                reasons.append(f"前3大持仓占比{top_ratio:.1f}%，集中度较高")
            else:
                reasons.append(f"前3大持仓占比{top_ratio:.1f}%，分散度良好")

    # 信号判断
    score = max(0, min(100, score))
    if score >= 70:
        signal = "买入"
        confidence = min(0.95, score / 100)
    elif score >= 40:
        signal = "持有"
        confidence = 1 - abs(score - 55) / 55
    else:
        signal = "赎回"
        confidence = min(0.95, (100 - score) / 100)

    return score, signal, confidence, reasons


def _calc_radar_scores(
    info: Optional[Dict], nav_data: Optional[List], portfolio: Optional[Dict]
) -> Dict[str, float]:
    """计算雷达图评分（0-100）"""
    scores = {
        "profitability": 50,
        "risk_control": 50,
        "stability": 50,
        "stock_picking": 50,
        "timing": 50,
    }

    if nav_data and len(nav_data) > 60:
        navs = [p.get("nav", 0) for p in nav_data if p.get("nav", 0) > 0]
        if len(navs) > 60:
            # 收益能力
            total_return = (navs[-1] - navs[0]) / navs[0] * 100
            scores["profitability"] = min(100, max(0, 50 + total_return))

            # 波动率（稳定性反向）
            import numpy as np
            returns = np.diff(navs) / navs[:-1]
            vol = np.std(returns) * np.sqrt(252) * 100
            scores["stability"] = min(100, max(0, 100 - vol * 10))
            scores["risk_control"] = min(100, max(0, 100 - vol * 8))

            # 夏普比率近似
            if vol > 0:
                sharpe = (total_return / max(1, len(navs) / 252)) / vol
                scores["stock_picking"] = min(100, max(0, 50 + sharpe * 20))

    return scores
