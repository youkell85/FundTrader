"""Regime Detector — market regime classification using macro indicators.

Uses multi-signal sigmoid scoring with persistence logic.
Graceful fallback: returns baseline if no macro data available.
"""
import logging
import os
import threading
import time
from dataclasses import dataclass, fields
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
_last_pending_started_at: Optional[float] = None  # monotonic time of first pending detection
_regime_lock = threading.Lock()
# Minimum elapsed monotonic time (seconds) before a pending regime can be
# confirmed. Prevents fast-loop callers (e.g., SSE regenerate) from confirming
# a regime switch on the same dataset within milliseconds.
_PERSISTENCE_MIN_INTERVAL_S = 60.0


# ─── Calibratable Thresholds ────────────────────────────────────────────────────

@dataclass
class RegimeThresholds:
    """Calibratable regime scoring and classification thresholds.

    All fields have sensible defaults matching current hard-coded values.
    When a historical calibration snapshot is available via
    StatsSnapshotCache("historical_calibration") -> regime_thresholds.params,
    fields are overridden per-field with fallback to these defaults.
    """
    quadrant: float = 0.2
    pmi_neutral: float = 50.0
    pmi_scale: float = 2.0
    gdp_neutral: float = 4.5
    gdp_scale: float = 3.0
    cpi_neutral: float = 2.0
    cpi_scale: float = 2.0
    ppi_neutral: float = 0.0
    ppi_scale: float = 4.0
    m2_neutral: float = 8.5
    m2_scale: float = 3.0
    yield_10y_neutral: float = 3.0
    yield_10y_scale: float = 1.0


def get_regime_thresholds() -> RegimeThresholds:
    """Return active regime thresholds, preferring cached calibration when valid.

    Loads from StatsSnapshotCache("historical_calibration") ->
    regime_thresholds.params, with per-field fallback to RegimeThresholds defaults.

    Only numeric (int/float, not bool) values are accepted as overrides;
    missing, null, or non-numeric values fall back to the dataclass default.
    """
    thresholds = RegimeThresholds()
    try:
        from app.storage.database import StatsSnapshotCache

        cached = StatsSnapshotCache.get("historical_calibration")
        if isinstance(cached, dict):
            params = cached.get("regime_thresholds", {})
            if isinstance(params, dict):
                # Support both nested {"params": {...}} and flat {...}
                params = params.get("params", params)
            if isinstance(params, dict):
                for f in fields(RegimeThresholds):
                    val = params.get(f.name)
                    if isinstance(val, (int, float)) and not isinstance(val, bool):
                        setattr(thresholds, f.name, float(val))
    except Exception:
        pass
    return thresholds


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

    # Composite score (useful for continuous tracking).
    # Default weights assume "normal" cycle. When growth or inflation is the
    # dominant risk, weight shifts toward that dimension to match regime reality.
    if raw_regime == "stagflation":
        weights = (0.25, 0.5, 0.25)
    elif raw_regime == "deflation":
        weights = (0.55, 0.15, 0.30)
    elif raw_regime == "overheat":
        weights = (0.30, 0.40, 0.30)
    else:
        weights = (0.4, 0.3, 0.3)
    composite = round(
        growth_score * weights[0]
        + (-inflation_score) * weights[1]
        + monetary_score * weights[2],
        3,
    )

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
    t = get_regime_thresholds()
    scores = []

    pmi = macro.get_value("PMI制造业")
    if pmi is not None:
        # PMI: neutral point configurable. Score: (PMI - neutral) / scale, clamped to [-1, 1]
        s = max(-1.0, min(1.0, (pmi - t.pmi_neutral) / t.pmi_scale))
        scores.append(s)

    gdp = macro.get_value("GDP同比")
    if gdp is not None:
        # GDP: neutral point configurable. Score: (GDP - neutral) / scale, clamped
        s = max(-1.0, min(1.0, (gdp - t.gdp_neutral) / t.gdp_scale))
        scores.append(s)

    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _score_inflation(macro) -> float:
    """Score inflation dimension: CPI + PPI. Range [-1, +1]. Positive = inflationary."""
    t = get_regime_thresholds()
    scores = []

    cpi = macro.get_value("CPI同比")
    if cpi is not None:
        # CPI: neutral point configurable. Score: (CPI - neutral) / scale, clamped
        s = max(-1.0, min(1.0, (cpi - t.cpi_neutral) / t.cpi_scale))
        scores.append(s)

    ppi = macro.get_value("PPI同比")
    if ppi is not None:
        # PPI: neutral point configurable. Score: (PPI - neutral) / scale, clamped
        s = max(-1.0, min(1.0, (ppi - t.ppi_neutral) / t.ppi_scale))
        scores.append(s)

    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _score_monetary(macro) -> float:
    """Score monetary/liquidity dimension: M2 + 10Y yield. Range [-1, +1]. Positive = easing."""
    t = get_regime_thresholds()
    scores = []

    m2 = macro.get_value("M2增速")
    if m2 is not None:
        # M2: neutral point configurable. Higher = more easing
        s = max(-1.0, min(1.0, (m2 - t.m2_neutral) / t.m2_scale))
        scores.append(s)

    yield_10y = macro.get_value("10Y国债收益率")
    if yield_10y is not None:
        # 10Y yield: neutral point configurable. LOWER = more easing (inverted)
        s = max(-1.0, min(1.0, (t.yield_10y_neutral - yield_10y) / t.yield_10y_scale))
        scores.append(s)

    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _classify_quadrant(growth: float, inflation: float, monetary: float) -> str:
    """Classify regime from growth and inflation scores."""
    t = get_regime_thresholds()

    if growth > t.quadrant and inflation < -t.quadrant:
        return "goldilocks"
    elif growth > t.quadrant and inflation > t.quadrant:
        return "overheat"
    elif growth < -t.quadrant and inflation > t.quadrant:
        return "stagflation"
    elif growth < -t.quadrant and inflation < -t.quadrant:
        return "deflation"
    else:
        return "baseline"


def _apply_persistence(raw_regime: str) -> str:
    """Apply persistence logic: require 2 consecutive same detections to switch.

    Additionally requires the two detections to be at least
    _PERSISTENCE_MIN_INTERVAL_S apart in wall-clock terms, so a tight
    loop cannot confirm a regime switch on the same data snapshot.
    """
    global _previous_regime, _pending_regime, _pending_count
    global _last_pending_started_at

    now = time.monotonic()
    with _regime_lock:
        if raw_regime == _previous_regime:
            _pending_regime = None
            _pending_count = 0
            _last_pending_started_at = None
            return _previous_regime

        if raw_regime == _pending_regime:
            _pending_count += 1
            elapsed = now - (_last_pending_started_at or now)
            if _pending_count >= 2 and elapsed >= _PERSISTENCE_MIN_INTERVAL_S:
                _previous_regime = raw_regime
                _pending_regime = None
                _pending_count = 0
                _last_pending_started_at = None
                logger.info(
                    f"Regime switched to: {raw_regime} "
                    f"({REGIME_LABELS.get(raw_regime, '')}) after {elapsed:.0f}s"
                )
                return raw_regime
        else:
            _pending_regime = raw_regime
            _pending_count = 1
            _last_pending_started_at = now

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
