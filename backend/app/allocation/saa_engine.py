"""SAA Engine — 6-level fallback optimizer for Strategic Asset Allocation.

Levels:
  L1: SLSQP risk-budget optimization
  L2: Minimum Volatility
  L3: Equal Risk Contribution (ERC) — cyclical coordinate descent
  L4: Inverse Volatility weighting
  L5: Conservative fallback template
  L6: Maximum Diversification (optional, via `optimizer_mode`)
"""
import numpy as np
from scipy.optimize import minimize

from .config import (
    ASSET_BOUNDS,
    ASSET_CLASSES,
    ASSET_TO_GROUP,
    FALLBACK_TEMPLATES,
    GROUP_MAP,
    RISK_BUDGETS,
)
from .matrix_utils import (
    ensure_positive_definite,
    portfolio_risk_contributions,
    portfolio_volatility,
)
from .models import CMAResult, RiskProfile


def optimize_saa(profile: RiskProfile, cma: CMAResult) -> dict:
    """Run 5-level fallback SAA optimization.

    Returns dict with:
      - allocations: {asset: weight}  (sum = 1.0)
      - optimizer_level: int (1-5)
      - risk_contributions: {asset: RC}
      - expected_return: float (%)
      - expected_volatility: float (%)
    """
    cov = np.array(cma.covariance_matrix, dtype=np.float64)
    cov = ensure_positive_definite(cov)
    returns = np.array([cma.expected_returns[a] / 100.0 for a in ASSET_CLASSES])

    # Equity center constraint
    equity_center = profile.equity_center / 100.0
    risk_level = profile.effective_risk

    # Bounds for each asset
    bounds = [ASSET_BOUNDS[a] for a in ASSET_CLASSES]

    # Target risk budgets
    target_budgets = RISK_BUDGETS[risk_level]

    # Try each level sequentially
    for level, optimizer_fn in enumerate([
        lambda: _l1_risk_budget(cov, returns, bounds, target_budgets, equity_center),
        lambda: _l2_min_vol(cov, returns, bounds, equity_center),
        lambda: _l3_erc(cov, bounds),
        lambda: _l4_inverse_vol(cma),
        lambda: _l5_template(risk_level),
    ], start=1):
        try:
            weights = optimizer_fn()
            if weights is not None and _validate_weights(weights):
                break
        except Exception:
            weights = None
            continue
    else:
        # Should never reach here since L5 always succeeds
        weights = _l5_template(risk_level)
        level = 5

    # Normalize to sum exactly 1
    weights = _normalize(weights)

    # Compute metrics
    w = np.array(weights)
    port_vol = portfolio_volatility(w, cov)
    port_ret = float(w @ returns)
    rc = portfolio_risk_contributions(w, cov)

    allocations = {a: round(weights[i], 6) for i, a in enumerate(ASSET_CLASSES)}
    risk_contribs = {a: round(float(rc[i]), 6) for i, a in enumerate(ASSET_CLASSES)}

    return {
        "allocations": allocations,
        "optimizer_level": level,
        "risk_contributions": risk_contribs,
        "expected_return": round(port_ret * 100, 2),
        "expected_volatility": round(port_vol * 100, 2),
    }


# ─── Level 1: SLSQP Risk Budget ───

def _l1_risk_budget(cov, returns, bounds, target_budgets, equity_center):
    """Minimize distance between actual and target risk contributions."""
    n = cov.shape[0]

    # Map group budgets to per-asset targets — group-level constraint only,
    # optimizer decides intra-group distribution based on risk characteristics
    group_target_rc = {}
    for grp, budget in target_budgets.items():
        group_assets = GROUP_MAP[grp]
        for a in group_assets:
            idx = ASSET_CLASSES.index(a)
            group_target_rc[idx] = (grp, budget)

    def objective(w):
        rc = portfolio_risk_contributions(w, cov)
        total_rc = rc.sum()
        if total_rc < 1e-10:
            return 1e6
        rc_pct = rc / total_rc
        # Group-level L2 distance: sum of (group_rc_sum - group_target)^2
        group_sums = {}
        for idx, (grp, _budget) in group_target_rc.items():
            group_sums.setdefault(grp, 0.0)
            group_sums[grp] += rc_pct[idx]
        loss = 0.0
        for grp, budget in target_budgets.items():
            loss += (group_sums.get(grp, 0.0) - budget) ** 2
        return float(loss)

    # Constraints
    constraints = [
        {"type": "eq", "fun": lambda w: np.sum(w) - 1.0},
    ]

    # Equity group constraint
    eq_indices = [ASSET_CLASSES.index(a) for a in GROUP_MAP["equity"]]

    def equity_constraint_upper(w):
        return (equity_center + 0.10) - sum(w[i] for i in eq_indices)

    def equity_constraint_lower(w):
        return sum(w[i] for i in eq_indices) - max(0, equity_center - 0.10)

    constraints.append({"type": "ineq", "fun": equity_constraint_upper})
    constraints.append({"type": "ineq", "fun": equity_constraint_lower})

    # Initial guess: equal weight
    x0 = np.ones(n) / n

    result = minimize(
        objective,
        x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 500, "ftol": 1e-10},
    )

    if result.success and result.fun < 0.01:
        return result.x.tolist()
    return None


# ─── Level 2: Minimum Volatility ───

def _l2_min_vol(cov, returns, bounds, equity_center):
    """Minimize portfolio volatility subject to equity center constraint."""
    n = cov.shape[0]
    eq_indices = [ASSET_CLASSES.index(a) for a in GROUP_MAP["equity"]]

    def objective(w):
        return portfolio_volatility(w, cov)

    constraints = [
        {"type": "eq", "fun": lambda w: np.sum(w) - 1.0},
        {"type": "ineq", "fun": lambda w: (equity_center + 0.15) - sum(w[i] for i in eq_indices)},
        {"type": "ineq", "fun": lambda w: sum(w[i] for i in eq_indices) - max(0, equity_center - 0.15)},
    ]

    x0 = np.ones(n) / n
    result = minimize(
        objective, x0, method="SLSQP",
        bounds=bounds, constraints=constraints,
        options={"maxiter": 300, "ftol": 1e-9},
    )

    if result.success:
        return result.x.tolist()
    return None


# ─── Level 3: Equal Risk Contribution (Enhanced) ───

def _l3_erc(cov, bounds):
    """Equal Risk Contribution — SLSQP-first with CCD fallback.

    SLSQP is more reliable for bounded ERC problems. CCD is used as
    a fast-path when it converges cleanly.

    Reference: Maillard, Roncalli & Teïletche (2010)
    """
    # Try SLSQP first (most reliable with bounds)
    weights = _erc_slsqp(cov, bounds)
    if weights is not None:
        return weights
    # Fall back to CCD
    return _erc_ccd(cov, bounds)


def _erc_ccd(cov, bounds, max_iter=200, tol=1e-8):
    """ERC via undamped cyclical coordinate descent."""
    n = cov.shape[0]
    w = np.ones(n) / n
    bounds_arr = np.array(bounds)

    for iteration in range(max_iter):
        w_old = w.copy()

        for i in range(n):
            a = float(cov[i] @ w)
            if a < 1e-12:
                continue
            var_p = float(w @ cov @ w)
            if var_p < 1e-12:
                break
            # ERC: target each RC to equal sigma_p / n
            # (RC_i = w_i * (cov @ w)_i, summing to var_p; equal-RC means each ≈ sqrt(var_p)/n)
            sigma_p = np.sqrt(var_p)
            target_rc_i = sigma_p / n
            w_new_i = target_rc_i / a
            w[i] = np.clip(w_new_i, bounds_arr[i, 0], bounds_arr[i, 1])

        total = w.sum()
        if total < 1e-10:
            return None
        w = w / total

        if np.max(np.abs(w - w_old)) < tol:
            break

    rc = portfolio_risk_contributions(w, cov)
    total_rc = rc.sum()
    if total_rc < 1e-10:
        return None
    rc_pct = rc / total_rc
    max_dev = float(np.max(np.abs(rc_pct - 1.0 / n)))
    if max_dev < 0.05:
        return w.tolist()
    return None


def _erc_slsqp(cov, bounds):
    """ERC via SLSQP (fallback if CCD fails)."""
    n = cov.shape[0]
    target_rc = np.ones(n) / n

    def objective(w):
        rc = portfolio_risk_contributions(w, cov)
        total_rc = rc.sum()
        if total_rc < 1e-10:
            return 1e6
        rc_pct = rc / total_rc
        return float(np.sum((rc_pct - target_rc) ** 2))

    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
    x0 = np.ones(n) / n

    result = minimize(
        objective, x0, method="SLSQP",
        bounds=bounds, constraints=constraints,
        options={"maxiter": 300, "ftol": 1e-9},
    )

    if result.success:
        return result.x.tolist()
    return None


# ─── Standalone ERC function (for external use) ───

def optimize_erc(cov_matrix: np.ndarray, bounds: list = None) -> dict:
    """Standalone ERC optimizer for external use.

    Args:
        cov_matrix: n×n covariance matrix
        bounds: list of (min, max) per asset, defaults to (0, 1)

    Returns:
        dict with weights, risk_contributions, erc_quality (0-1)
    """
    n = cov_matrix.shape[0]
    cov = ensure_positive_definite(cov_matrix)
    if bounds is None:
        bounds = [(0.0, 1.0)] * n

    weights = _erc_slsqp(cov, bounds)
    if weights is None:
        weights = _erc_ccd(cov, bounds)
    if weights is None:
        weights = (np.ones(n) / n).tolist()

    w = np.array(weights)
    w = np.maximum(w, 0)
    w /= w.sum()

    rc = portfolio_risk_contributions(w, cov)
    rc_pct = rc / rc.sum() if rc.sum() > 1e-10 else rc
    erc_quality = 1.0 - float(np.max(np.abs(rc_pct - 1.0 / n)) / (1.0 / n))

    return {
        "weights": w.tolist(),
        "risk_contributions": rc.tolist(),
        "risk_contribution_pcts": rc_pct.tolist(),
        "erc_quality": round(max(0, erc_quality), 4),
        "portfolio_volatility": round(portfolio_volatility(w, cov), 6),
    }


# ─── Level 6: Maximum Diversification ───

def _l6_max_div(cov, bounds):
    """Maximum Diversification — maximize the diversification ratio.

    DR = (sum of w_i * sigma_i) / sigma_p
    """
    n = cov.shape[0]
    vols = np.sqrt(np.diag(cov))

    def objective(w):
        sigma_p = portfolio_volatility(w, cov)
        if sigma_p < 1e-10:
            return 1e6
        return -float(w @ vols) / sigma_p

    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
    x0 = np.ones(n) / n

    result = minimize(
        objective, x0, method="SLSQP",
        bounds=bounds, constraints=constraints,
        options={"maxiter": 300, "ftol": 1e-9},
    )

    if result.success:
        return result.x.tolist()
    return None


# ─── Level 4: Inverse Volatility ───

def _l4_inverse_vol(cma: CMAResult):
    """Inverse volatility weighting — closed-form, always succeeds."""
    vols = np.array([cma.volatilities[a] for a in ASSET_CLASSES])
    # Floor at 1.0% so a money-market fund (vol≈0.5%) doesn't dominate weights
    vols = np.maximum(vols, 1.0)  # Prevent division by zero and extreme concentration
    inv_vol = 1.0 / vols
    weights = inv_vol / inv_vol.sum()
    return weights.tolist()


# ─── Level 5: Conservative Template ───

def _l5_template(risk_level: str):
    """Hardcoded template — never fails."""
    template = FALLBACK_TEMPLATES[risk_level]
    return [template[a] for a in ASSET_CLASSES]


# ─── Helpers ───

def _validate_weights(weights) -> bool:
    """Check weights are valid (non-negative, sum close to 1)."""
    if weights is None:
        return False
    w = np.array(weights)
    if np.any(np.isnan(w)) or np.any(np.isinf(w)):
        return False
    if np.any(w < -0.01):
        return False
    if abs(w.sum() - 1.0) > 0.05:
        return False
    return True


def _normalize(weights) -> list:
    """Normalize weights to sum exactly 1.0, clip negatives."""
    w = np.array(weights, dtype=np.float64)
    w = np.maximum(w, 0.0)
    total = w.sum()
    if total < 1e-10:
        w = np.ones(len(w)) / len(w)
    else:
        w = w / total
    return w.tolist()
