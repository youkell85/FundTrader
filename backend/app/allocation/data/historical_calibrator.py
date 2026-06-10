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
    values: Dict[str, float] | None = None
    matrix: List[List[float]] | None = None
    params: Dict[str, Any] | None = None

    def to_dict(self) -> dict:
        data = {
            "source": self.source,
            "as_of": self.as_of,
            "coverage": self.coverage,
            "valid_assets": self.valid_assets,
            "invalid_assets": self.invalid_assets,
            "assumptions_used": self.assumptions_used,
            "calibration_version": self.calibration_version,
        }
        if self.values is not None:
            data["values"] = self.values
        if self.matrix is not None:
            data["matrix"] = self.matrix
        if self.params is not None:
            data["params"] = self.params
        return data


class HistoricalCalibrator:
    """Calibrate core allocation assumptions with auditable fallback metadata."""

    def __init__(self, stats_snapshot: dict | None = None):
        self._stats_snapshot = stats_snapshot
        self._stats_source = "static_assumption"

    def calibrate_all(self, persist: bool = False) -> dict:
        result = {
            "equilibrium_returns": self.calibrate_equilibrium_returns(),
            "equilibrium_vols": self.calibrate_equilibrium_vols(),
            "correlation_matrix": self.calibrate_correlation_matrix(),
            "jump_params": self.calibrate_jump_params(),
            "stress_scenarios": self.calibrate_stress_scenarios(),
        }
        if persist:
            try:
                from app.storage.database import StatsSnapshotCache

                StatsSnapshotCache.save("historical_calibration", result)
            except Exception:
                pass
        return result

    def calibrate_equilibrium_returns(self) -> dict:
        stats = self._load_stats()
        values = (stats or {}).get("returns") or {}
        if not values:
            values = (stats or {}).get("returns_long") or {}
        return self._series_result(
            values,
            EQUILIBRIUM_RETURNS,
            "equilibrium_returns",
            _assumptions_from_quality((stats or {}).get("quality") or {}),
        )

    def calibrate_equilibrium_vols(self) -> dict:
        stats = self._load_stats()
        values = (stats or {}).get("vols") or {}
        if not values:
            values = (stats or {}).get("vols_long") or {}
        return self._series_result(
            values,
            EQUILIBRIUM_VOLS,
            "equilibrium_vols",
            _assumptions_from_quality((stats or {}).get("quality") or {}),
        )

    def calibrate_correlation_matrix(self) -> dict:
        stats = self._load_stats()
        matrix = (stats or {}).get("correlation_matrix")
        if _is_valid_corr_matrix(matrix):
            quality = (stats or {}).get("quality") or {}
            valid_assets = _quality_assets(quality, "available")
            invalid_assets = _invalid_assets_from_quality(quality)
            coverage = round(len(valid_assets) / len(ASSET_CLASSES), 4)
            if coverage >= MIN_COVERAGE:
                return CalibrationResult(
                    source=self._stats_source,
                    as_of=_today(),
                    coverage=coverage,
                    valid_assets=valid_assets,
                    invalid_assets=invalid_assets,
                    assumptions_used=_assumptions_from_quality(quality),
                    matrix=_sanitize_corr_matrix(matrix),
            ).to_dict()

        return _static_matrix_result("insufficient_historical_correlation")

    def _load_stats(self) -> dict | None:
        if self._stats_snapshot:
            self._stats_source = "historical_market_data"
            return self._stats_snapshot
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
    ) -> dict:
        valid_assets: List[str] = []
        invalid_assets: Dict[str, str] = {}
        merged: Dict[str, float] = {}

        for asset in ASSET_CLASSES:
            value = observed.get(asset)
            if _is_finite_number(value):
                merged[asset] = round(float(value), 4)
                valid_assets.append(asset)
            else:
                merged[asset] = float(fallback[asset])
                invalid_assets[asset] = f"{assumption_name}_fallback"

        coverage = round(len(valid_assets) / len(ASSET_CLASSES), 4)
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
                values=merged,
            ).to_dict()

        return CalibrationResult(
            source="static_assumption",
            as_of=_today(),
            coverage=coverage,
            valid_assets=valid_assets,
            invalid_assets={asset: f"{assumption_name}_static_assumption" for asset in ASSET_CLASSES},
            assumptions_used=[f"{asset}:{assumption_name}_static_assumption" for asset in ASSET_CLASSES],
            values={asset: float(fallback[asset]) for asset in ASSET_CLASSES},
        ).to_dict()


def _load_rolling_stats() -> dict | None:
    try:
        from app.storage.database import StatsSnapshotCache

        cached = StatsSnapshotCache.get("rolling_stats")
        return cached if isinstance(cached, dict) else None
    except Exception:
        return None


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


def _static_matrix_result(reason: str) -> dict:
    return CalibrationResult(
        source="static_assumption",
        as_of=_today(),
        coverage=0.0,
        valid_assets=[],
        invalid_assets={asset: reason for asset in ASSET_CLASSES},
        assumptions_used=[f"{asset}:{reason}" for asset in ASSET_CLASSES],
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
        params=params,
    ).to_dict()


historical_calibrator = HistoricalCalibrator()
