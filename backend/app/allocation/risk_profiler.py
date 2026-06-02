"""Risk Profiler — maps user inputs to internal RiskProfile."""
from .config import RISK_PROFILES, HORIZON_MONTHS
from .models import AllocationRequest, RiskProfile, RiskTolerance

# Risk level ordering for up/down shifting
_RISK_LEVELS: list = ["conservative", "moderate", "balanced", "aggressive", "radical"]

# Behavior answer adjustments
_BEHAVIOR_ADJUSTMENTS = {
    "q1_drawdown": {"add": 1, "hold": 0, "reduce": -1, "sell": -2},
    "q2_rally": {"chase": 0, "hold": 1, "partial": 0, "all_out": -1},
    "q3_volatility": {"high": 2, "medium": 0, "low": -1, "none": -2},
}

RISK_LABELS = {
    "conservative": "保守型",
    "moderate": "稳健型",
    "balanced": "平衡型",
    "aggressive": "进取型",
    "radical": "激进型",
}


def profile_user(request: AllocationRequest) -> RiskProfile:
    """Convert AllocationRequest to internal RiskProfile with behavior calibration and glide path."""
    risk_tol = request.risk_tolerance
    profile_params = RISK_PROFILES[risk_tol]

    # ─── Behavior calibration ───
    effective_risk = risk_tol
    behavior_adjusted = False

    if request.behavior_answers:
        total_adj = 0.0
        count = 0
        for qid, adjustments in _BEHAVIOR_ADJUSTMENTS.items():
            answer = request.behavior_answers.get(qid)
            if answer and answer in adjustments:
                total_adj += adjustments[answer]
                count += 1

        if count > 0:
            avg_adj = total_adj / count
            idx = _RISK_LEVELS.index(risk_tol)
            if avg_adj < -0.5:
                new_idx = max(0, idx - 1)
            elif avg_adj > 1.5:
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
    )
