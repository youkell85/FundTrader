"""Historical Data Loader — fetch and align ETF + macro time series for backtest."""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Representative ETFs (from market_data_fetcher)
REPRESENTATIVE_ETFS: Dict[str, Optional[str]] = {
    "a_share_large": "510300",
    "a_share_small": "512100",
    "a_share_value": "515180",
    "a_share_growth": "159915",
    "hk_equity": "513050",
    "us_equity": "513500",
    "rate_bond": "511010",
    "credit_bond": "511030",
    "convertible": "511380",
    "money_fund": "511880",
    "gold": "518880",
    "commodity": "161815",
    "reits": "508088",
    "cash": None,
}

ASSET_ORDER = list(REPRESENTATIVE_ETFS.keys())

# Cash annualized return assumption
CASH_ANNUAL_RETURN = 0.02


def load_etf_history(start_date: str, end_date: str, allow_network: bool = True) -> Tuple[pd.DataFrame, Dict]:
    """Load daily price data for all 14 asset classes.

    Returns:
        Tuple of (prices_df, quality_info)
        - prices_df: DataFrame with DatetimeIndex, columns = asset class names, values = prices
        - quality_info: dict with coverage statistics
    """
    all_series: Dict[str, pd.Series] = {}
    quality = {
        "assets_with_full_history": 0,
        "assets_with_partial_history": 0,
        "missing_assets": [],
    }

    start_dt = pd.Timestamp(start_date)
    end_dt = pd.Timestamp(end_date)

    for asset_class, etf_code in REPRESENTATIVE_ETFS.items():
        if etf_code is None:
            # Cash: synthesized later
            continue

        prices = _fetch_etf_prices_with_dates(etf_code, start_date, end_date, allow_network=allow_network)
        if prices is not None and len(prices) > 0:
            # Filter to requested date range
            mask = (prices.index >= start_dt) & (prices.index <= end_dt)
            filtered = prices[mask]

            if len(filtered) >= 20:  # At least ~1 month of data
                # Deduplicate dates (keep last) to avoid reindex errors
                filtered = filtered[~filtered.index.duplicated(keep="last")]
                all_series[asset_class] = filtered

                # Check if covers full range
                if filtered.index[0] <= start_dt + pd.Timedelta(days=5):
                    quality["assets_with_full_history"] += 1
                else:
                    quality["assets_with_partial_history"] += 1
            else:
                quality["missing_assets"].append(asset_class)
                logger.warning(f"Insufficient data for {asset_class} (ETF {etf_code}): {len(filtered)} days")
        else:
            quality["missing_assets"].append(asset_class)
            logger.warning(f"No data available for {asset_class} (ETF {etf_code})")

    if not all_series:
        raise ValueError("No ETF data available for the requested date range")

    # Build aligned DataFrame
    prices_df = pd.DataFrame(all_series)
    prices_df = prices_df.sort_index()

    # Forward-fill gaps (holidays, suspensions)
    prices_df = prices_df.ffill()
    # Backward-fill the start (if some ETFs have later start dates)
    prices_df = prices_df.bfill()

    # Synthesize cash series (compound daily at CASH_ANNUAL_RETURN)
    daily_rate = (1 + CASH_ANNUAL_RETURN) ** (1 / 252) - 1
    n_days = len(prices_df)
    cash_prices = 1.0 * (1 + daily_rate) ** np.arange(n_days)
    prices_df["cash"] = cash_prices

    # Synthesize money_fund if missing (slightly higher than cash: 2.5%)
    if "money_fund" not in prices_df.columns:
        mf_rate = (1 + 0.025) ** (1 / 252) - 1
        prices_df["money_fund"] = 1.0 * (1 + mf_rate) ** np.arange(n_days)
        quality["assets_with_full_history"] += 1

    quality["earliest_common_date"] = prices_df.index[0].strftime("%Y-%m-%d")
    quality["total_trading_days"] = len(prices_df)

    return prices_df, quality


def _macro_series_from_cache(name: str, start: str, end: str, limit: int = 240) -> Optional[pd.Series]:
    """Read a macro indicator history from SQLite cache without provider calls."""
    try:
        from app.storage.database import MacroCache

        rows = MacroCache.get_history(name, limit=limit)
    except Exception as e:
        logger.debug(f"Macro {name}: SQLite history miss - {e}")
        return None

    if not rows:
        return None

    dates = []
    values = []
    for date_str, value, _source in rows:
        try:
            dt = pd.Timestamp(date_str)
            val = float(value)
        except (TypeError, ValueError):
            continue
        dates.append(dt)
        values.append(val)

    if not dates:
        return None

    series = pd.Series(values, index=pd.DatetimeIndex(dates), name=name).sort_index()
    series = series[~series.index.duplicated(keep="last")]
    return _filter_date_range(series, start, end)


def load_macro_history(start_date: str, end_date: str, allow_network: bool = True) -> Dict[str, pd.Series]:
    """Load historical macro indicator time series.

    Returns dict mapping indicator name -> date-indexed Series.
    Gracefully handles missing data (returns empty Series).
    """
    macro_data: Dict[str, pd.Series] = {}

    fetchers = [
        ("PMI制造业", _fetch_pmi_history),
        ("GDP同比", _fetch_gdp_history),
        ("CPI同比", _fetch_cpi_history),
        ("PPI同比", _fetch_ppi_history),
        ("10Y国债收益率", _fetch_bond_yield_history),
        ("M2增速", _fetch_m2_history),
        ("社融增速", _fetch_social_financing_history),
        ("美联储利率", _fetch_fed_rate_history),
        ("美元指数", _fetch_usd_index_history),
        ("DR007", _fetch_dr007_history),
        ("融资余额变化", _fetch_margin_history),
        ("北向资金净流入", _fetch_northbound_history),
        ("财政赤字率", _fetch_fiscal_deficit_history),
    ]

    for name, fetcher in fetchers:
        try:
            if allow_network:
                series = fetcher(start_date, end_date)
            else:
                series = _macro_series_from_cache(name, start_date, end_date)
            if series is not None and len(series) > 0:
                macro_data[name] = series
                logger.debug(f"Macro {name}: {len(series)} data points loaded")
            else:
                macro_data[name] = pd.Series(dtype=float)
        except Exception as e:
            logger.warning(f"Failed to fetch macro history for {name}: {e}")
            macro_data[name] = pd.Series(dtype=float)

    return macro_data


# ---------------------------------------------------------------------------
# ETF Price Fetching
# ---------------------------------------------------------------------------

def _cached_series_from_range(code: str, start: str, end: str, min_rows: int = 20) -> Optional[pd.Series]:
    """Read a requested ETF date range from SQLite cache if it is usable."""
    try:
        from app.storage.database import ETFPriceCache

        cached = ETFPriceCache.get_range(code, start, end)
        if len(cached) >= min_rows:
            s = pd.Series(cached, name=code)
            s.index = pd.to_datetime(s.index)
            s = s.sort_index()
            start_ts = pd.Timestamp(start)
            end_ts = pd.Timestamp(end)
            covers_start = s.index[0] <= start_ts + pd.Timedelta(days=5)
            covers_end = s.index[-1] >= end_ts - pd.Timedelta(days=5)
            if covers_start and covers_end:
                logger.debug(f"ETF {code}: loaded {len(s)} requested rows from SQLite cache")
                return s
            logger.debug(
                "ETF %s: cached requested rows do not cover %s..%s (have %s..%s)",
                code,
                start,
                end,
                s.index[0].strftime("%Y-%m-%d"),
                s.index[-1].strftime("%Y-%m-%d"),
            )
    except Exception as e:
        logger.debug(f"ETF {code}: requested SQLite cache miss - {e}")
    return None


def _fetch_etf_prices_with_dates(
    code: str,
    start_date: str | None = None,
    end_date: str | None = None,
    allow_network: bool = True,
) -> Optional[pd.Series]:
    """Fetch full ETF price history as a date-indexed Series.

    SQLite cache → efinance → tushare → akshare fallback chain.
    """
    # Use the requested window from cache even when it is not current to today.
    # Backtest API calls set allow_network=False so provider stalls cannot block
    # the request path when cached historical data is already enough.
    if start_date and end_date:
        cached_requested = _cached_series_from_range(code, start_date, end_date)
        if cached_requested is not None:
            return cached_requested
        if not allow_network:
            logger.info(f"ETF {code}: cache insufficient for requested range {start_date}..{end_date}")
            return None

    # 0. SQLite cache — check if we have recent data (within 1 day)
    try:
        from app.storage.database import ETFPriceCache
        latest = ETFPriceCache.get_latest_date(code)
        today = pd.Timestamp.now().strftime("%Y-%m-%d")
        if latest and latest >= today:
            cached = ETFPriceCache.get_range(code, "2000-01-01", today)
            if len(cached) >= 20:
                s = pd.Series(cached, name=code)
                s.index = pd.to_datetime(s.index)
                s = s.sort_index()
                logger.debug(f"ETF {code}: loaded {len(s)} rows from SQLite cache")
                return s
    except Exception as e:
        logger.debug(f"ETF {code}: SQLite cache miss — {e}")

    # 1. Try efinance first (fastest, no auth needed)
    series = _try_efinance_full(code)
    if series is not None and len(series) >= 20:
        logger.debug(f"ETF {code}: loaded {len(series)} rows from efinance")
        _cache_etf_prices(code, series)
        return series

    # Fallback to tushare (needs API token)
    series = _try_tushare_full(code)
    if series is not None and len(series) >= 20:
        logger.debug(f"ETF {code}: loaded {len(series)} rows from tushare")
        _cache_etf_prices(code, series)
        return series

    # Final fallback: akshare (fund_etf_hist_em)
    series = _try_akshare_etf(code)
    if series is not None and len(series) >= 20:
        logger.debug(f"ETF {code}: loaded {len(series)} rows from akshare")
        _cache_etf_prices(code, series)
        return series

    logger.warning(f"ETF {code}: all 3 data sources failed")
    return None


def _cache_etf_prices(code: str, series: pd.Series) -> None:
    """Save ETF prices to SQLite cache in background."""
    try:
        from app.storage.database import ETFPriceCache
        prices = {d.strftime("%Y-%m-%d"): float(v) for d, v in series.items() if not pd.isna(v)}
        ETFPriceCache.save_batch(code, prices)
    except Exception:
        pass  # Cache save failure is non-fatal


def _try_efinance_full(code: str) -> Optional[pd.Series]:
    """Fetch full history from efinance fund module with date index."""
    try:
        import efinance as ef

        # NOTE: efinance fund API does NOT support klt param (that's stock-only)
        df = ef.fund.get_quote_history(code)
        if df is None or df.empty:
            return None

        # Detect date column — efinance fund returns: 日期, 单位净值, 累计净值, ...
        date_col = None
        for col in ["日期", "date", "Date", "净值日期"]:
            if col in df.columns:
                date_col = col
                break

        if date_col is None:
            # Try using index
            if hasattr(df.index, 'name') and df.index.name in ["日期", "date"]:
                df = df.reset_index()
                date_col = df.columns[0]
            else:
                return None

        # Detect price column — prefer 累计净值 (accumulated), then 单位净值 (unit)
        price_col = None
        for col in ["累计净值", "单位净值", "收盘", "close", "Close"]:
            if col in df.columns:
                price_col = col
                break

        if price_col is None:
            return None

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[price_col] = pd.to_numeric(df[price_col], errors="coerce")
        df = df.dropna(subset=[date_col, price_col])

        if df.empty:
            return None

        series = df.set_index(date_col)[price_col].sort_index()
        series.index = pd.DatetimeIndex(series.index)
        return series

    except Exception as e:
        logger.debug(f"efinance full history fetch failed for {code}: {e}")
        return None


def _try_tushare_full(code: str) -> Optional[pd.Series]:
    """Fetch full history from tushare."""
    try:
        from ...data.providers.tushare_provider import TushareProvider

        provider = TushareProvider()
        # Fetch long history
        start = "20180101"
        end = datetime.now().strftime("%Y%m%d")

        navs = provider.get_fund_nav(code, start, end)
        if not navs:
            return None

        dates = []
        values = []
        for nav in navs:
            try:
                dt = pd.Timestamp(nav.date)
                val = nav.adj_nav or nav.accum_nav or nav.nav
                if val is not None:
                    dates.append(dt)
                    values.append(float(val))
            except (ValueError, TypeError):
                continue

        if len(dates) < 20:
            return None

        series = pd.Series(values, index=pd.DatetimeIndex(dates)).sort_index()
        return series

    except Exception as e:
        logger.debug(f"tushare full history fetch failed for {code}: {e}")
        return None


def _try_akshare_etf(code: str) -> Optional[pd.Series]:
    """Fetch ETF price history via akshare (fund_etf_hist_em).

    akshare uses the eastmoney fund API which is generally accessible.
    Returns a date-indexed Series of closing prices.
    """
    try:
        import akshare as ak

        df = ak.fund_etf_hist_em(
            symbol=code,
            period="daily",
            start_date="20100101",
            end_date=datetime.now().strftime("%Y%m%d"),
            adjust="qfq",
        )
        if df is None or df.empty:
            return None

        # Detect date column
        date_col = None
        for col in ["日期", "date", "Date"]:
            if col in df.columns:
                date_col = col
                break
        if date_col is None:
            date_col = df.columns[0]

        # Detect close price column
        close_col = None
        for col in ["收盘", "close", "Close"]:
            if col in df.columns:
                close_col = col
                break
        if close_col is None and len(df.columns) >= 5:
            close_col = df.columns[4]
        elif close_col is None:
            close_col = df.columns[2]

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[close_col] = pd.to_numeric(df[close_col], errors="coerce")
        df = df.dropna(subset=[date_col, close_col])

        if df.empty:
            return None

        series = df.set_index(date_col)[close_col].sort_index()
        series.index = pd.DatetimeIndex(series.index)
        return series

    except Exception as e:
        logger.debug(f"akshare ETF history fetch failed for {code}: {e}")
        return None


# ---------------------------------------------------------------------------
# Macro History Fetchers
# ---------------------------------------------------------------------------

def _parse_akshare_macro_df(df: pd.DataFrame) -> Optional[pd.Series]:
    """Parse akshare macro indicator DataFrame.

    Most akshare macro_*_yearly() APIs return columns:
    ['产品'/'统计时间', '日期'/'月份', '实际值', '预期值', '前值']
    or similar variants. This helper detects the date and value columns.

    Returns a date-indexed Series of the actual value, or None.
    """
    if df is None or df.empty:
        return None

    cols = list(df.columns)

    # Detect date column
    date_col = None
    for candidate in ["日期", "月份", "统计时间", "date", "Date"]:
        if candidate in cols:
            date_col = candidate
            break
    if date_col is None:
        # Try second column (first is often product name)
        if len(cols) >= 2:
            date_col = cols[1]
        else:
            date_col = cols[0]

    # Detect value column
    val_col = None
    for candidate in ["实际值", "制造业-Loss", "全国-当月-同比", "同比", "数值"]:
        if candidate in cols:
            val_col = candidate
            break
    if val_col is None:
        # Use the first numeric column after date
        for col in cols:
            if col != date_col and col not in ["产品", "预期值", "前值"]:
                try:
                    pd.to_numeric(df[col].head(5), errors="raise")
                    val_col = col
                    break
                except (ValueError, TypeError):
                    continue
    if val_col is None:
        val_col = cols[2] if len(cols) > 2 else cols[-1]

    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
    df = df.dropna(subset=[date_col, val_col])

    if df.empty:
        return None

    series = df.set_index(date_col)[val_col].sort_index()
    # Remove duplicate dates
    series = series[~series.index.duplicated(keep="last")]
    return series


def _fetch_pmi_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch historical PMI data."""
    try:
        import akshare as ak
        df = ak.macro_china_pmi_yearly()
        series = _parse_akshare_macro_df(df)
        if series is None:
            return None
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"PMI history fetch failed: {e}")
        return None


def _fetch_gdp_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch historical GDP growth."""
    try:
        import akshare as ak
        df = ak.macro_china_gdp_yearly()
        series = _parse_akshare_macro_df(df)
        if series is None:
            return None
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"GDP history fetch failed: {e}")
        return None


def _fetch_cpi_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch historical CPI data (YoY %)."""
    try:
        import akshare as ak
        df = ak.macro_china_cpi_yearly()
        series = _parse_akshare_macro_df(df)
        if series is None:
            return None
        # If values are around 100 (index), convert to YoY %
        if series.median() > 50:
            series = series - 100
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"CPI history fetch failed: {e}")
        return None


def _fetch_ppi_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch historical PPI data (YoY %)."""
    try:
        import akshare as ak
        df = ak.macro_china_ppi_yearly()
        series = _parse_akshare_macro_df(df)
        if series is None:
            return None
        if series.median() > 50:
            series = series - 100
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"PPI history fetch failed: {e}")
        return None


def _fetch_bond_yield_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch 10Y government bond yield history.

    Uses bond_zh_us_rate() which provides daily China/US bond yields.
    """
    try:
        import akshare as ak

        # bond_zh_us_rate() returns daily China/US yields across maturities
        df = ak.bond_zh_us_rate()
        if df is None or df.empty:
            return None

        # Columns: 日期, 中国国债收益率2年, 中国国债收益率5年, 中国国债收益率10年, ...
        date_col = None
        for col in ["日期", "date", "Date"]:
            if col in df.columns:
                date_col = col
                break
        if date_col is None:
            date_col = df.columns[0]

        # Find China 10Y yield column
        val_col = None
        for col in df.columns:
            if "中国" in col and "10" in col:
                val_col = col
                break
        if val_col is None:
            for col in df.columns:
                if "中国" in col:
                    val_col = col
                    break
        if val_col is None:
            val_col = df.columns[3] if len(df.columns) > 3 else df.columns[1]

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
        df = df.dropna(subset=[date_col, val_col])

        if df.empty:
            return None

        series = df.set_index(date_col)[val_col].sort_index()
        series = series[~series.index.duplicated(keep="last")]
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"Bond yield history fetch failed: {e}")
        return None


def _fetch_m2_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch M2 money supply YoY growth history."""
    try:
        import akshare as ak
        df = ak.macro_china_money_supply()
        if df is None or df.empty:
            return None

        # Column format: 月份, M2-数量(亿元), M2-同比增速, M2-环比增速, M1-...
        date_col = df.columns[0]
        val_col = None
        for col in df.columns:
            if "M2" in col and ("同比" in col or "增速" in col):
                val_col = col
                break
        if val_col is None:
            for col in df.columns:
                if "M2" in col:
                    val_col = col
                    break
        if val_col is None:
            val_col = df.columns[1]

        df[date_col] = _parse_chinese_date(df[date_col])
        df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
        df = df.dropna(subset=[date_col, val_col])

        if df.empty:
            return None

        series = df.set_index(date_col)[val_col].sort_index()
        series = series[~series.index.duplicated(keep="last")]
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"M2 history fetch failed: {e}")
        return None


def _fetch_social_financing_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch total social financing (monthly, 亿元)."""
    try:
        import akshare as ak
        df = ak.macro_china_shrzgm()
        if df is None or df.empty:
            return None

        # Column: 月份, 社会融资规模存量, ...
        date_col = df.columns[0]
        val_col = df.columns[1]

        df[date_col] = _parse_chinese_date(df[date_col])
        df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
        df = df.dropna(subset=[date_col, val_col])

        if df.empty:
            return None

        series = df.set_index(date_col)[val_col].sort_index()
        series = series[~series.index.duplicated(keep="last")]
        # Convert stock to YoY growth rate
        if len(series) > 12 and series.iloc[-1] > 1000:
            yoy = series.pct_change(periods=12) * 100
            yoy = yoy.dropna()
            if len(yoy) > 0:
                return _filter_date_range(yoy, start, end)
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"Social financing history fetch failed: {e}")
        return None


def _fetch_fed_rate_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch Fed funds rate history."""
    try:
        import akshare as ak
        df = ak.macro_bank_usa_interest_rate()
        series = _parse_akshare_macro_df(df)
        if series is None:
            return None
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"Fed rate history fetch failed: {e}")
        return None


def _fetch_usd_index_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch USD index (DXY) history."""
    try:
        import akshare as ak

        df = ak.index_us_stock_sina(symbol="UDI")
        if df is None or df.empty:
            return None
        date_col = "date" if "date" in df.columns else df.columns[0]
        val_col = "close" if "close" in df.columns else df.columns[-1]

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
        df = df.dropna(subset=[date_col, val_col])
        series = df.set_index(date_col)[val_col].sort_index()
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"USD index history fetch failed: {e}")
        return None


def _fetch_dr007_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch interbank rate history (Shibor 1W as DR007 proxy)."""
    try:
        import akshare as ak

        # Use macro_bank_china_interest_rate for benchmark rate
        df = ak.macro_bank_china_interest_rate()
        if df is None or df.empty:
            return None
        series = _parse_akshare_macro_df(df)
        if series is None:
            return None
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"DR007 history fetch failed: {e}")
        return None


def _fetch_margin_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch margin balance (融资余额) change history from SSE."""
    try:
        import akshare as ak

        df = ak.stock_margin_sse(start_date=start.replace("-", ""))
        if df is None or df.empty:
            return None

        # Columns: 信用交易日期, 融资买入额, 融资余额, 融券卖出量, ...
        date_col = df.columns[0]
        val_col = None
        for col in df.columns:
            if "融资余额" in col:
                val_col = col
                break
        if val_col is None:
            val_col = df.columns[1]

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
        df = df.dropna(subset=[date_col, val_col])

        if df.empty:
            return None

        series = df.set_index(date_col)[val_col].sort_index()
        series = series[~series.index.duplicated(keep="last")]
        # Convert to daily change (%)
        if len(series) > 5 and series.iloc[-1] > 1e8:
            daily_chg = series.pct_change() * 100
            daily_chg = daily_chg.dropna()
            if len(daily_chg) > 0:
                return _filter_date_range(daily_chg, start, end)
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"Margin balance history fetch failed: {e}")
        return None


def _fetch_northbound_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch northbound capital net flow history."""
    try:
        import akshare as ak

        # Try stock_hsgt_hist_em for historical northbound data
        df = ak.stock_hsgt_hist_em(symbol="沪股通")
        if df is None or df.empty:
            return None

        # Detect date and value columns
        date_col = None
        for col in ["日期", "date", "Date"]:
            if col in df.columns:
                date_col = col
                break
        if date_col is None:
            date_col = df.columns[0]

        val_col = None
        for col in df.columns:
            if "净流入" in col or "净买入" in col:
                val_col = col
                break
        if val_col is None:
            for col in df.columns:
                if "净" in col:
                    val_col = col
                    break
        if val_col is None and len(df.columns) > 3:
            val_col = df.columns[3]

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
        df = df.dropna(subset=[date_col, val_col])

        if df.empty:
            return None

        series = df.set_index(date_col)[val_col].sort_index()
        series = series[~series.index.duplicated(keep="last")]
        return _filter_date_range(series, start, end)
    except Exception as e:
        logger.debug(f"Northbound flow history fetch failed: {e}")
        return None


def _fetch_fiscal_deficit_history(start: str, end: str) -> Optional[pd.Series]:
    """Fetch fiscal deficit rate. Returns static value (3.0%) as proxy.

    NOTE: This is a placeholder — fiscal deficit data changes yearly.
    Replace with actual data source (e.g. tushare.fina_indicator) in production.
    """
    dates = pd.date_range(start, end, freq="MS")
    return pd.Series(3.0, index=dates)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _parse_chinese_date(series: pd.Series) -> pd.Series:
    """Parse various Chinese date formats to datetime.

    Handles:
    - '2026年04月份' / '2026年4月份' (Chinese year-month)
    - '201501' (YYYYMM compact)
    - Standard ISO formats
    """
    result = pd.to_datetime(series, errors="coerce")

    # If standard parsing fails (all NaT), try Chinese format
    if result.isna().all():
        str_series = series.astype(str)

        # Try '2026年04月份' format
        if str_series.str.contains("年").any():
            cleaned = (
                str_series
                .str.replace("年", "-", regex=False)
                .str.replace("月份", "", regex=False)
                .str.replace("月", "", regex=False)
                .str.strip()
            )
            result = pd.to_datetime(cleaned + "-01", errors="coerce")

        # Try '201501' YYYYMM format
        elif str_series.str.match(r"^\d{6}$").any():
            result = pd.to_datetime(str_series, format="%Y%m", errors="coerce")

        # Try '2015-01' YYYY-MM format
        elif str_series.str.match(r"^\d{4}-\d{2}$").any():
            result = pd.to_datetime(str_series + "-01", errors="coerce")

    return result


def _filter_date_range(series: pd.Series, start: str, end: str) -> pd.Series:
    """Filter a series to the given date range."""
    start_dt = pd.Timestamp(start)
    end_dt = pd.Timestamp(end)
    mask = (series.index >= start_dt) & (series.index <= end_dt)
    return series[mask]
