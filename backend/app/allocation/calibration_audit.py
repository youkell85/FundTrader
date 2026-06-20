"""Calibration audit helper -- read-only summary of StatsSnapshotCache("historical_calibration").

Exposes a compact audit object for the pipeline health panel without changing
allocation behaviour or mutating calibration data.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date as _date
from typing import Dict, List, Optional, Tuple

from .config import EQUILIBRIUM_RETURNS, EQUILIBRIUM_VOLS

# --- Known calibration section keys ---
_SECTION_KEYS = [
    "equilibrium_returns",
    "equilibrium_vols",
    "correlation_matrix",
    "jump_params",
    "stress_scenarios",
    "regime_thresholds",
    "circuit_breaker_destination",
    "scenario_analysis",
    "risk_questionnaire",
]

# --- Default audit policy (immutable reference values) ---
_DEFAULT_RETURN_DRIFT_THRESHOLD = 3.0
_DEFAULT_VOL_DRIFT_THRESHOLD = 5.0
_DEFAULT_JUMP_PROB_MIN = 0.0
_DEFAULT_JUMP_PROB_MAX = 0.10
_DEFAULT_COVERAGE_THRESHOLD = 0.7
_DEFAULT_POLICY_SOURCE = "static_defaults"


@dataclass
class AuditPolicy:
    """Explicit, serializable audit policy for calibration coverage/drift classification.

    Thresholds match the pre-policy module-level constants so behaviour is
    unchanged when no cache override is present.
    """

    return_drift_threshold: float = _DEFAULT_RETURN_DRIFT_THRESHOLD
    vol_drift_threshold: float = _DEFAULT_VOL_DRIFT_THRESHOLD
    jump_probability_min: float = _DEFAULT_JUMP_PROB_MIN
    jump_probability_max: float = _DEFAULT_JUMP_PROB_MAX
    coverage_threshold: float = _DEFAULT_COVERAGE_THRESHOLD
    policy_source: str = _DEFAULT_POLICY_SOURCE
    policy_version: Optional[str] = None

    def to_dict(self) -> dict:
        d: dict = {
            "return_drift_threshold": self.return_drift_threshold,
            "vol_drift_threshold": self.vol_drift_threshold,
            "jump_probability_min": self.jump_probability_min,
            "jump_probability_max": self.jump_probability_max,
            "coverage_threshold": self.coverage_threshold,
            "policy_source": self.policy_source,
        }
        if self.policy_version is not None:
            d["policy_version"] = self.policy_version
        return d


def _resolve_policy(cache: Optional[dict]) -> AuditPolicy:
    """Load an optional audit policy from the calibration cache without mutation.

    Looks for ``calibration_audit_policy`` in *cache*.  Accepts two shapes:

    * ``{"calibration_audit_policy": {"params": {...}}}``
    * ``{"calibration_audit_policy": {"return_drift_threshold": ...}}`` (flat)

    Malformed, non-finite, or logically invalid values are silently ignored and
    fall back to the :class:`AuditPolicy` default for that field.
    """
    policy = AuditPolicy()

    if not isinstance(cache, dict):
        return policy

    raw = cache.get("calibration_audit_policy")
    if not isinstance(raw, dict):
        return policy

    # Support both nested (params) and flat shapes
    params: dict = raw.get("params") if isinstance(raw.get("params"), dict) else raw
    if not isinstance(params, dict):
        return policy

    # --- Numeric thresholds ---
    _apply_numeric_override(params, "return_drift_threshold", policy, gt=0.0)
    _apply_numeric_override(params, "vol_drift_threshold", policy, gt=0.0)
    _apply_numeric_override(
        params, "jump_probability_min", policy, ge=0.0, le=policy.jump_probability_max
    )
    _apply_numeric_override(
        params, "jump_probability_max", policy, ge=policy.jump_probability_min, le=1.0
    )
    _apply_numeric_override(params, "coverage_threshold", policy, ge=0.0, le=1.0)

    # --- policy_version (string) ---
    ver = params.get("policy_version")
    if isinstance(ver, str) and ver.strip():
        policy.policy_version = ver.strip()

    # --- Determine source ---
    if (
        policy.return_drift_threshold != _DEFAULT_RETURN_DRIFT_THRESHOLD
        or policy.vol_drift_threshold != _DEFAULT_VOL_DRIFT_THRESHOLD
        or policy.jump_probability_min != _DEFAULT_JUMP_PROB_MIN
        or policy.jump_probability_max != _DEFAULT_JUMP_PROB_MAX
        or policy.coverage_threshold != _DEFAULT_COVERAGE_THRESHOLD
        or policy.policy_version is not None
    ):
        policy.policy_source = "cache_override"

    return policy


def _apply_numeric_override(
    params: dict,
    key: str,
    policy: AuditPolicy,
    gt: Optional[float] = None,
    ge: Optional[float] = None,
    lt: Optional[float] = None,
    le: Optional[float] = None,
) -> None:
    """Set *policy*.*key* from *params*[*key*] if the value is a finite number
    passing the optional bounds checks."""
    val = params.get(key)
    if not isinstance(val, (int, float)):
        return
    if isinstance(val, bool):
        return
    fval = float(val)
    if not math.isfinite(fval):
        return
    if gt is not None and not (fval > gt):
        return
    if ge is not None and not (fval >= ge):
        return
    if lt is not None and not (fval < lt):
        return
    if le is not None and not (fval <= le):
        return
    setattr(policy, key, fval)


@dataclass
class CalibrationSectionItem:
    key: str  # section key for frontend labeling
    status: str  # real | partial | assumption | stale | missing | rejected
    source: str
    as_of: Optional[str] = None
    calibration_version: Optional[str] = None
    coverage: Optional[float] = None
    invalid_count: int = 0
    assumption_count: int = 0
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d: dict = {
            "key": self.key,
            "status": self.status,
            "source": self.source,
            "invalid_count": self.invalid_count,
            "assumption_count": self.assumption_count,
            "warnings": list(self.warnings),
        }
        if self.as_of is not None:
            d["as_of"] = self.as_of
        if self.calibration_version is not None:
            d["calibration_version"] = self.calibration_version
        if self.coverage is not None:
            d["coverage"] = self.coverage
        return d


def _today() -> str:
    return _date.today().isoformat()


def _section_status_from_result(result: dict, coverage_threshold: float = _DEFAULT_COVERAGE_THRESHOLD) -> Tuple[str, List[str]]:
    """Infer status and warnings from a CalibrationResult dict."""
    source = result.get("source", "unknown")
    coverage = result.get("coverage", 0.0)
    assumptions = result.get("assumptions_used") or []
    invalid = result.get("invalid_assets") or {}

    if source == "static_assumption":
        return ("assumption", [])
    if source == "unknown" or (source != "static_assumption" and not result.get("values") and not result.get("matrix") and not result.get("params")):
        return ("missing", ["no calibration data loaded"])
    if isinstance(coverage, (int, float)) and coverage < coverage_threshold:
        return ("partial", [f"coverage {coverage:.0%} below threshold"])
    if len(invalid) > 0:
        return ("partial", [f"{len(invalid)} assets rejected/missing"])
    if len(assumptions) > 0:
        return ("partial", [f"{len(assumptions)} assumptions used"])
    return ("real", [])


def _check_numeric_drift(
    calibrated: Optional[dict],
    static: Dict[str, float],
    threshold: float,
    label: str,
) -> List[str]:
    """Return drift warnings when calibrated values deviate too far from static priors."""
    if not calibrated or not isinstance(calibrated, dict):
        return []
    values = calibrated.get("values") or {}
    if not values:
        return []
    warnings: List[str] = []
    for asset in static:
        cal_val = values.get(asset)
        static_val = static.get(asset)
        if cal_val is None or static_val is None:
            continue
        try:
            diff = abs(float(cal_val) - float(static_val))
        except (TypeError, ValueError):
            continue
        if diff > threshold:
            warnings.append(
                f"{label}/{asset}: calibrated={float(cal_val):.1f}% vs static={float(static_val):.1f}% (delta={diff:.1f}%)"
            )
    return warnings


def _check_jump_drift(params: Optional[dict], jump_prob_range: Tuple[float, float] = (_DEFAULT_JUMP_PROB_MIN, _DEFAULT_JUMP_PROB_MAX)) -> List[str]:
    """Warn if jump params drift outside conservative range."""
    if not params or not isinstance(params, dict):
        return []
    warnings: List[str] = []
    jp = params.get("params") or params
    if not isinstance(jp, dict):
        return []
    if "jump_probability" not in jp:
        return ["jump_params/jump_probability: missing"]
    jp_val = jp.get("jump_probability")
    try:
        jp_val = float(jp_val)
    except (TypeError, ValueError):
        return ["jump_params/jump_probability: unreadable"]
    if jp_val < jump_prob_range[0] or jp_val > jump_prob_range[1]:
        warnings.append(
            f"jump_params/jump_probability={jp_val:.4f} outside [{jump_prob_range[0]},{jump_prob_range[1]}]"
        )
    return warnings


def _summarize_static_section(
    name: str, reason: str = "uses static defaults"
) -> CalibrationSectionItem:
    """Create an assumption-status item for a section backed by static config only."""
    return CalibrationSectionItem(
        key=name,
        status="assumption",
        source="static_config",
        as_of=_today(),
        calibration_version=None,
        coverage=0.0,
        invalid_count=0,
        assumption_count=1,
        warnings=[reason],
    )


def _build_section(
    name: str, result: Optional[dict], coverage_threshold: float = _DEFAULT_COVERAGE_THRESHOLD
) -> CalibrationSectionItem:
    """Build a section audit item from a calibration result dict."""
    if result is None:
        return CalibrationSectionItem(
            key=name,
            status="missing",
            source="none",
            warnings=["section not found in calibration cache"],
        )

    status, warnings = _section_status_from_result(result, coverage_threshold)

    return CalibrationSectionItem(
        key=name,
        status=status,
        source=result.get("source", "unknown"),
        as_of=result.get("as_of"),
        calibration_version=result.get("calibration_version"),
        coverage=result.get("coverage"),
        invalid_count=len(result.get("invalid_assets") or {}),
        assumption_count=len(result.get("assumptions_used") or []),
        warnings=warnings,
    )


def audit_calibration() -> dict:
    """Read-only audit of StatsSnapshotCache("historical_calibration").

    Returns a stable dict even when the cache is missing or malformed.

    Return shape::

        {
            "health": "healthy" | "degraded" | "critical" | "unknown",
            "sections": [{CalibrationSectionItem.to_dict()}, ...],
            "warning_count": int,
            "missing_count": int,
            "policy": {AuditPolicy.to_dict()},
        }
    """
    # --- Load cache safely ---
    cache: Optional[dict] = None
    try:
        from app.storage.database import StatsSnapshotCache

        cache = StatsSnapshotCache.get("historical_calibration")
    except Exception:
        pass
    if not isinstance(cache, dict):
        cache = None

    # --- Resolve audit policy ---
    policy = _resolve_policy(cache)

    sections: List[CalibrationSectionItem] = []

    # --- Process each section ---
    for key in _SECTION_KEYS:
        raw = cache.get(key) if cache else None
        if isinstance(raw, dict):
            section = _build_section(key, raw, policy.coverage_threshold)
        else:
            section = CalibrationSectionItem(
                key=key, status="missing", source="none", warnings=["cache entry missing or malformed"]
            )
        sections.append(section)

    # --- Drift checks for numeric sections ---
    eq_returns = cache.get("equilibrium_returns") if cache else None
    eq_vols = cache.get("equilibrium_vols") if cache else None
    jump_raw = cache.get("jump_params") if cache else None

    # Annotate drift on the matched section items
    for section in sections:
        if section.status == "missing":
            continue
        if section.status == "assumption" and "cache entry missing" not in section.warnings:
            # No drift check for static-only sections
            continue

    # equilibrium_returns drift
    eq_ret_section = _find_section(sections, "equilibrium_returns")
    if eq_ret_section and eq_ret_section.status not in ("missing", "assumption"):
        d_w = _check_numeric_drift(eq_returns, EQUILIBRIUM_RETURNS, policy.return_drift_threshold, "return")
        eq_ret_section.warnings.extend(d_w)

    # equilibrium_vols drift
    eq_vol_section = _find_section(sections, "equilibrium_vols")
    if eq_vol_section and eq_vol_section.status not in ("missing", "assumption"):
        v_w = _check_numeric_drift(eq_vols, EQUILIBRIUM_VOLS, policy.vol_drift_threshold, "vol")
        eq_vol_section.warnings.extend(v_w)

    # jump_params drift
    jp_section = _find_section(sections, "jump_params")
    if jp_section and jp_section.status not in ("missing", "assumption"):
        j_w = _check_jump_drift(jump_raw, (policy.jump_probability_min, policy.jump_probability_max))
        jp_section.warnings.extend(j_w)

    # --- Aggregate health ---
    all_statuses = {s.status for s in sections}
    missing_count = sum(1 for s in sections if s.status == "missing")
    warning_count = sum(len(s.warnings) for s in sections)

    if "missing" not in all_statuses and "assumption" not in all_statuses:
        if warning_count == 0:
            health = "healthy"
        else:
            health = "degraded"
    elif "missing" in all_statuses and len(all_statuses - {"missing"}) <= 1:
        health = "critical"
    elif missing_count >= 3:
        health = "degraded"
    elif warning_count >= 5:
        health = "degraded"
    else:
        health = "degraded"

    if cache is None:
        health = "unknown"
        missing_count = len(_SECTION_KEYS)

    return {
        "health": health,
        "sections": [s.to_dict() for s in sections],
        "warning_count": warning_count,
        "missing_count": missing_count,
        "policy": policy.to_dict(),
    }


def _find_section(
    sections: List[CalibrationSectionItem], key: str
) -> Optional[CalibrationSectionItem]:
    """Linear search -- list is always len(_SECTION_KEYS)=9 so O(n) is fine."""
    for s in sections:
        if s.key == key:
            return s
    return None
