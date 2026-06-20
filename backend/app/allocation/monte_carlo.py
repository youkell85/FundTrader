"""Monte Carlo Simulation — Cholesky-correlated path generation with regime-aware jumps."""
import numpy as np
from typing import Dict, Optional, Tuple

from .config import ASSET_CLASSES, N_ASSETS
from .matrix_utils import ensure_positive_definite
from .models import CMAResult, MonteCarloResult, RegimeState

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
    if not np.all(np.isfinite(weights)):
        raise ValueError("Monte Carlo input allocations contain non-finite values")

    # Monthly parameters
    annual_returns = np.array([cma.expected_returns[a] / 100.0 for a in ASSET_CLASSES])
    if not np.all(np.isfinite(annual_returns)):
        raise ValueError("Monte Carlo expected returns contain non-finite values")
    if np.any(annual_returns <= -1.0):
        raise ValueError("Monte Carlo expected returns must be greater than -100%")
    monthly_returns = np.power(1 + annual_returns, 1 / 12.0) - 1
    if not np.all(np.isfinite(monthly_returns)):
        raise ValueError("Monte Carlo monthly returns contain non-finite values")

    # Annual covariance to monthly
    cov_annual = np.array(cma.covariance_matrix, dtype=np.float64)
    if cov_annual.shape != (N_ASSETS, N_ASSETS):
        raise ValueError("Monte Carlo covariance matrix has invalid shape")
    if not np.all(np.isfinite(cov_annual)):
        raise ValueError("Monte Carlo covariance matrix contains non-finite values")
    cov_monthly = cov_annual / 12.0
    cov_monthly = ensure_positive_definite(cov_monthly)
    if not np.all(np.isfinite(cov_monthly)):
        raise ValueError("Monte Carlo monthly covariance contains non-finite values")

    # Cholesky decomposition
    L = np.linalg.cholesky(cov_monthly)

    # Jump parameters. Jumps are injected only when calibrated data exists.
    regime_key = regime.regime if regime else "baseline"
    jp, jump_metadata = _load_jump_params(regime_key)

    # Simulate paths
    # Shape: (n_paths, horizon_months)
    portfolio_values = np.ones((n_paths, horizon_months + 1))

    for t in range(horizon_months):
        # Generate correlated random returns
        z = rng.standard_normal((n_paths, N_ASSETS))
        asset_returns = monthly_returns + z @ L.T  # (n_paths, n_assets)

        # Calibrated jump diffusion (Poisson process). If calibration is
        # missing, probability is 0 and no jump shock is injected.
        if jp["prob"] > 0:
            jump_mask = rng.random((n_paths, N_ASSETS)) < jp["prob"]
            jump_sizes = rng.normal(jp["mean"], jp["vol"], (n_paths, N_ASSETS))
            asset_returns += jump_mask * jump_sizes

        # Portfolio return for this month
        port_returns = asset_returns @ weights  # (n_paths,)
        if not np.all(np.isfinite(port_returns)):
            raise ValueError("Monte Carlo generated non-finite portfolio returns")

        # Update portfolio value
        portfolio_values[:, t + 1] = portfolio_values[:, t] * (1 + port_returns)
        if (
            not np.all(np.isfinite(portfolio_values[:, t + 1]))
            or np.any(portfolio_values[:, t + 1] <= 0)
        ):
            raise ValueError("Monte Carlo generated invalid portfolio values")

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

    stats = [
        median_return, p10, p25, p75, p90, max_dd_95,
        var_95, cvar_95, var_95_annual, cvar_95_annual, prob_positive,
    ]
    if not np.all(np.isfinite(stats)):
        raise ValueError("Monte Carlo output contains non-finite values")

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
        jump_source=jump_metadata.get("source"),
        jump_as_of=jump_metadata.get("as_of"),
        jump_sample_size=jump_metadata.get("sample_size"),
        calibration_version=jump_metadata.get("calibration_version"),
        jump_missing_reason=jump_metadata.get("missing_reason"),
    )


def _load_jump_params(regime_key: str) -> Tuple[dict, dict]:
    """Load calibrated jump parameters when available, otherwise disable jumps."""
    missing = _missing_jump_params(f"missing calibrated jump params for regime={regime_key}")
    try:
        from app.storage.database import StatsSnapshotCache

        snapshot = StatsSnapshotCache.get("historical_calibration") or {}
        section = snapshot.get("jump_params") or {}
        source = section.get("source") or "sqlite_cache"
        status = section.get("status") or section.get("data_status")
        if source == "static_assumption" or status == "assumption":
            return _missing_jump_params("jump_params calibration is static assumption")
        params = section.get("params") or {}
        prob = params.get("prob", params.get("jump_probability"))
        mean = params.get("mean", params.get("jump_mean"))
        vol = params.get("vol", params.get("jump_vol"))
        if prob is None or mean is None or vol is None:
            return missing
        prob = float(prob)
        mean = float(mean)
        vol = float(vol)
        if prob < 0 or prob > 1 or vol < 0:
            return _missing_jump_params("invalid calibrated jump params")
        return {
            "prob": prob,
            "mean": mean,
            "vol": vol,
        }, {
            "source": source,
            "as_of": section.get("as_of"),
            "sample_size": params.get("sample_size"),
            "calibration_version": section.get("calibration_version"),
            "missing_reason": None,
        }
    except Exception:
        return _missing_jump_params("jump_params calibration cache unavailable")


def _missing_jump_params(reason: str) -> Tuple[dict, dict]:
    return {
        "prob": 0.0,
        "mean": 0.0,
        "vol": 0.0,
    }, {
        "source": "missing",
        "as_of": None,
        "sample_size": None,
        "calibration_version": None,
        "missing_reason": reason,
    }
