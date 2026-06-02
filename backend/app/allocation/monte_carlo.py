"""Monte Carlo Simulation — Cholesky-correlated path generation with regime-aware jumps."""
import numpy as np
from typing import Dict, Optional

from .config import ASSET_CLASSES, N_ASSETS
from .matrix_utils import ensure_positive_definite
from .models import CMAResult, MonteCarloResult, RegimeState

# ─── Regime-aware jump parameters ───
# Jump probability, mean and vol vary by market regime.
# Crisis/deflation periods have higher jump prob and more negative mean.
_JUMP_PARAMS = {
    "goldilocks": {"prob": 0.015, "mean": -0.02, "vol": 0.025},
    "overheat":   {"prob": 0.025, "mean": -0.04, "vol": 0.030},
    "stagflation": {"prob": 0.035, "mean": -0.05, "vol": 0.035},
    "deflation":  {"prob": 0.045, "mean": -0.07, "vol": 0.040},
    "baseline":   {"prob": 0.020, "mean": -0.03, "vol": 0.025},
}

# Per-asset jump sensitivity (equity > commodity > bond > cash)
_ASSET_JUMP_SENSITIVITY = {
    "a_share_large": 1.2, "a_share_small": 1.4, "a_share_value": 1.1,
    "a_share_growth": 1.3, "hk_equity": 1.3, "us_equity": 1.2,
    "rate_bond": 0.3, "credit_bond": 0.5, "convertible": 0.9,
    "money_fund": 0.05, "gold": 0.8, "commodity": 1.1, "reits": 0.9, "cash": 0.05,
}


def simulate(
    allocations: Dict[str, float],
    cma: CMAResult,
    horizon_months: int = 36,
    n_paths: int = 1000,
    seed: int = 42,
    regime: Optional[RegimeState] = None,
) -> MonteCarloResult:
    """Run Monte Carlo simulation with Cholesky-correlated returns and regime-aware jumps.

    Args:
        allocations: asset weights (sum = 1)
        cma: Capital Market Assumptions (returns in %, cov in decimal)
        horizon_months: simulation horizon
        n_paths: number of simulation paths
        seed: random seed for reproducibility
        regime: optional regime state for jump diffusion parameters
    """
    rng = np.random.default_rng(seed)

    # Weights vector
    weights = np.array([allocations.get(a, 0.0) for a in ASSET_CLASSES])

    # Monthly parameters
    annual_returns = np.array([cma.expected_returns[a] / 100.0 for a in ASSET_CLASSES])
    monthly_returns = np.power(1 + annual_returns, 1 / 12.0) - 1

    # Annual covariance to monthly
    cov_annual = np.array(cma.covariance_matrix, dtype=np.float64)
    cov_monthly = cov_annual / 12.0
    cov_monthly = ensure_positive_definite(cov_monthly)

    # Cholesky decomposition
    L = np.linalg.cholesky(cov_monthly)

    # Jump parameters (regime-aware)
    regime_key = regime.regime if regime else "baseline"
    jp = _JUMP_PARAMS.get(regime_key, _JUMP_PARAMS["baseline"])
    jump_sensitivity = np.array([_ASSET_JUMP_SENSITIVITY.get(a, 1.0) for a in ASSET_CLASSES])

    # Simulate paths
    # Shape: (n_paths, horizon_months)
    portfolio_values = np.ones((n_paths, horizon_months + 1))

    for t in range(horizon_months):
        # Generate correlated random returns
        z = rng.standard_normal((n_paths, N_ASSETS))
        asset_returns = monthly_returns + z @ L.T  # (n_paths, n_assets)

        # Regime-aware jump diffusion (Poisson process)
        # Jump probability is uniform; only jump size is scaled by sensitivity
        jump_mask = rng.random((n_paths, N_ASSETS)) < jp["prob"]
        jump_sizes = rng.normal(jp["mean"] * jump_sensitivity[np.newaxis, :], jp["vol"], (n_paths, N_ASSETS))
        asset_returns += jump_mask * jump_sizes

        # Portfolio return for this month
        port_returns = asset_returns @ weights  # (n_paths,)

        # Update portfolio value
        portfolio_values[:, t + 1] = portfolio_values[:, t] * (1 + port_returns)

    # Terminal values
    terminal = portfolio_values[:, -1]
    total_returns = terminal - 1.0  # Convert to return

    # Drawdown calculation
    running_max = np.maximum.accumulate(portfolio_values, axis=1)
    drawdowns = (portfolio_values - running_max) / running_max
    max_drawdowns = drawdowns.min(axis=1)  # Most negative per path

    # Statistics
    median_return = float(np.median(total_returns))
    p10 = float(np.percentile(total_returns, 10))
    p25 = float(np.percentile(total_returns, 25))
    p75 = float(np.percentile(total_returns, 75))
    p90 = float(np.percentile(total_returns, 90))

    # VaR and CVaR (95%)
    # Two horizons are reported so consumers can compare across MC horizons:
    #   - var_95 / cvar_95: cumulative over the simulation horizon (legacy)
    #   - var_95_annual / cvar_95_annual: annualized, comparable across horizons
    var_95 = float(np.percentile(total_returns, 5))  # 5th percentile = 95% VaR
    cvar_95 = float(total_returns[total_returns <= var_95].mean()) if (total_returns <= var_95).any() else var_95
    horizon_years = max(horizon_months / 12.0, 1e-9)
    var_95_annual = 1.0 - (1.0 - var_95) ** (1.0 / horizon_years) if var_95 < 0 else var_95
    cvar_95_annual = 1.0 - (1.0 - cvar_95) ** (1.0 / horizon_years) if cvar_95 < 0 else cvar_95

    # Max drawdown at 95% confidence
    max_dd_95 = float(np.percentile(max_drawdowns, 5))  # 5th percentile of drawdowns

    # Probability of positive return
    prob_positive = float((total_returns > 0).mean())

    return MonteCarloResult(
        median_return=round(median_return * 100, 2),
        percentile_10=round(p10 * 100, 2),
        percentile_25=round(p25 * 100, 2),
        percentile_75=round(p75 * 100, 2),
        percentile_90=round(p90 * 100, 2),
        max_drawdown_95=round(max_dd_95 * 100, 2),
        var_95=round(var_95 * 100, 2),
        cvar_95=round(cvar_95 * 100, 2),
        var_95_annual=round(var_95_annual * 100, 2),
        cvar_95_annual=round(cvar_95_annual * 100, 2),
        prob_positive=round(prob_positive * 100, 1),
    )
