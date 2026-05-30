"""Factor Exposure — portfolio-level factor loading calculation."""
from typing import Dict

from .config import ASSET_CLASSES, FACTOR_LOADINGS


def calculate_exposures(allocations: Dict[str, float]) -> Dict[str, float]:
    """Calculate portfolio factor exposures as weighted sum of asset loadings.

    Factors:
      - equity_beta: Sensitivity to equity market moves
      - term_premium: Duration/interest rate exposure
      - credit_premium: Credit spread exposure
      - inflation: Inflation sensitivity
      - liquidity: Liquidity premium exposure
    """
    factors = ["equity_beta", "term_premium", "credit_premium", "inflation", "liquidity"]
    exposures = {f: 0.0 for f in factors}

    for asset in ASSET_CLASSES:
        weight = allocations.get(asset, 0.0)
        if weight < 0.001:
            continue

        loadings = FACTOR_LOADINGS.get(asset, {})
        for factor in factors:
            exposures[factor] += weight * loadings.get(factor, 0.0)

    # Round for cleanliness
    return {f: round(v, 4) for f, v in exposures.items()}
