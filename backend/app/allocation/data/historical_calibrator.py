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

from ..config import (
    ASSET_CLASSES,
    DEFAULT_CORR,
    EQUILIBRIUM_RETURNS,
    EQUILIBRIUM_VOLS,
    STRESS_SCENARIOS,
)


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
       }
        result.update(self._p2_defaults())
        if persist:
            try:
                from app.storage.database import StatsSnapshotCache

                StatsSnapshotCache.save("historical_calibration", result)
            except Exception:
                pass
        return result

    @staticmethod
    def _p2_defaults() -> dict:
        """P2 parameter defaults for cache seeding.

        When historical_calibration is persisted, these sections ensure
        calibration audit sees 'assumption' instead of 'missing'.
        """
        try:
            from ..regime_detector import RegimeThresholds
            from dataclasses import fields as dc_fields
            from ..config import GROUP_MAP, EQUILIBRIUM_RETURNS

            rt_defaults = {f.name: getattr(RegimeThresholds, f.name) for f in dc_fields(RegimeThresholds)}
            cash_assets = GROUP_MAP.get("cash_equiv", ["money_fund", "cash"])
            n_cash = len(cash_assets)
            dest_weights = {a: round(1.0 / n_cash, 4) for a in cash_assets}

            return {
                "regime_thresholds": {"params": rt_defaults, "source": "static_assumption", "status": "assumption"},
                "circuit_breaker_destination": {"params": dest_weights, "source": "static_assumption", "status": "assumption"},
                "scenario_analysis": {
                    "params": {
                        "baseline_returns": dict(EQUILIBRIUM_RETURNS),
                        "probabilities": [0.25, 0.50, 0.25],
                        "multiplier_overrides": None,
                    },
                    "source": "static_assumption",
                    "status": "assumption",
                },
                "risk_questionnaire": {
                    "params": {"weights": None, "shift_down_threshold": -0.5, "shift_up_threshold": 1.5},
                    "source": "static_assumption",
                    "status": "assumption",
                },
            }
        except Exception:
            return {}

    def calibrate_equilibrium_returns(self) -> dict:
        stats = self._load_stats()
        long_window = _extract_long_window(stats)
        values = long_window.get("returns") or (stats or {}).get("returns_long") or {}
        if not values:
            values = (stats or {}).get("returns") or {}
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
            pass

        cached = _load_rolling_stats()
        if cached:
            self._stats_source = "sqlite_cache"
            return cached

        self._stats_source = "static_assumption"
        return None

    def calibrate_jump_params(self) -> dict:
        return _static_params_result(
            "jump_params",
            {
                "source_note": "Historical tail-event calibration is not yet available.",
                "jump_probability": 0.03,
                "jump_mean": -0.04,
                "jump_vol": 0.08,
            },
            "static_jump_params",
        )

    def calibrate_stress_scenarios(self) -> dict:
        return _static_params_result(
            "stress_scenarios",
            STRESS_SCENARIOS,
            "static_stress_scenarios",
        )

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
        return None


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


def _is_valid_corr_matrix(matrix: Any) -> bool:
    if matrix is None:
        return False
    arr = np.asarray(matrix, dtype=float)
    return arr.shape == (len(ASSET_CLASSES), len(ASSET_CLASSES))


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
