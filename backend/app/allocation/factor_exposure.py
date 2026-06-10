"""Portfolio factor exposure calculation with auditable loadings."""

import logging
from typing import Dict

from .config import ASSET_CLASSES, FACTOR_LOADINGS

logger = logging.getLogger(__name__)

FACTOR_NAMES = ["equity_beta", "term_premium", "credit_premium", "inflation", "liquidity"]


def calculate_exposures(allocations: Dict[str, float]) -> Dict[str, float]:
    """Calculate weighted portfolio factor exposures."""
    loadings = _get_calibration_bundle()["loadings"]
    exposures = {factor: 0.0 for factor in FACTOR_NAMES}

    for asset in ASSET_CLASSES:
        weight = allocations.get(asset, 0.0)
        if weight < 0.001:
            continue

        asset_loadings = loadings.get(asset) or FACTOR_LOADINGS.get(asset, {})
        for factor in FACTOR_NAMES:
            exposures[factor] += weight * asset_loadings.get(factor, 0.0)

    return {factor: round(value, 4) for factor, value in exposures.items()}


def _get_calibration_bundle() -> dict:
    try:
        from . import factor_calibrator

        bundle = factor_calibrator.get_calibration_bundle()
        if isinstance(bundle, dict) and isinstance(bundle.get("loadings"), dict):
            return bundle
    except Exception as exc:
        logger.debug("Dynamic factor calibration unavailable, using static: %s", exc)

    return _static_bundle("dynamic_calibration_unavailable")


def get_calibration_metadata() -> dict:
    """Expose calibration source metadata for diagnostics or UI/reporting."""
    bundle = _get_calibration_bundle()
    summary = dict(bundle.get("summary") or {})
    summary["assets_calibrated"] = len(summary.get("valid_assets") or [])
    summary["method"] = (
        "latest_window_ols"
        if summary.get("source") != "static_assumption"
        else "static_expert_estimate"
    )
    summary["window"] = "252d_latest" if summary.get("source") != "static_assumption" else None
    if bundle.get("metadata"):
        summary["asset_metadata"] = bundle["metadata"]
    return summary


def _static_bundle(reason: str) -> dict:
    invalid_assets = {asset: reason for asset in ASSET_CLASSES}
    as_of = None
    return {
        "loadings": {asset: dict(FACTOR_LOADINGS.get(asset, {})) for asset in ASSET_CLASSES},
        "metadata": {},
        "summary": {
            "source": "static_assumption",
            "as_of": as_of,
            "coverage": 0.0,
            "valid_assets": [],
            "invalid_assets": invalid_assets,
            "assumptions_used": [f"{asset}:{reason}" for asset in ASSET_CLASSES],
            "calibration_version": "static-factor-loadings",
        },
    }
