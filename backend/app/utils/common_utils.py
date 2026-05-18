"""通用工具函数 - 提取重复的错误处理和数据处理逻辑"""

import math
from typing import Any, Optional, List, Dict
import numpy as np


def safe_float(val: Any) -> Optional[float]:
    """安全转换为浮点数，处理NaN和异常值"""
    try:
        f = float(val)
        if math.isnan(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def safe_int(val: Any) -> Optional[int]:
    """安全转换为整数，处理异常值"""
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def safe_execute(func, *args, default=None, error_msg_prefix="Safe execution error"):
    """安全执行函数，捕获异常并返回默认值"""
    try:
        return func(*args)
    except Exception as e:
        from . import console_error
        console_error(f"{error_msg_prefix}: {e}")
        return default


def handle_error_and_log(error: Exception, error_msg: str, console_error_func=None):
    """统一错误处理和日志记录函数"""
    if console_error_func is None:
        from . import console_error
        console_error_func = console_error
    console_error_func(f"{error_msg}: {error}")


def extract_latest_nav(nav_data: Optional[List[Dict]]) -> Dict[str, Any]:
    """从净值历史中提取最新净值、日期和日涨跌幅"""
    if not nav_data:
        return {"nav": None, "nav_date": None, "day_growth": None}
    
    # 按日期排序取最新
    sorted_data = sorted(
        nav_data, 
        key=lambda x: x.get("date", "") or x.get("净值日期", "") or "", 
        reverse=True
    )
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


def extract_fund_name(info: Optional[Dict], code: str) -> str:
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


def calculate_sharpe_ratio(returns: np.ndarray, risk_free: float = 0.02 / 252) -> float:
    """夏普比率计算"""
    if len(returns) < 2 or np.std(returns) == 0:
        return 0
    return (np.mean(returns) - risk_free) / np.std(returns) * np.sqrt(252)


def calculate_max_drawdown(navs: List[float]) -> float:
    """最大回撤计算"""
    if not navs:
        return 0
        
    peak = navs[0]
    max_dd = 0
    for nav in navs:
        if nav > peak:
            peak = nav
        dd = (peak - nav) / peak * 100
        if dd > max_dd:
            max_dd = dd
    return max_dd


def calculate_volatility(returns: np.ndarray) -> float:
    """年化波动率计算"""
    if len(returns) < 2:
        return 0
    return np.std(returns) * np.sqrt(252) * 100


def calculate_calmar_ratio(returns: np.ndarray, navs: List[float]) -> float:
    """Calmar比率计算"""
    max_dd = calculate_max_drawdown(navs)
    if max_dd == 0:
        return 0
    annual_return = (1 + np.mean(returns)) ** 252 - 1
    return annual_return / (max_dd / 100)


def calculate_sortino_ratio(returns: np.ndarray, risk_free: float = 0.02 / 252) -> float:
    """Sortino比率计算"""
    if len(returns) < 2:
        return 0
    downside = returns[returns < risk_free] - risk_free
    if len(downside) == 0:
        return 0
    downside_std = np.sqrt(np.mean(downside ** 2))
    if downside_std == 0:
        return 0
    return (np.mean(returns) - risk_free) / downside_std * np.sqrt(252)


def sort_nav_data(nav_data: List[Dict[str, Any]], date_key: str = "date") -> List[Dict[str, Any]]:
    """对净值数据按日期排序"""
    return sorted(nav_data, key=lambda x: x.get(date_key, ""), reverse=True)


def filter_nav_by_date_range(
    nav_data: List[Dict[str, Any]], 
    start_date: str = "", 
    end_date: str = "",
    date_key: str = "date"
) -> List[Dict[str, Any]]:
    """按日期范围过滤净值数据"""
    result = nav_data
    if start_date:
        result = [r for r in result if r[date_key] >= start_date]
    if end_date:
        result = [r for r in result if r[date_key] <= end_date]
    return result


def normalize_nav_data(nav_list, date_field="date", nav_field="nav", acc_nav_field="accum_nav", growth_field="day_growth"):
    """标准化净值数据格式"""
    return [
        {
            "date": getattr(n, date_field, None),
            "nav": getattr(n, nav_field, None),
            "acc_nav": getattr(n, acc_nav_field, None),
            "day_growth": getattr(n, growth_field, None)
        }
        for n in nav_list if getattr(n, nav_field, None)
    ]