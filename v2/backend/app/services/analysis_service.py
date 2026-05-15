"""深度产品分析服务 - 多数据源融合版"""
from typing import Dict, Any, Optional, List
from ..data.akshare_fetcher import get_fund_info, get_fund_manager_info, get_fund_portfolio
from ..data.efinance_fetcher import get_fund_nav_history
from ..data.providers.fusion import get_fusion
from ..data.cache_manager import cache
from ..config import CACHE_TTL_NAV, CACHE_TTL_INFO


def analyze_fund(code: str) -> Dict[str, Any]:
    """深度分析单只基金 - 多数据源融合"""
    # 尝试使用多数据源融合层
    fusion = get_fusion()
    detail = fusion.get_fund_detail(code)

    if detail:
        # 多数据源成功获取数据
        nav_data = [
            {"date": n.date, "nav": n.nav, "accum_nav": n.accum_nav, "day_growth": n.day_growth}
            for n in (detail.nav_history or [])
        ]
        holdings = [
            {"name": h.name, "code": h.code, "ratio": h.ratio}
            for h in (detail.holdings or [])
        ]
        manager = detail.manager_info or {}
        if not manager and detail.basic and detail.basic.manager:
            manager = {"name": detail.basic.manager, "tenure_days": 0}

        # 计算任职天数
        if manager and manager.get("begin_date"):
            try:
                from datetime import datetime
                begin_str = str(manager["begin_date"]).replace("-", "").replace(".", "")
                if len(begin_str) == 8:
                    begin_dt = datetime.strptime(begin_str, "%Y%m%d")
                    tenure_days = (datetime.now() - begin_dt).days
                    manager = dict(manager)
                    manager["tenure_days"] = tenure_days
            except Exception:
                pass
        if manager and "tenure_days" not in manager:
            manager = dict(manager) if manager else {}
            manager["tenure_days"] = 0

        # 计算策略信号
        score, signal, confidence, reasons = _calc_strategy_signal_fusion(detail)

        # 雷达图评分
        radar = _calc_radar_scores_fusion(detail)

        return {
            "code": code,
            "name": detail.name or code,
            "nav": detail.nav,
            "nav_date": detail.nav_date,
            "day_growth": detail.day_growth,
            "signal": signal,
            "confidence": confidence,
            "score": score,
            "reasons": reasons,
            "manager": manager,
            "holdings": holdings,
            "nav_data": nav_data[-120:] if nav_data else [],
            "radar_scores": radar,
            "source": detail.source,
            "style_analysis": None,
            "data_sources": fusion.get_providers_status(),
        }

    # 融合层失败，回退到旧的数据源
    return _analyze_fund_legacy(code)


def _analyze_fund_legacy(code: str) -> Dict[str, Any]:
    """旧版单数据源分析（fallback）"""
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

    # 从净值历史提取最新净值和日涨跌幅
    latest_nav = _extract_latest_nav(nav_data)

    # 提取基金名称
    fund_name = _extract_fund_name(info, code)

    return {
        "code": code,
        "name": fund_name,
        "nav": latest_nav.get("nav"),
        "nav_date": latest_nav.get("nav_date"),
        "day_growth": latest_nav.get("day_growth"),
        "signal": signal,
        "confidence": confidence,
        "score": score,
        "reasons": reasons,
        "manager": manager,
        "holdings": portfolio.get("stock_holdings", []) if portfolio else [],
        "nav_data": nav_data[-120:] if nav_data else [],
        "radar_scores": radar,
        "source": "legacy",
        "style_analysis": None,
    }


def _extract_latest_nav(nav_data: Optional[List[Dict]]) -> Dict[str, Any]:
    """从净值历史中提取最新净值、日期和日涨跌幅"""
    if not nav_data:
        return {"nav": None, "nav_date": None, "day_growth": None}
    # 按日期排序取最新
    sorted_data = sorted(nav_data, key=lambda x: x.get("date", "") or x.get("净值日期", "") or "", reverse=True)
    latest = sorted_data[0] if sorted_data else {}
    nav = latest.get("nav") or latest.get("单位净值") or latest.get("nav_value")
    nav_date = latest.get("date") or latest.get("净值日期") or latest.get("nav_date")
    day_growth = latest.get("day_growth") or latest.get("日增长率") or latest.get("daily_change")
    # 尝试从最新两条计算日涨跌幅
    if day_growth is None and len(sorted_data) >= 2:
        try:
            prev = sorted_data[1]
            prev_nav = float(prev.get("nav") or prev.get("单位净值") or 0)
            curr_nav = float(nav or 0)
            if prev_nav > 0:
                day_growth = round((curr_nav - prev_nav) / prev_nav * 100, 2)
        except (ValueError, TypeError):
            pass
    return {
        "nav": nav,
        "nav_date": nav_date,
        "day_growth": day_growth,
    }


def _extract_fund_name(info: Optional[Dict], code: str) -> str:
    """从多种可能的数据源格式中提取基金名称"""
    if not info:
        return code
    # 尝试多种可能的键名
    for key in ["基金简称", "name", "基金名称", "fund_name", "简称", "名称"]:
        if key in info and info[key]:
            return info[key]
    # 如果info是item-value格式
    for key, val in info.items():
        if isinstance(val, str) and len(val) > 4 and "基金" in val:
            return val
    return code


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


def _calc_strategy_signal_fusion(detail) -> tuple:
    """基于融合数据的策略信号计算"""
    score = 50
    reasons = []

    if detail.basic and detail.basic.manager:
        reasons.append(f"基金经理：{detail.basic.manager}")
        score += 3

    if detail.nav_history and len(detail.nav_history) > 20:
        navs = [n.nav for n in detail.nav_history if n.nav]
        if len(navs) > 20:
            recent_return = (navs[-1] - navs[0]) / navs[0] * 100
            if recent_return > 10:
                score += 5
                reasons.append(f"近20日涨幅{recent_return:.1f}%，短期表现强势")
            elif recent_return < -10:
                score -= 5
                reasons.append(f"近20日跌幅{recent_return:.1f}%，短期承压")
            else:
                reasons.append(f"近20日涨跌{recent_return:+.1f}%，走势平稳")

    if detail.holdings:
        top_ratio = sum(h.ratio for h in detail.holdings[:3])
        if top_ratio > 40:
            score -= 5
            reasons.append(f"前3大持仓占比{top_ratio:.1f}%，集中度较高")
        else:
            reasons.append(f"前3大持仓占比{top_ratio:.1f}%，分散度良好")

    if detail.risk:
        if detail.risk.sharpe and detail.risk.sharpe > 1:
            score += 3
            reasons.append(f"夏普比率{detail.risk.sharpe:.2f}，风险收益比良好")
        if detail.risk.max_drawdown and detail.risk.max_drawdown < 15:
            score += 3
            reasons.append(f"最大回撤{detail.risk.max_drawdown:.1f}%，风控能力较强")

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


def _calc_radar_scores_fusion(detail) -> Dict[str, float]:
    """基于融合数据的雷达图评分"""
    scores = {
        "profitability": 50,
        "risk_control": 50,
        "stability": 50,
        "stock_picking": 50,
        "timing": 50,
    }

    navs = [n.nav for n in detail.nav_history if n.nav] if detail.nav_history else []
    if len(navs) > 60:
        total_return = (navs[-1] - navs[0]) / navs[0] * 100
        scores["profitability"] = min(100, max(0, 50 + total_return))

        import numpy as np
        returns = np.diff(navs) / navs[:-1]
        vol = np.std(returns) * np.sqrt(252) * 100
        scores["stability"] = min(100, max(0, 100 - vol * 10))
        scores["risk_control"] = min(100, max(0, 100 - vol * 8))

        if vol > 0:
            sharpe = (total_return / max(1, len(navs) / 252)) / vol
            scores["stock_picking"] = min(100, max(0, 50 + sharpe * 20))

    if detail.risk:
        if detail.risk.sharpe:
            scores["stock_picking"] = min(100, max(0, 50 + detail.risk.sharpe * 15))
        if detail.risk.max_drawdown:
            scores["risk_control"] = min(100, max(0, 100 - detail.risk.max_drawdown * 3))

    return scores
