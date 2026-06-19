"""Factor calibrator for latest-window OLS factor loading estimates.

The module preserves a simple ``calibrate()`` entrypoint for consumers while
storing richer metadata for auditability, cache persistence, and static
fallback handling.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd

from .config import ASSET_CLASSES, FACTOR_LOADINGS

logger = logging.getLogger(__name__)

FACTOR_PROXIES = {
    "equity_beta": {"asset_class": "a_share_large", "code": "000300"},
    "term_premium": {"asset_class": "rate_bond", "code": "511260"},
    "credit_premium": {"asset_class": "credit_bond", "code": "credit_spread"},
    "inflation": {"asset_class": "commodity", "code": "NHCI"},
    "liquidity": {"asset_class": "money_fund", "code": "511880"},
}

CALIBRATION_VERSION = "factor-calibration-v1"
WINDOW_DAYS = 252
MIN_PROXY_COUNT = 3
MIN_OBSERVATIONS = 120
MIN_R_SQUARED = 0.05
_CACHE_TTL = 3600 * 24
_SNAPSHOT_KEY = "factor_calibration"
_LEGACY_LOADINGS_KEY = "factor_loadings"

_cache_bundle: Optional[dict] = None
_cache_ts: Optional[datetime] = None
_ENABLE_LIVE_CALIBRATION = os.environ.get(
    "FUNDTRADER_ENABLE_LIVE_FACTOR_CALIBRATION", ""
).lower() in {"1", "true", "yes"}


def calibrate() -> Dict[str, Dict[str, float]]:
    """Return only factor loadings for backward-compatible consumers."""
    return get_calibration_bundle().get("loadings", _fallback_loadings())


def get_calibration_bundle(force_refresh: bool = False) -> dict:
    """Return calibrated loadings plus asset-level metadata."""
    global _cache_bundle, _cache_ts

    now = datetime.now()
    if (
        not force_refresh
        and _cache_bundle is not None
        and _cache_ts is not None
        and (now - _cache_ts).total_seconds() < _CACHE_TTL
    ):
        return _cache_bundle

    cached = _load_from_db()
    if cached is not None and not force_refresh:
        _cache_bundle = cached
        _cache_ts = now
        return cached

    if _ENABLE_LIVE_CALIBRATION:
        try:
            bundle = _run_calibration()
            _cache_bundle = bundle
            _cache_ts = now
            _save_to_db(bundle)
            return bundle
        except Exception as exc:
            logger.warning("Factor calibration failed, attempting cached bundle: %s", exc)

        cached = _load_from_db()
        if cached is not None:
            _cache_bundle = cached
            _cache_ts = now
            return cached

    reason = "live_calibration_disabled" if not _ENABLE_LIVE_CALIBRATION else "calibration_unavailable"
    bundle = _fallback_bundle(source="static_assumption", reason=reason)
    _cache_bundle = bundle
    _cache_ts = now
    return bundle


def clear_cache() -> None:
    """Clear in-memory cache; useful before background refresh or tests."""
    global _cache_bundle, _cache_ts
    _cache_bundle = None
    _cache_ts = None


def _run_calibration() -> dict:
    proxy_bundle = _fetch_factor_proxy_series()
    loadings: Dict[str, Dict[str, float]] = {}
    metadata: Dict[str, dict] = {}
    valid_assets: list[str] = []
    invalid_assets: Dict[str, str] = {}
    assumptions_used: list[str] = []

    for asset in ASSET_CLASSES:
        loadings[asset], metadata[asset] = _calibrate_asset(asset, proxy_bundle)
        source = metadata[asset]["source"]
        if source == "latest_window_regression":
            valid_assets.append(asset)
        else:
            invalid_assets[asset] = metadata[asset].get("assumption_reason") or source
            assumptions_used.append(f"{asset}:{invalid_assets[asset]}")

    overall_source = "historical_market_data" if valid_assets else "static_assumption"
    return {
        "loadings": loadings,
        "metadata": metadata,
        "summary": {
            "source": overall_source,
            "as_of": datetime.now().date().isoformat(),
            "coverage": round(len(valid_assets) / len(ASSET_CLASSES), 4) if ASSET_CLASSES else 0.0,
            "valid_assets": valid_assets,
            "invalid_assets": invalid_assets,
            "assumptions_used": sorted(set(assumptions_used)),
            "calibration_version": CALIBRATION_VERSION,
        },
    }


def _calibrate_asset(asset: str, proxy_bundle: dict) -> Tuple[Dict[str, float], dict]:
    from .data import market_data_fetcher

    as_of = datetime.now().date().isoformat()
    static_loadings = _static_loadings_for(asset)
    representative_code = market_data_fetcher.REPRESENTATIVE_ETFS.get(asset)

    base_metadata = {
        "source": "static_expert_estimate",
        "n_obs": 0,
        "r_squared": None,
        "window_start": None,
        "window_end": None,
        "proxy_sources": {
            factor: details.get("source")
            for factor, details in proxy_bundle.items()
            if details.get("source")
        },
        "invalid_proxies": sorted(
            [factor for factor, details in proxy_bundle.items() if details.get("invalid_reason")]
        ),
        "as_of": as_of,
    }

    if representative_code is None:
        base_metadata["assumption_reason"] = "no_representative_etf"
        return static_loadings, base_metadata

    asset_prices = market_data_fetcher._fetch_etf_nav(representative_code)
    is_valid, invalid_reason = market_data_fetcher._validate_price_series(asset, representative_code, asset_prices)
    if not is_valid:
        base_metadata["assumption_reason"] = invalid_reason or "invalid_asset_price_series"
        return static_loadings, base_metadata

    valid_proxies = {
        factor: details
        for factor, details in proxy_bundle.items()
        if details.get("returns") is not None
    }
    if len(valid_proxies) < MIN_PROXY_COUNT:
        proxy_reasons = [
            details.get("invalid_reason")
            for details in proxy_bundle.values()
            if details.get("invalid_reason")
        ]
        if "insufficient_observations" in proxy_reasons:
            base_metadata["assumption_reason"] = "insufficient_observations"
        else:
            base_metadata["assumption_reason"] = "insufficient_valid_proxies"
        return static_loadings, base_metadata

    asset_returns = np.diff(np.log(np.asarray(asset_prices, dtype=np.float64)))
    regression = _regress_latest_window(asset_returns, valid_proxies)
    if regression is None:
        base_metadata["n_obs"] = min(len(asset_returns), WINDOW_DAYS)
        base_metadata["assumption_reason"] = "insufficient_observations"
        return static_loadings, base_metadata

    loadings, n_obs, r_squared = regression
    window_start, window_end = _window_bounds(n_obs)
    if r_squared < MIN_R_SQUARED:
        base_metadata.update(
            {
                "n_obs": n_obs,
                "r_squared": round(r_squared, 4),
                "window_start": window_start,
                "window_end": window_end,
                "assumption_reason": "low_r_squared",
            }
        )
        return static_loadings, base_metadata

    return loadings, {
        **base_metadata,
        "source": "latest_window_regression",
        "n_obs": n_obs,
        "r_squared": round(r_squared, 4),
        "window_start": window_start,
        "window_end": window_end,
        "assumption_reason": None,
    }


def _fetch_factor_proxy_series() -> dict:
    bundle: dict = {}

    equity_prices = _fetch_equity_proxy_prices()
    bundle["equity_beta"] = _build_proxy_series(
        factor="equity_beta",
        asset_class=FACTOR_PROXIES["equity_beta"]["asset_class"],
        code=FACTOR_PROXIES["equity_beta"]["code"],
        prices=equity_prices,
        source="index:000300",
    )

    from .data import market_data_fetcher

    bundle["term_premium"] = _build_proxy_series(
        factor="term_premium",
        asset_class=FACTOR_PROXIES["term_premium"]["asset_class"],
        code=FACTOR_PROXIES["term_premium"]["code"],
        prices=market_data_fetcher._fetch_etf_nav("511260"),
        source="etf:511260",
    )

    bundle["credit_premium"] = _build_credit_spread_proxy()
    bundle["inflation"] = _build_inflation_proxy()
    bundle["liquidity"] = _build_proxy_series(
        factor="liquidity",
        asset_class=FACTOR_PROXIES["liquidity"]["asset_class"],
        code=FACTOR_PROXIES["liquidity"]["code"],
        prices=market_data_fetcher._fetch_etf_nav("511880"),
        source="etf:511880",
    )
    return bundle


def _build_credit_spread_proxy() -> dict:
    from .data import market_data_fetcher

    credit = _build_proxy_series(
        factor="credit_premium_credit_leg",
        asset_class="credit_bond",
        code="511030",
        prices=market_data_fetcher._fetch_etf_nav("511030"),
        source="etf:511030",
    )
    rate = _build_proxy_series(
        factor="credit_premium_rate_leg",
        asset_class="rate_bond",
        code="511010",
        prices=market_data_fetcher._fetch_etf_nav("511010"),
        source="etf:511010",
    )
    if credit.get("returns") is None or rate.get("returns") is None:
        invalid_reason = credit.get("invalid_reason") or rate.get("invalid_reason") or "invalid_credit_spread_proxy"
        return {
            "returns": None,
            "source": None,
            "invalid_reason": invalid_reason,
        }

    n_obs = min(len(credit["returns"]), len(rate["returns"]))
    if n_obs < MIN_OBSERVATIONS:
        return {
            "returns": None,
            "source": None,
            "invalid_reason": "insufficient_observations",
        }

    return {
        "returns": credit["returns"][-n_obs:] - rate["returns"][-n_obs:],
        "source": "spread:511030-511010",
        "invalid_reason": None,
    }


def _build_inflation_proxy() -> dict:
    prices, source = _fetch_inflation_proxy_prices()
    return _build_proxy_series(
        factor="inflation",
        asset_class="commodity",
        code="NHCI",
        prices=prices,
        source=source,
    )


def _build_proxy_series(
    *,
    factor: str,
    asset_class: str,
    code: str,
    prices: Optional[np.ndarray],
    source: Optional[str],
) -> dict:
    from .data import market_data_fetcher

    is_valid, invalid_reason = market_data_fetcher._validate_price_series(asset_class, code, prices)
    if not is_valid:
        return {
            "returns": None,
            "source": None,
            "invalid_reason": invalid_reason or f"{factor}_invalid_price_series",
        }

    series = np.asarray(prices, dtype=np.float64)
    returns = np.diff(np.log(series))
    if len(returns) < MIN_OBSERVATIONS or not np.all(np.isfinite(returns)):
        return {
            "returns": None,
            "source": None,
            "invalid_reason": "insufficient_observations",
        }
    return {"returns": returns, "source": source, "invalid_reason": None}


def _fetch_equity_proxy_prices() -> Optional[np.ndarray]:
    try:
        from .volatility_monitor import _fetch_csi300_prices

        return _fetch_csi300_prices(days=WINDOW_DAYS + 80)
    except Exception as exc:
        logger.debug("equity_beta proxy fetch failed: %s", exc)
        return None


def _fetch_inflation_proxy_prices() -> Tuple[Optional[np.ndarray], Optional[str]]:
    try:
        import akshare as ak

        start = pd.Timestamp.today().floor("D") - pd.Timedelta(days=480)
        df = ak.index_nhci_daily(
            symbol="NHCI",
            start_date=start.strftime("%Y%m%d"),
            end_date=pd.Timestamp.today().strftime("%Y%m%d"),
        )
        if df is not None and not df.empty:
            for column in ("close", "Close", "收盘"):
                if column in df.columns:
                    values = pd.to_numeric(df[column], errors="coerce").dropna().to_numpy(dtype=np.float64)
                    if len(values) >= MIN_OBSERVATIONS:
                        return values, "index:NHCI"
    except Exception as exc:
        logger.debug("inflation index fetch failed: %s", exc)

    try:
        from .data import market_data_fetcher

        prices = market_data_fetcher._fetch_etf_nav("161815")
        return prices, "etf:161815"
    except Exception as exc:
        logger.debug("inflation fallback ETF fetch failed: %s", exc)
        return None, None


def _regress_latest_window(asset_returns: np.ndarray, proxy_bundle: dict) -> Optional[Tuple[Dict[str, float], int, float]]:
    factor_names = sorted(proxy_bundle.keys())
    min_len = min(len(asset_returns), *(len(proxy_bundle[name]["returns"]) for name in factor_names))
    window = min(WINDOW_DAYS, min_len)
    if window < MIN_OBSERVATIONS:
        return None

    y = asset_returns[-window:]
    X = np.column_stack([proxy_bundle[name]["returns"][-window:] for name in factor_names])
    X_with_const = np.column_stack([np.ones(window), X])

    coeffs, _, _, _ = np.linalg.lstsq(X_with_const, y, rcond=None)
    fitted = X_with_const @ coeffs
    residual = y - fitted
    ss_res = float(np.sum(np.square(residual)))
    ss_tot = float(np.sum(np.square(y - y.mean())))
    r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    if not np.all(np.isfinite(coeffs)) or not np.isfinite(r_squared):
        return None

    return (
        {
            factor_name: round(float(np.clip(coeffs[index + 1], -3.0, 3.0)), 4)
            for index, factor_name in enumerate(factor_names)
        },
        window,
        max(0.0, min(1.0, float(r_squared))),
    )


def _fallback_bundle(*, source: str, reason: str) -> dict:
    as_of = datetime.now().date().isoformat()
    loadings = _fallback_loadings()
    metadata = {
        asset: {
            "source": "static_expert_estimate",
            "n_obs": 0,
            "r_squared": None,
            "window_start": None,
            "window_end": None,
            "proxy_sources": {},
            "invalid_proxies": [],
            "as_of": as_of,
            "assumption_reason": reason,
        }
        for asset in ASSET_CLASSES
    }
    return {
        "loadings": loadings,
        "metadata": metadata,
        "summary": {
            "source": source,
            "as_of": as_of,
            "coverage": 0.0,
            "valid_assets": [],
            "invalid_assets": {asset: reason for asset in ASSET_CLASSES},
            "assumptions_used": [f"{asset}:{reason}" for asset in ASSET_CLASSES],
            "calibration_version": CALIBRATION_VERSION,
        },
    }


def _save_to_db(bundle: dict) -> None:
    try:
        from app.storage.database import StatsSnapshotCache

        StatsSnapshotCache.save(_SNAPSHOT_KEY, bundle)
        StatsSnapshotCache.save(_LEGACY_LOADINGS_KEY, bundle.get("loadings", {}))
    except Exception as exc:
        logger.debug("Failed to save factor calibration bundle to DB: %s", exc)


def _load_from_db() -> Optional[dict]:
    try:
        from app.storage.database import StatsSnapshotCache

        bundle = StatsSnapshotCache.get(_SNAPSHOT_KEY)
        if isinstance(bundle, dict) and bundle.get("loadings") and bundle.get("summary"):
            summary = dict(bundle.get("summary") or {})
            summary["source"] = "sqlite_cache"
            summary.setdefault("calibration_version", CALIBRATION_VERSION)
            bundle["summary"] = summary
            return bundle

        legacy = StatsSnapshotCache.get(_LEGACY_LOADINGS_KEY)
        if isinstance(legacy, dict) and legacy:
            as_of = datetime.now().date().isoformat()
            return {
                "loadings": legacy,
                "metadata": {
                    asset: {
                        "source": "static_expert_estimate",
                        "n_obs": 0,
                        "r_squared": None,
                        "window_start": None,
                        "window_end": None,
                        "proxy_sources": {},
                        "invalid_proxies": [],
                        "as_of": as_of,
                        "assumption_reason": "legacy_sqlite_cache",
                    }
                    for asset in ASSET_CLASSES
                },
                "summary": {
                    "source": "sqlite_cache",
                    "as_of": as_of,
                    "coverage": 0.0,
                    "valid_assets": [],
                    "invalid_assets": {asset: "legacy_sqlite_cache" for asset in ASSET_CLASSES},
                    "assumptions_used": [f"{asset}:legacy_sqlite_cache" for asset in ASSET_CLASSES],
                    "calibration_version": CALIBRATION_VERSION,
                },
            }
    except Exception as exc:
        logger.debug("Failed to load factor calibration bundle from DB: %s", exc)
    return None


def _fallback_loadings() -> Dict[str, Dict[str, float]]:
    return {asset: dict(FACTOR_LOADINGS.get(asset, {})) for asset in ASSET_CLASSES}


def _static_loadings_for(asset: str) -> Dict[str, float]:
    loadings = FACTOR_LOADINGS.get(asset)
    if loadings is None:
        return {factor: 0.0 for factor in FACTOR_PROXIES}
    return dict(loadings)


def _window_bounds(n_obs: int) -> Tuple[str, str]:
    end = pd.Timestamp.today().floor("D")
    dates = pd.bdate_range(end=end, periods=max(n_obs, 1) + 1)
    return dates[0].date().isoformat(), dates[-1].date().isoformat()
