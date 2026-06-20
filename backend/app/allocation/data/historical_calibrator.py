"""Historical calibration facade for allocation assumptions.

The calibrator prefers cached market snapshots produced by MarketDataService.
When coverage is insufficient it returns config.py assumptions with explicit
``static_assumption`` provenance instead of presenting them as real data.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List

import numpy as np
import logging

logger = logging.getLogger(__name__)

from ..config import (
    ASSET_CLASSES,
    DEFAULT_CORR,
    EQUILIBRIUM_RETURNS,
    EQUILIBRIUM_VOLS,
    GROUP_MAP,
    STRESS_SCENARIOS,
)

from ..config import DMS_PRIOR_RETURNS, DMS_PRIOR_VOLS


CALIBRATION_VERSION = "historical-calibrator-v1"
MIN_COVERAGE = 0.7


@dataclass
class CalibrationResult:
    source: str
    as_of: str
    coverage: float
    valid_assets: List[str]
    invalid_assets: Dict[str, str]
    assumptions_used: List[str]
    calibration_version: str = CALIBRATION_VERSION
    data_status: str = "assumption"
    values: Dict[str, float] | None = None
    matrix: List[List[float]] | None = None
    params: Dict[str, Any] | None = None
    window_start: str | None = None
    window_end: str | None = None
    n_observations: int | None = None
    confidence_score: float | None = None

    def to_dict(self) -> dict:
        data = {
            "source": self.source,
            "as_of": self.as_of,
            "coverage": self.coverage,
            "valid_assets": self.valid_assets,
            "invalid_assets": self.invalid_assets,
            "assumptions_used": self.assumptions_used,
            "calibration_version": self.calibration_version,
            "data_status": self.data_status,
        }
        if self.values is not None:
            data["values"] = self.values
        if self.matrix is not None:
            data["matrix"] = self.matrix
        if self.params is not None:
            data["params"] = self.params
        if self.window_start is not None:
            data["window_start"] = self.window_start
        if self.window_end is not None:
            data["window_end"] = self.window_end
        if self.n_observations is not None:
            data["n_observations"] = self.n_observations
        if self.confidence_score is not None:
            data["confidence_score"] = self.confidence_score
        return data


class HistoricalCalibrator:
    """Calibrate core allocation assumptions with auditable fallback metadata."""

    def __init__(self, stats_snapshot: dict | None = None):
        self._stats_snapshot = stats_snapshot
        self._stats_source = "static_assumption"
        self._long_window_meta: dict = {}

    def calibrate_all(self, persist: bool = False) -> dict:
        result = {
            "equilibrium_returns": self.calibrate_equilibrium_returns(),
            "equilibrium_vols": self.calibrate_equilibrium_vols(),
            "correlation_matrix": self.calibrate_correlation_matrix(),
            "jump_params": self.calibrate_jump_params(),
            "stress_scenarios": self.calibrate_stress_scenarios(),
            "scenario_analysis": self.calibrate_scenario_analysis(),
        }
        for key, value in self._p2_defaults().items():
            result.setdefault(key, value)
        if persist:
            try:
                from app.storage.database import StatsSnapshotCache

                StatsSnapshotCache.save("historical_calibration", result)
            except Exception:
                logger.warning("calibrate_all persist failed", exc_info=True)
        return result

    def _p2_defaults(self) -> dict:
        """P2 parameter defaults for cache seeding.

        When historical_calibration is persisted, these sections ensure
        calibration audit sees explicit provenance instead of silently missing
        calibration slots.
        """
        try:
            from ..regime_detector import RegimeThresholds
            from dataclasses import fields as dc_fields
            from ..config import GROUP_MAP

            rt_defaults = {f.name: getattr(RegimeThresholds, f.name) for f in dc_fields(RegimeThresholds)}
            cash_assets = GROUP_MAP.get("cash_equiv", ["money_fund", "cash"])
            stats = self._load_stats() or {}
            long_window = _extract_long_window(stats)
            vols = long_window.get("vols") or stats.get("vols_long") or stats.get("vols") or {}
            quality = stats.get("quality") or {}
            dest_weights, dest_meta = _calibrate_circuit_breaker_destination(vols, quality, cash_assets)
            regime_thresholds = _calibrate_regime_thresholds(rt_defaults)

            return {
                "regime_thresholds": regime_thresholds,
                "circuit_breaker_destination": {
                    "params": dest_weights,
                    "source": dest_meta["source"],
                    "status": dest_meta["status"],
                    "data_status": dest_meta["status"],
                    "as_of": _today(),
                    "coverage": dest_meta["coverage"],
                    "valid_assets": dest_meta["valid_assets"],
                    "invalid_assets": dest_meta["invalid_assets"],
                    "assumptions_used": dest_meta["assumptions_used"],
                    "calibration_version": CALIBRATION_VERSION,
                },
                "risk_questionnaire": {
                    **_not_calibrated_params(
                        "risk_questionnaire",
                        {"weights": None, "shift_down_threshold": -0.5, "shift_up_threshold": 1.5},
                        "insufficient_behavior_response_history",
                    )
                }
            }
        except Exception:
            logger.warning("_p2_defaults failed", exc_info=True)
            return {}

    def calibrate_equilibrium_returns(self) -> dict:
        stats = self._load_stats()
        long_window = _extract_long_window(stats)
        values = long_window.get("returns") or (stats or {}).get("returns_long") or {}
        if not values:
            values = (stats or {}).get("returns") or {}
        values = _apply_bayesian_shrinkage(values, DMS_PRIOR_RETURNS, stats)
        self._long_window_meta = _extract_long_window_meta(long_window, "returns")
        return self._series_result(
            values,
            EQUILIBRIUM_RETURNS,
            "equilibrium_returns",
            _assumptions_from_quality((stats or {}).get("quality") or {}),
            (stats or {}).get("quality") or {},
        )

    def calibrate_equilibrium_vols(self) -> dict:
        stats = self._load_stats()
        long_window = _extract_long_window(stats)
        values = long_window.get("vols") or (stats or {}).get("vols_long") or {}
        if not values:
            values = (stats or {}).get("vols") or {}
        values = _apply_bayesian_shrinkage(values, DMS_PRIOR_VOLS, stats)
        self._long_window_meta = _extract_long_window_meta(long_window, "vols")
        return self._series_result(
            values,
            EQUILIBRIUM_VOLS,
            "equilibrium_vols",
            _assumptions_from_quality((stats or {}).get("quality") or {}),
            (stats or {}).get("quality") or {},
        )

    def calibrate_correlation_matrix(self) -> dict:
        stats = self._load_stats()
        long_window = _extract_long_window(stats)
        matrix = long_window.get("correlation_matrix")
        if not _is_valid_corr_matrix(matrix):
            matrix = (stats or {}).get("correlation_matrix")
        self._long_window_meta = _extract_long_window_meta(long_window, "correlation")
        if _is_valid_corr_matrix(matrix):
            quality = (stats or {}).get("quality") or {}
            valid_assets = _quality_assets(quality, "available")
            invalid_assets = _invalid_assets_from_quality(quality)
            coverage = round(len(valid_assets) / len(ASSET_CLASSES), 4)
            if coverage >= MIN_COVERAGE:
                return self._build_matrix_result(
                    source=self._stats_source,
                    coverage=coverage,
                    valid_assets=valid_assets,
                    invalid_assets=invalid_assets,
                    assumptions_used=_assumptions_from_quality(quality),
                    matrix=_sanitize_corr_matrix(matrix),
                )

        return self._build_matrix_result(
            source="static_assumption",
            coverage=0.0,
            valid_assets=[],
            invalid_assets={asset: "insufficient_historical_correlation" for asset in ASSET_CLASSES},
            assumptions_used=[f"{asset}:insufficient_historical_correlation" for asset in ASSET_CLASSES],
            matrix=_sanitize_corr_matrix(DEFAULT_CORR),
        )

    def _build_matrix_result(self, **kwargs) -> dict:
        meta = self._long_window_meta if self._long_window_meta else {}
        return CalibrationResult(
            as_of=_today(),
            **kwargs,
            data_status=_calibration_data_status(
                kwargs.get("source", "static_assumption"),
                float(kwargs.get("coverage", 0.0)),
                kwargs.get("invalid_assets", {}),
                kwargs.get("assumptions_used", []),
            ),
            window_start=meta.get("window_start"),
            window_end=meta.get("window_end"),
            n_observations=meta.get("n_observations"),
            confidence_score=meta.get("confidence_score"),
        ).to_dict()

    def _load_stats(self) -> dict | None:
        if self._stats_snapshot:
            self._stats_source = (
                "long_window_snapshot"
                if _extract_long_window(self._stats_snapshot)
                else "historical_market_data"
            )
            return self._stats_snapshot

        long_window_stats = _load_long_window_cache()
        if long_window_stats:
            self._stats_source = "long_window_cache"
            return long_window_stats

        try:
            from . import market_data_fetcher

            live = market_data_fetcher.compute_rolling_stats_ex()
            if isinstance(live, dict):
                self._stats_source = "historical_market_data"
                return live
        except Exception:
            logger.debug("_load_stats: live fetch failed", exc_info=True)

        cached = _load_rolling_stats()
        if cached:
            self._stats_source = "sqlite_cache"
            return cached

        self._stats_source = "static_assumption"
        return None

    def calibrate_jump_params(self) -> dict:
        """Calibrate jump diffusion params from historical tail data when available.

        Uses persisted daily return tail statistics from the long-window snapshot
        to estimate jump probability, mean, and vol. Falls back to static defaults
        when no tail statistics are available.
        """
        stats = self._load_stats()
        long_window = _extract_long_window(stats)
        self._long_window_meta = _extract_long_window_meta(long_window, "jump_tail")
        static_params = {
            "jump_probability": 0.03,
            "jump_mean": -0.04,
            "jump_vol": 0.08,
        }
        if not _has_jump_tail_stats(stats):
            long_window_stats = _load_long_window_cache()
            if _has_jump_tail_stats(long_window_stats):
                stats = long_window_stats
                self._stats_source = "long_window_cache"
                long_window = _extract_long_window(stats)
                self._long_window_meta = _extract_long_window_meta(long_window, "jump_tail")
        calibrated_params = _extract_jump_params_from_stats(stats, static_params)
        source = self._stats_source if calibrated_params.get("sample_size") else "static_assumption"
        coverage = 0.0 if source == "static_assumption" else min(
            1.0,
            round(len(calibrated_params.get("source_assets") or []) / len(ASSET_CLASSES), 4),
        )
        data_status = "assumption" if source == "static_assumption" else "partial"
        return CalibrationResult(
            source=source,
            as_of=_today(),
            coverage=coverage,
            valid_assets=["jump_params"] if source != "static_assumption" else [],
            invalid_assets={"jump_params": source} if source == "static_assumption" else {},
            assumptions_used=["jump_params:static_defaults"] if source == "static_assumption" else [],
            data_status=data_status,
            params=calibrated_params,
            window_start=(self._long_window_meta or {}).get("window_start"),
            window_end=(self._long_window_meta or {}).get("window_end"),
            n_observations=(self._long_window_meta or {}).get("n_observations"),
            confidence_score=(self._long_window_meta or {}).get("confidence_score"),
        ).to_dict()

    def calibrate_stress_scenarios(self) -> dict:
        """Calibrate stress scenarios with historical severity scaling when available.

        Base scenarios come from STRESS_SCENARIOS config. When long-window data is
        available, each scenario is scaled by the ratio of current vol to long-term vol,
        making stress tests reflect actual market conditions rather than pure static
        assumptions.
        """
        stats = self._load_stats()
        base_scenarios = dict(STRESS_SCENARIOS)
        # Scale stress scenarios by current vs long-term vol ratio
        scaled_scenarios = _scale_stress_scenarios_from_stats(stats, base_scenarios)
        source = self._stats_source if scaled_scenarios != base_scenarios else "static_assumption"
        coverage = 0.0 if source == "static_assumption" else 0.5
        data_status = "assumption" if source == "static_assumption" else "partial"
        return CalibrationResult(
            source=source,
            as_of=_today(),
            coverage=coverage,
            valid_assets=["stress_scenarios"] if source != "static_assumption" else [],
            invalid_assets={"stress_scenarios": source} if source == "static_assumption" else {},
            assumptions_used=["stress_scenarios:static_defaults"] if source == "static_assumption" else [],
            data_status=data_status,
            params=scaled_scenarios,
            window_start=(self._long_window_meta or {}).get("window_start"),
            window_end=(self._long_window_meta or {}).get("window_end"),
            n_observations=(self._long_window_meta or {}).get("n_observations"),
            confidence_score=(self._long_window_meta or {}).get("confidence_score"),
        ).to_dict()

    def calibrate_scenario_analysis(self) -> dict:
        """Calibrate scenario probabilities and multipliers from long-window data."""
        stats = self._load_stats()
        long_window = _extract_long_window(stats)
        returns = _apply_bayesian_shrinkage(
            long_window.get("returns") or (stats or {}).get("returns_long") or (stats or {}).get("returns") or {},
            DMS_PRIOR_RETURNS,
            stats,
        )
        vols = _apply_bayesian_shrinkage(
            long_window.get("vols") or (stats or {}).get("vols_long") or (stats or {}).get("vols") or {},
            DMS_PRIOR_VOLS,
            stats,
        )
        quality = (stats or {}).get("quality") or {}
        self._long_window_meta = _extract_long_window_meta(long_window, "scenario")

        params = _calibrate_scenario_params_from_stats(returns, vols, quality)
        if params is None:
            return _static_params_result(
                "scenario_analysis",
                {
                    "baseline_returns": dict(EQUILIBRIUM_RETURNS),
                    "probabilities": [0.25, 0.50, 0.25],
                    "multiplier_overrides": None,
                },
                "insufficient_scenario_calibration_data",
            )

        valid_assets = _quality_assets(quality, "available")
        invalid_assets = _invalid_assets_from_quality(quality)
        coverage = round(len(valid_assets) / len(ASSET_CLASSES), 4)
        if coverage <= 0:
            coverage = round(len([a for a in ASSET_CLASSES if _is_finite_number(returns.get(a)) and _is_finite_number(vols.get(a))]) / len(ASSET_CLASSES), 4)
        source = self._stats_source if coverage >= MIN_COVERAGE else "static_assumption"
        if source == "static_assumption":
            return _static_params_result(
                "scenario_analysis",
                params,
                "insufficient_scenario_calibration_coverage",
            )

        meta = self._long_window_meta if self._long_window_meta else {}
        return CalibrationResult(
            source=source,
            as_of=_today(),
            coverage=coverage,
            valid_assets=valid_assets or [a for a in ASSET_CLASSES if _is_finite_number(returns.get(a))],
            invalid_assets=invalid_assets,
            assumptions_used=_assumptions_from_quality(quality),
            data_status=_calibration_data_status(
                source,
                coverage,
                invalid_assets,
                _assumptions_from_quality(quality),
            ),
            params=params,
            window_start=meta.get("window_start"),
            window_end=meta.get("window_end"),
            n_observations=meta.get("n_observations"),
            confidence_score=meta.get("confidence_score"),
        ).to_dict()

    def _series_result(
        self,
        observed: Dict[str, Any],
        fallback: Dict[str, float],
        assumption_name: str,
        quality_assumptions: List[str],
        quality: Dict[str, dict],
    ) -> dict:
        valid_assets: List[str] = []
        invalid_assets: Dict[str, str] = {}
        merged: Dict[str, float] = {}

        for asset in ASSET_CLASSES:
            value = observed.get(asset)
            quality_item = quality.get(asset) or {}
            quality_status = quality_item.get("status")
            if quality_status in {"rejected", "missing", "assumption"}:
                reason = quality_item.get("reason") or quality_status
                merged[asset] = float(fallback[asset])
                invalid_assets[asset] = str(reason)
            elif _is_finite_number(value):
                merged[asset] = round(float(value), 4)
                valid_assets.append(asset)
            else:
                merged[asset] = float(fallback[asset])
                invalid_assets[asset] = f"{assumption_name}_fallback"

        coverage = round(len(valid_assets) / len(ASSET_CLASSES), 4)
        meta = self._long_window_meta if self._long_window_meta else {}
        if coverage >= MIN_COVERAGE:
            return CalibrationResult(
                source=self._stats_source,
                as_of=_today(),
                coverage=coverage,
                valid_assets=valid_assets,
                invalid_assets=invalid_assets,
                assumptions_used=sorted(
                    set(
                        [f"{asset}:{reason}" for asset, reason in invalid_assets.items()]
                        + quality_assumptions
                    )
                ),
                data_status=_calibration_data_status(
                    self._stats_source,
                    coverage,
                    invalid_assets,
                    quality_assumptions,
                ),
                values=merged,
                window_start=meta.get("window_start"),
                window_end=meta.get("window_end"),
                n_observations=meta.get("n_observations"),
                confidence_score=meta.get("confidence_score"),
            ).to_dict()

        return CalibrationResult(
            source="static_assumption",
            as_of=_today(),
            coverage=coverage,
            valid_assets=valid_assets,
            invalid_assets={asset: f"{assumption_name}_static_assumption" for asset in ASSET_CLASSES},
            assumptions_used=[f"{asset}:{assumption_name}_static_assumption" for asset in ASSET_CLASSES],
            data_status="assumption",
            values={asset: float(fallback[asset]) for asset in ASSET_CLASSES},
        ).to_dict()


def _load_rolling_stats() -> dict | None:
    try:
        from app.storage.database import StatsSnapshotCache

        cached = StatsSnapshotCache.get("rolling_stats")
        return cached if isinstance(cached, dict) else None
    except Exception:
        logger.debug("_load_rolling_stats: cache miss", exc_info=True)
        return None


def _not_calibrated_params(name: str, params: dict, reason: str) -> dict:
    return {
        "params": params,
        "source": "not_calibrated",
        "status": "missing",
        "data_status": "missing",
        "as_of": _today(),
        "coverage": 0.0,
        "valid_assets": [],
        "invalid_assets": {name: reason},
        "assumptions_used": [],
        "missing_reason": reason,
        "calibration_version": CALIBRATION_VERSION,
    }


def _calibrate_regime_thresholds(defaults: Dict[str, float]) -> dict:
    specs = [
        ("PMI制造业", "pmi_neutral", "pmi_scale", 12),
        ("GDP同比", "gdp_neutral", "gdp_scale", 8),
        ("CPI同比", "cpi_neutral", "cpi_scale", 12),
        ("PPI同比", "ppi_neutral", "ppi_scale", 12),
        ("M2增速", "m2_neutral", "m2_scale", 12),
        ("10Y国债收益率", "yield_10y_neutral", "yield_10y_scale", 60),
    ]
    histories = _load_regime_macro_histories([item[0] for item in specs])
    params: Dict[str, float] = {}
    valid_assets: List[str] = []
    invalid_assets: Dict[str, str] = {}
    score_samples: List[float] = []
    observation_counts: Dict[str, int] = {}

    for indicator, neutral_key, scale_key, min_obs in specs:
        values = [
            float(value)
            for value in histories.get(indicator, [])
            if _is_finite_number(value)
        ]
        observation_counts[indicator] = len(values)
        if len(values) < min_obs:
            invalid_assets[indicator] = f"insufficient_history:{len(values)}/{min_obs}"
            continue

        arr = np.asarray(values, dtype=np.float64)
        neutral = float(np.median(arr))
        q25, q75 = np.percentile(arr, [25, 75])
        iqr = float(q75 - q25)
        std = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
        scale = max(iqr, std)
        if not _is_finite_number(scale) or scale <= 0:
            invalid_assets[indicator] = "zero_dispersion"
            continue

        params[neutral_key] = round(neutral, 4)
        params[scale_key] = round(scale, 4)
        valid_assets.append(indicator)
        score_samples.extend([abs(float(value - neutral) / scale) for value in arr])

    if valid_assets and score_samples:
        quadrant = float(np.percentile(np.asarray(score_samples, dtype=np.float64), 35))
        params["quadrant"] = round(_clamp(quadrant, 0.1, 0.5), 4)

    coverage = round(len(valid_assets) / len(specs), 4) if specs else 0.0
    if coverage <= 0:
        result = _not_calibrated_params(
            "regime_thresholds",
            defaults,
            "insufficient_macro_history_for_regime_thresholds",
        )
        result["observation_counts"] = observation_counts
        return result

    merged = dict(defaults)
    merged.update(params)
    status = "real" if coverage >= 1.0 and not invalid_assets else "partial"
    return {
        "params": merged,
        "source": "macro_history_distribution",
        "status": status,
        "data_status": status,
        "as_of": _today(),
        "coverage": coverage,
        "valid_assets": valid_assets,
        "invalid_assets": invalid_assets,
        "assumptions_used": [],
        "observation_counts": observation_counts,
        "calibration_version": CALIBRATION_VERSION,
    }


def _load_regime_macro_histories(indicators: List[str], limit: int = 240) -> Dict[str, List[float]]:
    try:
        from app.storage.database import MacroCache
    except Exception:
        logger.debug("_load_regime_macro_histories: MacroCache unavailable", exc_info=True)
        return {}

    histories: Dict[str, List[float]] = {}
    for indicator in indicators:
        try:
            rows = MacroCache.get_history(indicator, limit=limit)
        except Exception:
            logger.debug("regime macro history read failed for %s", indicator, exc_info=True)
            rows = []
        values: List[float] = []
        for _date, value, _source in rows or []:
            if _is_finite_number(value):
                values.append(float(value))
        histories[indicator] = values
    return histories


def _calibrate_circuit_breaker_destination(
    vols: Dict[str, Any],
    quality: Dict[str, dict],
    cash_assets: List[str],
) -> tuple[Dict[str, float], dict]:
    raw: Dict[str, float] = {}
    invalid: Dict[str, str] = {}
    for asset in cash_assets:
        quality_item = quality.get(asset) or {}
        status = quality_item.get("status")
        vol = vols.get(asset)
        if status not in {"available", "synthesized"}:
            invalid[asset] = quality_item.get("reason") or status or "missing_cash_equiv_signal"
            continue
        if not _is_finite_number(vol) or float(vol) < 0:
            invalid[asset] = "missing_cash_equiv_vol"
            continue
        raw[asset] = 1.0 / max(float(vol), 1e-6)

    total = sum(raw.values())
    if total <= 0:
        n_cash = len(cash_assets) or 1
        params = {asset: round(1.0 / n_cash, 4) for asset in cash_assets}
        return params, {
            "source": "not_calibrated",
            "status": "missing",
            "coverage": 0.0,
            "valid_assets": [],
            "invalid_assets": {asset: invalid.get(asset, "missing_cash_equiv_vol") for asset in cash_assets},
            "assumptions_used": [],
        }

    params = {asset: round(raw.get(asset, 0.0) / total, 6) for asset in cash_assets}
    valid_assets = [asset for asset in cash_assets if asset in raw]
    coverage = round(len(valid_assets) / len(cash_assets), 4) if cash_assets else 0.0
    return params, {
        "source": "cash_equiv_volatility",
        "status": "real" if coverage >= 1.0 and not invalid else "partial",
        "coverage": coverage,
        "valid_assets": valid_assets,
        "invalid_assets": invalid,
        "assumptions_used": [],
    }


def _load_long_window_cache() -> dict | None:
    """Load a long-window equilibrium snapshot from the cache (key: ``long_window_stats``).

    The snapshot may be a flat dict with ``returns_long`` / ``vols_long`` /
    ``correlation_matrix`` keys, or it may contain a nested ``long_window`` block.
    """
    try:
        from app.storage.database import StatsSnapshotCache

        cached = StatsSnapshotCache.get("long_window_stats")
        if not isinstance(cached, dict):
            return None
        return cached
    except Exception:
        logger.debug("_load_long_window_cache: miss", exc_info=True)
        return None


def _extract_long_window(stats: dict | None) -> dict:
    """Return normalized long-window data from *stats* when present."""
    if not isinstance(stats, dict):
        return {}
    long_window = stats.get("long_window")
    if isinstance(long_window, dict):
        normalized = dict(long_window)
    else:
        normalized = {}

    has_flat_long = bool(stats.get("returns_long") or stats.get("vols_long"))
    if has_flat_long:
        normalized.setdefault("returns", stats.get("returns_long") or {})
        normalized.setdefault("vols", stats.get("vols_long") or {})
        if stats.get("correlation_matrix") is not None:
            normalized.setdefault("correlation_matrix", stats.get("correlation_matrix"))

    for key in ("window_start", "window_end", "n_observations", "confidence_score"):
        if key not in normalized and stats.get(key) is not None:
            normalized[key] = stats[key]

    return normalized


def _extract_long_window_meta(long_window: dict, data_kind: str) -> dict:
    """Pull optional metadata keys from a long_window dict for a specific *data_kind*.

    Returns optional ``window_start``, ``window_end``, ``n_observations``, and
    ``confidence_score`` keys when those values are present.
    """
    if not isinstance(long_window, dict):
        return {}
    meta: dict = {}
    for key in ("window_start", "window_end", "n_observations", "confidence_score"):
        val = long_window.get(key)
        if val is not None:
            meta[key] = val
    return meta


def _today() -> str:
    return datetime.now().date().isoformat()


def _is_finite_number(value: Any) -> bool:
    try:
        return bool(np.isfinite(float(value)))
    except (TypeError, ValueError):
        return False
def _apply_bayesian_shrinkage(
    observed: Dict[str, Any],
    prior: Dict[str, float],
    stats: dict | None,
) -> Dict[str, float]:
    """Bayesian shrinkage of sample estimates towards long-term priors.

    Formula (opus.md section 2.3.1):
        shrinkage = 100 / (100 + N)
        blended[asset] = (1 - shrinkage) * sample + shrinkage * prior

    N is the number of trading-day observations in the long-window snapshot.
    With ~727 observations, shrinkage ~ 0.12 -- a mild anchor that prevents
    extreme short-window values (e.g. A-share -14% return) from dominating.

    Extreme values in observed are Winsorized to 2x the prior before blending,
    preventing extreme sample estimates from polluting the result even after
    shrinkage. For returns, the clip range is [-2*|prior|, 2*|prior|] when the
    prior is non-zero; for vols, the floor is max(0.1, 0.5*|prior|).
    """
    if not observed or not prior:
        return observed if isinstance(observed, dict) else {}

    # Determine N from long_window metadata or quality info
    n_obs = 0
    if stats and isinstance(stats, dict):
        lw = stats.get("long_window") or {}
        n_obs = lw.get("n_observations", 0)
        if not n_obs:
            quality = stats.get("quality") or {}
            for asset_q in quality.values():
                if isinstance(asset_q, dict):
                    dp = asset_q.get("data_points", 0)
                    if dp > n_obs:
                        n_obs = dp
    if n_obs <= 0:
        logger.debug("bayesian_shrinkage: n_obs unavailable, defaulting to 500")
        n_obs = 500  # ~2 years of trading days

    shrinkage = 100.0 / (100.0 + n_obs)
    result: Dict[str, float] = {}
    for asset in observed:
        sample_val = observed.get(asset)
        prior_val = prior.get(asset)
        if not _is_finite_number(sample_val) or not _is_finite_number(prior_val):
            if _is_finite_number(sample_val):
                result[asset] = float(sample_val)
            elif _is_finite_number(prior_val):
                result[asset] = float(prior_val)
            else:
                result[asset] = 0.0
            continue

        s = float(sample_val)
        p = float(prior_val)

        # Winsorize extreme sample values before blending.
        # Clip returns to [-2*|prior|, 2*|prior|]; clip vols to [0.1, 2*|prior|].
        abs_p = abs(p)
        if abs_p > 0.01:
            clip_lo = -2.0 * abs_p
            clip_hi = 2.0 * abs_p
        else:
            clip_lo = -50.0
            clip_hi = 50.0
        # For volatilities (always positive), enforce a reasonable floor
        if p >= 0 and s < 0.1:
            clip_lo = max(0.1, 0.5 * abs_p)
        s = max(clip_lo, min(clip_hi, s))

        blended = (1 - shrinkage) * s + shrinkage * p
        result[asset] = round(blended, 4)
    return result



def _is_valid_corr_matrix(matrix: Any) -> bool:
    """Check if *matrix* is a valid N x N correlation matrix."""
    if matrix is None:
        return False
    arr = np.asarray(matrix, dtype=float)
    return arr.shape == (len(ASSET_CLASSES), len(ASSET_CLASSES))


def _extract_jump_params_from_stats(
    stats: dict | None,
    defaults: dict,
) -> dict:
    """Extract jump diffusion params from persisted long-window tail stats."""
    if isinstance(stats, dict):
        long_window = stats.get("long_window") if isinstance(stats.get("long_window"), dict) else {}
        tail_stats = long_window.get("jump_tail_stats") or stats.get("jump_tail_stats") or {}
        if isinstance(tail_stats, dict):
            try:
                sample_size = int(tail_stats.get("sample_size") or 0)
                tail_count = int(tail_stats.get("tail_count") or 0)
                jump_probability = float(tail_stats.get("jump_probability"))
                jump_mean = float(tail_stats.get("jump_mean"))
                jump_vol = float(tail_stats.get("jump_vol"))
            except (TypeError, ValueError):
                sample_size = 0
                tail_count = 0
                jump_probability = 0.0
                jump_mean = 0.0
                jump_vol = 0.0
            if (
                sample_size >= 252
                and tail_count >= 3
                and 0.0 <= jump_probability <= 0.10
                and -0.30 <= jump_mean < 0.0
                and 0.0 < jump_vol <= 0.30
            ):
                source_assets = tail_stats.get("source_assets")
                return {
                    "jump_probability": round(jump_probability, 6),
                    "jump_mean": round(jump_mean, 6),
                    "jump_vol": round(jump_vol, 6),
                    "sample_size": sample_size,
                    "tail_count": tail_count,
                    "source_assets": list(source_assets) if isinstance(source_assets, list) else [],
                }
    return dict(defaults)


def _has_jump_tail_stats(stats: dict | None) -> bool:
    if not isinstance(stats, dict):
        return False
    long_window = stats.get("long_window") if isinstance(stats.get("long_window"), dict) else {}
    tail_stats = long_window.get("jump_tail_stats") or stats.get("jump_tail_stats")
    return isinstance(tail_stats, dict) and bool(tail_stats)


def _calibrate_scenario_params_from_stats(
    returns: Dict[str, Any],
    vols: Dict[str, Any],
    quality: Dict[str, dict],
) -> dict | None:
    baseline_returns: Dict[str, float] = {}
    valid_assets: List[str] = []
    for asset in ASSET_CLASSES:
        value = returns.get(asset)
        vol = vols.get(asset)
        if _is_finite_number(value) and _is_finite_number(vol):
            baseline_returns[asset] = round(float(value), 4)
            if (quality.get(asset) or {}).get("status") in {"available", "synthesized"}:
                valid_assets.append(asset)

    coverage = len(valid_assets) / len(ASSET_CLASSES) if ASSET_CLASSES else 0.0
    if coverage < MIN_COVERAGE or len(baseline_returns) != len(ASSET_CLASSES):
        return None

    group_returns = _group_average(baseline_returns)
    group_vols = _group_average(vols)
    if not group_returns or not group_vols:
        return None

    equity_return = group_returns.get("equity", 0.0)
    defensive_return = float(np.mean([
        group_returns.get("fixed_income", 0.0),
        group_returns.get("cash_equiv", 0.0),
    ]))
    equity_vol = max(group_vols.get("equity", 0.0), 1.0)
    median_vol = max(float(np.median([v for v in group_vols.values() if _is_finite_number(v)])), 1.0)

    risk_premium_score = (equity_return - defensive_return) / equity_vol
    vol_pressure = min(max(equity_vol / median_vol - 1.0, -1.0), 1.0)

    optimistic = _clamp(0.25 + 0.08 * risk_premium_score - 0.03 * vol_pressure, 0.15, 0.45)
    pessimistic = _clamp(0.25 - 0.05 * risk_premium_score + 0.05 * vol_pressure, 0.15, 0.45)
    baseline = 1.0 - optimistic - pessimistic
    if baseline < 0.20:
        scale = (0.80) / max(optimistic + pessimistic, 1e-9)
        optimistic *= scale
        pessimistic *= scale
        baseline = 0.20
    total = optimistic + baseline + pessimistic
    probabilities = [
        round(optimistic / total, 4),
        round(baseline / total, 4),
        round(pessimistic / total, 4),
    ]
    probabilities[1] = round(1.0 - probabilities[0] - probabilities[2], 4)

    multiplier_overrides = {"0": {}, "1": {}, "2": {}}
    median_abs_return = max(float(np.median([abs(v) for v in group_returns.values()])), 1.0)
    for group in GROUP_MAP:
        group_return = group_returns.get(group, 0.0)
        group_vol = max(group_vols.get(group, 0.0), 0.1)
        return_strength = group_return / median_abs_return
        vol_strength = group_vol / median_vol
        multiplier_overrides["0"][group] = round(_clamp(1.0 + 0.10 * vol_strength + 0.06 * max(return_strength, 0.0), 1.02, 1.60), 4)
        multiplier_overrides["1"][group] = 1.0
        multiplier_overrides["2"][group] = round(_clamp(1.0 - 0.16 * vol_strength + 0.04 * min(return_strength, 0.0), 0.35, 0.98), 4)

    return {
        "baseline_returns": baseline_returns,
        "probabilities": probabilities,
        "multiplier_overrides": multiplier_overrides,
    }


def _group_average(values: Dict[str, Any]) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for group, assets in GROUP_MAP.items():
        nums = [float(values[a]) for a in assets if _is_finite_number(values.get(a))]
        if nums:
            result[group] = float(np.mean(nums))
    return result


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, float(value)))


def _scale_stress_scenarios_from_stats(
    stats: dict | None,
    base_scenarios: dict,
) -> dict:
    """Scale stress scenario impacts based on current vs long-term volatility.

    When the current market vol regime is elevated (e.g. vols 30% above
    long-term), stress scenario impacts are amplified proportionally.
    When vol is below long-term, impacts are moderated. This makes stress
    tests responsive to actual market conditions instead of being pure static.

    Scaling coefficients and blend weight come from config.STRESS_VOL_SCALING
    and config.STRESS_BLEND_WEIGHT so they can be tuned without code changes.
    """
    if not stats or not isinstance(stats, dict):
        return dict(base_scenarios)

    from ..config import (
        EQUILIBRIUM_VOLS,
        ASSET_TO_GROUP,
        STRESS_VOL_SCALING,
        STRESS_BLEND_WEIGHT,
        STRESS_VOL_RATIO_RANGE,
    )

    long_window = stats.get("long_window") or {}
    vols_data = long_window.get("vols") or stats.get("vols_long") or {}
    if not vols_data:
        vols_data = stats.get("vols") or {}
    quality = stats.get("quality") or {}

    # Compute vol scaling factor from available assets
    vol_ratios = []
    for asset in ASSET_CLASSES:
        if quality.get(asset, {}).get("status") != "available":
            continue
        observed = vols_data.get(asset)
        expected = EQUILIBRIUM_VOLS.get(asset)
        if _is_finite_number(observed) and _is_finite_number(expected) and float(expected) > 0:
            vol_ratios.append(float(observed) / float(expected))

    if len(vol_ratios) < 3:
        return dict(base_scenarios)

    # Median vol ratio across assets (robust to outliers)
    vol_ratio = float(np.median(vol_ratios))
    # Clamp to configured range
    vol_ratio = max(STRESS_VOL_RATIO_RANGE[0], min(STRESS_VOL_RATIO_RANGE[1], vol_ratio))

    # Scale stress scenarios: blend scaled + base to avoid extreme swings
    scaled = {}
    for scenario_name, impacts in base_scenarios.items():
        scaled_impacts = {}
        for asset, impact in impacts.items():
            if not _is_finite_number(impact):
                scaled_impacts[asset] = impact
                continue
            # Per-group vol sensitivity from config
            group = ASSET_TO_GROUP.get(asset, "cash_equiv")
            sensitivity = STRESS_VOL_SCALING.get(group, 0.0)
            # scaling = sensitivity * vol_ratio + (1 - sensitivity)
            # When sensitivity=1.0 (equity): scaling = vol_ratio
            # When sensitivity=0.0 (cash):   scaling = 1.0 (no change)
            scaling = sensitivity * vol_ratio + (1.0 - sensitivity)
            scaled_impact = float(impact) * scaling
            # Blend scaled with base
            blended_impact = (1 - STRESS_BLEND_WEIGHT) * float(impact) + STRESS_BLEND_WEIGHT * scaled_impact
            scaled_impacts[asset] = round(blended_impact, 2)
        scaled[scenario_name] = scaled_impacts

    return scaled



def _sanitize_corr_matrix(matrix: Any) -> List[List[float]]:
    arr = np.asarray(matrix, dtype=float)
    arr = np.nan_to_num(arr, nan=0.0, posinf=1.0, neginf=-1.0)
    arr = (arr + arr.T) / 2
    arr = np.clip(arr, -1.0, 1.0)
    np.fill_diagonal(arr, 1.0)
    return [[round(float(value), 6) for value in row] for row in arr.tolist()]


def _quality_assets(quality: dict, status: str) -> List[str]:
    return [asset for asset, item in quality.items() if item.get("status") == status]


def _invalid_assets_from_quality(quality: dict) -> Dict[str, str]:
    return {
        asset: item.get("reason") or item.get("status") or "invalid"
        for asset, item in quality.items()
        if item.get("status") in {"rejected", "missing"}
    }


def _assumptions_from_quality(quality: dict) -> List[str]:
    return [
        f"{asset}:{item.get('reason') or item.get('status')}"
        for asset, item in quality.items()
        if item.get("status") == "assumption"
    ]


def _calibration_data_status(
    source: str,
    coverage: float,
    invalid_assets: Dict[str, str],
    assumptions_used: List[str],
) -> str:
    if source == "static_assumption" or coverage <= 0:
        return "assumption"
    if coverage >= 1.0 and not invalid_assets and not assumptions_used:
        return "real"
    if coverage >= MIN_COVERAGE:
        return "partial"
    return "assumption"


def _static_matrix_result(reason: str) -> dict:
    return CalibrationResult(
        source="static_assumption",
        as_of=_today(),
        coverage=0.0,
        valid_assets=[],
        invalid_assets={asset: reason for asset in ASSET_CLASSES},
        assumptions_used=[f"{asset}:{reason}" for asset in ASSET_CLASSES],
        data_status="assumption",
        matrix=_sanitize_corr_matrix(DEFAULT_CORR),
    ).to_dict()


def _static_params_result(name: str, params: dict, reason: str) -> dict:
    return CalibrationResult(
        source="static_assumption",
        as_of=_today(),
        coverage=0.0,
        valid_assets=[],
        invalid_assets={name: reason},
        assumptions_used=[f"{name}:{reason}"],
        data_status="assumption",
        params=params,
    ).to_dict()


historical_calibrator = HistoricalCalibrator()
