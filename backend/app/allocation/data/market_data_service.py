"""Market Data Service — singleton cache layer for all allocation data.

API requests NEVER trigger network calls. They read pre-computed cached values.
Background refresh populates the cache periodically.
"""
import logging
import threading
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from .models import MacroSnapshot, VolatilitySnapshot

logger = logging.getLogger(__name__)


class MarketDataService:
    """Central data service for allocation engine.

    All public get_* methods read from internal cache — instant, no I/O.
    The refresh() method triggers background data pull.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._macro_snapshot: Optional[MacroSnapshot] = None
        self._rolling_stats: Optional[Tuple[Dict[str, float], Dict[str, float], List[List[float]]]] = None
        self._rolling_stats_ex: Optional[Dict] = None  # Extended multi-window stats
        self._vol_snapshot: Optional[VolatilitySnapshot] = None
        self._ic_decay_cache: Optional[Dict] = None  # IC decay per signal category
        self._last_refresh: Optional[str] = None

    def refresh(self) -> None:
        """Refresh all data from external sources. Called by background task.

        Each sub-fetch is independent — failure in one doesn't affect others.
        """
        logger.info("MarketDataService: Starting data refresh...")

        # 1. Macro indicators
        try:
            from . import macro_fetcher
            snapshot = macro_fetcher.fetch_all()
            with self._lock:
                self._macro_snapshot = snapshot
            # Save to SQLite for persistence across restarts
            self._save_macro_to_db(snapshot)
            valid_count = sum(1 for ind in snapshot.indicators.values() if ind.value is not None)
            logger.info(f"  Macro: {valid_count}/13 indicators fetched (confidence={snapshot.overall_confidence:.2f})")
        except Exception as e:
            logger.error(f"  Macro fetch failed: {e}")
            # Try loading from SQLite cache
            self._load_macro_from_db()

        # 2. Rolling ETF statistics (basic + extended multi-window)
        try:
            from . import market_data_fetcher
            result_ex = market_data_fetcher.compute_rolling_stats_ex()
            if result_ex is not None:
                with self._lock:
                    self._rolling_stats_ex = result_ex
                    # Also populate basic stats for backward compatibility
                    self._rolling_stats = (
                        result_ex["returns_long"],
                        result_ex["vols_long"],
                        result_ex["correlation_matrix"],
                    )
                valid_count = sum(1 for v in result_ex["returns_long"].values() if v is not None)
                logger.info(f"  Rolling stats: {valid_count}/14 assets (multi-window + EWMA)")
            else:
                # Fallback to basic computation
                result = market_data_fetcher.compute_rolling_stats()
                if result is not None:
                    with self._lock:
                        self._rolling_stats = result
                    returns_dict, vols_dict, _ = result
                    valid_count = sum(1 for v in returns_dict.values() if v is not None)
                    logger.info(f"  Rolling stats: {valid_count}/14 assets computed")
                else:
                    logger.warning("  Rolling stats: insufficient data, keeping previous cache")
        except Exception as e:
            logger.error(f"  Rolling stats computation failed: {e}")

        # 3. Volatility snapshot
        try:
            from . import volatility_monitor
            vol = volatility_monitor.compute_vol_snapshot()
            if vol is not None:
                with self._lock:
                    self._vol_snapshot = vol
                logger.info(f"  Volatility: ratio={vol.vol_ratio:.3f} (20d={vol.current_vol_20d:.4f}, 252d={vol.long_term_vol_252d:.4f})")
            else:
                logger.warning("  Volatility: insufficient data, keeping previous cache")
        except Exception as e:
            logger.error(f"  Volatility computation failed: {e}")

        # 4. IC decay analysis (per signal category)
        try:
            self._compute_ic_decay()
        except Exception as e:
            logger.debug(f"  IC decay computation failed: {e}")

        self._last_refresh = datetime.now().isoformat()
        logger.info(f"MarketDataService: Refresh complete at {self._last_refresh}")

        # Save stats snapshots to SQLite for cross-restart persistence
        self._save_stats_to_db()

    # ─── Public Read Methods (instant, from cache) ─────────────────────────────

    def get_macro_snapshot(self) -> Optional[MacroSnapshot]:
        """Get cached macro indicators. Returns None if never refreshed."""
        with self._lock:
            return self._macro_snapshot

    def get_rolling_stats(self) -> Optional[Tuple[Dict[str, float], Dict[str, float], List[List[float]]]]:
        """Get cached rolling statistics (252d window, backward compatible).

        Returns:
            (returns_dict, vols_dict, correlation_matrix) or None
            - returns_dict: {asset_class: annualized_return_% or None}
            - vols_dict: {asset_class: annualized_vol_% or None}
            - correlation_matrix: 14x14 EWMA-weighted list
        """
        with self._lock:
            return self._rolling_stats

    def get_rolling_stats_ex(self) -> Optional[Dict]:
        """Get extended multi-window rolling statistics with EWMA covariance.

        Returns dict with keys:
            returns_short/medium/long, vols_short/medium/long,
            correlation_matrix, covariance_matrix, vol_regime
        """
        with self._lock:
            return self._rolling_stats_ex

    def get_vol_ratio(self) -> Optional[float]:
        """Get cached vol_ratio for circuit breaker. Returns None if unavailable."""
        with self._lock:
            if self._vol_snapshot is not None:
                return self._vol_snapshot.vol_ratio
            return None

    def get_ic_decay(self) -> Optional[Dict]:
        """Get cached IC decay analysis per signal category.

        Returns:
            {category: {"quality": float, "half_life": str, "ic_mean": float}}
            or None if not yet computed.
        """
        with self._lock:
            return self._ic_decay_cache

    def _compute_ic_decay(self) -> None:
        """Compute IC decay for each signal category using cached data.

        Requires both macro snapshot (signal values) and rolling stats (returns).
        Silently skips if either is unavailable.
        """
        import numpy as np
        from . import ic_decay

        macro = self.get_macro_snapshot()
        stats_ex = self.get_rolling_stats_ex()
        if macro is None or stats_ex is None:
            return

        # Map signal categories to macro indicator names
        category_signals = {
            "growth": ["PMI制造业", "GDP同比"],
            "inflation": ["CPI同比", "PPI同比"],
            "interest": ["10Y国债收益率", "DR007"],
            "credit_money": ["社融增速", "M2增速"],
            "liquidity": ["融资余额变化", "北向资金净流入"],
            "policy": ["财政赤字率"],
            "overseas": ["美联储利率", "美元指数"],
        }

        # Get returns for equity as proxy (a_share_large)
        returns_short = stats_ex.get("returns_short", {})
        proxy_asset = "a_share_large"
        proxy_returns = returns_short.get(proxy_asset)
        if proxy_returns is None:
            return

        returns_arr = np.array(proxy_returns, dtype=np.float64)
        if len(returns_arr) < 60:
            return

        result = {}
        for cat_key, indicator_names in category_signals.items():
            # Average signal values across indicators in this category
            signal_values = []
            for name in indicator_names:
                ind = macro.indicators.get(name)
                if ind and ind.value is not None:
                    signal_values.append(ind.value)

            if not signal_values:
                continue

            # Use average signal as a scalar — compute a simplified IC proxy
            # Since we only have one signal snapshot (not a time series),
            # we estimate quality from signal confidence instead
            avg_confidence = macro.overall_confidence
            avg_signal = np.mean(signal_values)

            result[cat_key] = {
                "quality": round(avg_confidence, 4),
                "half_life": "6m",  # Default estimate
                "ic_mean": round(float(avg_signal) * avg_confidence * 0.1, 4),
            }

        if result:
            with self._lock:
                self._ic_decay_cache = result
            logger.debug(f"  IC decay: computed for {len(result)} categories")

    def get_status(self) -> dict:
        """Get service status for diagnostics."""
        with self._lock:
            rolling_quality = self._summarize_rolling_quality_locked()
            health = "healthy"
            if self._macro_snapshot is None or self._rolling_stats is None or self._vol_snapshot is None:
                health = "degraded"
            if not rolling_quality["rolling_stats_available"]:
                health = "critical" if self._rolling_stats is None else "degraded"
            elif rolling_quality["invalid_assets"] or rolling_quality["rolling_coverage"] < 0.7:
                health = "degraded"
            return {
                "last_refresh": self._last_refresh,
                "macro_available": self._macro_snapshot is not None,
                "macro_confidence": self._macro_snapshot.overall_confidence if self._macro_snapshot else 0,
                "rolling_stats_available": self._rolling_stats is not None,
                "vol_ratio": self._vol_snapshot.vol_ratio if self._vol_snapshot else None,
                "health": health,
                **rolling_quality,
            }

    def _summarize_rolling_quality_locked(self) -> dict:
        quality = {}
        if self._rolling_stats_ex:
            quality = self._rolling_stats_ex.get("quality", {}) or {}

        invalid_assets = {
            asset: item.get("reason") or item.get("status") or "invalid"
            for asset, item in quality.items()
            if item.get("status") == "rejected"
        }
        assumption_assets = [
            asset for asset, item in quality.items()
            if item.get("status") == "assumption"
        ]
        valid_assets = [
            asset for asset, item in quality.items()
            if item.get("status") == "available"
        ]
        total_assets = len(quality) or 0
        rolling_coverage = (len(valid_assets) / total_assets) if total_assets else 0.0

        return {
            "rolling_stats_available": self._rolling_stats is not None,
            "rolling_coverage": round(rolling_coverage, 4),
            "valid_assets": valid_assets,
            "invalid_assets": invalid_assets,
            "assumptions_used": [
                f"{asset}:no_representative_etf" for asset in assumption_assets
            ],
        }

    def _save_macro_to_db(self, snapshot) -> None:
        """Persist macro indicators to SQLite for cross-restart survival."""
        try:
            from app.storage.database import MacroCache
            today = datetime.now().strftime("%Y-%m")
            rows = []
            for name, ind in snapshot.indicators.items():
                if ind.value is not None:
                    rows.append((name, ind.value, today, ind.source if hasattr(ind, 'source') else "api"))
            if rows:
                MacroCache.save_batch(rows)
                logger.debug(f"Saved {len(rows)} macro indicators to SQLite")
        except Exception as e:
            logger.debug(f"Failed to save macro to SQLite: {e}")

    def _load_macro_from_db(self) -> None:
        """Load macro indicators from SQLite cache (used when API fetch fails)."""
        try:
            from app.storage.database import MacroCache
            cached = MacroCache.get_all()
            if cached:
                from .models import MacroIndicator, MacroSnapshot
                indicators = {}
                for name, value in cached.items():
                    indicators[name] = MacroIndicator(
                        name=name, value=value, source="sqlite_cache",
                        confidence=0.7, fetch_time=datetime.now().isoformat(),
                    )
                snapshot = MacroSnapshot(
                    indicators=indicators,
                    overall_confidence=0.7,
                )
                with self._lock:
                    self._macro_snapshot = snapshot
                    self._last_refresh = datetime.now().isoformat()
                logger.info(f"Loaded {len(cached)} macro indicators from SQLite cache")
        except Exception as e:
            logger.debug(f"Failed to load macro from SQLite: {e}")

    def _load_stats_from_db(self) -> None:
        """Load rolling statistics and volatility from SQLite cache."""
        try:
            from app.storage.database import StatsSnapshotCache

            cached_vol = StatsSnapshotCache.get("volatility")
            cached_stats = StatsSnapshotCache.get("rolling_stats")

            with self._lock:
                if cached_vol:
                    self._vol_snapshot = VolatilitySnapshot(
                        current_vol_20d=float(cached_vol["current_vol_20d"]),
                        long_term_vol_252d=float(cached_vol["long_term_vol_252d"]),
                        vol_ratio=float(cached_vol["vol_ratio"]),
                        as_of_date=str(cached_vol.get("as_of_date") or ""),
                    )
                if cached_stats:
                    returns = cached_stats.get("returns") or {}
                    vols = cached_stats.get("vols") or {}
                    corr = cached_stats.get("correlation_matrix") or []
                    self._rolling_stats = (returns, vols, corr)

                    stats_ex = cached_stats.get("stats_ex")
                    if stats_ex:
                        self._rolling_stats_ex = stats_ex
                    elif cached_stats.get("quality"):
                        self._rolling_stats_ex = {"quality": cached_stats["quality"]}

                if cached_vol or cached_stats:
                    self._last_refresh = datetime.now().isoformat()

            logger.info(
                "Loaded stats from SQLite cache: rolling=%s, volatility=%s",
                bool(cached_stats),
                bool(cached_vol),
            )
        except Exception as e:
            logger.debug(f"Failed to load stats from SQLite: {e}")

    def _save_stats_to_db(self) -> None:
        """Save rolling stats and vol snapshot to SQLite."""
        try:
            from app.storage.database import StatsSnapshotCache
            if self._vol_snapshot:
                StatsSnapshotCache.save("volatility", {
                    "vol_ratio": self._vol_snapshot.vol_ratio,
                    "current_vol_20d": self._vol_snapshot.current_vol_20d,
                    "long_term_vol_252d": self._vol_snapshot.long_term_vol_252d,
                    "as_of_date": self._vol_snapshot.as_of_date,
                })
            if self._rolling_stats:
                rets, vols, corr = self._rolling_stats
                StatsSnapshotCache.save("rolling_stats", {
                    "returns": rets,
                    "vols": vols,
                    "correlation_matrix": corr,
                    "quality": (self._rolling_stats_ex or {}).get("quality", {}),
                    "stats_ex": self._rolling_stats_ex,
                })
        except Exception as e:
            logger.debug(f"Failed to save stats to SQLite: {e}")


# Module-level singleton
market_data_service = MarketDataService()
