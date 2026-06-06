"""Backtest Metrics — compute performance and risk analytics from daily values."""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np

from .models import BacktestMetrics, RegimeHistoryEntry

logger = logging.getLogger(__name__)

# Risk-free rate assumption (annualized)
RISK_FREE_RATE = 0.02


def compute_metrics(
    daily_values: List[float],
    dates: List[str],
    rebalance_turnovers: List[float],
    saa_only_return: Optional[float] = None,
) -> BacktestMetrics:
    """Compute aggregate performance metrics from a daily portfolio value series.

    Args:
        daily_values: Daily portfolio values (absolute, starting from initial_amount)
        dates: ISO date strings aligned with daily_values
        rebalance_turnovers: List of turnover % at each rebalance
        saa_only_return: Annualized return of SAA-only mode (for TAA value-added calc)
    """
    values = np.array(daily_values, dtype=np.float64)
    n = len(values)

    if n < 2:
        return _empty_metrics()

    # Daily returns
    daily_returns = np.diff(values) / values[:-1]
    daily_returns = np.nan_to_num(daily_returns, nan=0.0, posinf=0.0, neginf=0.0)

    # Annualized return
    total_return = values[-1] / values[0] - 1.0
    n_years = n / 252.0
    ann_return = (1 + total_return) ** (1.0 / n_years) - 1.0 if n_years > 0 else 0.0

    # Annualized volatility
    ann_vol = float(np.std(daily_returns, ddof=1) * np.sqrt(252))

    # Max drawdown + duration
    max_dd, max_dd_duration = _compute_max_drawdown(values)

    # Sharpe ratio
    excess_daily = daily_returns - RISK_FREE_RATE / 252.0
    sharpe = float(np.mean(excess_daily) / np.std(excess_daily, ddof=1) * np.sqrt(252)) if np.std(excess_daily, ddof=1) > 0 else 0.0

    # Calmar ratio
    calmar = ann_return / max_dd if max_dd > 0 else 0.0

    # Sortino ratio (only downside deviation)
    downside_returns = daily_returns[daily_returns < RISK_FREE_RATE / 252.0]
    downside_dev = float(np.std(downside_returns, ddof=1) * np.sqrt(252)) if len(downside_returns) > 1 else ann_vol
    sortino = (ann_return - RISK_FREE_RATE) / downside_dev if downside_dev > 0 else 0.0

    # Monthly win rate
    win_rate = _compute_monthly_win_rate(values, dates)

    # Average turnover
    avg_turnover = float(np.mean(rebalance_turnovers)) if rebalance_turnovers else 0.0

    # TAA value-added
    taa_value_added = None
    if saa_only_return is not None:
        taa_value_added = round((ann_return - saa_only_return) * 100, 2)

    return BacktestMetrics(
        annualized_return=round(ann_return * 100, 2),
        annualized_volatility=round(ann_vol * 100, 2),
        max_drawdown=round(max_dd * 100, 2),
        max_drawdown_duration_days=max_dd_duration,
        sharpe_ratio=round(sharpe, 3),
        calmar_ratio=round(calmar, 3),
        sortino_ratio=round(sortino, 3),
        monthly_win_rate=round(win_rate, 1),
        avg_turnover=round(avg_turnover, 2),
        taa_value_added=taa_value_added,
    )


def compute_rolling_sharpe(
    daily_values: List[float], dates: List[str], window: int = 60
) -> List[Dict[str, float]]:
    """Compute rolling Sharpe ratio over a sliding window.

    Returns list of {date, sharpe} dicts.
    """
    values = np.array(daily_values, dtype=np.float64)
    n = len(values)
    result = []

    if n < window + 1:
        return result

    daily_returns = np.diff(values) / values[:-1]
    rf_daily = RISK_FREE_RATE / 252.0

    for i in range(window, len(daily_returns)):
        window_returns = daily_returns[i - window:i]
        excess = window_returns - rf_daily
        std = float(np.std(excess, ddof=1))
        if std > 0:
            sharpe = float(np.mean(excess) / std * np.sqrt(252))
        else:
            sharpe = 0.0

        result.append({
            "date": dates[i + 1],  # +1 because returns are offset by 1 from values
            "sharpe": round(sharpe, 3),
        })

    return result


def compute_monthly_returns(daily_values: List[float], dates: List[str]) -> Dict[str, float]:
    """Compute monthly returns from daily values.

    Returns dict mapping "YYYY-MM" -> return %.
    """
    if len(daily_values) < 2:
        return {}

    monthly: Dict[str, float] = {}

    # Group by year-month
    current_month = dates[0][:7]
    month_start_value = daily_values[0]

    for i in range(1, len(dates)):
        ym = dates[i][:7]
        if ym != current_month:
            # End of previous month
            month_end_value = daily_values[i - 1]
            if month_start_value > 0:
                monthly[current_month] = round(
                    (month_end_value / month_start_value - 1) * 100, 2
                )
            current_month = ym
            month_start_value = daily_values[i - 1]

    # Last incomplete month
    if current_month not in monthly and month_start_value > 0:
        monthly[current_month] = round(
            (daily_values[-1] / month_start_value - 1) * 100, 2
        )

    return monthly


def compute_regime_attribution(
    daily_values: List[float],
    dates: List[str],
    regime_history: List[RegimeHistoryEntry],
) -> Dict[str, Dict]:
    """Compute return attribution by regime period.

    Returns dict: regime -> {period_return: %, period_count: int, avg_monthly: %}
    """
    if not regime_history or len(daily_values) < 2:
        return {}

    attribution: Dict[str, Dict] = {}

    for entry in regime_history:
        regime = entry.regime
        if regime not in attribution:
            attribution[regime] = {"total_return": 0.0, "period_count": 0, "total_days": 0}

        # Find values within this regime period
        start_idx = None
        end_idx = None
        for i, d in enumerate(dates):
            if d >= entry.start_date and start_idx is None:
                start_idx = i
            if d <= entry.end_date:
                end_idx = i

        if start_idx is not None and end_idx is not None and end_idx > start_idx:
            period_return = daily_values[end_idx] / daily_values[start_idx] - 1.0
            days = end_idx - start_idx
            attribution[regime]["total_return"] += period_return
            attribution[regime]["period_count"] += 1
            attribution[regime]["total_days"] += days

    # Finalize
    result = {}
    for regime, data in attribution.items():
        count = data["period_count"]
        total_days = data["total_days"]
        total_return = data["total_return"]

        avg_monthly = 0.0
        if total_days > 0:
            # Approximate monthly: total_return / (total_days / 21)
            months = total_days / 21.0
            avg_monthly = (total_return / months) * 100 if months > 0 else 0.0

        result[regime] = {
            "total_return": round(total_return * 100, 2),
            "period_count": count,
            "total_days": total_days,
            "avg_monthly": round(avg_monthly, 2),
        }

    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _compute_max_drawdown(values: np.ndarray) -> Tuple[float, int]:
    """Compute maximum drawdown and its duration in trading days.

    Returns: (max_drawdown_fraction, duration_days)
    """
    running_max = np.maximum.accumulate(values)
    drawdowns = (values - running_max) / running_max

    max_dd = float(abs(np.min(drawdowns)))

    # Duration: from peak to recovery (or end if not recovered)
    peak_idx = 0
    max_duration = 0
    current_duration = 0

    for i in range(len(values)):
        if values[i] >= running_max[i]:
            # At or above previous peak — reset
            max_duration = max(max_duration, current_duration)
            current_duration = 0
            peak_idx = i
        else:
            current_duration = i - peak_idx

    max_duration = max(max_duration, current_duration)
    return max_dd, max_duration


def _compute_monthly_win_rate(values: np.ndarray, dates: List[str]) -> float:
    """Compute percentage of months with positive returns."""
    if len(values) < 22:  # Less than ~1 month
        return 0.0

    positive_months = 0
    total_months = 0

    current_month = dates[0][:7]
    month_start = values[0]

    for i in range(1, len(dates)):
        ym = dates[i][:7]
        if ym != current_month:
            month_end = values[i - 1]
            if month_end > month_start:
                positive_months += 1
            total_months += 1
            current_month = ym
            month_start = values[i - 1]

    # Last month
    if values[-1] > month_start:
        positive_months += 1
    total_months += 1

    return (positive_months / total_months * 100) if total_months > 0 else 0.0


def _empty_metrics() -> BacktestMetrics:
    """Return zero-filled metrics for edge cases."""
    return BacktestMetrics(
        annualized_return=0.0,
        annualized_volatility=0.0,
        max_drawdown=0.0,
        max_drawdown_duration_days=0,
        sharpe_ratio=0.0,
        calmar_ratio=0.0,
        sortino_ratio=0.0,
        monthly_win_rate=0.0,
        avg_turnover=0.0,
        taa_value_added=None,
    )
