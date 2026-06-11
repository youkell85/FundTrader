"""Market Data Fetcher — compute rolling statistics for 14 asset classes.

Uses representative ETF NAV data from efinance/tushare/akshare to compute:
- Annualized returns (%) — multi-window (60d, 120d, 252d)
- Annualized volatilities (%)
- 14x14 correlation matrix (EWMA-weighted for recency bias)
- 14x14 covariance matrix (from EWMA correlation + realized vol)
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .models import RollingAssetStats

logger = logging.getLogger(__name__)

# Representative ETF for each asset class
REPRESENTATIVE_ETFS: Dict[str, str] = {
    "a_share_large": "510300",
    "a_share_small": "512100",
    "a_share_value": "515180",
    "a_share_growth": "159915",
    "hk_equity": "513050",
    "us_equity": "513500",
    "rate_bond": "511010",
    "credit_bond": "511030",
    "convertible": "511380",
    "money_fund": "511880",
    "gold": "518880",
    "commodity": "161815",
    "reits": "508088",
    "cash": None,  # Static, no ETF
}

# Asset class order (must match config.ASSET_CLASSES)
ASSET_ORDER = [
    "a_share_large", "a_share_small", "a_share_value", "a_share_growth",
    "hk_equity", "us_equity",
    "rate_bond", "credit_bond", "convertible",
    "money_fund",
    "gold", "commodity", "reits",
    "cash",
]

# Minimum days of data required
MIN_DAYS = 120

# Multiple rolling windows for multi-horizon analysis
ROLLING_WINDOWS = {
    "short": 60,     # ~3 months: tactical signals
    "medium": 120,   # ~6 months: intermediate trend
    "long": 252,     # ~1 year: structural CMA signal
}

# EWMA half-life for covariance estimation (days)
EWMA_HALFLIFE = 60  # ~3 months: recent data gets ~50% weight


def compute_rolling_stats() -> Optional[Tuple[Dict[str, float], Dict[str, float], List[List[float]]]]:
    """Compute rolling statistics for all 14 asset classes.

    Returns:
        Tuple of (returns_dict, vols_dict, correlation_matrix) or None if insufficient data.
        - returns_dict: {asset_class: annualized_return_%}  (252d window)
        - vols_dict: {asset_class: annualized_vol_%}  (252d window)
        - correlation_matrix: 14x14 EWMA-weighted correlation list
    """
    result = compute_rolling_stats_ex()
    if result is None:
        return None
    # Return the long-window stats for backward compatibility
    return result["returns_long"], result["vols_long"], result["correlation_matrix"]


def compute_rolling_stats_ex() -> Optional[Dict]:
    """Extended rolling statistics with multi-window and EWMA covariance.

    Returns dict with:
        - returns_short/medium/long: {asset: ann_return_%}
        - vols_short/medium/long: {asset: ann_vol_%}
        - correlation_matrix: 14x14 EWMA correlation
        - covariance_matrix: 14x14 EWMA covariance
        - vol_regime: {asset: current_vol / long_term_vol}  (>1 = elevated)
    """
    # Fetch NAV data for all ETFs
    returns_matrix = {}  # asset_class → np.array of daily log returns

    quality = {}

    for asset_class in ASSET_ORDER:
        etf_code = REPRESENTATIVE_ETFS.get(asset_class)
        if etf_code is None:
            returns_matrix[asset_class] = None
            quality[asset_class] = {
                "status": "assumption",
                "source": "static",
                "reason": "no_representative_etf",
            }
            continue

        nav_series = _fetch_etf_nav(etf_code)
        is_valid, reason = _validate_price_series(asset_class, etf_code, nav_series)
        if is_valid:
            log_returns = np.diff(np.log(nav_series))
            returns_matrix[asset_class] = log_returns
            quality[asset_class] = {
                "status": "available",
                "source": f"representative_etf:{etf_code}",
                "reason": None,
            }
        else:
            logger.warning(f"Rejected NAV data for {asset_class} (ETF: {etf_code}): {reason}")
            returns_matrix[asset_class] = None
            quality[asset_class] = {
                "status": "rejected",
                "source": f"representative_etf:{etf_code}",
                "reason": reason,
            }

    # Count valid assets
    valid_count = sum(1 for v in returns_matrix.values() if v is not None)
    if valid_count < 5:
        logger.warning(f"Only {valid_count} assets have valid data, insufficient for CMA Signal layer")
        return None

    # Multi-window statistics
    result = {}
    for window_name, window_days in ROLLING_WINDOWS.items():
        returns_dict = {}
        vols_dict = {}
        for asset_class in ASSET_ORDER:
            rets = returns_matrix.get(asset_class)
            if rets is not None and len(rets) > 0:
                w = min(window_days, len(rets))
                rets_window = rets[-w:]
                ann_return = float(np.mean(rets_window) * 252 * 100)
                ann_vol = float(np.std(rets_window, ddof=1) * np.sqrt(252) * 100)
                returns_dict[asset_class] = round(ann_return, 2)
                vols_dict[asset_class] = round(ann_vol, 2)
            else:
                returns_dict[asset_class] = None
                vols_dict[asset_class] = None
        result[f"returns_{window_name}"] = returns_dict
        result[f"vols_{window_name}"] = vols_dict

    # EWMA correlation + covariance matrix
    ewma_corr, ewma_cov = _compute_ewma_correlation(returns_matrix)
    result["correlation_matrix"] = ewma_corr
    result["covariance_matrix"] = ewma_cov

    # Vol regime indicator (current 20d vol / 252d vol)
    vol_regime = {}
    for asset_class in ASSET_ORDER:
        rets = returns_matrix.get(asset_class)
        if rets is not None and len(rets) >= 252:
            vol_20d = float(np.std(rets[-20:], ddof=1) * np.sqrt(252))
            vol_252d = float(np.std(rets[-252:], ddof=1) * np.sqrt(252))
            vol_regime[asset_class] = round(vol_20d / vol_252d, 3) if vol_252d > 0 else 1.0
        else:
            vol_regime[asset_class] = 1.0
    result["vol_regime"] = vol_regime
    result["quality"] = quality

    return result


def _validate_price_series(
    asset_class: str,
    code: str,
    prices: Optional[np.ndarray],
) -> Tuple[bool, str | None]:
    """Reject impossible ETF price series before they contaminate CMA inputs."""
    if prices is None or len(prices) < MIN_DAYS:
        return False, "insufficient_points"
    arr = np.asarray(prices, dtype=np.float64)
    if not np.all(np.isfinite(arr)) or np.any(arr <= 0):
        return False, "non_positive_or_non_finite_price"
    log_returns = np.diff(np.log(arr))
    if len(log_returns) == 0 or not np.all(np.isfinite(log_returns)):
        return False, "non_finite_return"
    if float(np.nanmax(np.abs(log_returns))) > 0.25:
        return False, "abnormal_price_jump"
    if asset_class in {"money_fund", "cash"} and len(log_returns) >= 60:
        if float(np.nanstd(log_returns[-60:])) > 0.02:
            return False, "money_fund_vol_too_high"
    return True, None


def _compute_ewma_correlation(
    returns_matrix: Dict[str, Optional[np.ndarray]],
) -> Tuple[List[List[float]], List[List[float]]]:
    """Compute EWMA-weighted 14x14 correlation and covariance matrices.

    EWMA gives more weight to recent observations, making the correlation
    structure more responsive to regime changes than simple Pearson.

    Returns:
        (correlation_matrix, covariance_matrix) as 14x14 lists of lists
    """
    n = len(ASSET_ORDER)
    span = EWMA_HALFLIFE * 2  # EWMA span ≈ 2 * half-life

    # Collect valid series and indices
    valid_series = []
    valid_indices = []
    valid_vols = []  # annualized vol for covariance
    for i, asset_class in enumerate(ASSET_ORDER):
        rets = returns_matrix.get(asset_class)
        if rets is not None and len(rets) >= MIN_DAYS:
            valid_series.append(rets)
            valid_indices.append(i)
            valid_vols.append(float(np.std(rets[-252:], ddof=1) * np.sqrt(252)))

    # Start with identity (correlation) / diagonal (covariance)
    corr = np.eye(n)
    cov = np.eye(n) * 0.01  # Default small variance for missing assets

    if len(valid_series) >= 2:
        # Align to minimum common length
        min_len = min(len(s) for s in valid_series)
        min_len = max(min_len, MIN_DAYS)
        aligned = np.array([s[-min_len:] for s in valid_series])  # shape: (n_valid, T)

        # Compute EWMA covariance
        T = aligned.shape[1]
        ewma_weights = np.zeros(T)
        for t in range(T):
            ewma_weights[t] = (1 - 1 / span) ** (T - 1 - t)
        ewma_weights /= ewma_weights.sum()  # Normalize

        # Weighted mean
        ewma_mean = np.sum(aligned * ewma_weights[np.newaxis, :], axis=1)

        # Weighted covariance
        centered = aligned - ewma_mean[:, np.newaxis]
        ewma_cov_sub = np.zeros((len(valid_series), len(valid_series)))
        for t in range(T):
            ewma_cov_sub += ewma_weights[t] * np.outer(centered[:, t], centered[:, t])

        # Convert to correlation
        diag = np.sqrt(np.diag(ewma_cov_sub))
        diag[diag == 0] = 1e-10  # Avoid division by zero
        ewma_corr_sub = ewma_cov_sub / np.outer(diag, diag)
        ewma_corr_sub = np.clip(ewma_corr_sub, -1, 1)
        np.fill_diagonal(ewma_corr_sub, 1.0)

        # Handle NaN
        ewma_corr_sub = np.nan_to_num(ewma_corr_sub, nan=0.0)

        # Place into full matrices
        for i_sub, i_full in enumerate(valid_indices):
            for j_sub, j_full in enumerate(valid_indices):
                corr[i_full][j_full] = float(ewma_corr_sub[i_sub][j_sub])

        # Build full covariance matrix from EWMA corr + realized vols
        vols_full = np.array([0.10] * n)  # Default 10% vol for missing
        for idx, vi in enumerate(valid_indices):
            vols_full[vi] = valid_vols[idx]
        cov = np.outer(vols_full, vols_full) * corr

    return corr.tolist(), cov.tolist()


def _fetch_etf_nav(code: str) -> Optional[np.ndarray]:
    """Fetch ETF NAV/price history. Four-tier fallback: tickflow → efinance → tushare → akshare.

    Returns array of closing prices (oldest to newest).
    """
    prices = _try_tickflow_nav(code)
    if prices is not None and len(prices) >= MIN_DAYS:
        return prices

    prices = _try_efinance_nav(code)
    if prices is not None and len(prices) >= MIN_DAYS:
        return prices

    prices = _try_tushare_nav(code)
    if prices is not None and len(prices) >= MIN_DAYS:
        return prices

    prices = _try_akshare_nav(code)
    if prices is not None and len(prices) >= MIN_DAYS:
        return prices

    return None


def _try_tickflow_nav(code: str) -> Optional[np.ndarray]:
    """Fetch ETF data via TickFlow (fastest, 1-3 seconds for 500 bars)."""
    try:
        from tickflow import TickFlow
        import os
        api_key = os.environ.get("TICKFLOW_API_KEY")
        if not api_key:
            return None
        tf = TickFlow(api_key=api_key)
        suffix = ".SH" if code.startswith(("5", "6")) else ".SZ"
        symbol = code + suffix
        df = tf.klines.get(symbol, period="1d", count=500, as_dataframe=True)
        if df is None or df.empty:
            return None
        close_col = None
        for col in ["close", "Close", "收盘"]:
            if col in df.columns:
                close_col = col
                break
        if close_col is None and len(df.columns) >= 5:
            close_col = df.columns[4]
        if close_col is None:
            return None
        vals = pd.to_numeric(df[close_col], errors="coerce").dropna()
        if len(vals) >= MIN_DAYS:
            return vals.values.astype(np.float64)
    except Exception as e:
        logger.debug(f"TickFlow NAV fetch failed for {code}: {e}")
    return None


def _try_efinance_nav(code: str) -> Optional[np.ndarray]:
    """Fetch ETF data via efinance fund module (no klt param)."""
    try:
        import efinance as ef
        # NOTE: fund API does NOT support klt (that's stock-only)
        df = ef.fund.get_quote_history(code)
        if df is None or df.empty:
            return None
        # efinance fund history columns: 日期, 单位净值, 累计净值, 涨跌幅
        for col in ["累计净值", "单位净值", "收盘"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna()
                if len(vals) >= MIN_DAYS:
                    return vals.values.astype(np.float64)
    except Exception as e:
        logger.debug(f"efinance NAV fetch failed for {code}: {e}")
    return None


def _try_tushare_nav(code: str) -> Optional[np.ndarray]:
    """Fetch ETF data via tushare."""
    try:
        from ...data.providers.tushare_provider import TushareProvider
        provider = TushareProvider()
        start = (datetime.now() - timedelta(days=400)).strftime("%Y%m%d")
        end = datetime.now().strftime("%Y%m%d")
        ts_code = f"{code}.SH" if code.startswith(("5", "6")) else f"{code}.SZ"
        df = provider.get_fund_nav(ts_code)
        if df is not None and not df.empty:
            for col in ["adj_nav", "accum_nav", "unit_nav"]:
                if col in df.columns:
                    vals = pd.to_numeric(df[col], errors="coerce").dropna()
                    if len(vals) >= MIN_DAYS:
                        return vals.values[::-1].astype(np.float64)
    except Exception as e:
        logger.debug(f"tushare NAV fetch failed for {code}: {e}")
    return None


def _try_akshare_nav(code: str) -> Optional[np.ndarray]:
    """Fetch ETF data via akshare (fund_etf_hist_em)."""
    try:
        import akshare as ak
        df = ak.fund_etf_hist_em(
            symbol=code,
            period="daily",
            start_date="20100101",
            end_date=datetime.now().strftime("%Y%m%d"),
            adjust="qfq",
        )
        if df is None or df.empty:
            return None
        # Detect close price column
        close_col = None
        for col in ["收盘", "close", "Close"]:
            if col in df.columns:
                close_col = col
                break
        if close_col is None and len(df.columns) >= 5:
            close_col = df.columns[4]
        elif close_col is None:
            close_col = df.columns[2]

        vals = pd.to_numeric(df[close_col], errors="coerce").dropna()
        if len(vals) >= MIN_DAYS:
            return vals.values.astype(np.float64)
    except Exception as e:
        logger.debug(f"akshare NAV fetch failed for {code}: {e}")
    return None
