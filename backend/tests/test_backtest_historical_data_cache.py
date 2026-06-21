import pandas as pd

from app.allocation.backtest import engine
from app.allocation.backtest import historical_data as h
from app.storage.database import ETFPriceCache, MacroCache


def _cached_prices(days: int = 25) -> dict[str, float]:
    dates = pd.date_range("2024-01-02", periods=days, freq="B")
    return {d.strftime("%Y-%m-%d"): float(i + 1) for i, d in enumerate(dates)}


def test_requested_cache_window_bypasses_today_recency_gate(monkeypatch):
    monkeypatch.setattr(ETFPriceCache, "get_range", staticmethod(lambda *_args: _cached_prices(days=45)))
    monkeypatch.setattr(
        ETFPriceCache,
        "get_latest_date",
        staticmethod(lambda _code: (_ for _ in ()).throw(AssertionError("latest date should not be required"))),
    )
    monkeypatch.setattr(
        h,
        "_try_efinance_full",
        lambda _code: (_ for _ in ()).throw(AssertionError("network provider should not be called")),
    )

    series = h._fetch_etf_prices_with_dates(
        "510300",
        start_date="2024-01-01",
        end_date="2024-03-01",
        allow_network=False,
    )

    assert series is not None
    assert len(series) == 45
    assert series.index[0] == pd.Timestamp("2024-01-02")


def test_cache_miss_with_network_disabled_returns_none(monkeypatch):
    monkeypatch.setattr(ETFPriceCache, "get_range", staticmethod(lambda *_args: {}))
    monkeypatch.setattr(
        h,
        "_try_efinance_full",
        lambda _code: (_ for _ in ()).throw(AssertionError("efinance should not be called")),
    )
    monkeypatch.setattr(
        h,
        "_try_tushare_full",
        lambda _code: (_ for _ in ()).throw(AssertionError("tushare should not be called")),
    )
    monkeypatch.setattr(
        h,
        "_try_akshare_etf",
        lambda _code: (_ for _ in ()).throw(AssertionError("akshare should not be called")),
    )

    assert h._fetch_etf_prices_with_dates(
        "508088",
        start_date="2024-01-01",
        end_date="2024-03-01",
        allow_network=False,
    ) is None


def test_stale_requested_cache_window_is_not_used(monkeypatch):
    monkeypatch.setattr(ETFPriceCache, "get_range", staticmethod(lambda *_args: _cached_prices(days=25)))
    monkeypatch.setattr(
        h,
        "_try_efinance_full",
        lambda _code: (_ for _ in ()).throw(AssertionError("efinance should not be called")),
    )

    assert h._fetch_etf_prices_with_dates(
        "510300",
        start_date="2024-06-01",
        end_date="2024-08-01",
        allow_network=False,
    ) is None


def test_load_etf_history_passes_network_policy(monkeypatch):
    calls = []

    def fake_fetch(code, start_date=None, end_date=None, allow_network=True):
        calls.append((code, start_date, end_date, allow_network))
        dates = pd.date_range("2024-01-02", periods=25, freq="B")
        return pd.Series(range(1, 26), index=dates, name=code, dtype=float)

    monkeypatch.setattr(h, "REPRESENTATIVE_ETFS", {"a_share_large": "510300", "cash": None})
    monkeypatch.setattr(h, "_fetch_etf_prices_with_dates", fake_fetch)

    prices, quality = h.load_etf_history("2024-01-01", "2024-03-01", allow_network=False)

    assert calls == [("510300", "2024-01-01", "2024-03-01", False)]
    assert "a_share_large" in prices.columns
    assert "cash" in prices.columns
    assert "money_fund" in prices.columns
    assert quality["assets_with_full_history"] == 2


def test_backtest_history_loader_refills_on_cold_cache(monkeypatch):
    calls = []

    def fake_load(start_date, end_date, allow_network=True):
        calls.append(allow_network)
        if not allow_network:
            raise ValueError("No ETF data available for the requested date range")
        dates = pd.date_range("2024-01-02", periods=25, freq="B")
        prices = pd.DataFrame({"a_share_large": range(1, 26)}, index=dates, dtype=float)
        return prices, {"assets_with_full_history": 1, "assets_with_partial_history": 0, "missing_assets": []}

    monkeypatch.setattr(engine, "load_etf_history", fake_load)

    prices, quality = engine._load_etf_history_for_backtest("2024-01-01", "2024-03-01")

    assert calls == [False, True]
    assert "a_share_large" in prices.columns
    assert quality["assets_with_full_history"] == 1


def test_load_macro_history_uses_cache_when_network_disabled(monkeypatch):
    def fake_history(indicator, limit=24):
        if indicator == "PMI制造业":
            return [
                ("2024-01-31", 50.1, "cache"),
                ("2024-02-29", 50.3, "cache"),
            ]
        return []

    monkeypatch.setattr(MacroCache, "get_history", staticmethod(fake_history))
    monkeypatch.setattr(
        h,
        "_fetch_pmi_history",
        lambda *_args: (_ for _ in ()).throw(AssertionError("macro provider should not be called")),
    )

    macro = h.load_macro_history("2024-01-01", "2024-03-01", allow_network=False)

    assert list(macro["PMI制造业"].round(1)) == [50.1, 50.3]
    assert macro["GDP同比"].empty


def test_tushare_full_supports_csi_index_daily(monkeypatch):
    calls = []

    class Row:
        def __init__(self, date: str, close: float):
            self.date = date
            self.close = close

    class FakeProvider:
        def get_index_daily(self, ts_code: str, start_date: str, end_date: str):
            calls.append(("index", ts_code, start_date, end_date))
            return [Row(f"2024-01-{day:02d}", 100.0 + day) for day in range(1, 25)]

        def get_fund_nav(self, *_args):
            raise AssertionError("CSI index should not call fund NAV")

    monkeypatch.setattr(
        "app.data.providers.tushare_provider.TushareProvider",
        lambda: FakeProvider(),
    )

    series = h._try_tushare_full("932047.CSI")

    assert series is not None
    assert len(series) == 24
    assert calls and calls[0][0] == "index"
