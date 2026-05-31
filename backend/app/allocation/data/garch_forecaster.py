"""GARCH(1,1) Volatility Forecaster.

Fits GARCH(1,1) models to asset return series and produces
forward-looking volatility estimates. This improves upon simple
rolling standard deviation by capturing volatility clustering
and mean-reversion.

The model:
  sigma_t^2 = omega + alpha * r_{t-1}^2 + beta * sigma_{t-1}^2

where:
  omega > 0, alpha >= 0, beta >= 0
  alpha + beta < 1 (stationarity condition)

Long-run variance: sigma_LR^2 = omega / (1 - alpha - beta)
Forecast h-step: sigma_h^2 = sigma_LR^2 + (alpha+beta)^h * (sigma_t^2 - sigma_LR^2)
"""
import logging
from typing import Dict, Optional

import numpy as np
from scipy.optimize import minimize

logger = logging.getLogger(__name__)


def fit_garch11(returns: np.ndarray) -> Optional[Dict]:
    """Fit GARCH(1,1) to a return series.

    Args:
        returns: 1D array of daily log returns

    Returns:
        dict with omega, alpha, beta, sigma_t (current conditional vol),
        sigma_lr (long-run vol), persistence (alpha+beta), or None on failure.
    """
    returns = np.asarray(returns, dtype=np.float64)
    if len(returns) < 60:
        return None

    # Initial variance estimate
    sigma2_0 = np.var(returns)
    if sigma2_0 < 1e-12:
        return None

    # Parameterize: [omega, alpha, beta] with bounds
    def log_likelihood(params):
        omega, alpha, beta = params
        T = len(returns)
        sigma2 = np.zeros(T)
        sigma2[0] = sigma2_0

        for t in range(1, T):
            sigma2[t] = omega + alpha * returns[t - 1] ** 2 + beta * sigma2[t - 1]
            sigma2[t] = max(sigma2[t], 1e-12)

        # Gaussian log-likelihood
        ll = -0.5 * np.sum(np.log(sigma2) + returns ** 2 / sigma2)
        return -ll  # Minimize negative log-likelihood

    # Bounds: omega > 0, alpha >= 0, beta >= 0, alpha+beta < 0.9999
    # Use transformation: optimize [log(omega), logit(alpha), logit(beta)]
    # But simpler: use bounded optimization
    x0 = [sigma2_0 * 0.01, 0.08, 0.88]  # Reasonable starting point

    bounds = [(1e-10, 10 * sigma2_0), (0.0, 0.5), (0.0, 0.99)]
    constraints = [
        {"type": "ineq", "fun": lambda p: 0.9999 - p[1] - p[2]},  # alpha+beta < 1
    ]

    try:
        result = minimize(
            log_likelihood, x0, method="SLSQP",
            bounds=bounds, constraints=constraints,
            options={"maxiter": 300, "ftol": 1e-10},
        )

        if not result.success:
            return None

        omega, alpha, beta = result.x
        persistence = alpha + beta

        # Current conditional volatility
        T = len(returns)
        sigma2 = np.zeros(T)
        sigma2[0] = sigma2_0
        for t in range(1, T):
            sigma2[t] = omega + alpha * returns[t - 1] ** 2 + beta * sigma2[t - 1]
            sigma2[t] = max(sigma2[t], 1e-12)

        sigma_t = np.sqrt(sigma2[-1])  # Latest conditional vol (daily)
        sigma_lr = np.sqrt(omega / (1 - persistence))  # Long-run daily vol

        return {
            "omega": omega,
            "alpha": alpha,
            "beta": beta,
            "persistence": persistence,
            "sigma_t_daily": sigma_t,
            "sigma_lr_daily": sigma_lr,
            "sigma_t_annual": sigma_t * np.sqrt(252),
            "sigma_lr_annual": sigma_lr * np.sqrt(252),
        }
    except Exception as e:
        logger.debug(f"GARCH(1,1) fit failed: {e}")
        return None


def forecast_garch_vol(
    params: Dict,
    horizon_days: int = 21,
) -> float:
    """Forecast average volatility over a future horizon.

    Uses the GARCH(1,1) forecast formula:
      E[sigma^2_{t+h}] = sigma_lr^2 + (alpha+beta)^h * (sigma_t^2 - sigma_lr^2)

    Args:
        params: dict from fit_garch11()
        horizon_days: forecast horizon in trading days

    Returns:
        Annualized volatility forecast (as decimal, e.g. 0.18 for 18%)
    """
    omega = params["omega"]
    alpha = params["alpha"]
    beta = params["beta"]
    sigma_t = params["sigma_t_daily"]
    persistence = params["persistence"]
    sigma_lr = params["sigma_lr_daily"]

    sigma_t_sq = sigma_t ** 2
    sigma_lr_sq = sigma_lr ** 2

    # Average forecast variance over horizon
    total_var = 0.0
    for h in range(1, horizon_days + 1):
        var_h = sigma_lr_sq + (persistence ** h) * (sigma_t_sq - sigma_lr_sq)
        total_var += max(var_h, 1e-12)

    avg_var = total_var / horizon_days
    return float(np.sqrt(avg_var) * np.sqrt(252))


def compute_garch_vols(
    returns_dict: Dict[str, Optional[np.ndarray]],
    horizon_days: int = 21,
) -> Dict[str, Optional[float]]:
    """Fit GARCH(1,1) and forecast vol for multiple assets.

    Args:
        returns_dict: {asset_class: daily_log_returns_array}
        horizon_days: forecast horizon

    Returns:
        {asset_class: annualized_vol_decimal or None}
    """
    result = {}
    for asset, rets in returns_dict.items():
        if rets is None or len(rets) < 10:
            result[asset] = None
            continue

        if len(rets) < 60:
            # Too short for GARCH, use realized vol
            result[asset] = round(float(np.std(rets, ddof=1) * np.sqrt(252)), 6)
            continue

        params = fit_garch11(rets)
        if params is None:
            result[asset] = round(float(np.std(rets[-252:], ddof=1) * np.sqrt(252)), 6)
            continue

        garch_vol = forecast_garch_vol(params, horizon_days)
        result[asset] = round(garch_vol, 6)

    return result


def vol_regime_indicator(
    returns: np.ndarray,
    short_window: int = 20,
    long_window: int = 252,
) -> float:
    """Compute vol regime indicator: ratio of short to long-term vol.

    Returns:
        float > 1 means elevated vol, < 1 means calm market.
        Values > 1.5 trigger circuit breaker consideration.
    """
    if returns is None or len(returns) < long_window:
        return 1.0

    vol_short = float(np.std(returns[-short_window:], ddof=1) * np.sqrt(252))
    vol_long = float(np.std(returns[-long_window:], ddof=1) * np.sqrt(252))

    if vol_long < 1e-10:
        return 1.0
    return round(vol_short / vol_long, 3)
