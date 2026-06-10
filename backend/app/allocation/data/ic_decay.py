"""IC (Information Coefficient) Decay Analysis.

Measures how the predictive power of macro signals decays over
different time horizons. This helps the TAA engine understand
which signals are persistent (slow decay) vs. transient (fast decay).

IC is computed as the rank correlation (Spearman) between:
  - Signal value at time t
  - Forward asset returns over horizon h

IC Decay Curve: IC as a function of horizon h.
  - Slow decay → signal has long-term predictive power
  - Fast decay → signal is only useful for short-term tactical moves

Key metrics:
  - IC at each horizon (1m, 3m, 6m, 12m)
  - Half-life: horizon at which IC drops to 50% of peak
  - IC stability: std(IC) / mean(|IC|)
  - Signal quality score: composite of IC strength and persistence
"""
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
from scipy.stats import spearmanr

logger = logging.getLogger(__name__)

# Forward-looking horizons (in trading days)
IC_HORIZONS = {
    "1m": 21,
    "3m": 63,
    "6m": 126,
    "12m": 252,
}


def compute_ic_series(
    signal: np.ndarray,
    returns: np.ndarray,
    horizons: Dict[str, int] = None,
) -> Dict[str, Optional[float]]:
    """Compute IC (Spearman rank correlation) at multiple forward horizons.

    Args:
        signal: 1D array of signal values (e.g., PMI readings)
        returns: 1D array of daily log returns (same length as signal)
        horizons: dict of {label: days} for forward return computation

    Returns:
        {horizon_label: IC_value or None}
    """
    if horizons is None:
        horizons = IC_HORIZONS

    signal = np.asarray(signal, dtype=np.float64)
    returns = np.asarray(returns, dtype=np.float64)

    result = {}
    for label, h_days in horizons.items():
        # Compute forward returns (sum of daily returns over h_days)
        fwd_returns = np.zeros(len(returns))
        for t in range(len(returns) - h_days):
            fwd_returns[t] = np.sum(returns[t : t + h_days])

        # Truncate to valid range (need h_days of forward data)
        valid_len = len(returns) - h_days
        if valid_len < 10:
            result[label] = None
            continue

        sig_valid = signal[:valid_len]
        ret_valid = fwd_returns[:valid_len]

        # Remove NaN/inf
        mask = np.isfinite(sig_valid) & np.isfinite(ret_valid)
        if mask.sum() < 10:
            result[label] = None
            continue

        ic, _ = spearmanr(sig_valid[mask], ret_valid[mask])
        result[label] = round(float(ic), 4) if np.isfinite(ic) else None

    return result


def ic_half_life(ic_series: Dict[str, Optional[float]]) -> Optional[str]:
    """Find the horizon at which IC drops to 50% of its peak value.

    Args:
        ic_series: {horizon_label: IC} from compute_ic_series()

    Returns:
        Horizon label where IC crosses 50% threshold, or None if no decay.
    """
    # Ordered horizons
    ordered = ["1m", "3m", "6m", "12m"]
    values = []
    for label in ordered:
        v = ic_series.get(label)
        if v is not None:
            values.append((label, abs(v)))

    if len(values) < 2:
        return None

    peak = max(v for _, v in values)
    if peak < 0.01:
        return None  # No meaningful signal

    half = peak * 0.5
    for label, v in values:
        if v < half:
            return label

    return None  # IC persists beyond all measured horizons


def signal_quality_score(ic_series: Dict[str, Optional[float]]) -> float:
    """Compute a composite signal quality score [0, 1].

    Components:
      - IC strength (40%): mean |IC| across horizons
      - IC persistence (30%): 1 if IC doesn't decay, 0 if fast decay
      - IC stability (30%): low std relative to mean

    Args:
        ic_series: {horizon_label: IC}

    Returns:
        float in [0, 1], higher = better signal
    """
    values = [abs(v) for v in ic_series.values() if v is not None]
    if len(values) < 2:
        return 0.0

    # IC strength: mean |IC| (typical good signals have |IC| > 0.05)
    mean_ic = np.mean(values)
    strength = min(1.0, mean_ic / 0.10)  # Normalize: 0.10 = perfect score

    # IC persistence: ratio of long-term IC to short-term IC
    ordered = ["1m", "3m", "6m", "12m"]
    short_ic = None
    long_ic = None
    for label in ordered:
        v = ic_series.get(label)
        if v is not None:
            if short_ic is None:
                short_ic = abs(v)
            long_ic = abs(v)

    if short_ic and short_ic > 0.01:
        persistence = min(1.0, long_ic / short_ic)
    else:
        persistence = 0.0

    # IC stability: low coefficient of variation
    if mean_ic > 0.01:
        cv = np.std(values) / mean_ic
        stability = max(0.0, 1.0 - cv)
    else:
        stability = 0.0

    score = 0.4 * strength + 0.3 * persistence + 0.3 * stability
    return round(float(np.clip(score, 0, 1)), 3)


def build_daily_signal_series(
    history: List[Tuple[str, float, str]],
    return_dates: List[str],
) -> Optional[np.ndarray]:
    """Convert monthly macro history to a daily signal series aligned to return dates.

    Forward-fills each monthly value to all subsequent trading days until the
    next monthly observation. This is the standard approach for aligning
    low-frequency macro data with daily asset returns.

    Args:
        history: List of (date_str, value, source) from MacroCache.get_history(),
                 ordered newest-first. date_str is "YYYY-MM" (monthly).
        return_dates: List of "YYYY-MM-DD" trading dates, oldest-first.

    Returns:
        1D numpy array of signal values aligned to return_dates, or None if
        fewer than 6 monthly observations are available.
    """
    if len(history) < 6:
        return None

    # Parse monthly observations, oldest-first
    monthly = []
    for date_str, value, _source in history:
        try:
            parts = date_str.split("-")
            if len(parts) == 2:
                year, month = int(parts[0]), int(parts[1])
                monthly.append((year, month, float(value)))
            elif len(parts) == 3:
                # "YYYY-MM-DD" format — treat as monthly by year-month
                year, month = int(parts[0]), int(parts[1])
                monthly.append((year, month, float(value)))
        except (ValueError, IndexError):
            continue

    if len(monthly) < 6:
        return None

    # Sort oldest-first
    monthly.sort(key=lambda x: (x[0], x[1]))

    # Build daily signal by forward-filling
    signal = np.full(len(return_dates), np.nan, dtype=np.float64)
    month_idx = 0
    for i, date_str in enumerate(return_dates):
        try:
            parts = date_str.split("-")
            d_year, d_month = int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            continue

        # Advance to the latest monthly observation <= this trading date
        while month_idx + 1 < len(monthly):
            ny, nm = monthly[month_idx + 1][0], monthly[month_idx + 1][1]
            if (ny, nm) <= (d_year, d_month):
                month_idx += 1
            else:
                break

        my, mm = monthly[month_idx][0], monthly[month_idx][1]
        if (my, mm) <= (d_year, d_month):
            signal[i] = monthly[month_idx][2]

    # Drop leading NaN (before first monthly observation)
    valid_mask = np.isfinite(signal)
    if valid_mask.sum() < 60:
        return None

    return signal


def analyze_macro_signals(
    signals: Dict[str, np.ndarray],
    asset_returns: Dict[str, np.ndarray],
) -> Dict[str, Dict]:
    """Analyze IC decay for all signal-asset pairs.

    Args:
        signals: {signal_name: array of signal values}
        asset_returns: {asset_class: array of daily log returns}

    Returns:
        {signal_name: {
            "ic_series": {horizon: IC},
            "half_life": horizon_label,
            "quality": score,
            "best_asset": asset with highest IC,
        }}
    """
    results = {}

    for sig_name, sig_values in signals.items():
        sig_results = {}
        best_ic = 0
        best_asset = None

        for asset, rets in asset_returns.items():
            # Align lengths
            min_len = min(len(sig_values), len(rets))
            if min_len < 60:
                continue

            sig_aligned = sig_values[-min_len:]
            ret_aligned = rets[-min_len:]

            ic = compute_ic_series(sig_aligned, ret_aligned)
            quality = signal_quality_score(ic)

            sig_results[asset] = {
                "ic_series": ic,
                "half_life": ic_half_life(ic),
                "quality": quality,
            }

            # Track best
            mean_ic = np.mean([abs(v) for v in ic.values() if v is not None]) if ic else 0
            if mean_ic > best_ic:
                best_ic = mean_ic
                best_asset = asset

        results[sig_name] = {
            "assets": sig_results,
            "best_asset": best_asset,
            "best_ic": round(best_ic, 4),
        }

    return results
