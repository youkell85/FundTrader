"""Regime Detector — market regime classification using macro indicators.

Uses multi-signal sigmoid scoring with persistence logic.
Graceful fallback: returns baseline if no macro data available.
"""
import logging
import os
import threading
from typing import Optional

from .models import RegimeState

logger = logging.getLogger(__name__)

# Regime labels mapping
REGIME_LABELS = {
    "goldilocks": "金发女孩",
    "overheat": "过热",
    "stagflation": "滞胀",
    "deflation": "通缩衰退",
    "baseline": "基准",
}

# Thread-safe state for persistence (2 consecutive confirmations required)
_previous_regime: str = "baseline"
_pending_regime: Optional[str] = None
_pending_count: int = 0
_regime_lock = threading.Lock()


def detect_regime() -> RegimeState:
    """Detect current market regime from macro indicators.

    Uses 2D quadrant classification (growth x inflation):
    - growth>0 & inflation<0 → goldilocks
    - growth>0 & inflation>0 → overheat
    - growth<0 & inflation>0 → stagflation
    - growth<0 & inflation<0 → deflation
    - ambiguous → baseline

    Persistence: requires 2 consecutive detections to switch regime.
    Fallback: returns baseline with low confidence if no data.
    """
    global _previous_regime, _pending_regime, _pending_count

    # Get macro data from service
    macro = _get_macro_snapshot()
    if macro is None:
        return RegimeState(
            regime="baseline",
            regime_label=REGIME_LABELS["baseline"],
            confidence=0.3,
            score=0.0,
        )

    # Score growth dimension
    growth_score = _score_growth(macro)
    # Score inflation dimension
    inflation_score = _score_inflation(macro)
    # Score monetary/liquidity dimension (supplementary)
    monetary_score = _score_monetary(macro)

    # Determine raw regime from 2D quadrant
    raw_regime = _classify_quadrant(growth_score, inflation_score, monetary_score)

    # Compute confidence from data quality
    confidence = macro.overall_confidence

    # Composite score (useful for continuous tracking)
    composite = round(growth_score * 0.4 + (-inflation_score) * 0.3 + monetary_score * 0.3, 3)

    # Persistence logic: require 2 consecutive same detections to switch
    # (v3 mode: skip persistence, use immediate classification)
    if os.environ.get("FUNDTRADER_NO_REGIME_PERSISTENCE"):
        confirmed_regime = raw_regime
        is_confirmed = True
        with _regime_lock:
            global _previous_regime, _pending_regime, _pending_count
            _previous_regime = raw_regime
            _pending_regime = None
            _pending_count = 0
    else:
        confirmed_regime = _apply_persistence(raw_regime)
        is_confirmed = confirmed_regime == raw_regime

    # During pending period, reduce confidence proportionally
    with _regime_lock:
        pending = _pending_count
        pending_regime_val = _pending_regime

    if not is_confirmed and pending > 0:
        confidence *= (0.3 + 0.7 * (pending / 2.0))
        confidence = min(confidence, 0.6)

    # Log regime to SQLite history
    _log_regime_to_db(confirmed_regime, growth_score, inflation_score, confidence)

    return RegimeState(
        regime=confirmed_regime,
        regime_label=REGIME_LABELS.get(confirmed_regime, "基准"),
        confidence=round(confidence, 2),
        score=composite,
        pending_regime=pending_regime_val,
        pending_count=pending,
        is_confirmed=is_confirmed,
    )


def _log_regime_to_db(regime: str, growth: float, inflation: float, confidence: float):
    """Log detected regime to SQLite for trend tracking."""
    try:
        from app.storage.database import RegimeHistoryCache
        RegimeHistoryCache.log(
            regime=regime,
            label=REGIME_LABELS.get(regime, "基准"),
            growth_score=round(growth, 3),
            inflation_score=round(inflation, 3),
            confidence=round(confidence, 2),
        )
    except Exception:
        pass


def _get_macro_snapshot():
    """Get macro snapshot from market data service. Returns None if unavailable."""
    try:
        from .data import market_data_service
        return market_data_service.get_macro_snapshot()
    except Exception:
        return None


def _score_growth(macro) -> float:
    """Score growth dimension: PMI + GDP. Range [-1, +1]."""
    scores = []

    pmi = macro.get_value("PMI制造业")
    if pmi is not None:
        # PMI: 50 is neutral. Score: (PMI - 50) / 2, clamped to [-1, 1]
        s = max(-1.0, min(1.0, (pmi - 50.0) / 2.0))
        scores.append(s)

    gdp = macro.get_value("GDP同比")
    if gdp is not None:
        # GDP: 4.5% is neutral. Score: (GDP - 4.5) / 3, clamped
        s = max(-1.0, min(1.0, (gdp - 4.5) / 3.0))
        scores.append(s)

    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _score_inflation(macro) -> float:
    """Score inflation dimension: CPI + PPI. Range [-1, +1]. Positive = inflationary."""
    scores = []

    cpi = macro.get_value("CPI同比")
    if cpi is not None:
        # CPI: 2% is neutral. Score: (CPI - 2) / 2, clamped
        s = max(-1.0, min(1.0, (cpi - 2.0) / 2.0))
        scores.append(s)

    ppi = macro.get_value("PPI同比")
    if ppi is not None:
        # PPI: 0% is neutral. Score: PPI / 4, clamped
        s = max(-1.0, min(1.0, ppi / 4.0))
        scores.append(s)

    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _score_monetary(macro) -> float:
    """Score monetary/liquidity dimension: M2 + 10Y yield. Range [-1, +1]. Positive = easing."""
    scores = []

    m2 = macro.get_value("M2增速")
    if m2 is not None:
        # M2: 8.5% is neutral. Higher = more easing
        s = max(-1.0, min(1.0, (m2 - 8.5) / 3.0))
        scores.append(s)

    yield_10y = macro.get_value("10Y国债收益率")
    if yield_10y is not None:
        # 10Y yield: 3% is neutral. LOWER = more easing (inverted)
        s = max(-1.0, min(1.0, (3.0 - yield_10y) / 1.0))
        scores.append(s)

    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _classify_quadrant(growth: float, inflation: float, monetary: float) -> str:
    """Classify regime from growth and inflation scores."""
    # Signal thresholds
    THRESHOLD = 0.2

    if growth > THRESHOLD and inflation < -THRESHOLD:
        return "goldilocks"
    elif growth > THRESHOLD and inflation > THRESHOLD:
        return "overheat"
    elif growth < -THRESHOLD and inflation > THRESHOLD:
        return "stagflation"
    elif growth < -THRESHOLD and inflation < -THRESHOLD:
        return "deflation"
    else:
        return "baseline"


def _apply_persistence(raw_regime: str) -> str:
    """Apply persistence logic: require 2 consecutive same detections to switch."""
    global _previous_regime, _pending_regime, _pending_count

    with _regime_lock:
        if raw_regime == _previous_regime:
            _pending_regime = None
            _pending_count = 0
            return _previous_regime

        if raw_regime == _pending_regime:
            _pending_count += 1
            if _pending_count >= 2:
                _previous_regime = raw_regime
                _pending_regime = None
                _pending_count = 0
                logger.info(f"Regime switched to: {raw_regime} ({REGIME_LABELS.get(raw_regime, '')})")
                return raw_regime
        else:
            _pending_regime = raw_regime
            _pending_count = 1

        return _previous_regime


def get_regime_status() -> dict:
    """Return current regime status including pending state (for pipeline health)."""
    with _regime_lock:
        return {
            "confirmed_regime": _previous_regime,
            "confirmed_label": REGIME_LABELS.get(_previous_regime, "基准"),
            "pending_regime": _pending_regime,
            "pending_label": REGIME_LABELS.get(_pending_regime, "") if _pending_regime else None,
            "pending_count": _pending_count,
            "is_stable": _pending_regime is None,
        }
