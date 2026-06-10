"""CMA Manager — Capital Market Assumptions (Three-layer: Anchor/Signal/Blend).

Three-layer architecture:
- Anchor: Long-term equilibrium (static, always available)
- Signal: Short-term data-driven from rolling 252-day calculations
- Blend: Weighted combination with regime-dependent mixing

Falls back to pure Anchor layer if Signal data is unavailable.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .config import (
    ASSET_CLASSES,
    ASSET_TO_GROUP,
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
    anchor_returns, anchor_vols, anchor_corr, anchor_quality = _get_anchor_layer()

    # ─── Signal Layer (dynamic) ───
    signal_returns, signal_vols, signal_corr, signal_quality = _get_signal_layer()
    signal_returns, signal_vols, invalid_assets = _sanitize_signal_layer(
        signal_returns,
        signal_vols,
        signal_quality,
    )

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
        quality=_build_cma_quality(blend_lambda, signal_quality, invalid_assets, anchor_quality),
    )


def _get_anchor_layer() -> Tuple[Dict[str, float], Dict[str, float], np.ndarray, Dict[str, Any]]:
    """Load auditable CMA anchors from historical calibration, falling back to config."""
    static_returns = {a: EQUILIBRIUM_RETURNS[a] for a in ASSET_CLASSES}
    static_vols = {a: EQUILIBRIUM_VOLS[a] for a in ASSET_CLASSES}
    static_corr = np.array(DEFAULT_CORR, dtype=np.float64)
    static_quality = {
        "source": "static_assumption",
        "as_of": None,
        "coverage": 0.0,
        "invalid_assets": {asset: "static_anchor" for asset in ASSET_CLASSES},
        "assumptions_used": [f"{asset}:static_anchor" for asset in ASSET_CLASSES],
        "calibration_version": "static-cma-anchor",
    }

    try:
        from .data.historical_calibrator import HistoricalCalibrator

        snapshot = _load_cached_anchor_snapshot()
        if snapshot is None:
            stats_snapshot = _current_market_stats_snapshot()
            if stats_snapshot is None:
                return static_returns, static_vols, static_corr, static_quality
            snapshot = HistoricalCalibrator(stats_snapshot=stats_snapshot).calibrate_all(persist=False)
        returns_result = snapshot.get("equilibrium_returns") or {}
        vols_result = snapshot.get("equilibrium_vols") or {}
        corr_result = snapshot.get("correlation_matrix") or {}

        returns = _merge_anchor_series(returns_result.get("values") or {}, static_returns)
        vols = _merge_anchor_series(vols_result.get("values") or {}, static_vols)
        corr = _anchor_corr_matrix(corr_result.get("matrix"), static_corr)
        quality = {
            "source": _anchor_source(
                {
                    returns_result.get("source"),
                    vols_result.get("source"),
                    corr_result.get("source"),
                }
            ),
            "as_of": returns_result.get("as_of") or vols_result.get("as_of") or corr_result.get("as_of"),
            "coverage": min(
                float(returns_result.get("coverage") or 0.0),
                float(vols_result.get("coverage") or 0.0),
                float(corr_result.get("coverage") or 0.0),
            ),
            "invalid_assets": _merge_invalid_assets(returns_result, vols_result, corr_result),
            "assumptions_used": sorted(
                set(
                    (returns_result.get("assumptions_used") or [])
                    + (vols_result.get("assumptions_used") or [])
                    + (corr_result.get("assumptions_used") or [])
                )
            ),
            "calibration_version": returns_result.get("calibration_version")
            or vols_result.get("calibration_version")
            or corr_result.get("calibration_version")
            or "historical-calibrator-v1",
        }
        return returns, vols, corr, quality
    except Exception as exc:
        logger.debug("CMA anchor calibration unavailable, using static config: %s", exc)
        return static_returns, static_vols, static_corr, static_quality


def _load_cached_anchor_snapshot() -> Optional[dict]:
    try:
        from app.storage.database import StatsSnapshotCache

        cached = StatsSnapshotCache.get("historical_calibration")
        return cached if isinstance(cached, dict) else None
    except Exception:
        return None


def _current_market_stats_snapshot() -> Optional[dict]:
    try:
        from .data import market_data_service

        stats = market_data_service.get_rolling_stats_ex()
        if isinstance(stats, dict):
            return stats
        basic = market_data_service.get_rolling_stats()
        if basic is None:
            return None
        returns, vols, corr = basic
        return {
            "returns_long": returns,
            "vols_long": vols,
            "correlation_matrix": corr,
            "quality": {},
        }
    except Exception:
        return None


def _get_signal_layer() -> Tuple[
    Optional[Dict[str, float]],
    Optional[Dict[str, float]],
    Optional[List[List[float]]],
    Dict[str, dict],
]:
    """Get Signal layer from market data service.

    Uses multi-window stats: blends short (60d) and long (252d) returns for
    a more responsive yet stable signal. Uses EWMA correlation matrix.

    Returns (returns_dict, vols_dict, correlation_matrix) or (None, None, None).
    """
    try:
        from .data import market_data_service
        result = market_data_service.get_rolling_stats_ex()
        if result is None:
            basic = market_data_service.get_rolling_stats()
            if basic is None:
                return None, None, None, {}
            returns_dict, vols_dict, corr_matrix = basic
            return returns_dict, vols_dict, corr_matrix, {}

        returns_dict = result.get("returns_long", {})
        vols_dict = result.get("vols_long", {})
        corr_matrix = result.get("correlation_matrix")
        quality = result.get("quality", {})

        # Validate: need at least some valid data
        valid_returns = sum(1 for v in returns_dict.values() if v is not None)
        if valid_returns < 5:
            return None, None, None, quality

        return returns_dict, vols_dict, corr_matrix, quality
    except Exception as e:
        logger.debug(f"Signal layer unavailable: {e}")
        return None, None, None, {}


def _sanitize_signal_layer(
    signal_returns: Optional[Dict[str, float]],
    signal_vols: Optional[Dict[str, float]],
    quality: Dict[str, dict],
) -> Tuple[Optional[Dict[str, float]], Optional[Dict[str, float]], Dict[str, str]]:
    """Remove impossible signal values before they reach the CMA blend."""
    if signal_returns is None or signal_vols is None:
        return signal_returns, signal_vols, {}

    cleaned_returns = dict(signal_returns)
    cleaned_vols = dict(signal_vols)
    invalid_assets: Dict[str, str] = {}

    for asset in ASSET_CLASSES:
        ok, reason = _validate_signal_value(
            asset,
            cleaned_returns.get(asset),
            cleaned_vols.get(asset),
            quality.get(asset, {}),
        )
        if not ok:
            cleaned_returns[asset] = None
            cleaned_vols[asset] = None
            invalid_assets[asset] = reason or "invalid_signal"

    return cleaned_returns, cleaned_vols, invalid_assets


def _validate_signal_value(
    asset: str,
    ret: Optional[float],
    vol: Optional[float],
    quality_item: dict,
) -> Tuple[bool, Optional[str]]:
    status = quality_item.get("status")
    if status in {"rejected", "missing"}:
        return False, quality_item.get("reason") or status
    if ret is None or vol is None:
        return False, "missing_signal"
    if not np.isfinite(ret) or not np.isfinite(vol):
        return False, "non_finite_signal"

    group = ASSET_TO_GROUP.get(asset)
    ret_min, ret_max = -80.0, 120.0
    vol_min, vol_max = 5.0, 100.0
    if group == "fixed_income":
        ret_min, ret_max = -30.0, 40.0
        vol_min, vol_max = 0.5, 35.0
    if group == "cash_equiv" or asset in {"money_fund", "cash"}:
        ret_min, ret_max = -2.0, 8.0
        vol_min, vol_max = 0.0, 3.0

    if ret < ret_min or ret > ret_max:
        return False, "return_out_of_bounds"
    if vol < vol_min or vol > vol_max:
        return False, "vol_out_of_bounds"
    return True, None


def _merge_anchor_series(values: Dict[str, Any], fallback: Dict[str, float]) -> Dict[str, float]:
    merged: Dict[str, float] = {}
    for asset in ASSET_CLASSES:
        value = values.get(asset)
        if value is not None and np.isfinite(float(value)):
            merged[asset] = float(value)
        else:
            merged[asset] = float(fallback[asset])
    return merged


def _anchor_corr_matrix(matrix: Any, fallback: np.ndarray) -> np.ndarray:
    try:
        corr = np.asarray(matrix, dtype=np.float64)
        if corr.shape != (len(ASSET_CLASSES), len(ASSET_CLASSES)):
            return fallback
        corr = np.nan_to_num(corr, nan=0.0, posinf=1.0, neginf=-1.0)
        corr = np.clip((corr + corr.T) / 2.0, -1.0, 1.0)
        np.fill_diagonal(corr, 1.0)
        return corr
    except Exception:
        return fallback


def _anchor_source(sources: set) -> str:
    cleaned = {source for source in sources if source}
    if "historical_market_data" in cleaned:
        return "historical_market_data"
    if "sqlite_cache" in cleaned:
        return "sqlite_cache"
    return "static_assumption"


def _merge_invalid_assets(*results: dict) -> Dict[str, str]:
    invalid: Dict[str, str] = {}
    for result in results:
        for asset, reason in (result.get("invalid_assets") or {}).items():
            invalid.setdefault(asset, str(reason))
    return invalid


def _build_cma_quality(
    blend_lambda: float,
    quality: Dict[str, dict],
    invalid_assets: Dict[str, str],
    anchor_quality: Optional[Dict[str, Any]] = None,
) -> dict:
    anchor_quality = anchor_quality or {}
    valid_assets = [
        asset for asset, item in quality.items()
        if item.get("status") == "available" and asset not in invalid_assets
    ]
    assumption_assets = [
        asset for asset, item in quality.items()
        if item.get("status") == "assumption" and asset not in invalid_assets
    ]
    coverage = len(valid_assets) / len(ASSET_CLASSES) if ASSET_CLASSES else 0.0
    status = "real"
    if blend_lambda <= 0:
        status = "assumption"
    elif coverage < 0.7 or invalid_assets or assumption_assets:
        status = "partial"
    if status == "assumption" and anchor_quality.get("source") in {"historical_market_data", "sqlite_cache"}:
        status = "partial"

    merged_invalid = dict(anchor_quality.get("invalid_assets") or {})
    merged_invalid.update(invalid_assets)
    source_prefix = "historical_anchor" if anchor_quality.get("source") != "static_assumption" else "static_anchor"

    return {
        "data_status": status,
        "blend_lambda": round(float(blend_lambda), 4),
        "rolling_coverage": round(float(coverage), 4),
        "valid_assets": valid_assets,
        "invalid_assets": merged_invalid,
        "anchor_assets": [asset for asset in ASSET_CLASSES if asset not in valid_assets],
        "source": f"{source_prefix}_signal_blend" if blend_lambda > 0 else source_prefix,
        "anchor_source": anchor_quality.get("source", "static_assumption"),
        "anchor_as_of": anchor_quality.get("as_of"),
        "anchor_coverage": round(float(anchor_quality.get("coverage") or 0.0), 4),
        "anchor_invalid_assets": anchor_quality.get("invalid_assets") or {},
        "anchor_assumptions_used": anchor_quality.get("assumptions_used") or [],
        "calibration_version": anchor_quality.get("calibration_version"),
    }


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
    anchor_returns, anchor_vols, anchor_corr, anchor_quality = _get_anchor_layer()

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
        quality=_build_cma_quality(blend_lambda, {}, {}, anchor_quality),
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
        return {a: 1.0 for a in ASSET_CLASSES if ASSET_TO_GROUP.get(a) == "equity"}
    elif regime == "overheat":
        return {"gold": 1.5, "commodity": 2.0, "rate_bond": -0.5}
    elif regime == "stagflation":
        adj = {a: -1.5 for a in ASSET_CLASSES if ASSET_TO_GROUP.get(a) == "equity"}
        adj.update({"gold": 2.0, "rate_bond": 1.0})
        return adj
    elif regime == "deflation":
        adj = {a: -2.0 for a in ASSET_CLASSES if ASSET_TO_GROUP.get(a) == "equity"}
        adj.update({"rate_bond": 1.5, "credit_bond": 0.5})
        return adj
    return {}  # baseline — no adjustment
