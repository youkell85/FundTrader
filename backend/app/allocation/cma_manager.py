"""CMA Manager — Capital Market Assumptions (Three-layer: Anchor/Signal/Blend).

Three-layer architecture:
- Anchor: Long-term equilibrium (static, always available)
- Signal: Short-term data-driven from rolling 252-day calculations
- Blend: Weighted combination with regime-dependent mixing

Falls back to pure Anchor layer if Signal data is unavailable.
"""
import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .config import (
    ASSET_CLASSES,
    DEFAULT_CORR,
    EQUILIBRIUM_RETURNS,
    EQUILIBRIUM_VOLS,
    N_ASSETS,
)
from .matrix_utils import corr_to_cov, ensure_positive_definite
from .models import CMAResult, RegimeState

logger = logging.getLogger(__name__)

# Blend weights
CMA_SIGNAL_BLEND_WEIGHT = 0.40           # Signal weight when data is good
CMA_SIGNAL_BLEND_WEIGHT_UNCERTAIN = 0.20  # Signal weight when confidence is low


def estimate_cma(regime: RegimeState) -> CMAResult:
    """Estimate Capital Market Assumptions using Anchor/Signal/Blend.

    - Anchor: Static equilibrium values (always available)
    - Signal: Rolling 252-day statistics from market data (when available)
    - Blend: Weighted mix, regime-dependent lambda
    """
    # ─── Anchor Layer (static) ───
    anchor_returns = {a: EQUILIBRIUM_RETURNS[a] for a in ASSET_CLASSES}
    anchor_vols = {a: EQUILIBRIUM_VOLS[a] for a in ASSET_CLASSES}
    anchor_corr = np.array(DEFAULT_CORR, dtype=np.float64)

    # ─── Signal Layer (dynamic) ───
    signal_returns, signal_vols, signal_corr = _get_signal_layer()

    # ─── Blend Layer ───
    blend_lambda = _compute_blend_weight(regime, signal_returns)

    if blend_lambda > 0 and signal_returns is not None:
        expected_returns = _blend_dicts(anchor_returns, signal_returns, blend_lambda)
        volatilities = _blend_dicts(anchor_vols, signal_vols, blend_lambda)
        if signal_corr is not None:
            blended_corr = (1 - blend_lambda) * anchor_corr + blend_lambda * np.array(signal_corr)
        else:
            blended_corr = anchor_corr
    else:
        # Pure Anchor fallback
        expected_returns = anchor_returns
        volatilities = anchor_vols
        blended_corr = anchor_corr

    # Regime-based return adjustment (mild, applied after blend)
    regime_adjustments = _get_regime_adjustments(regime.regime)
    for asset in ASSET_CLASSES:
        expected_returns[asset] += regime_adjustments.get(asset, 0.0)

    # Build covariance matrix from blended correlation + volatilities
    vols_array = np.array([volatilities[a] / 100.0 for a in ASSET_CLASSES])  # Convert % to decimal
    cov = corr_to_cov(blended_corr, vols_array)
    cov = ensure_positive_definite(cov)

    if blend_lambda > 0:
        logger.debug(f"CMA blend: lambda={blend_lambda:.2f}, regime={regime.regime}")

    return CMAResult(
        expected_returns=expected_returns,
        volatilities=volatilities,
        covariance_matrix=cov.tolist(),
    )


def _get_signal_layer() -> Tuple[Optional[Dict[str, float]], Optional[Dict[str, float]], Optional[List[List[float]]]]:
    """Get Signal layer from market data service.

    Uses multi-window stats: blends short (60d) and long (252d) returns for
    a more responsive yet stable signal. Uses EWMA correlation matrix.

    Returns (returns_dict, vols_dict, correlation_matrix) or (None, None, None).
    """
    try:
        from .data import market_data_service
        result = market_data_service.get_rolling_stats()
        if result is None:
            return None, None, None

        returns_dict, vols_dict, corr_matrix = result

        # Validate: need at least some valid data
        valid_returns = sum(1 for v in returns_dict.values() if v is not None)
        if valid_returns < 5:
            return None, None, None

        return returns_dict, vols_dict, corr_matrix
    except Exception as e:
        logger.debug(f"Signal layer unavailable: {e}")
        return None, None, None


def get_dynamic_cma(regime: RegimeState, prices_df=None) -> CMAResult:
    """Enhanced CMA estimation using real price data when available.

    This function can be called by the backtest engine with actual price data
    to compute time-varying CMA based on rolling realized statistics.

    Args:
        regime: Current market regime state
        prices_df: Optional DataFrame with DatetimeIndex and asset class columns.
                   If provided, computes realized stats from actual prices.

    Returns:
        CMAResult with expected_returns, volatilities, and covariance_matrix
    """
    if prices_df is not None and len(prices_df) >= 60:
        return _estimate_cma_from_prices(prices_df, regime)
    return estimate_cma(regime)


def _estimate_cma_from_prices(prices_df: pd.DataFrame, regime: RegimeState) -> CMAResult:
    """Compute CMA directly from a price DataFrame (used in backtest)."""
    returns_df = prices_df.pct_change().dropna()
    if len(returns_df) < 60:
        return estimate_cma(regime)

    # Anchor layer
    anchor_returns = {a: EQUILIBRIUM_RETURNS.get(a, 2.0) for a in ASSET_CLASSES}
    anchor_vols = {a: EQUILIBRIUM_VOLS.get(a, 10.0) for a in ASSET_CLASSES}
    anchor_corr = np.array(DEFAULT_CORR, dtype=np.float64)

    # Signal layer from realized prices
    signal_returns = {}
    signal_vols = {}
    for asset in ASSET_CLASSES:
        if asset in returns_df.columns:
            r = returns_df[asset].tail(252)
            signal_returns[asset] = round(float(r.mean() * 252 * 100), 2)
            signal_vols[asset] = round(float(r.std(ddof=1) * np.sqrt(252) * 100), 2)
        else:
            signal_returns[asset] = None
            signal_vols[asset] = None

    # EWMA correlation from realized returns
    valid_cols = [a for a in ASSET_CLASSES if a in returns_df.columns]
    if len(valid_cols) >= 3:
        aligned = returns_df[valid_cols].tail(252).values.T  # (n_assets, T)
        T = aligned.shape[1]
        span = 120  # EWMA span
        weights = np.array([(1 - 1 / span) ** (T - 1 - t) for t in range(T)])
        weights /= weights.sum()
        ewma_mean = np.sum(aligned * weights[np.newaxis, :], axis=1)
        centered = aligned - ewma_mean[:, np.newaxis]
        ewma_cov = np.zeros((len(valid_cols), len(valid_cols)))
        for t in range(T):
            ewma_cov += weights[t] * np.outer(centered[:, t], centered[:, t])
        diag = np.sqrt(np.diag(ewma_cov))
        diag[diag == 0] = 1e-10
        signal_corr_sub = ewma_cov / np.outer(diag, diag)
        signal_corr_sub = np.clip(signal_corr_sub, -1, 1)
        np.fill_diagonal(signal_corr_sub, 1.0)
        signal_corr_sub = np.nan_to_num(signal_corr_sub, nan=0.0)

        # Place into full 14x14 matrix
        signal_corr = anchor_corr.copy()
        for i, ai in enumerate(valid_cols):
            for j, aj in enumerate(valid_cols):
                ii = ASSET_CLASSES.index(ai)
                jj = ASSET_CLASSES.index(aj)
                signal_corr[ii][jj] = signal_corr_sub[i][j]
    else:
        signal_corr = anchor_corr

    # Blend
    blend_lambda = _compute_blend_weight(regime, signal_returns)
    if blend_lambda > 0:
        expected_returns = _blend_dicts(anchor_returns, signal_returns, blend_lambda)
        volatilities = _blend_dicts(anchor_vols, signal_vols, blend_lambda)
        blended_corr = (1 - blend_lambda) * anchor_corr + blend_lambda * signal_corr
    else:
        expected_returns = anchor_returns
        volatilities = anchor_vols
        blended_corr = anchor_corr

    # Regime adjustments
    regime_adjustments = _get_regime_adjustments(regime.regime)
    for asset in ASSET_CLASSES:
        expected_returns[asset] += regime_adjustments.get(asset, 0.0)

    # Build covariance
    vols_array = np.array([volatilities.get(a, 10.0) / 100.0 for a in ASSET_CLASSES])
    cov = corr_to_cov(blended_corr, vols_array)
    cov = ensure_positive_definite(cov)

    return CMAResult(
        expected_returns=expected_returns,
        volatilities=volatilities,
        covariance_matrix=cov.tolist(),
    )


def _compute_blend_weight(regime: RegimeState, signal_returns: Optional[Dict]) -> float:
    """Determine blend weight (lambda) for Signal layer.

    - 0.0 if no signal data
    - CMA_SIGNAL_BLEND_WEIGHT_UNCERTAIN if low confidence
    - CMA_SIGNAL_BLEND_WEIGHT if good data
    """
    if signal_returns is None:
        return 0.0

    # Count how many assets have valid signal data
    valid = sum(1 for v in signal_returns.values() if v is not None)
    coverage = valid / len(ASSET_CLASSES)

    if coverage < 0.3:
        return 0.0

    # Use lower weight in uncertain regimes or low coverage
    if regime.confidence < 0.5 or coverage < 0.7:
        return CMA_SIGNAL_BLEND_WEIGHT_UNCERTAIN
    else:
        return CMA_SIGNAL_BLEND_WEIGHT


def _blend_dicts(anchor: Dict[str, float], signal: Dict[str, float], lam: float) -> Dict[str, float]:
    """Blend two dictionaries: result = (1-lam)*anchor + lam*signal.

    If signal[key] is None, use pure anchor value.
    """
    result = {}
    for key in anchor:
        anchor_val = anchor[key]
        signal_val = signal.get(key)
        if signal_val is not None:
            result[key] = round((1 - lam) * anchor_val + lam * signal_val, 2)
        else:
            result[key] = anchor_val
    return result


def _get_regime_adjustments(regime: str) -> dict:
    """Mild return adjustments based on market regime."""
    if regime == "goldilocks":
        return {a: 1.0 for a in ASSET_CLASSES if "equity" in a or "share" in a}
    elif regime == "overheat":
        return {"gold": 1.5, "commodity": 2.0, "rate_bond": -0.5}
    elif regime == "stagflation":
        adj = {a: -1.5 for a in ASSET_CLASSES if "share" in a}
        adj.update({"gold": 2.0, "rate_bond": 1.0})
        return adj
    elif regime == "deflation":
        adj = {a: -2.0 for a in ASSET_CLASSES if "share" in a}
        adj.update({"rate_bond": 1.5, "credit_bond": 0.5})
        return adj
    return {}  # baseline — no adjustment
