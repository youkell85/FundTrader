"""Portfolio factor exposure calculation with auditable loadings."""

import logging
from typing import Dict

from .config import ASSET_CLASSES

logger = logging.getLogger(__name__)

FACTOR_NAMES = ["equity_beta", "term_premium", "credit_premium", "inflation", "liquidity"]
REAL_FACTOR_SOURCES = {
    "latest_window_regression",
    "latest_window_regression_low_confidence",
    "long_window_factor_proxy",
}


class FactorCalibrationUnavailable(RuntimeError):
    """Raised when factor exposure lacks real calibrated loadings."""


def calculate_exposures(allocations: Dict[str, float]) -> Dict[str, float]:
    """Calculate weighted portfolio factor exposures."""
    bundle = _get_calibration_bundle()
    _validate_bundle_for_allocations(bundle, allocations)
    loadings = bundle["loadings"]
    exposures = {factor: 0.0 for factor in FACTOR_NAMES}

    for asset in ASSET_CLASSES:
        weight = allocations.get(asset, 0.0)
        if weight < 0.001:
            continue

        asset_loadings = loadings[asset]
        for factor in FACTOR_NAMES:
            exposures[factor] += weight * asset_loadings[factor]

    return {factor: round(value, 4) for factor, value in exposures.items()}


def _get_calibration_bundle() -> dict:
    try:
        from . import factor_calibrator

        bundle = factor_calibrator.get_calibration_bundle()
        if isinstance(bundle, dict) and isinstance(bundle.get("loadings"), dict):
            return bundle
    except Exception as exc:
        logger.debug("Dynamic factor calibration unavailable: %s", exc)

    raise FactorCalibrationUnavailable("factor calibration unavailable")


def get_calibration_metadata() -> dict:
    """Expose calibration source metadata for diagnostics or UI/reporting."""
    try:
        bundle = _get_calibration_bundle()
    except FactorCalibrationUnavailable as exc:
        return _missing_metadata(str(exc))
    summary = dict(bundle.get("summary") or {})
    if summary.get("source") == "static_assumption" or float(summary.get("coverage") or 0.0) <= 0.0:
        return _missing_metadata("factor calibration has no real asset coverage")
    summary["assets_calibrated"] = len(summary.get("valid_assets") or [])
    summary["method"] = (
        "latest_window_ols"
        if summary.get("source") == "historical_market_data"
        else "long_window_beta_from_correlation_volatility"
    )
    summary["window"] = "252d_latest" if summary.get("source") == "historical_market_data" else "long_window"
    if bundle.get("metadata"):
        summary["asset_metadata"] = bundle["metadata"]
    return summary


def _validate_bundle_for_allocations(bundle: dict, allocations: Dict[str, float]) -> None:
    summary = bundle.get("summary") or {}
    if summary.get("source") == "static_assumption":
        raise FactorCalibrationUnavailable("factor calibration is static assumption")
    if float(summary.get("coverage") or 0.0) <= 0.0:
        raise FactorCalibrationUnavailable("factor calibration has no real asset coverage")

    loadings = bundle.get("loadings") or {}
    metadata = bundle.get("metadata") or {}
    for asset in ASSET_CLASSES:
        if allocations.get(asset, 0.0) < 0.001:
            continue
        asset_loadings = loadings.get(asset)
        asset_meta = metadata.get(asset) or {}
        if asset_meta.get("source") not in REAL_FACTOR_SOURCES:
            raise FactorCalibrationUnavailable(f"missing calibrated factor loadings for {asset}")
        if not isinstance(asset_loadings, dict):
            raise FactorCalibrationUnavailable(f"missing factor loadings for {asset}")
        for factor in FACTOR_NAMES:
            if not isinstance(asset_loadings.get(factor), (int, float)):
                raise FactorCalibrationUnavailable(f"invalid factor loading {asset}.{factor}")


def _missing_metadata(reason: str) -> dict:
    return {
        "source": "missing",
        "coverage": 0.0,
        "valid_assets": [],
        "invalid_assets": {asset: reason for asset in ASSET_CLASSES},
        "assumptions_used": [],
        "assets_calibrated": 0,
        "method": None,
        "window": None,
        "missing_reason": reason,
    }
