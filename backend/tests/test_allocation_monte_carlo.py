import json
import unittest

import numpy as np

from app.allocation.config import ASSET_CLASSES, N_ASSETS
from app.allocation.models import CMAResult
from app.allocation.monte_carlo import simulate


def _cma_with_return(expected_return: float) -> CMAResult:
    return CMAResult(
        expected_returns={asset: expected_return for asset in ASSET_CLASSES},
        volatilities={asset: 5.0 for asset in ASSET_CLASSES},
        covariance_matrix=(np.eye(N_ASSETS) * 0.0025).tolist(),
    )


class AllocationMonteCarloTest(unittest.TestCase):
    def test_simulate_rejects_return_below_minus_100_percent(self):
        allocations = {asset: 1.0 / N_ASSETS for asset in ASSET_CLASSES}
        cma = _cma_with_return(-184.87)

        with self.assertRaisesRegex(ValueError, "greater than -100%"):
            simulate(allocations, cma, horizon_months=12, n_paths=100)

    def test_simulate_result_is_strict_json_serializable(self):
        allocations = {asset: 1.0 / N_ASSETS for asset in ASSET_CLASSES}
        cma = _cma_with_return(4.0)

        result = simulate(allocations, cma, horizon_months=12, n_paths=100)
        payload = result.model_dump()

        json.dumps(payload, allow_nan=False)
        for value in payload.values():
            if isinstance(value, (int, float)):
                self.assertTrue(np.isfinite(value))


if __name__ == "__main__":
    unittest.main()
