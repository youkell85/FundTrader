"""Regime Replay — replay regime detection logic over historical macro data.

Stateless version of regime_detector.py that accepts explicit macro values
instead of calling the live market data service.
"""

import logging
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd

from ..models import RegimeState

logger = logging.getLogger(__name__)

REGIME_LABELS = {
    "goldilocks": "金发女孩",
    "overheat": "过热",
    "stagflation": "滞胀",
    "deflation": "通缩衰退",
    "baseline": "基准",
}

# Persistence threshold: 2 consecutive detections to confirm switch
PERSISTENCE_THRESHOLD = 2
# Growth/inflation classification threshold
QUADRANT_THRESHOLD = 0.2


def build_macro_snapshot_at(
    macro_history: Dict[str, pd.Series], as_of_date: pd.Timestamp
) -> Dict[str, Optional[float]]:
    """Build a point-in-time macro snapshot from historical time series.

    For each indicator, picks the most recent published value <= as_of_date,
    accounting for typical publication lags.
    """
    snapshot: Dict[str, Optional[float]] = {}

    # Publication lags (approximate business days)
    lags = {
        "PMI制造业": 0,         # Published at month end for that month
        "GDP同比": 45,          # ~45 day lag (quarterly)
        "CPI同比": 15,          # ~15 day lag
        "PPI同比": 15,
        "10Y国债收益率": 1,     # Daily, 1 day lag
        "DR007": 1,
        "社融增速": 20,
        "M2增速": 20,
        "融资余额变化": 2,
        "北向资金净流入": 2,
        "财政赤字率": 0,        # Annual, use static
        "美联储利率": 0,
        "美元指数": 1,
    }

    for name, series in macro_history.items():
        if series is None or series.empty:
            snapshot[name] = None
            continue

        lag_days = lags.get(name, 15)
        effective_date = as_of_date - pd.Timedelta(days=lag_days)

        # Get most recent value on or before effective_date
        valid = series[series.index <= effective_date]
        if len(valid) > 0:
            snapshot[name] = float(valid.iloc[-1])
        else:
            snapshot[name] = None

    return snapshot


def detect_regime_at(
    snapshot: Dict[str, Optional[float]],
    prev_regime: str,
    pending_regime: Optional[str],
    pending_count: int,
) -> Tuple[RegimeState, str, Optional[str], int]:
    """Detect regime from a point-in-time macro snapshot.

    Stateless: caller manages persistence state across calls.

    Returns:
        Tuple of (RegimeState, confirmed_regime, new_pending_regime, new_pending_count)
    """
    # Score dimensions
    growth_score = _score_growth(snapshot)
    inflation_score = _score_inflation(snapshot)
    monetary_score = _score_monetary(snapshot)

    # Classify raw regime
    raw_regime = _classify_quadrant(growth_score, inflation_score, monetary_score)

    # Compute confidence (based on data availability)
    available_count = sum(1 for v in snapshot.values() if v is not None)
    total_count = len(snapshot) if snapshot else 13
    confidence = round(min(0.9, 0.3 + 0.6 * (available_count / total_count)), 2)

    # Composite score
    composite = round(growth_score * 0.4 + (-inflation_score) * 0.3 + monetary_score * 0.3, 3)

    # Apply persistence
    confirmed, new_pending, new_count = _apply_persistence(
        raw_regime, prev_regime, pending_regime, pending_count
    )

    state = RegimeState(
        regime=confirmed,
        regime_label=REGIME_LABELS.get(confirmed, "基准"),
        confidence=confidence,
        score=composite,
    )

    return state, confirmed, new_pending, new_count


def compute_vol_ratio_at(prices_df: pd.DataFrame, as_of_date: pd.Timestamp) -> Optional[float]:
    """Compute volatility ratio (20d / 60d) for circuit breaker evaluation.

    Uses a_share_large (CSI300 proxy) prices.
    Returns None if insufficient data.
    """
    if "a_share_large" not in prices_df.columns:
        return None

    # Get data up to as_of_date
    prices = prices_df["a_share_large"]
    valid = prices[prices.index <= as_of_date]

    if len(valid) < 60:
        return None

    # Compute log returns
    log_returns = np.log(valid / valid.shift(1)).dropna()

    if len(log_returns) < 60:
        return None

    # 20-day and 60-day realized vol
    vol_20 = float(log_returns.iloc[-20:].std() * np.sqrt(252))
    vol_60 = float(log_returns.iloc[-60:].std() * np.sqrt(252))

    if vol_60 == 0:
        return 1.0

    return round(vol_20 / vol_60, 3)


# ---------------------------------------------------------------------------
# Internal scoring functions (replicated from regime_detector.py)
# ---------------------------------------------------------------------------

def _score_growth(snapshot: Dict[str, Optional[float]]) -> float:
    """Score growth dimension: PMI + GDP. Range [-1, +1]."""
    scores = []

    pmi = snapshot.get("PMI制造业")
    if pmi is not None:
        s = max(-1.0, min(1.0, (pmi - 50.0) / 2.0))
        scores.append(s)

    gdp = snapshot.get("GDP同比")
    if gdp is not None:
        s = max(-1.0, min(1.0, (gdp - 4.5) / 3.0))
        scores.append(s)

    return sum(scores) / len(scores) if scores else 0.0


def _score_inflation(snapshot: Dict[str, Optional[float]]) -> float:
    """Score inflation dimension: CPI + PPI. Range [-1, +1]. Positive = inflationary."""
    scores = []

    cpi = snapshot.get("CPI同比")
    if cpi is not None:
        s = max(-1.0, min(1.0, (cpi - 2.0) / 2.0))
        scores.append(s)

    ppi = snapshot.get("PPI同比")
    if ppi is not None:
        s = max(-1.0, min(1.0, ppi / 4.0))
        scores.append(s)

    return sum(scores) / len(scores) if scores else 0.0


def _score_monetary(snapshot: Dict[str, Optional[float]]) -> float:
    """Score monetary/liquidity dimension. Range [-1, +1]. Positive = easing."""
    scores = []

    m2 = snapshot.get("M2增速")
    if m2 is not None:
        s = max(-1.0, min(1.0, (m2 - 8.5) / 3.0))
        scores.append(s)

    yield_10y = snapshot.get("10Y国债收益率")
    if yield_10y is not None:
        s = max(-1.0, min(1.0, (3.0 - yield_10y) / 1.0))
        scores.append(s)

    return sum(scores) / len(scores) if scores else 0.0


def _classify_quadrant(growth: float, inflation: float, monetary: float) -> str:
    """Classify regime from growth and inflation scores."""
    if growth > QUADRANT_THRESHOLD and inflation < -QUADRANT_THRESHOLD:
        return "goldilocks"
    elif growth > QUADRANT_THRESHOLD and inflation > QUADRANT_THRESHOLD:
        return "overheat"
    elif growth < -QUADRANT_THRESHOLD and inflation > QUADRANT_THRESHOLD:
        return "stagflation"
    elif growth < -QUADRANT_THRESHOLD and inflation < -QUADRANT_THRESHOLD:
        return "deflation"
    else:
        return "baseline"


def _apply_persistence(
    raw_regime: str,
    prev_regime: str,
    pending_regime: Optional[str],
    pending_count: int,
) -> Tuple[str, Optional[str], int]:
    """Apply persistence logic (stateless version).

    Returns: (confirmed_regime, new_pending_regime, new_pending_count)
    """
    if raw_regime == prev_regime:
        return prev_regime, None, 0

    if raw_regime == pending_regime:
        new_count = pending_count + 1
        if new_count >= PERSISTENCE_THRESHOLD:
            return raw_regime, None, 0
        return prev_regime, pending_regime, new_count
    else:
        return prev_regime, raw_regime, 1
