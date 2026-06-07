"""Fund Data Refresher 鈥?dynamically update fund pool metrics from real NAV data.

Fetches latest ETF NAV from efinance, computes performance metrics (1Y return,
Sharpe ratio, tracking error), and updates FundProfile objects before scoring.
Falls back to static values when data is unavailable.
"""
import logging
import threading
from datetime import datetime, timedelta
from typing import Dict, Optional

import numpy as np
import pandas as pd

from .fund_scorer import FundProfile

logger = logging.getLogger(__name__)

# Cache: code -> (timestamp, metrics_dict)
_cache: Dict[str, tuple] = {}
_cache_lock = threading.Lock()
_CACHE_TTL_SECONDS = 3600 * 4  # 4 hours


def refresh_fund_profile(profile: FundProfile) -> FundProfile:
    """Update a FundProfile with dynamic metrics from real NAV data.

    Returns a new FundProfile with updated return_1y, sharpe_1y, and tracking_error.
    If data fetch fails, returns the original profile unchanged.
    """
    # 0. Try SQLite cache first (survives restarts)
    metrics = _get_sqlite_metrics(profile.code)
    if metrics is not None:
        return _build_updated_profile(profile, metrics)

    # 1. Try in-memory cache
    metrics = _get_cached_metrics(profile.code)
    if metrics is None:
        return profile

    # Save to SQLite for cross-restart persistence
    _save_sqlite_metrics(profile.code, metrics)

    return _build_updated_profile(profile, metrics)


def _build_updated_profile(profile: FundProfile, metrics: dict) -> FundProfile:
    """Construct updated FundProfile from metrics dict."""
    return FundProfile(
        code=profile.code, name=profile.name,
        fund_type=profile.fund_type, asset_class=profile.asset_class,
        company=profile.company,
        management_fee=profile.management_fee, custody_fee=profile.custody_fee,
        aum=metrics.get("aum") or profile.aum,
        daily_turnover=metrics.get("daily_turnover") or profile.daily_turnover,
        tracking_error=metrics.get("tracking_error") or profile.tracking_error,
        return_1y=metrics.get("return_1y", profile.return_1y),
        sharpe_1y=metrics.get("sharpe_1y", profile.sharpe_1y),
        base_quality=profile.base_quality,
    )


def _get_sqlite_metrics(code: str) -> Optional[dict]:
    """Try to load metrics from SQLite cache."""
    try:
        from app.storage.database import FundNAVCache
        ret = FundNAVCache.get(code, "return_1y")
        if ret is None:
            return None
        return {
            "return_1y": ret,
            "sharpe_1y": FundNAVCache.get(code, "sharpe_1y"),
            "tracking_error": FundNAVCache.get(code, "tracking_error"),
            "daily_turnover": FundNAVCache.get(code, "daily_turnover"),
            "data_points": FundNAVCache.get(code, "data_points"),
        }
    except Exception:
        return None


def _save_sqlite_metrics(code: str, metrics: dict) -> None:
    """Save metrics to SQLite cache."""
    try:
        from app.storage.database import FundNAVCache
        FundNAVCache.save(code, metrics)
    except Exception:
    logger.exception("Ignored non-fatal exception")


def refresh_fund_pool(profiles: Dict[str, FundProfile]) -> Dict[str, FundProfile]:
    """Refresh all fund profiles in the pool with dynamic data.

    Returns a new dict with updated profiles.
    """
    result = {}
    for code, profile in profiles.items():
        result[code] = refresh_fund_profile(profile)
    return result


def _get_cached_metrics(code: str) -> Optional[Dict]:
    """Get cached metrics or compute fresh ones."""
    with _cache_lock:
        if code in _cache:
            ts, metrics = _cache[code]
            if (datetime.now() - ts).total_seconds() < _CACHE_TTL_SECONDS:
                return metrics

    # Compute fresh metrics
    metrics = _compute_metrics(code)
    if metrics is not None:
        with _cache_lock:
            _cache[code] = (datetime.now(), metrics)
    return metrics


def _compute_metrics(code: str) -> Optional[Dict]:
    """Compute dynamic metrics for a fund from its NAV history.

    Four-tier fallback: tickflow 鈫?efinance 鈫?tushare 鈫?akshare.
    Returns dict with: return_1y, sharpe_1y, tracking_error, daily_turnover
    """
    nav_data = _fetch_nav_series(code)
    if nav_data is None:
        return None

    prices, turnover_series = nav_data

    if len(prices) < 60:
        return None

    log_returns = np.diff(np.log(prices))
    if len(log_returns) < 20:
        return None

    n_1y = min(252, len(log_returns))
    ret_1y = float(np.sum(log_returns[-n_1y:])) * 100

    rf_daily = 0.02 / 252
    excess = log_returns[-n_1y:] - rf_daily
    mean_excess = float(np.mean(excess))
    std_excess = float(np.std(excess, ddof=1))
    sharpe = (mean_excess / std_excess * np.sqrt(252)) if std_excess > 0 else 0.0

    ann_vol = float(np.std(log_returns[-n_1y:], ddof=1) * np.sqrt(252))

    daily_turnover = None
    if turnover_series is not None and len(turnover_series) > 20:
        daily_turnover = float(turnover_series[-20:].mean()) / 10000

    return {
        "return_1y": round(ret_1y, 2),
        "sharpe_1y": round(float(sharpe), 3),
        "tracking_error": round(float(ann_vol), 4),
        "daily_turnover": daily_turnover,
        "data_points": len(log_returns),
    }


def _fetch_nav_series(code: str) -> Optional[tuple]:
    """Fetch NAV price series. Four-tier fallback: tickflow 鈫?efinance 鈫?tushare 鈫?akshare.

    Returns (prices_array, turnover_array_or_None) or None.
    """
    result = _try_tickflow_series(code)
    if result is not None:
        return result

    result = _try_efinance_series(code)
    if result is not None:
        return result

    result = _try_tushare_series(code)
    if result is not None:
        return result

    return None


def _try_tickflow_series(code: str) -> Optional[tuple]:
    """Fetch via TickFlow (fastest, 1-3s for 500 bars)."""
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
        for col in ["close", "Close", "鏀剁洏"]:
            if col in df.columns:
                close_col = col
                break
        if close_col is None:
            return None
        prices = pd.to_numeric(df[close_col], errors="coerce").dropna().values.astype(np.float64)
        turnover = None
        for col in ["volume", "Volume", "鎴愪氦棰?]:
            if col in df.columns:
                turnover = pd.to_numeric(df[col], errors="coerce").dropna().values
                break
        if len(prices) >= 60:
            return prices, turnover
    except Exception as e:
        logger.debug(f"TickFlow series fetch failed for {code}: {e}")
    return None


def _try_efinance_series(code: str) -> Optional[tuple]:
    """Fetch via efinance (3-8s)."""
    try:
        import efinance as ef
        df = ef.fund.get_quote_history(code)
        if df is None or df.empty:
            return None
        price_col = None
        for col in ["绱鍑€鍊?, "鍗曚綅鍑€鍊?, "鏀剁洏", "close"]:
            if col in df.columns:
                price_col = col
                break
        if price_col is None:
            return None
        prices = pd.to_numeric(df[price_col], errors="coerce").dropna().values.astype(np.float64)
        turnover = None
        for col in ["鎴愪氦棰?, "volume", "Volume"]:
            if col in df.columns:
                turnover = pd.to_numeric(df[col], errors="coerce").dropna().values
                break
        if len(prices) >= 60:
            return prices, turnover
    except Exception as e:
        logger.debug(f"efinance series fetch failed for {code}: {e}")
    return None


def _try_tushare_series(code: str) -> Optional[tuple]:
    """Fetch via Tushare (0.5-2s)."""
    try:
        from ..data.providers.tushare_provider import TushareProvider
        provider = TushareProvider()
        start = (datetime.now() - timedelta(days=400)).strftime("%Y%m%d")
        end = datetime.now().strftime("%Y%m%d")
        ts_code = f"{code}.SH" if code.startswith(("5", "6")) else f"{code}.SZ"
        df = provider.get_fund_nav(ts_code)
        if df is None or df.empty:
            return None
        for col in ["adj_nav", "accum_nav", "unit_nav"]:
            if col in df.columns:
                prices = pd.to_numeric(df[col], errors="coerce").dropna().values[::-1].astype(np.float64)
                if len(prices) >= 60:
                    return prices, None
    except Exception as e:
        logger.debug(f"Tushare series fetch failed for {code}: {e}")
    return None


def clear_cache():
    """Clear the metrics cache. Useful for testing."""
    with _cache_lock:
        _cache.clear()

