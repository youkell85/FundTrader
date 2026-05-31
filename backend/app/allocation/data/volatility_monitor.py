"""Volatility Monitor — compute vol_ratio for circuit breaker.

Uses CSI300 index data to calculate 20-day vs 252-day realized volatility ratio.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

import numpy as np

from .models import VolatilitySnapshot

logger = logging.getLogger(__name__)


def compute_vol_snapshot() -> Optional[VolatilitySnapshot]:
    """Compute volatility snapshot from CSI300 index.

    Returns None if data is insufficient.
    """
    prices = _fetch_csi300_prices(days=300)
    if prices is None or len(prices) < 60:
        logger.warning("Insufficient CSI300 data for vol computation")
        return None

    # Compute daily log returns
    returns = np.diff(np.log(prices))

    if len(returns) < 252:
        # Use all available data for long-term, but need at least 20 for short-term
        if len(returns) < 20:
            return None
        vol_20d = float(np.std(returns[-20:], ddof=1) * np.sqrt(252))
        vol_252d = float(np.std(returns, ddof=1) * np.sqrt(252))
    else:
        vol_20d = float(np.std(returns[-20:], ddof=1) * np.sqrt(252))
        vol_252d = float(np.std(returns[-252:], ddof=1) * np.sqrt(252))

    if vol_252d < 0.001:
        # Avoid division by zero
        return None

    vol_ratio = vol_20d / vol_252d

    return VolatilitySnapshot(
        current_vol_20d=round(vol_20d, 4),
        long_term_vol_252d=round(vol_252d, 4),
        vol_ratio=round(vol_ratio, 3),
        as_of_date=datetime.now().strftime("%Y-%m-%d"),
    )


def _fetch_csi300_prices(days: int = 300) -> Optional[np.ndarray]:
    """Fetch CSI300 closing prices for the last N calendar days.

    Tries multiple sources with fallback.
    """
    prices = _try_efinance_index(days)
    if prices is not None and len(prices) >= 20:
        return prices

    prices = _try_akshare_index(days)
    if prices is not None and len(prices) >= 20:
        return prices

    prices = _try_tushare_index(days)
    if prices is not None and len(prices) >= 20:
        return prices

    return None


def _try_efinance_index(days: int) -> Optional[np.ndarray]:
    """Fetch via efinance."""
    try:
        import efinance as ef
        df = ef.stock.get_quote_history("000300", klt=101)
        if df is None or df.empty:
            return None
        # efinance returns columns like '收盘' or 'close'
        for col in ["收盘", "close", "Close"]:
            if col in df.columns:
                vals = df[col].dropna().values[-days:]
                arr = np.array(vals, dtype=np.float64)
                if len(arr) >= 20:
                    return arr
    except Exception as e:
        logger.debug(f"efinance CSI300 fetch failed: {e}")
    return None


def _try_akshare_index(days: int) -> Optional[np.ndarray]:
    """Fetch via akshare."""
    try:
        import akshare as ak
        import pandas as pd
        start = (datetime.now() - timedelta(days=days + 30)).strftime("%Y%m%d")
        df = ak.stock_zh_index_daily(symbol="sh000300")
        if df is None or df.empty:
            return None
        for col in ["close", "收盘"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna().values[-days:]
                arr = np.array(vals, dtype=np.float64)
                if len(arr) >= 20:
                    return arr
    except Exception as e:
        logger.debug(f"akshare CSI300 fetch failed: {e}")
    return None


def _try_tushare_index(days: int) -> Optional[np.ndarray]:
    """Fetch via tushare."""
    try:
        import pandas as pd
        from ...data.providers.tushare_provider import TushareProvider
        provider = TushareProvider()
        start = (datetime.now() - timedelta(days=days + 30)).strftime("%Y%m%d")
        end = datetime.now().strftime("%Y%m%d")
        df = provider.get_index_daily("000300.SH", start, end)
        if df is None or df.empty:
            return None
        for col in ["close", "收盘"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna().values
                arr = np.array(vals, dtype=np.float64)
                if len(arr) >= 20:
                    return arr
    except Exception as e:
        logger.debug(f"tushare CSI300 fetch failed: {e}")
    return None
