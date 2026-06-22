from __future__ import annotations

from typing import Any

from .dca_service import _calculate_dca_backtest, _get_nav_history


SUPPORTED_STRATEGIES = ["fixed", "ratio", "ma", "martingale"]


def fetch_real_nav_history(code: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
    nav = _get_nav_history(code, start_date, end_date)
    return sorted([item for item in nav if item.get("date") and item.get("nav")], key=lambda item: item["date"])


def bounded_rolling_start_dates(nav: list[dict[str, Any]], max_windows: int = 36) -> list[str]:
    if not nav:
        return []
    months: list[str] = []
    seen: set[str] = set()
    for item in nav:
        month = str(item["date"])[:7]
        if month not in seen:
            seen.add(month)
            months.append(str(item["date"]))
    if len(months) <= max_windows:
        return months
    step = max(1, len(months) // max_windows)
    sampled = months[::step][:max_windows]
    return sampled


def run_strategy_compare(code: str, amount: float, start_date: str, end_date: str) -> dict[str, Any]:
    return _calculate_dca_backtest(
        code=code,
        amount=amount,
        frequency="monthly",
        strategy="compare",
        start_date=start_date,
        end_date=end_date,
    )
