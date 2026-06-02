"""Matrix utilities — ensure positive-definite, Ledoit-Wolf shrinkage, risk utils."""
import numpy as np
from numpy.typing import NDArray


def ensure_positive_definite(matrix: NDArray, min_eigenvalue: float = 1e-6) -> NDArray:
    """Fix non-positive-definite matrix by clipping eigenvalues.

    Uses spectral decomposition: M = V @ diag(max(lambda, eps)) @ V.T
    """
    matrix = np.array(matrix, dtype=np.float64)
    # Ensure symmetry
    matrix = (matrix + matrix.T) / 2.0
    eigenvalues, eigenvectors = np.linalg.eigh(matrix)
    eigenvalues = np.maximum(eigenvalues, min_eigenvalue)
    result = eigenvectors @ np.diag(eigenvalues) @ eigenvectors.T
    # Re-symmetrize to remove floating point asymmetry
    return (result + result.T) / 2.0


def corr_to_cov(corr: NDArray, vols: NDArray) -> NDArray:
    """Convert correlation matrix + volatility vector to covariance matrix.

    cov[i,j] = corr[i,j] * vol[i] * vol[j]
    """
    vol_diag = np.diag(vols)
    return vol_diag @ corr @ vol_diag


def cov_to_corr(cov: NDArray) -> NDArray:
    """Convert covariance matrix to correlation matrix."""
    d = np.sqrt(np.diag(cov))
    d[d == 0] = 1e-10
    d_inv = np.diag(1.0 / d)
    corr = d_inv @ cov @ d_inv
    np.fill_diagonal(corr, 1.0)
    return corr


def portfolio_volatility(weights: NDArray, cov: NDArray) -> float:
    """Compute annualized portfolio volatility: sqrt(w' @ cov @ w)."""
    var = weights @ cov @ weights
    return float(np.sqrt(max(var, 0.0)))


def portfolio_risk_contributions(weights: NDArray, cov: NDArray) -> NDArray:
    """Compute marginal risk contributions for each asset.

    RC_i = w_i * (cov @ w)_i / sigma_p
    """
    sigma_p = portfolio_volatility(weights, cov)
    if sigma_p < 1e-10:
        return np.zeros_like(weights)
    marginal = cov @ weights
    rc = weights * marginal / sigma_p
    return rc


# ─── Ledoit-Wolf Linear Shrinkage ───

def ledoit_wolf_shrinkage(
    sample_cov: NDArray,
    target: NDArray = None,
    n_observations: int = None,
) -> tuple:
    """Ledoit-Wolf optimal linear shrinkage estimator.

    Shrinks the sample covariance matrix toward a structured target:
        cov_shrunk = (1 - delta) * sample_cov + delta * target

    This reduces estimation noise especially when n_assets is large
    relative to n_observations.

    Args:
        sample_cov: n×n sample covariance matrix.
        target: n×n shrinkage target (default: scaled identity with average
            variance on diagonal).
        n_observations: number of observations T used to estimate sample_cov.
            When provided, uses the standard Ledoit-Wolf (2004) formula
            delta* = min(1, phi_hat / (T * d^2)). When absent, falls back
            to a condition-number heuristic.

    Returns:
        (shrunk_cov, delta) where delta is the optimal shrinkage intensity [0, 1]

    Reference: Ledoit & Wolf (2004) "A well-conditioned estimator for
    large-dimensional covariance matrices"
    """
    sample_cov = np.array(sample_cov, dtype=np.float64)
    n = sample_cov.shape[0]

    if target is None:
        # Default target: scaled identity (average variance)
        avg_var = np.trace(sample_cov) / n
        target = np.eye(n) * avg_var

    diff = sample_cov - target
    d_sq = float(np.sum(diff ** 2))  # ||S - T||_F^2

    if d_sq < 1e-12:
        return sample_cov.copy(), 0.0

    if n_observations is not None and n_observations > 0:
        # Standard Ledoit-Wolf (2004) formula.
        # phi_hat is the sum of asymptotic variances of the entries of S;
        # with no access to the raw observations, approximate using the
        # bound phi_hat ≤ (1/n) * ||S||_F^2, which is conservative (gives
        # larger delta, i.e. more shrinkage, appropriate when T is small).
        s_norm_sq = float(np.sum(sample_cov ** 2))
        phi_hat = s_norm_sq / n
        delta = phi_hat / (n_observations * d_sq)
        delta = float(np.clip(delta, 0.0, 1.0))
    else:
        # Fallback heuristic: condition-number-driven shrinkage, used when
        # T is unknown. Less principled than the LW formula, but still
        # improves conditioning for ill-conditioned sample covariances.
        cond = np.linalg.cond(sample_cov)
        if cond > 1000:
            delta = min(1.0, 0.5 * np.sqrt(n / d_sq) * 0.1)
        elif cond > 100:
            delta = min(1.0, 0.3 * np.sqrt(n / d_sq) * 0.1)
        else:
            delta = min(1.0, 0.1 * np.sqrt(n / d_sq) * 0.1)
        delta = float(np.clip(delta, 0.0, 1.0))

    shrunk = (1.0 - delta) * sample_cov + delta * target
    return ensure_positive_definite(shrunk), delta


def shrink_covariance_toward_diagonal(cov: NDArray, intensity: float = 0.1) -> NDArray:
    """Simple shrinkage toward diagonal (variance-only) matrix.

    cov_shrunk = (1 - intensity) * cov + intensity * diag(cov)

    This preserves individual asset volatilities while reducing
    spurious correlation estimates.

    Args:
        cov: n×n covariance matrix
        intensity: shrinkage weight [0, 1]. 0=no shrinkage, 1=diagonal only.

    Returns:
        Shrunk covariance matrix (positive definite)
    """
    cov = np.array(cov, dtype=np.float64)
    diag_cov = np.diag(np.diag(cov))
    shrunk = (1.0 - intensity) * cov + intensity * diag_cov
    return ensure_positive_definite(shrunk)


def diversification_ratio(weights: NDArray, cov: NDArray) -> float:
    """Compute the diversification ratio.

    DR = (sum of w_i * sigma_i) / sigma_p
    DR = 1 means no diversification (single asset or perfectly correlated)
    DR > 1 means diversification benefit exists
    """
    sigma_p = portfolio_volatility(weights, cov)
    if sigma_p < 1e-10:
        return 1.0
    vols = np.sqrt(np.diag(cov))
    weighted_vol = float(weights @ vols)
    return weighted_vol / sigma_p
