"""Risk Profiler — maps user inputs to internal RiskProfile."""
from typing import Optional, Tuple

from .config import RISK_PROFILES, HORIZON_MONTHS
from .models import AllocationRequest, RiskProfile, RiskTolerance

# Risk level ordering for up/down shifting
_RISK_LEVELS: list = ["conservative", "moderate", "balanced", "aggressive", "radical"]

# Behavior answer adjustments (static defaults)
_BEHAVIOR_ADJUSTMENTS = {
    "q1_drawdown": {"add": 1, "hold": 0, "reduce": -1, "sell": -2},
    "q2_rally": {"chase": 0, "hold": 1, "partial": 0, "all_out": -1},
    "q3_volatility": {"high": 2, "medium": 0, "low": -1, "none": -2},
}

# Default behavior thresholds
_DEFAULT_SHIFT_DOWN_THRESHOLD = -0.5
_DEFAULT_SHIFT_UP_THRESHOLD = 1.5

RISK_LABELS = {
    "conservative": "保守型",
    "moderate": "稳健型",
    "balanced": "平衡型",
    "aggressive": "进取型",
    "radical": "激进型",
}


def _load_calibration() -> Tuple[Optional[dict], Optional[dict]]:
    """Load risk-questionnaire calibration from StatsSnapshotCache.

    Reads StatsSnapshotCache("historical_calibration") ->
    risk_questionnaire.params, expecting:
      {
        "weights": {"q1_drawdown": {"add": 1, ...}, ...},
        "shift_down_threshold": -0.5,
        "shift_up_threshold": 1.5,
      }

    Returns (weights, meta) where weights is the answer-weight dict
    (or None to use static defaults) and meta is a dict of provenance
    fields (or None).
    """
    try:
        from app.storage.database import StatsSnapshotCache

        cached = StatsSnapshotCache.get("historical_calibration")
        if not isinstance(cached, dict):
            return None, None

        section = cached.get("risk_questionnaire", {})
        if isinstance(section, dict):
            # Preserve meta fields from parent section before extracting params
            _parent_source = section.get("source")
            _parent_cal_ver = section.get("calibration_version")
            _parent_as_of = section.get("as_of")
            # Support both {"params": {...}} and flat {...}
            section = section.get("params", section)
            # Re-inject parent meta so section.get("source") works
            if _parent_source is not None:
                section.setdefault("source", _parent_source)
            if _parent_cal_ver is not None:
                section.setdefault("calibration_version", _parent_cal_ver)
            if _parent_as_of is not None:
                section.setdefault("as_of", _parent_as_of)
        if not isinstance(section, dict) or not section:
            return None, None

        weights = section.get("weights")
        if not isinstance(weights, dict) or not weights:
            weights = None

        # Validate weights shape: must be {qid: {answer: numeric}}
        if weights is not None:
            validated = {}
            for qid, answers in weights.items():
                if not isinstance(qid, str) or not isinstance(answers, dict):
                    continue
                validated_answers = {}
                for ans, val in answers.items():
                    if isinstance(val, (int, float)) and not isinstance(val, bool):
                        validated_answers[str(ans)] = float(val)
                if validated_answers:
                    validated[str(qid)] = validated_answers
            weights = validated if validated else None

        # Extract thresholds (numeric only, fall back to defaults)
        shift_down = _DEFAULT_SHIFT_DOWN_THRESHOLD
        shift_up = _DEFAULT_SHIFT_UP_THRESHOLD
        raw_down = section.get("shift_down_threshold")
        raw_up = section.get("shift_up_threshold")
        if isinstance(raw_down, (int, float)) and not isinstance(raw_down, bool):
            shift_down = float(raw_down)
        if isinstance(raw_up, (int, float)) and not isinstance(raw_up, bool):
            shift_up = float(raw_up)

        meta = {
            "source": section.get("source") or "sqlite_cache",
            "calibration_version": section.get("calibration_version"),
            "as_of": section.get("as_of"),
            "shift_down_threshold": shift_down,
            "shift_up_threshold": shift_up,
        }
        return weights, meta
    except Exception:
        return None, None


def profile_user(request: AllocationRequest) -> RiskProfile:
    """Convert AllocationRequest to internal RiskProfile with behavior calibration and glide path."""
    risk_tol = request.risk_tolerance
    profile_params = RISK_PROFILES[risk_tol]

    # ─── Load calibration (cache-backed, graceful fallback) ───
    cal_weights, cal_meta = _load_calibration()
    adjustments = cal_weights if cal_weights else _BEHAVIOR_ADJUSTMENTS
    shift_down = (
        cal_meta.get("shift_down_threshold", _DEFAULT_SHIFT_DOWN_THRESHOLD)
        if cal_meta
        else _DEFAULT_SHIFT_DOWN_THRESHOLD
    )
    shift_up = (
        cal_meta.get("shift_up_threshold", _DEFAULT_SHIFT_UP_THRESHOLD)
        if cal_meta
        else _DEFAULT_SHIFT_UP_THRESHOLD
    )

    # ─── Behavior calibration ───
    effective_risk = risk_tol
    behavior_adjusted = False
    behavior_score: Optional[float] = None
    behavior_question_count: Optional[int] = None

    if request.behavior_answers:
        total_adj = 0.0
        count = 0
        for qid, answer_weights in adjustments.items():
            answer = request.behavior_answers.get(qid)
            if answer and answer in answer_weights:
                total_adj += answer_weights[answer]
                count += 1

        if count > 0:
            avg_adj = total_adj / count
            behavior_score = round(avg_adj, 4)
            behavior_question_count = count
            idx = _RISK_LEVELS.index(risk_tol)
            if avg_adj < shift_down:
                new_idx = max(0, idx - 1)
            elif avg_adj > shift_up:
                new_idx = min(len(_RISK_LEVELS) - 1, idx + 1)
            else:
                new_idx = idx

            if new_idx != idx:
                effective_risk = _RISK_LEVELS[new_idx]
                behavior_adjusted = True

    # Use effective risk for actual parameters
    effective_params = RISK_PROFILES[effective_risk]
    equity_center = effective_params["equity_center"]

    # ─── Glide path: age-based equity reduction, modulated by horizon ───
    glide_path_applied = False
    age = request.age
    horizon = request.investment_horizon or "medium"
    horizon_months = HORIZON_MONTHS.get(horizon, 36)
    if age > 40:
        # Horizon attenuation: long-horizon investors can tolerate more equity
        # at the same age (e.g., 70y with 15y horizon vs 70y with 1y horizon).
        # Multiplier: short=1.0, medium=0.85, long=0.7, very_long=0.55
        horizon_factor = {
            "short": 1.0,
            "medium": 0.85,
            "long": 0.7,
            "very_long": 0.55,
        }.get(horizon, 0.85)
        reduction = (age - 40) * 0.5 * horizon_factor  # % per year attenuated by horizon
        equity_center = max(10, equity_center - reduction)
        glide_path_applied = True

    # ─── Max drawdown override ───
    max_dd = request.max_drawdown if request.max_drawdown else effective_params["max_drawdown"]

    # ─── Horizon ───
    horizon = request.investment_horizon or "medium"
    horizon_months = HORIZON_MONTHS.get(horizon, 36)

    return RiskProfile(
        risk_tolerance=risk_tol,
        effective_risk=effective_risk,
        equity_center=equity_center,
        max_drawdown=max_dd,
        volatility_target=effective_params["volatility_target"],
        behavior_adjusted=behavior_adjusted,
        glide_path_applied=glide_path_applied,
        age=age,
        amount=request.amount,
        horizon=horizon,
        horizon_months=horizon_months,
        behavior_score=behavior_score,
        behavior_question_count=behavior_question_count,
        behavior_source=cal_meta.get("source", "static_defaults") if cal_meta else "static_defaults",
        behavior_calibration_version=cal_meta.get("calibration_version") if cal_meta else None,
        behavior_as_of=cal_meta.get("as_of") if cal_meta else None,
    )
