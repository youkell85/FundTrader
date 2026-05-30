"""Circuit Breaker — 4-level gradient protection with asymmetric recovery.

Evaluates current market volatility vs long-term average to trigger
graduated equity reduction. Falls back to Normal (no action) if data unavailable.

Asymmetric recovery:
- Level UPGRADE (more severe): immediate
- Level DOWNGRADE (less severe): requires 2 consecutive periods at lower level
"""
import logging
import os
import threading
from typing import Dict, Optional, Tuple

from .config import ASSET_CLASSES, GROUP_MAP
from .models import RegimeState

logger = logging.getLogger(__name__)

# Breaker levels: 0=Normal, 1=Caution, 2=Warning, 3=Emergency
LEVEL_NAMES = ["Normal", "Caution", "Warning", "Emergency"]

# Equity reduction factors per level
EQUITY_REDUCTION = {0: 0.0, 1: 0.10, 2: 0.30, 3: 0.50}

# Vol ratio thresholds
VOL_THRESHOLD_L1 = 1.2
VOL_THRESHOLD_L2 = 1.8
VOL_THRESHOLD_L3 = 2.5

# Thread-safe state for asymmetric recovery
_previous_level: int = 0
_pending_downgrade_level: Optional[int] = None
_downgrade_confirm_count: int = 0
_breaker_lock = threading.Lock()


def evaluate_breaker(
    regime: RegimeState, allocations: Dict[str, float]
) -> Tuple[Dict[str, float], bool]:
    """Evaluate circuit breaker and optionally reduce risk.

    Returns:
        (adjusted_allocations, triggered: bool)

    Uses real-time vol_ratio from MarketDataService.
    Graceful fallback: if data unavailable, returns level 0 (no trigger).

    Asymmetric recovery: upgrade is immediate, downgrade requires 2 confirmations.
    """
    raw_level = _compute_raw_level()
    # v3 mode: skip asymmetric recovery, use immediate level
    if os.environ.get("FUNDTRADER_NO_ASYMMETRIC_BREAKER"):
        effective_level = raw_level
    else:
        effective_level = _apply_asymmetric_recovery(raw_level)
    triggered = effective_level > 0

    if not triggered:
        return allocations, False

    with _breaker_lock:
        prev = _previous_level
    logger.info(
        f"Circuit breaker triggered: Level {effective_level} ({LEVEL_NAMES[effective_level]}), "
        f"reducing equity by {EQUITY_REDUCTION[effective_level]*100:.0f}% "
        f"(raw={raw_level}, prev={prev})"
    )
    reduction = EQUITY_REDUCTION[effective_level]
    adjusted = _reduce_equity(allocations, reduction)
    return adjusted, True


def _compute_raw_level() -> int:
    """Determine raw breaker level from current vol_ratio (no state tracking)."""
    try:
        from .data import market_data_service
        vol_ratio = market_data_service.get_vol_ratio()
    except Exception:
        vol_ratio = None

    if vol_ratio is None:
        return 0  # Graceful fallback: no data → no trigger

    if vol_ratio >= VOL_THRESHOLD_L3:
        return 3
    elif vol_ratio >= VOL_THRESHOLD_L2:
        return 2
    elif vol_ratio >= VOL_THRESHOLD_L1:
        return 1
    else:
        return 0


def _apply_asymmetric_recovery(raw_level: int) -> int:
    """Apply asymmetric recovery logic.

    - Upgrade (raw_level > previous): immediate — switch to new higher level
    - Downgrade (raw_level < previous): requires 2 consecutive periods at lower level
    - Same level: keep current
    """
    global _previous_level, _pending_downgrade_level, _downgrade_confirm_count

    with _breaker_lock:
        if raw_level >= _previous_level:
            _previous_level = raw_level
            _pending_downgrade_level = None
            _downgrade_confirm_count = 0
            return raw_level

        if raw_level == _pending_downgrade_level:
            _downgrade_confirm_count += 1
            if _downgrade_confirm_count >= 2:
                old_level = _previous_level
                _previous_level = raw_level
                _pending_downgrade_level = None
                _downgrade_confirm_count = 0
                logger.info(
                    f"Circuit breaker downgrade confirmed: "
                    f"{LEVEL_NAMES[old_level]} → {LEVEL_NAMES[raw_level]}"
                )
                return raw_level
        else:
            _pending_downgrade_level = raw_level
            _downgrade_confirm_count = 1

        return _previous_level


def _reduce_equity(allocations: Dict[str, float], reduction: float) -> Dict[str, float]:
    """Reduce equity allocation by `reduction` fraction, shift to cash_equiv."""
    adjusted = dict(allocations)
    equity_assets = GROUP_MAP["equity"]
    cash_assets = GROUP_MAP["cash_equiv"]

    total_eq_cut = 0.0
    for a in equity_assets:
        cut = adjusted.get(a, 0.0) * reduction
        adjusted[a] = adjusted.get(a, 0.0) - cut
        total_eq_cut += cut

    # Distribute cut to cash equivalents proportionally
    cash_total = sum(adjusted.get(a, 0.0) for a in cash_assets)
    if cash_total > 0:
        for a in cash_assets:
            share = adjusted.get(a, 0.0) / cash_total
            adjusted[a] = adjusted.get(a, 0.0) + total_eq_cut * share
    else:
        # Equal distribution to cash_equiv
        per_asset = total_eq_cut / len(cash_assets)
        for a in cash_assets:
            adjusted[a] = adjusted.get(a, 0.0) + per_asset

    return adjusted


def get_breaker_status() -> dict:
    """Return current breaker status including pending state (for pipeline health)."""
    with _breaker_lock:
        return {
            "confirmed_level": _previous_level,
            "confirmed_name": LEVEL_NAMES[_previous_level],
            "reduction_pct": EQUITY_REDUCTION[_previous_level] * 100,
            "pending_downgrade": _pending_downgrade_level,
            "pending_name": LEVEL_NAMES[_pending_downgrade_level] if _pending_downgrade_level is not None else None,
            "downgrade_confirm_count": _downgrade_confirm_count,
            "is_stable": _pending_downgrade_level is None,
        }
