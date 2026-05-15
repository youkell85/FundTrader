"""专业分析服务 - 夏普比率、最大回撤、波动率等"""
from typing import Dict, Any, Optional, List
import numpy as np
from ..data.akshare_fetcher import get_fund_portfolio
from ..data.cache_manager import cache
from ..config import CACHE_TTL_NAV


def _get_nav_history_pro(code: str) -> List[Dict[str, Any]]:
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
            if result:
                return result
    except Exception as e:
        from ..utils import console_error
        console_error(f"Fusion nav history fallback for {code}: {e}")
    from ..data.efinance_fetcher import get_fund_nav_history
    return get_fund_nav_history(code)


def _get_portfolio_fusion(code: str) -> Optional[Dict[str, Any]]:
    """优先使用融合层获取持仓，失败回退到AkShare"""
    try:
        from ..data.providers.fusion import get_fusion
        fusion = get_fusion()
        holdings = fusion.get_fund_holdings(code)
        if holdings:
            return {
                "stock_holdings": [
                    {"name": h.name, "code": h.code, "ratio": h.ratio}
                    for h in holdings
                ]
            }
    except Exception as e:
        from ..utils import console_error
        console_error(f"Fusion portfolio fallback for {code}: {e}")
    return get_fund_portfolio(code)


def professional_analysis(code: str) -> Dict[str, Any]:
    """专业分析"""
    # 获取净值数据（优先融合层）
    nav_data = _get_nav_history_pro(code)
    if not nav_data or len(nav_data) < 60:
        return {"code": code, "error": "净值数据不足，无法进行专业分析"}

    navs = [p.get("nav", 0) for p in nav_data if p.get("nav", 0) > 0]
    dates = [p.get("date", "") for p in nav_data if p.get("nav", 0) > 0]

    # 日收益率
    returns = np.diff(navs) / navs[:-1]

    # 风险指标
    sharpe = _calc_sharpe_ratio(returns)
    max_dd = _calc_max_drawdown(navs)
    volatility = _calc_volatility(returns)
    calmar = _calc_calmar_ratio(returns, navs)
    sortino = _calc_sortino_ratio(returns)

    # 资产配置（优先融合层）
    portfolio = _get_portfolio_fusion(code)
    asset_allocation = _analyze_asset_allocation(portfolio)
    industry_distribution = _analyze_industry_distribution(portfolio)

    # 风格箱
    style_box = _analyze_style_box(returns, navs)

    return {
        "code": code,
        "name": "",
        "sharpe_ratio": round(sharpe, 3),
        "max_drawdown": round(max_dd, 2),
        "volatility": round(volatility, 2),
        "calmar_ratio": round(calmar, 3),
        "sortino_ratio": round(sortino, 3),
        "asset_allocation": asset_allocation,
        "industry_distribution": industry_distribution,
        "style_box": style_box,
        "nav_summary": {
            "latest": round(navs[-1], 4),
            "period_return": round((navs[-1] - navs[0]) / navs[0] * 100, 2),
            "data_points": len(navs),
            "start_date": dates[0] if dates else "",
            "end_date": dates[-1] if dates else "",
        },
    }


def _calc_sharpe_ratio(returns: np.ndarray, risk_free: float = 0.02 / 252) -> float:
    """夏普比率"""
    if len(returns) < 2 or np.std(returns) == 0:
        return 0
    return (np.mean(returns) - risk_free) / np.std(returns) * np.sqrt(252)


def _calc_max_drawdown(navs: List[float]) -> float:
    """最大回撤"""
    peak = navs[0]
    max_dd = 0
    for nav in navs:
        if nav > peak:
            peak = nav
        dd = (peak - nav) / peak * 100
        if dd > max_dd:
            max_dd = dd
    return max_dd


def _calc_volatility(returns: np.ndarray) -> float:
    """年化波动率"""
    if len(returns) < 2:
        return 0
    return np.std(returns) * np.sqrt(252) * 100


def _calc_calmar_ratio(returns: np.ndarray, navs: List[float]) -> float:
    """Calmar比率"""
    max_dd = _calc_max_drawdown(navs)
    if max_dd == 0:
        return 0
    annual_return = (1 + np.mean(returns)) ** 252 - 1
    return annual_return / (max_dd / 100)


def _calc_sortino_ratio(returns: np.ndarray, risk_free: float = 0.02 / 252) -> float:
    """Sortino比率"""
    if len(returns) < 2:
        return 0
    downside = returns[returns < risk_free] - risk_free
    if len(downside) == 0:
        return 0
    downside_std = np.sqrt(np.mean(downside ** 2))
    if downside_std == 0:
        return 0
    return (np.mean(returns) - risk_free) / downside_std * np.sqrt(252)


def _analyze_asset_allocation(portfolio: Optional[Dict]) -> Dict[str, Any]:
    """资产配置分析"""
    if not portfolio:
        return {"stocks": 0, "bonds": 0, "cash": 0, "other": 0}
    holdings = portfolio.get("stock_holdings", [])
    stock_ratio = sum(h.get("ratio", 0) for h in holdings)
    return {
        "stocks": round(stock_ratio, 2),
        "bonds": round(max(0, 80 - stock_ratio), 2),
        "cash": round(max(0, 20 - stock_ratio * 0.1), 2),
        "other": 0,
    }


def _analyze_industry_distribution(portfolio: Optional[Dict]) -> Dict[str, Any]:
    """行业分布分析"""
    if not portfolio:
        return {}
    return {"待完善": 100}


def _analyze_style_box(returns: np.ndarray, navs: List[float]) -> Dict[str, Any]:
    """风格九宫格分析"""
    if len(returns) < 60:
        return {"size": "中盘", "style": "均衡", "box": [1, 1]}

    # 简化判断
    vol = np.std(returns) * np.sqrt(252) * 100
    total_return = (navs[-1] - navs[0]) / navs[0] * 100

    # 规模判断
    if vol > 25:
        size = "小盘"
        size_idx = 2
    elif vol > 15:
        size = "中盘"
        size_idx = 1
    else:
        size = "大盘"
        size_idx = 0

    # 风格判断
    if total_return > 30:
        style = "成长"
        style_idx = 2
    elif total_return > 10:
        style = "均衡"
        style_idx = 1
    else:
        style = "价值"
        style_idx = 0

    return {"size": size, "style": style, "box": [size_idx, style_idx]}


def calc_correlation_matrix(codes: List[str]) -> Dict[str, Any]:
    """计算基金间相关性矩阵"""
    nav_dict = {}
    for code in codes:
        nav_data = _get_nav_history_pro(code)
        if nav_data and len(nav_data) > 60:
            navs = [p.get("nav", 0) for p in nav_data if p.get("nav", 0) > 0]
            returns = np.diff(navs) / navs[:-1]
            nav_dict[code] = returns

    if len(nav_dict) < 2:
        return {"error": "需要至少2只基金的数据"}

    # 对齐长度
    min_len = min(len(v) for v in nav_dict.values())
    aligned = {k: v[:min_len] for k, v in nav_dict.items()}

    # 计算相关系数
    codes_list = list(aligned.keys())
    n = len(codes_list)
    matrix = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            matrix[i][j] = np.corrcoef(aligned[codes_list[i]], aligned[codes_list[j]])[0, 1]

    return {
        "codes": codes_list,
        "matrix": matrix.tolist(),
    }
