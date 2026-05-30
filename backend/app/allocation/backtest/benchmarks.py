"""Benchmark Portfolios — simulate reference strategies for comparison."""

import logging
from typing import Dict, List

import numpy as np
import pandas as pd

from .models import BacktestCurvePoint

logger = logging.getLogger(__name__)

# Group definitions for 60/40 benchmark
EQUITY_ASSETS = ["a_share_large", "a_share_small", "a_share_value", "a_share_growth", "hk_equity", "us_equity"]
FIXED_INCOME_ASSETS = ["rate_bond", "credit_bond", "convertible"]
ALL_ASSETS = [
    "a_share_large", "a_share_small", "a_share_value", "a_share_growth",
    "hk_equity", "us_equity",
    "rate_bond", "credit_bond", "convertible",
    "money_fund", "gold", "commodity", "reits", "cash",
]


def simulate_equal_weight(
    returns_df: pd.DataFrame,
    rebalance_dates: List[pd.Timestamp],
    initial_amount: float,
) -> List[BacktestCurvePoint]:
    """Simulate equal-weight portfolio across all available assets.

    Equal allocation to all assets in returns_df, rebalanced at given dates.
    """
    available = [a for a in ALL_ASSETS if a in returns_df.columns]
    if not available:
        return []

    n_assets = len(available)
    weights = {a: 1.0 / n_assets for a in available}

    return _simulate_fixed_strategy(returns_df, rebalance_dates, initial_amount, weights)


def simulate_sixty_forty(
    returns_df: pd.DataFrame,
    rebalance_dates: List[pd.Timestamp],
    initial_amount: float,
) -> List[BacktestCurvePoint]:
    """Simulate classic 60% equity / 40% fixed income portfolio.

    60% distributed equally among available equity assets.
    40% distributed equally among available fixed income assets.
    """
    available_equity = [a for a in EQUITY_ASSETS if a in returns_df.columns]
    available_fi = [a for a in FIXED_INCOME_ASSETS if a in returns_df.columns]

    if not available_equity and not available_fi:
        return []

    weights: Dict[str, float] = {}

    # Distribute 60% among equity
    if available_equity:
        eq_weight = 0.6 / len(available_equity)
        for a in available_equity:
            weights[a] = eq_weight
    else:
        # No equity, put all in FI
        pass

    # Distribute 40% among fixed income
    if available_fi:
        fi_weight = 0.4 / len(available_fi)
        for a in available_fi:
            weights[a] = fi_weight
    else:
        # No FI, reallocate to cash/money_fund if available
        if "money_fund" in returns_df.columns:
            weights["money_fund"] = 0.4
        elif "cash" in returns_df.columns:
            weights["cash"] = 0.4

    # Normalize to 1.0
    total = sum(weights.values())
    if total > 0:
        weights = {k: v / total for k, v in weights.items()}

    return _simulate_fixed_strategy(returns_df, rebalance_dates, initial_amount, weights)


def _simulate_fixed_strategy(
    returns_df: pd.DataFrame,
    rebalance_dates: List[pd.Timestamp],
    initial_amount: float,
    target_weights: Dict[str, float],
) -> List[BacktestCurvePoint]:
    """Simulate a fixed-weight strategy with periodic rebalancing.

    Between rebalance dates, weights drift based on actual returns.
    """
    dates = returns_df.index.tolist()
    if not dates:
        return []

    # Initialize portfolio
    portfolio_value = initial_amount
    # Current dollar amounts per asset
    holdings: Dict[str, float] = {
        a: initial_amount * w for a, w in target_weights.items()
    }

    curve: List[BacktestCurvePoint] = []
    peak_value = initial_amount
    rebalance_set = set(rebalance_dates)

    for i, date in enumerate(dates):
        if i == 0:
            curve.append(BacktestCurvePoint(
                date=date.strftime("%Y-%m-%d"),
                value=round(portfolio_value, 2),
                cumulative_return=0.0,
                drawdown=0.0,
            ))
            continue

        # Apply daily returns to holdings
        for asset, amount in holdings.items():
            if asset in returns_df.columns:
                daily_ret = returns_df.iloc[i][asset]
                if not np.isnan(daily_ret):
                    holdings[asset] = amount * (1 + daily_ret)

        # Update portfolio value
        portfolio_value = sum(holdings.values())
        peak_value = max(peak_value, portfolio_value)

        # Rebalance if this is a rebalance date
        if date in rebalance_set:
            holdings = {a: portfolio_value * w for a, w in target_weights.items()}

        # Compute metrics
        cum_return = (portfolio_value / initial_amount - 1) * 100
        drawdown = (portfolio_value / peak_value - 1) * 100

        curve.append(BacktestCurvePoint(
            date=date.strftime("%Y-%m-%d"),
            value=round(portfolio_value, 2),
            cumulative_return=round(cum_return, 3),
            drawdown=round(drawdown, 3),
        ))

    return curve
