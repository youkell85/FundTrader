import unittest
from unittest.mock import patch

import numpy as np

from app.allocation import factor_calibrator, factor_exposure
from app.allocation.config import FACTOR_LOADINGS


def _prices_from_returns(returns: np.ndarray, start: float = 100.0) -> np.ndarray:
    return start * np.exp(np.cumsum(np.concatenate([[0.0], returns])))


def _build_series(price_len: int = 261) -> dict:
    obs = price_len - 1
    t = np.arange(obs, dtype=np.float64)
    factor_equity = 0.0009 + 0.00035 * np.sin(t / 11.0)
    factor_term = 0.0004 + 0.00018 * np.cos(t / 15.0)
    factor_credit = 0.0003 + 0.00012 * np.sin(t / 17.0)
    factor_inflation = 0.0006 + 0.00022 * np.cos(t / 13.0)
    factor_liquidity = 0.0002 + 0.00008 * np.sin(t / 19.0)
    asset_returns = (
        1.05 * factor_equity
        + 0.35 * factor_term
        + 0.25 * factor_credit
        - 0.30 * factor_inflation
        + 0.15 * factor_liquidity
        + 0.00003 * np.sin(t / 7.0)
    )
    generic_returns = 0.55 * asset_returns + 0.00004 * np.cos(t / 9.0)
    money_fund_returns = 0.00005 + 0.00001 * np.sin(t / 21.0)

    return {
        "equity_proxy": _prices_from_returns(factor_equity, 100.0),
        "term_proxy": _prices_from_returns(factor_term, 102.0),
        "credit_proxy": _prices_from_returns(factor_credit, 103.0),
        "rate_proxy": _prices_from_returns(factor_term * 0.8, 101.0),
        "inflation_proxy": _prices_from_returns(factor_inflation, 99.0),
        "liquidity_proxy": _prices_from_returns(money_fund_returns, 1.0),
        "asset": _prices_from_returns(asset_returns, 98.0),
        "generic": _prices_from_returns(generic_returns, 97.0),
        "money_fund_asset": _prices_from_returns(money_fund_returns, 1.0),
    }


def _abnormal_liquidity_prices(price_len: int = 261) -> np.ndarray:
    prices = np.linspace(100.0, 100.3, price_len, dtype=np.float64)
    prices[-1] = 1.0
    return prices


def _nav_side_effect(series: dict):
    mapping = {
        "511260": series["term_proxy"],
        "511030": series["credit_proxy"],
        "511010": series["rate_proxy"],
        "511880": series["liquidity_proxy"],
        "161815": series["inflation_proxy"],
        "510300": series["asset"],
        "512100": series["generic"],
        "515180": series["generic"],
        "159915": series["generic"],
        "513050": series["generic"],
        "513500": series["generic"],
        "511380": series["generic"],
        "518880": series["generic"],
        "508000": series["generic"],
    }
    for code in ("511880", "000198", "003003"):
        mapping.setdefault(code, series["money_fund_asset"])

    def _fetch(code: str):
        return mapping.get(code, series["generic"])

    return _fetch


class FactorCalibratorTest(unittest.TestCase):
    def setUp(self) -> None:
        factor_calibrator.clear_cache()

    def tearDown(self) -> None:
        factor_calibrator.clear_cache()

    def test_abnormal_proxy_prices_are_rejected(self):
        series = _build_series()
        series["liquidity_proxy"] = _abnormal_liquidity_prices()

        with patch("app.allocation.factor_calibrator._fetch_equity_proxy_prices", return_value=series["equity_proxy"]), patch(
            "app.allocation.factor_calibrator._fetch_inflation_proxy_prices",
            return_value=(series["inflation_proxy"], "index:NHCI"),
        ), patch(
            "app.allocation.data.market_data_fetcher._fetch_etf_nav",
            side_effect=_nav_side_effect(series),
        ), patch(
            "app.storage.database.StatsSnapshotCache.save",
            return_value=None,
        ), patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=None,
        ):
            bundle = factor_calibrator.get_calibration_bundle(force_refresh=True)

        metadata = bundle["metadata"]["a_share_large"]
        self.assertIn("liquidity", metadata["invalid_proxies"])
        self.assertEqual(metadata["source"], "latest_window_regression")

    def test_insufficient_samples_fall_back_to_static_expert_estimate(self):
        short_series = _build_series(price_len=120)

        with patch("app.allocation.factor_calibrator._fetch_equity_proxy_prices", return_value=short_series["equity_proxy"]), patch(
            "app.allocation.factor_calibrator._fetch_inflation_proxy_prices",
            return_value=(short_series["inflation_proxy"], "index:NHCI"),
        ), patch(
            "app.allocation.data.market_data_fetcher._fetch_etf_nav",
            side_effect=_nav_side_effect(short_series),
        ), patch(
            "app.storage.database.StatsSnapshotCache.save",
            return_value=None,
        ), patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=None,
        ):
            bundle = factor_calibrator.get_calibration_bundle(force_refresh=True)

        metadata = bundle["metadata"]["a_share_large"]
        self.assertEqual(metadata["source"], "static_expert_estimate")
        self.assertEqual(metadata["assumption_reason"], "insufficient_observations")
        self.assertEqual(bundle["loadings"]["a_share_large"], FACTOR_LOADINGS["a_share_large"])

    def test_dynamic_result_includes_quality_metadata_fields(self):
        series = _build_series()

        with patch("app.allocation.factor_calibrator._fetch_equity_proxy_prices", return_value=series["equity_proxy"]), patch(
            "app.allocation.factor_calibrator._fetch_inflation_proxy_prices",
            return_value=(series["inflation_proxy"], "index:NHCI"),
        ), patch(
            "app.allocation.data.market_data_fetcher._fetch_etf_nav",
            side_effect=_nav_side_effect(series),
        ), patch(
            "app.storage.database.StatsSnapshotCache.save",
            return_value=None,
        ), patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=None,
        ):
            bundle = factor_calibrator.get_calibration_bundle(force_refresh=True)

        metadata = bundle["metadata"]["a_share_large"]
        self.assertEqual(metadata["source"], "latest_window_regression")
        self.assertGreaterEqual(metadata["n_obs"], 120)
        self.assertIsNotNone(metadata["r_squared"])
        self.assertTrue(metadata["window_start"])
        self.assertTrue(metadata["window_end"])
        self.assertTrue(metadata["proxy_sources"])
        self.assertIn("invalid_proxies", metadata)

    def test_factor_exposure_falls_back_to_static_when_dynamic_bundle_unavailable(self):
        allocations = {"a_share_large": 1.0}

        with patch(
            "app.allocation.factor_calibrator.get_calibration_bundle",
            side_effect=RuntimeError("boom"),
        ):
            exposures = factor_exposure.calculate_exposures(allocations)

        self.assertEqual(exposures, FACTOR_LOADINGS["a_share_large"])


if __name__ == "__main__":
    unittest.main()
