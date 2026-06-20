import sys

import pandas as pd

from app.allocation.backtest import historical_data as h
from app.allocation.data import macro_fetcher


def test_fiscal_deficit_fetcher_does_not_fall_back_to_static_target(monkeypatch):
    monkeypatch.setattr(macro_fetcher, "_ak_fiscal_deficit", lambda: None)
    monkeypatch.setattr(macro_fetcher, "_ak_gov_deficit_target", lambda: None)

    value, source = macro_fetcher._fetch_fiscal_deficit_with_source()

    assert value is None
    assert source == "missing"


def test_fetch_all_marks_fiscal_deficit_missing_without_static_value(monkeypatch):
    monkeypatch.setattr(macro_fetcher, "_get_tushare", lambda: None)
    for name in (
        "_fetch_pmi",
        "_fetch_gdp",
        "_fetch_cpi",
        "_fetch_ppi",
        "_fetch_bond_yield_10y",
        "_fetch_dr007",
        "_fetch_social_financing",
        "_fetch_m2",
        "_fetch_margin_balance",
        "_fetch_northbound",
        "_fetch_fed_rate",
        "_fetch_usd_index",
    ):
        monkeypatch.setattr(macro_fetcher, name, lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        macro_fetcher,
        "_fetch_fiscal_deficit_with_source",
        lambda: (None, "missing"),
    )

    snapshot = macro_fetcher.fetch_all()

    indicator = snapshot.indicators["财政赤字率"]
    assert indicator.value is None
    assert indicator.source == "missing"
    assert indicator.confidence == 0.0


def test_fiscal_deficit_history_does_not_generate_static_series(monkeypatch):
    monkeypatch.setattr(h, "_macro_series_from_cache", lambda *_args, **_kwargs: None)

    class _MissingMacroFetcher:
        @staticmethod
        def _fetch_fiscal_deficit_with_source():
            return None, "missing"

    monkeypatch.setitem(sys.modules, "app.allocation.data.macro_fetcher", _MissingMacroFetcher)

    assert h._fetch_fiscal_deficit_history("2024-01-01", "2024-12-31") is None


def test_fiscal_deficit_history_uses_cache_without_static_provider(monkeypatch):
    cached = pd.Series(
        [2.9, 3.1],
        index=pd.to_datetime(["2024-01-31", "2024-02-29"]),
        name="财政赤字率",
    )
    monkeypatch.setattr(h, "_macro_series_from_cache", lambda *_args, **_kwargs: cached)

    series = h._fetch_fiscal_deficit_history("2024-01-01", "2024-12-31")

    assert series is cached
