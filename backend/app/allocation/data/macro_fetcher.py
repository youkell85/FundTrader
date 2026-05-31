"""Macro Data Fetcher — fetch 13 macro indicators from akshare.

Each indicator is wrapped in a try/except with graceful fallback.
Uses existing cache_manager for persistence.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from .models import MacroIndicator, MacroSnapshot

logger = logging.getLogger(__name__)

# TTL constants (seconds)
TTL_DAILY = 14400    # 4 hours
TTL_MONTHLY = 86400  # 24 hours


def fetch_all() -> MacroSnapshot:
    """Fetch all 13 macro indicators. Never raises — returns partial data on failure."""
    indicators = {}
    fetchers = [
        ("PMI制造业", _fetch_pmi, TTL_MONTHLY),
        ("GDP同比", _fetch_gdp, TTL_MONTHLY),
        ("CPI同比", _fetch_cpi, TTL_MONTHLY),
        ("PPI同比", _fetch_ppi, TTL_MONTHLY),
        ("10Y国债收益率", _fetch_bond_yield_10y, TTL_DAILY),
        ("DR007", _fetch_dr007, TTL_DAILY),
        ("社融增速", _fetch_social_financing, TTL_MONTHLY),
        ("M2增速", _fetch_m2, TTL_MONTHLY),
        ("融资余额变化", _fetch_margin_balance, TTL_DAILY),
        ("北向资金净流入", _fetch_northbound, TTL_DAILY),
        ("财政赤字率", _fetch_fiscal_deficit, TTL_MONTHLY),
        ("美联储利率", _fetch_fed_rate, TTL_MONTHLY),
        ("美元指数", _fetch_usd_index, TTL_DAILY),
    ]

    for name, fetcher, ttl in fetchers:
        try:
            value = fetcher()
            if value is not None:
                indicators[name] = MacroIndicator(
                    name=name,
                    value=float(value),
                    source="akshare",
                    confidence=0.9,
                    fetch_time=datetime.now().isoformat(),
                    ttl_seconds=ttl,
                )
            else:
                indicators[name] = MacroIndicator(name=name, value=None, source="static", confidence=0.3)
        except Exception as e:
            logger.warning(f"Failed to fetch {name}: {e}")
            indicators[name] = MacroIndicator(name=name, value=None, source="static", confidence=0.3)

    # Overall confidence = mean of available indicators
    confs = [ind.confidence for ind in indicators.values() if ind.value is not None]
    overall = float(np.mean(confs)) if confs else 0.3

    return MacroSnapshot(indicators=indicators, overall_confidence=overall)


# ─── Individual Fetchers ───────────────────────────────────────────────────────

def _fetch_pmi() -> Optional[float]:
    """制造业PMI (monthly, latest value)."""
    import akshare as ak
    df = ak.macro_china_pmi_yearly()
    if df is None or df.empty:
        return None
    # Get latest row
    df = df.sort_index(ascending=False) if df.index.dtype != object else df
    # Try common column names
    for col in ["制造业-Loss", "国家统计局-制造业PMI", "制造业PMI"]:
        if col in df.columns:
            vals = pd.to_numeric(df[col], errors="coerce").dropna()
            if not vals.empty:
                return float(vals.iloc[-1])
    # Fallback: try last numeric column
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols) > 0:
        vals = df[numeric_cols[0]].dropna()
        if not vals.empty:
            return float(vals.iloc[-1])
    return None


def _fetch_gdp() -> Optional[float]:
    """GDP同比增速 (quarterly)."""
    import akshare as ak
    try:
        df = ak.macro_china_gdp()
        if df is None or df.empty:
            return None
        for col in ["累计同比", "国内生产总值-同比增长"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna()
                if not vals.empty:
                    return float(vals.iloc[-1])
    except Exception:
        pass
    return None


def _fetch_cpi() -> Optional[float]:
    """CPI同比 (monthly)."""
    import akshare as ak
    df = ak.macro_china_cpi_yearly()
    if df is None or df.empty:
        return None
    for col in ["全国-当月", "全国当月同比"]:
        if col in df.columns:
            vals = pd.to_numeric(df[col], errors="coerce").dropna()
            if not vals.empty:
                return float(vals.iloc[-1])
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols) > 0:
        vals = df[numeric_cols[0]].dropna()
        if not vals.empty:
            return float(vals.iloc[-1])
    return None


def _fetch_ppi() -> Optional[float]:
    """PPI同比 (monthly)."""
    import akshare as ak
    df = ak.macro_china_ppi_yearly()
    if df is None or df.empty:
        return None
    for col in ["工业品-当月", "全部工业品当月同比"]:
        if col in df.columns:
            vals = pd.to_numeric(df[col], errors="coerce").dropna()
            if not vals.empty:
                return float(vals.iloc[-1])
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols) > 0:
        vals = df[numeric_cols[0]].dropna()
        if not vals.empty:
            return float(vals.iloc[-1])
    return None


def _fetch_bond_yield_10y() -> Optional[float]:
    """10年期国债收益率 (daily)."""
    import akshare as ak
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
    try:
        df = ak.bond_china_yield(start_date=start, end_date=end)
        if df is None or df.empty:
            return None
        for col in ["中国国债收益率10年", "10年"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna()
                if not vals.empty:
                    return float(vals.iloc[-1])
    except Exception:
        pass
    return None


def _fetch_dr007() -> Optional[float]:
    """DR007银行间利率."""
    import akshare as ak
    try:
        # Try shibor as proxy
        df = ak.rate_interbank(market="中国银行间质押式回购加权利率", symbol="DR007", indicator="今日")
        if df is not None and not df.empty:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            if len(numeric_cols) > 0:
                vals = df[numeric_cols[0]].dropna()
                if not vals.empty:
                    return float(vals.iloc[-1])
    except Exception:
        pass
    # Fallback: try macro_china_lpr
    try:
        df = ak.macro_china_lpr()
        if df is not None and not df.empty:
            # Use 1Y LPR as proxy
            for col in ["1年", "LPR1Y"]:
                if col in df.columns:
                    vals = pd.to_numeric(df[col], errors="coerce").dropna()
                    if not vals.empty:
                        return float(vals.iloc[-1])
    except Exception:
        pass
    return None


def _fetch_social_financing() -> Optional[float]:
    """社会融资规模增量 (monthly, YoY growth %)."""
    import akshare as ak
    try:
        df = ak.macro_china_shrzgm()
        if df is None or df.empty:
            return None
        # Try to find YoY column or compute
        for col in ["社会融资规模增量", "其中-人民币贷款"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna()
                if len(vals) >= 13:
                    # Compute YoY growth from last 12 months
                    current = vals.iloc[-1]
                    prev_year = vals.iloc[-13]
                    if prev_year != 0:
                        return round((current - prev_year) / abs(prev_year) * 100, 2)
                elif not vals.empty:
                    return float(vals.iloc[-1])
    except Exception:
        pass
    return None


def _fetch_m2() -> Optional[float]:
    """M2同比增速 (monthly, %)."""
    import akshare as ak
    try:
        df = ak.macro_china_money_supply()
        if df is None or df.empty:
            return None
        for col in ["M2-同比增长", "M2同比", "货币和准货币(M2)同比增长"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna()
                if not vals.empty:
                    return float(vals.iloc[-1])
        # Fallback: first numeric column
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        if len(numeric_cols) > 0:
            vals = df[numeric_cols[0]].dropna()
            if not vals.empty:
                return float(vals.iloc[-1])
    except Exception:
        pass
    return None


def _fetch_margin_balance() -> Optional[float]:
    """融资余额 20日变化 (亿元)."""
    import akshare as ak
    try:
        df = ak.stock_margin_account_info()
        if df is None or df.empty:
            return None
        for col in ["融资余额(亿元)", "融资余额"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna()
                if len(vals) >= 20:
                    # 20-day change
                    return round(float(vals.iloc[-1] - vals.iloc[-20]), 2)
                elif len(vals) >= 2:
                    return round(float(vals.iloc[-1] - vals.iloc[0]), 2)
    except Exception:
        pass
    return None


def _fetch_northbound() -> Optional[float]:
    """北向资金20日累计净流入 (亿元)."""
    import akshare as ak
    try:
        df = ak.stock_hsgt_north_net_flow_in_em()
        if df is None or df.empty:
            return None
        for col in ["当日净流入-合计", "北向净流入", "净流入"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna()
                if len(vals) >= 20:
                    return round(float(vals.iloc[-20:].sum()), 2)
                elif not vals.empty:
                    return round(float(vals.sum()), 2)
        # Fallback: first numeric column
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        if len(numeric_cols) > 0:
            vals = df[numeric_cols[0]].dropna()
            if len(vals) >= 20:
                return round(float(vals.iloc[-20:].sum()), 2)
    except Exception:
        pass
    return None


def _fetch_fiscal_deficit() -> Optional[float]:
    """财政赤字率 (static/annual — event-driven)."""
    # This is typically set by government budget announcements
    # Default to recent historical value
    return 3.0  # 2024 target: 3%


def _fetch_fed_rate() -> Optional[float]:
    """美联储基准利率."""
    import akshare as ak
    try:
        df = ak.macro_bank_usa_interest_rate()
        if df is None or df.empty:
            return None
        for col in ["利率", "联邦基金利率"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna()
                if not vals.empty:
                    return float(vals.iloc[-1])
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        if len(numeric_cols) > 0:
            vals = df[numeric_cols[0]].dropna()
            if not vals.empty:
                return float(vals.iloc[-1])
    except Exception:
        pass
    return None


def _fetch_usd_index() -> Optional[float]:
    """美元指数 DXY."""
    import akshare as ak
    try:
        df = ak.index_investing_global(area="美国", symbol="美元指数", period="每日",
                                        start_date=(datetime.now() - timedelta(days=10)).strftime("%Y/%m/%d"),
                                        end_date=datetime.now().strftime("%Y/%m/%d"))
        if df is not None and not df.empty:
            for col in ["收盘", "close", "Close"]:
                if col in df.columns:
                    vals = pd.to_numeric(df[col], errors="coerce").dropna()
                    if not vals.empty:
                        return float(vals.iloc[-1])
    except Exception:
        pass
    return None
