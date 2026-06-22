import unittest
from unittest.mock import patch

from app.allocation.models import PortfolioBuildRequest, PortfolioCandidate, PortfolioConstraint
from app.allocation.model_portfolio import list_model_portfolios
from app.allocation.portfolio_builder import build_portfolio


SNAPSHOTS = [
    {
        "code": "000001",
        "name": "Bond Fund A",
        "type": "债券型",
        "nav": 1.01,
        "near_1y": 3.2,
        "annualized_return": 3.1,
        "max_drawdown": -2.5,
        "volatility": 3.0,
        "score": 81,
        "updated_at": "2026-06-22",
    },
    {
        "code": "000002",
        "name": "Equity Fund A",
        "type": "股票型",
        "nav": 1.2,
        "near_1y": 8.5,
        "annualized_return": 8.1,
        "max_drawdown": -18.0,
        "volatility": 20.0,
        "score": 86,
        "updated_at": "2026-06-22",
    },
    {
        "code": "000003",
        "name": "Mixed Fund A",
        "type": "混合型",
        "nav": 1.1,
        "near_1y": 5.5,
        "annualized_return": 5.3,
        "max_drawdown": -9.0,
        "volatility": 10.0,
        "score": 83,
        "updated_at": "2026-06-22",
    },
    {
        "code": "000004",
        "name": "Index Fund A",
        "type": "指数型",
        "nav": 1.3,
        "near_1y": 7.5,
        "annualized_return": 7.2,
        "max_drawdown": -16.0,
        "volatility": 18.0,
        "score": 84,
        "updated_at": "2026-06-22",
    },
]


def _list_snapshots(**_kwargs):
    return {"total": len(SNAPSHOTS), "funds": SNAPSHOTS}


def _get_snapshot(code):
    return next((item for item in SNAPSHOTS if item["code"] == code), None)


class PortfolioBuilderTest(unittest.TestCase):
    def test_empty_real_pool_returns_missing_without_holdings(self):
        with patch("app.allocation.portfolio_builder.FundDataStore.list_snapshots", return_value={"total": 0, "funds": []}):
            result = build_portfolio(
                PortfolioBuildRequest(
                    candidates=[],
                    constraints=PortfolioConstraint(min_fund_count=3, max_fund_count=5),
                    risk_tolerance="balanced",
                    amount=100000,
                )
            )

        self.assertEqual(result.data_quality.status, "missing")
        self.assertEqual(result.holdings, [])

    def test_missing_seed_code_is_not_replaced(self):
        request = PortfolioBuildRequest(
            candidates=[
                PortfolioCandidate(fund_code="000001", fund_name="Bond Fund A", asset_class="bond", role="defensive"),
                PortfolioCandidate(fund_code="999999", fund_name="Missing", asset_class="equity", role="satellite"),
            ],
            constraints=PortfolioConstraint(min_fund_count=1, max_fund_count=4, target_asset_weights={"bond": 1}),
            risk_tolerance="conservative",
            amount=100000,
        )
        with patch("app.allocation.portfolio_builder.FundDataStore.get_snapshot", side_effect=_get_snapshot):
            result = build_portfolio(request)

        self.assertEqual([holding.fund_code for holding in result.holdings], ["000001"])
        self.assertEqual(result.data_quality.status, "partial")
        self.assertTrue(any("999999" in warning and "not replaced" in warning for warning in result.warnings))

    def test_build_from_snapshot_pool_normalizes_weights(self):
        request = PortfolioBuildRequest(
            candidates=[],
            constraints=PortfolioConstraint(
                max_single_fund_weight=0.4,
                min_fund_count=3,
                max_fund_count=4,
                target_asset_weights={"bond": 0.3, "equity": 0.3, "mixed": 0.3, "index": 0.1},
            ),
            risk_tolerance="balanced",
            amount=100000,
        )
        with patch("app.allocation.portfolio_builder.FundDataStore.list_snapshots", side_effect=_list_snapshots):
            result = build_portfolio(request)

        self.assertGreaterEqual(len(result.holdings), 3)
        self.assertAlmostEqual(sum(holding.weight for holding in result.holdings), 1.0, places=6)
        self.assertEqual(result.data_quality.status, "real")

    def test_generated_model_portfolios_mark_target_basis_not_promise(self):
        with patch("app.allocation.portfolio_builder.FundDataStore.list_snapshots", side_effect=_list_snapshots), \
             patch("app.allocation.portfolio_builder.FundDataStore.get_snapshot", side_effect=_get_snapshot), \
             patch("app.allocation.model_portfolio._load_published_model_portfolios", return_value=[]):
            result = list_model_portfolios(limit=1)

        self.assertEqual(result["items"][0]["target_basis"], "historical_measurement_target")
        self.assertIn("不构成收益承诺", result["items"][0]["risk_disclaimer"])


if __name__ == "__main__":
    unittest.main()
