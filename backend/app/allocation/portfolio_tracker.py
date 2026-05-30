"""Portfolio Tracker — compute realized performance of a saved allocation plan.

Given a plan's weights and fund codes, fetches actual ETF NAV data and computes:
- Daily weighted portfolio returns
- Cumulative return curve
- Drawdown history
- Performance metrics (annualized return, Sharpe, max drawdown, etc.)
"""
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ETF codes for each asset class (same as historical_data.REPRESENTATIVE_ETFS)
ASSET_ETFS = {
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
    "reits": "508000",
    "cash": None,
}


def compute_portfolio_performance(
    weights: Dict[str, float],
    start_date: str,
    end_date: Optional[str] = None,
    initial_capital: float = 1_000_000,
) -> Optional[Dict[str, Any]]:
    """Compute realized portfolio performance from actual ETF data.

    Args:
        weights: {asset_class: weight} mapping (weights sum to ~1.0)
        start_date: Start date YYYY-MM-DD
        end_date: End date YYYY-MM-DD (defaults to today)
        initial_capital: Starting capital

    Returns:
        Dict with:
        - curve: list of {date, value, cum_return, drawdown}
        - metrics: {ann_return, ann_vol, sharpe, max_dd, calmar, total_return}
        - asset_contributions: {asset_class: contribution_to_return}
    """
    if end_date is None:
        end_date = datetime.now().strftime("%Y-%m-%d")

    # Load ETF prices for all weighted asset classes
    from .backtest.historical_data import load_etf_history

    try:
        prices_df, quality = load_etf_history(start_date, end_date)
    except Exception as e:
        logger.error(f"Failed to load ETF history: {e}")
        return None

    if prices_df is None or len(prices_df) < 10:
        logger.warning("Insufficient price data for performance tracking")
        return None

    # Compute daily returns
    returns_df = prices_df.pct_change().fillna(0.0)

    # Build portfolio weight vector aligned to DataFrame columns
    w = np.zeros(len(returns_df.columns))
    for i, col in enumerate(returns_df.columns):
        w[i] = weights.get(col, 0.0)

    # Normalize weights to sum to 1
    w_sum = w.sum()
    if w_sum > 0:
        w = w / w_sum

    # Daily portfolio returns (weighted)
    port_returns = returns_df.values @ w

    # Cumulative returns
    cum_returns = np.cumprod(1 + port_returns) - 1
    cum_values = initial_capital * (1 + cum_returns)

    # Running maximum for drawdown
    running_max = np.maximum.accumulate(cum_values)
    drawdowns = (cum_values - running_max) / running_max

    # Build curve data
    dates = returns_df.index
    curve = []
    for i in range(len(dates)):
        curve.append({
            "date": dates[i].strftime("%Y-%m-%d"),
            "value": round(float(cum_values[i]), 2),
            "cum_return": round(float(cum_returns[i] * 100), 2),
            "drawdown": round(float(drawdowns[i] * 100), 2),
        })

    # Performance metrics
    n_days = len(port_returns)
    n_years = n_days / 252

    total_return = float(cum_returns[-1])
    ann_return = float((1 + total_return) ** (1 / n_years) - 1) if n_years > 0 else 0
    ann_vol = float(np.std(port_returns, ddof=1) * np.sqrt(252))
    sharpe = float((ann_return - 0.02) / ann_vol) if ann_vol > 0 else 0
    max_dd = float(np.min(drawdowns))
    calmar = float(ann_return / abs(max_dd)) if max_dd != 0 else 0

    # Sortino ratio
    neg_returns = port_returns[port_returns < 0]
    downside_vol = float(np.std(neg_returns, ddof=1) * np.sqrt(252)) if len(neg_returns) > 0 else ann_vol
    sortino = float((ann_return - 0.02) / downside_vol) if downside_vol > 0 else 0

    # Win rate
    win_rate = float(np.sum(port_returns > 0) / n_days * 100)

    metrics = {
        "total_return": round(total_return * 100, 2),
        "annualized_return": round(ann_return * 100, 2),
        "annualized_vol": round(ann_vol * 100, 2),
        "sharpe_ratio": round(sharpe, 3),
        "sortino_ratio": round(sortino, 3),
        "max_drawdown": round(max_dd * 100, 2),
        "calmar_ratio": round(calmar, 3),
        "win_rate": round(win_rate, 1),
        "trading_days": n_days,
        "start_date": dates[0].strftime("%Y-%m-%d"),
        "end_date": dates[-1].strftime("%Y-%m-%d"),
    }

    # Asset contribution analysis
    asset_contributions = {}
    for i, col in enumerate(returns_df.columns):
        if w[i] > 0.001:
            asset_ret = float(np.sum(returns_df[col].values) * w[i] * 100)
            asset_contributions[col] = round(asset_ret, 2)

    return {
        "curve": curve,
        "metrics": metrics,
        "asset_contributions": asset_contributions,
        "weights_used": {col: round(float(w[i]), 4) for i, col in enumerate(returns_df.columns) if w[i] > 0.001},
    }


def extract_weights_from_plan(response: Dict[str, Any]) -> Dict[str, float]:
    """Extract asset class weights from a saved plan response.

    Handles different response formats (SAA, TAA, etc.)
    """
    weights = {}

    # Try TAA weights first (post-adjustment)
    if "taa_weights" in response:
        taa = response["taa_weights"]
        if isinstance(taa, dict):
            for asset, w in taa.items():
                if isinstance(w, (int, float)):
                    weights[asset] = float(w)

    # Fall back to SAA weights
    if not weights and "saa_weights" in response:
        saa = response["saa_weights"]
        if isinstance(saa, dict):
            for asset, w in saa.items():
                if isinstance(w, (int, float)):
                    weights[asset] = float(w)

    # Try direct "weights" key
    if not weights and "weights" in response:
        w = response["weights"]
        if isinstance(w, dict):
            for asset, val in w.items():
                if isinstance(val, (int, float)):
                    weights[asset] = float(val)

    # Try "allocation" key
    if not weights and "allocation" in response:
        alloc = response["allocation"]
        if isinstance(alloc, list):
            for item in alloc:
                if isinstance(item, dict) and "asset_class" in item and "weight" in item:
                    weights[item["asset_class"]] = float(item["weight"])

    return weights
