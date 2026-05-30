"""Dual Engine — v3 vs v4 comparison with shadow/canary/full deployment modes.

Deployment stages:
- shadow: Run both engines, return v3 result to user, log v4 diff internally
- canary: Run both engines, return v4 result to user, include diff report
- full:   Run v4 only (production mode)

This module provides the comparison infrastructure for validating v4 improvements
against the v3 baseline before full rollout.
"""
import logging
import time
from copy import deepcopy
from typing import Any, Dict, Optional

from .config import ASSET_CLASSES, GROUP_MAP
from .models import AllocationRequest, AllocationResponse

logger = logging.getLogger(__name__)

# Deployment mode: shadow | canary | full
_DEPLOYMENT_MODE = "full"


def set_deployment_mode(mode: str):
    """Set deployment mode: shadow, canary, or full."""
    global _DEPLOYMENT_MODE
    if mode not in ("shadow", "canary", "full"):
        raise ValueError(f"Invalid mode: {mode}. Must be shadow/canary/full.")
    _DEPLOYMENT_MODE = mode
    logger.info(f"Deployment mode set to: {mode}")


def get_deployment_mode() -> str:
    """Return current deployment mode."""
    return _DEPLOYMENT_MODE


def run_dual_comparison(request: AllocationRequest) -> dict:
    """Run both v3 (legacy) and v4 (current) engines and compare results.

    Returns a comprehensive diff report including:
    - Allocation differences per asset class
    - Metric comparisons (return, vol, sharpe, max_drawdown)
    - Group-level allocation changes
    - Regime/TAA/breaker status comparison
    """
    from .orchestrator import run as run_v4

    # Run v4 (current engine with all enhancements)
    t0 = time.monotonic()
    v4_result = run_v4(request)
    v4_ms = (time.monotonic() - t0) * 1000

    # Run v3 (legacy mode — disable new features)
    t0 = time.monotonic()
    v3_result = _run_v3_legacy(request)
    v3_ms = (time.monotonic() - t0) * 1000

    # Build comparison report
    comparison = _build_comparison(v3_result, v4_result, v3_ms, v4_ms)

    return {
        "mode": _DEPLOYMENT_MODE,
        "v3": {
            "elapsed_ms": round(v3_ms, 2),
            "allocations": v3_result.saa.allocations,
            "group_allocations": v3_result.saa.group_allocations,
            "expected_return": v3_result.saa.expected_return,
            "expected_volatility": v3_result.saa.expected_volatility,
            "sharpe_ratio": v3_result.saa.sharpe_ratio,
            "regime": v3_result.meta.regime,
            "circuit_breaker": v3_result.meta.circuit_breaker_triggered,
            "fed_value": v3_result.taa.fed_value,
            "warnings": v3_result.warnings,
        },
        "v4": {
            "elapsed_ms": round(v4_ms, 2),
            "allocations": v4_result.saa.allocations,
            "group_allocations": v4_result.saa.group_allocations,
            "expected_return": v4_result.saa.expected_return,
            "expected_volatility": v4_result.saa.expected_volatility,
            "sharpe_ratio": v4_result.saa.sharpe_ratio,
            "regime": v4_result.meta.regime,
            "circuit_breaker": v4_result.meta.circuit_breaker_triggered,
            "fed_value": v4_result.taa.fed_value,
            "warnings": v4_result.warnings,
        },
        "comparison": comparison,
    }


def _run_v3_legacy(request: AllocationRequest) -> AllocationResponse:
    """Run allocation with v3 legacy behavior (no v4 enhancements).

    This simulates the v3 engine by running the current pipeline but
    disabling v4-specific enhancements:
    - No FED continuous model (fed_value=None)
    - No IC adaptive weights (uses static weights only)
    - No asymmetric circuit breaker recovery (stateless)
    - No convertible 3D stress channel
    - No regime 2-period persistence (immediate classification)
    """
    import os
    from .orchestrator import run as run_engine

    saved_env = {}
    v3_env_flags = {
        "FUNDTRADER_V3_MODE": "1",
        "FUNDTRADER_NO_FED": "1",
        "FUNDTRADER_NO_IC_ADAPTIVE": "1",
        "FUNDTRADER_NO_ASYMMETRIC_BREAKER": "1",
        "FUNDTRADER_NO_REGIME_PERSISTENCE": "1",
    }
    for k, v in v3_env_flags.items():
        saved_env[k] = os.environ.get(k)
        os.environ[k] = v

    try:
        result = run_engine(request)
    finally:
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    v3 = result.model_copy(deep=True)
    v3.taa.fed_value = None
    v3.taa.fed_interpretation = "v3: 无Fed连续化模型"

    return v3


def _build_comparison(
    v3: AllocationResponse, v4: AllocationResponse,
    v3_ms: float, v4_ms: float,
) -> dict:
    """Build detailed comparison between v3 and v4 results."""

    # Per-asset allocation diff
    alloc_diff = {}
    for asset in ASSET_CLASSES:
        v3_val = v3.saa.allocations.get(asset, 0.0)
        v4_val = v4.saa.allocations.get(asset, 0.0)
        diff = v4_val - v3_val
        alloc_diff[asset] = {
            "v3": v3_val,
            "v4": v4_val,
            "delta": round(diff, 2),
            "changed": abs(diff) > 0.01,
        }

    # Group-level diff
    group_diff = {}
    for group in GROUP_MAP:
        v3_val = v3.saa.group_allocations.get(group, 0.0)
        v4_val = v4.saa.group_allocations.get(group, 0.0)
        diff = v4_val - v3_val
        group_diff[group] = {
            "v3": v3_val,
            "v4": v4_val,
            "delta": round(diff, 2),
        }

    # Metric comparison
    metrics_diff = {
        "expected_return": {
            "v3": v3.saa.expected_return,
            "v4": v4.saa.expected_return,
            "delta": round(v4.saa.expected_return - v3.saa.expected_return, 2),
        },
        "expected_volatility": {
            "v3": v3.saa.expected_volatility,
            "v4": v4.saa.expected_volatility,
            "delta": round(v4.saa.expected_volatility - v3.saa.expected_volatility, 2),
        },
        "sharpe_ratio": {
            "v3": v3.saa.sharpe_ratio,
            "v4": v4.saa.sharpe_ratio,
            "delta": round(v4.saa.sharpe_ratio - v3.saa.sharpe_ratio, 2),
        },
    }

    # Count changed assets
    changed_count = sum(1 for v in alloc_diff.values() if v["changed"])
    total_assets = len(ASSET_CLASSES)

    # Max absolute allocation change
    max_delta = max(abs(v["delta"]) for v in alloc_diff.values()) if alloc_diff else 0.0

    # Summary assessment
    if changed_count == 0:
        assessment = "无差异 — v4增强未改变当前配置"
    elif max_delta < 1.0:
        assessment = f"微小差异 — {changed_count}/{total_assets}资产变化<1%"
    elif max_delta < 3.0:
        assessment = f"中等差异 — {changed_count}/{total_assets}资产变化<3%"
    else:
        assessment = f"显著差异 — {changed_count}/{total_assets}资产变化≥3%, 需人工审核"

    return {
        "alloc_diff": alloc_diff,
        "group_diff": group_diff,
        "metrics_diff": metrics_diff,
        "changed_assets": changed_count,
        "total_assets": total_assets,
        "max_allocation_delta": round(max_delta, 2),
        "regime_same": v3.meta.regime == v4.meta.regime,
        "breaker_same": v3.meta.circuit_breaker_triggered == v4.meta.circuit_breaker_triggered,
        "v4_has_fed_model": v4.taa.fed_value is not None,
        "performance_ratio": round(v4_ms / v3_ms, 2) if v3_ms > 0 else 1.0,
        "assessment": assessment,
    }
