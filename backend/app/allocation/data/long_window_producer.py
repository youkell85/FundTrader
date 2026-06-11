"""Cache-only producer for long-window allocation calibration stats.

This module builds a ``long_window_stats`` snapshot from local SQLite ETF price
cache data only. It deliberately avoids live market-data fetchers and is not
wired into runtime refresh yet.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import numpy as np

from app.allocation.config import ASSET_CLASSES, ASSET_INDEX, DEFAULT_CORR
from app.storage.database import ETFPriceCache, StatsSnapshotCache


TRADING_DAYS_PER_YEAR = 252
MIN_COVERAGE = 0.7
MIN_OBSERVATIONS = 252
CASH_ANNUAL_RETURN = 0.02
CASH_ANNUAL_VOL = 0.003
MONEY_FUND_ANNUAL_RETURN = 0.025
MONEY_FUND_ANNUAL_VOL = 0.005

# Duplicated to avoid importing the backtest historical loader, whose module
# contains fetcher functions and optional provider imports.
REPRESENTATIVE_ETFS: dict[str, str | None] = {
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


def build_long_window_stats(as_of_date: str | None = None, years: int = 3) -> dict[str, Any] | None:
    """Build a long-window calibration snapshot from ``ETFPriceCache``.

    Returns ``None`` when fewer than ``MIN_COVERAGE`` assets have usable local
    data. No network or schema-changing operation is performed.
    """
    end = _parse_date(as_of_date) if as_of_date else date.today()
    start = end - timedelta(days=int(max(years, 1) * 365.25))
    start_s = start.isoformat()
    end_s = end.isoformat()

    prices_by_asset: dict[str, dict[str, float]] = {}
    returns_by_asset: dict[str, np.ndarray] = {}
    quality: dict[str, dict[str, Any]] = {}
    valid_assets: list[str] = []
    first_dates: list[str] = []
    last_dates: list[str] = []

    for asset in ASSET_CLASSES:
        code = REPRESENTATIVE_ETFS.get(asset)
        if code is None:
            quality[asset] = {"status": "synthesized", "reason": "no_representative_etf"}
            continue

        raw_prices = _load_cached_prices(code, start_s, end_s)
        if len(raw_prices) < MIN_OBSERVATIONS:
            quality[asset] = {
                "status": "missing",
                "reason": f"insufficient_cache_data:{len(raw_prices)}",
                "source": f"etf_cache:{code}",
            }
            continue

        values = np.asarray(list(raw_prices.values()), dtype=float)
        values = values[np.isfinite(values) & (values > 0)]
        if len(values) < MIN_OBSERVATIONS:
            quality[asset] = {
                "status": "rejected",
                "reason": "invalid_cached_prices",
                "source": f"etf_cache:{code}",
            }
            continue

        log_returns = np.diff(np.log(values))
        if len(log_returns) < MIN_OBSERVATIONS - 1 or not np.all(np.isfinite(log_returns)):
            quality[asset] = {
                "status": "rejected",
                "reason": "invalid_log_returns",
                "source": f"etf_cache:{code}",
            }
            continue

        prices_by_asset[asset] = raw_prices
        returns_by_asset[asset] = log_returns
        valid_assets.append(asset)
        dates = list(raw_prices.keys())
        first_dates.append(dates[0])
        last_dates.append(dates[-1])
        quality[asset] = {
            "status": "available",
            "source": f"etf_cache:{code}",
            "coverage": round(len(values) / max(MIN_OBSERVATIONS, 1), 4),
            "data_points": len(values),
        }

    _add_synthesized_cash_like(returns_by_asset, valid_assets, quality)

    coverage = round(len(valid_assets) / len(ASSET_CLASSES), 4)
    if coverage < MIN_COVERAGE:
        return None

    returns_long = _annualized_returns(returns_by_asset)
    vols_long = _annualized_vols(returns_by_asset)
    corr = _correlation_matrix(returns_by_asset)
    n_observations = max((len(v) for v in returns_by_asset.values()), default=0)
    confidence_score = _confidence_score(quality)
    window_start = min(first_dates) if first_dates else start_s
    window_end = max(last_dates) if last_dates else end_s

    long_window = {
        "returns": returns_long,
        "vols": vols_long,
        "correlation_matrix": corr,
        "window_start": window_start,
        "window_end": window_end,
        "n_observations": n_observations,
        "confidence_score": confidence_score,
    }

    return {
        "returns_long": returns_long,
        "vols_long": vols_long,
        "correlation_matrix": corr,
        "quality": quality,
        "coverage": coverage,
        "long_window": long_window,
        "window_start": window_start,
        "window_end": window_end,
        "n_observations": n_observations,
        "confidence_score": confidence_score,
    }


def persist_long_window_stats(snapshot: dict[str, Any]) -> None:
    """Persist a snapshot under the consumer cache key."""
    StatsSnapshotCache.save("long_window_stats", snapshot)


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _load_cached_prices(code: str, start: str, end: str) -> dict[str, float]:
    raw = ETFPriceCache.get_range(code, start, end)
    if not isinstance(raw, dict):
        return {}
    cleaned: dict[str, float] = {}
    for day in sorted(raw):
        try:
            value = float(raw[day])
        except (TypeError, ValueError):
            continue
        if np.isfinite(value) and value > 0:
            cleaned[str(day)] = value
    return cleaned


def _add_synthesized_cash_like(
    returns_by_asset: dict[str, np.ndarray],
    valid_assets: list[str],
    quality: dict[str, dict[str, Any]],
) -> None:
    obs = max((len(v) for v in returns_by_asset.values()), default=MIN_OBSERVATIONS)
    if "cash" not in returns_by_asset:
        daily_cash = np.full(obs, CASH_ANNUAL_RETURN / TRADING_DAYS_PER_YEAR, dtype=float)
        returns_by_asset["cash"] = daily_cash
        valid_assets.append("cash")
        quality["cash"] = {"status": "synthesized", "reason": "no_representative_etf"}
    if "money_fund" not in returns_by_asset:
        daily_money = np.full(obs, MONEY_FUND_ANNUAL_RETURN / TRADING_DAYS_PER_YEAR, dtype=float)
        returns_by_asset["money_fund"] = daily_money
        valid_assets.append("money_fund")
        quality["money_fund"] = {"status": "synthesized", "reason": "insufficient_or_missing_etf_cache"}


def _annualized_returns(returns_by_asset: dict[str, np.ndarray]) -> dict[str, float]:
    result: dict[str, float] = {}
    for asset in ASSET_CLASSES:
        values = returns_by_asset.get(asset)
        if values is None or len(values) == 0:
            result[asset] = 0.0
        else:
            result[asset] = round(float(np.mean(values) * TRADING_DAYS_PER_YEAR), 6)
    return result


def _annualized_vols(returns_by_asset: dict[str, np.ndarray]) -> dict[str, float]:
    result: dict[str, float] = {}
    for asset in ASSET_CLASSES:
        values = returns_by_asset.get(asset)
        if values is None or len(values) < 2:
            result[asset] = 0.0
        else:
            result[asset] = round(float(np.std(values, ddof=1) * np.sqrt(TRADING_DAYS_PER_YEAR)), 6)
    if result.get("cash") == 0.0:
        result["cash"] = CASH_ANNUAL_VOL
    if result.get("money_fund") == 0.0:
        result["money_fund"] = MONEY_FUND_ANNUAL_VOL
    return result


def _correlation_matrix(returns_by_asset: dict[str, np.ndarray]) -> list[list[float]]:
    corr = np.asarray(DEFAULT_CORR, dtype=float).copy()
    available = [asset for asset in ASSET_CLASSES if asset in returns_by_asset]
    for left in available:
        for right in available:
            i = ASSET_INDEX[left]
            j = ASSET_INDEX[right]
            if i == j:
                corr[i, j] = 1.0
                continue
            x = returns_by_asset[left]
            y = returns_by_asset[right]
            n = min(len(x), len(y))
            if n < 2:
                continue
            value = float(np.corrcoef(x[-n:], y[-n:])[0, 1])
            if np.isfinite(value):
                corr[i, j] = value
    corr = np.nan_to_num(corr, nan=0.0, posinf=1.0, neginf=-1.0)
    corr = (corr + corr.T) / 2
    corr = np.clip(corr, -1.0, 1.0)
    np.fill_diagonal(corr, 1.0)
    return [[round(float(value), 6) for value in row] for row in corr.tolist()]


def _confidence_score(quality: dict[str, dict[str, Any]]) -> float:
    score = 0.0
    for asset in ASSET_CLASSES:
        status = (quality.get(asset) or {}).get("status")
        if status == "available":
            score += 1.0
        elif status == "synthesized":
            score += 0.3
    return round(score / len(ASSET_CLASSES), 4)
