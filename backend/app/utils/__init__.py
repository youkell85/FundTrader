"""通用工具函数"""
import sys

from .common_utils import (
    safe_float,
    safe_int,
    safe_execute,
    handle_error_and_log,
    extract_latest_nav,
    extract_fund_name,
    calculate_sharpe_ratio,
    calculate_max_drawdown,
    calculate_volatility,
    calculate_calmar_ratio,
    calculate_sortino_ratio,
    sort_nav_data,
    filter_nav_by_date_range,
    normalize_nav_data,
)


def console_error(msg: str) -> None:
    """在控制台输出错误信息"""
    print(f"[ERROR] {msg}", file=sys.stderr)