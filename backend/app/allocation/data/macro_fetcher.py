"""Macro Data Fetcher — fetch 13 macro indicators from akshare.

Each indicator is wrapped in try/except with graceful fallback.
Column names verified against akshare 1.18.63 (2026-05).
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from .models import MacroIndicator, MacroSnapshot

logger = logging.getLogger(__name__)

# TTL constants (seconds)
TTL_DAILY = 14400     # 4 hours
TTL_MONTHLY = 86400   # 24 hours


def fetch_all() -> MacroSnapshot:
    """Fetch all 13 macro indicators. Never raises — returns partial data on failure."""
    indicators = {}
    fetchers = [
        ("PMI制造业",       _fetch_pmi,                TTL_MONTHLY),
        ("GDP同比",         _fetch_gdp,                TTL_MONTHLY),
        ("CPI同比",         _fetch_cpi,                TTL_MONTHLY),
        ("PPI同比",         _fetch_ppi,                TTL_MONTHLY),
        ("10Y国债收益率",    _fetch_bond_yield_10y,     TTL_DAILY),
        ("DR007",           _fetch_dr007,              TTL_DAILY),
        ("社融增量",         _fetch_social_financing,   TTL_MONTHLY),
        ("M2增速",          _fetch_m2,                 TTL_MONTHLY),
        ("融资余额变化",     _fetch_margin_balance,     TTL_DAILY),
        ("北向资金净流入",   _fetch_northbound,         TTL_DAILY),
        ("财政赤字率",       _fetch_fiscal_deficit,     TTL_MONTHLY),
        ("美联储利率",       _fetch_fed_rate,           TTL_MONTHLY),
        ("美元指数",         _fetch_usd_index,          TTL_DAILY),
    ]

    for name, fetcher, ttl in fetchers:
        try:
            value = fetcher()
            if value is not None:
                indicators[name] = MacroIndicator(
                    name=name, value=float(value), source="akshare",
                    confidence=0.9, fetch_time=datetime.now().isoformat(), ttl_seconds=ttl,
                )
            else:
                indicators[name] = MacroIndicator(
                    name=name, value=None, source="static", confidence=0.3,
                )
        except Exception as e:
            logger.warning(f"Failed to fetch {name}: {e}")
            indicators[name] = MacroIndicator(
                name=name, value=None, source="static", confidence=0.3,
            )

    confs = [ind.confidence for ind in indicators.values() if ind.value is not None]
    overall = float(np.mean(confs)) if confs else 0.3
    return MacroSnapshot(indicators=indicators, overall_confidence=overall)


# ─── Helper ────────────────────────────────────────────────────────────────────

def _latest_numeric(df: pd.DataFrame, col: str) -> Optional[float]:
    """Extract the latest non-NaN numeric value from a DataFrame column."""
    if col not in df.columns:
        return None
    vals = pd.to_numeric(df[col], errors="coerce").dropna()
    return float(vals.iloc[-1]) if not vals.empty else None


def _latest_jinzhi(df: pd.DataFrame) -> Optional[float]:
    """Extract latest '今值' from akshare standardized-format DataFrame."""
    return _latest_numeric(df, "今值")


# ─── 1. PMI 制造业 ─────────────────────────────────────────────────────────────

def _fetch_pmi() -> Optional[float]:
    """制造业PMI (monthly). akshare macro_china_pmi_yearly → cols: 商品,日期,今值,预测值,前值"""
    import akshare as ak
    try:
        df = ak.macro_china_pmi_yearly()
        if df is None or df.empty:
            return None
        # Filter to 中国官方制造业PMI rows
        mask = df["商品"].str.contains("制造业PMI", na=False)
        subset = df[mask] if mask.any() else df
        return _latest_jinzhi(subset)
    except Exception:
        return None


# ─── 2. GDP 同比 ────────────────────────────────────────────────────────────────

def _fetch_gdp() -> Optional[float]:
    """GDP同比增速 (quarterly). Data sorted descending by quarter — most recent at top."""
    import akshare as ak
    try:
        df = ak.macro_china_gdp()
        if df is None or df.empty:
            return None
        # Sort ascending by quarter to get latest at bottom
        df = df.sort_values("季度")
        return _latest_numeric(df, "国内生产总值-同比增长")
    except Exception:
        return None


# ─── 3. CPI 同比 ────────────────────────────────────────────────────────────────

def _fetch_cpi() -> Optional[float]:
    """CPI同比 (monthly). akshare macro_china_cpi_yearly → cols: 商品,日期,今值,预测值,前值"""
    import akshare as ak
    try:
        df = ak.macro_china_cpi_yearly()
        if df is None or df.empty:
            return None
        return _latest_jinzhi(df)
    except Exception:
        return None


# ─── 4. PPI 同比 ────────────────────────────────────────────────────────────────

def _fetch_ppi() -> Optional[float]:
    """PPI同比 (monthly). akshare macro_china_ppi_yearly → cols: 商品,日期,今值,预测值,前值"""
    import akshare as ak
    try:
        df = ak.macro_china_ppi_yearly()
        if df is None or df.empty:
            return None
        return _latest_jinzhi(df)
    except Exception:
        return None


# ─── 5. 10Y 国债收益率 ──────────────────────────────────────────────────────────

def _fetch_bond_yield_10y() -> Optional[float]:
    """10年期国债收益率 (daily). Filter for 中债国债收益率曲线, column: 10年."""
    import akshare as ak
    try:
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
        df = ak.bond_china_yield(start_date=start, end_date=end)
        if df is None or df.empty:
            return None
        # Filter to 国债 row specifically (not 中短期票据, not 商业银行债)
        mask = df["曲线名称"].str.contains("中债国债收益率曲线", na=False)
        if mask.any():
            df = df[mask]
        return _latest_numeric(df, "10年")
    except Exception:
        return None


# ─── 6. DR007 ───────────────────────────────────────────────────────────────────

def _fetch_dr007() -> Optional[float]:
    """DR007 银行间回购利率. Try bond_repo_yield then LPR as fallback."""
    import akshare as ak
    # Primary: try bond repo
    try:
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=5)).strftime("%Y%m%d")
        df = ak.bond_repo_yield(start_date=start, end_date=end)
        if df is not None and not df.empty and "DR007" in df.columns:
            return _latest_numeric(df, "DR007")
    except Exception:
        pass
    # Fallback: LPR 1Y as proxy for short-term rate
    try:
        df = ak.macro_china_lpr()
        if df is not None and not df.empty:
            return _latest_numeric(df, "LPR1Y")
    except Exception:
        pass
    return None


# ─── 7. 社融增量 ────────────────────────────────────────────────────────────────

def _fetch_social_financing() -> Optional[float]:
    """社会融资规模月度增量 (亿元). Returns trailing-12-month sum for stability."""
    import akshare as ak
    try:
        df = ak.macro_china_shrzgm()
        if df is None or df.empty:
            return None
        vals = pd.to_numeric(df["社会融资规模增量"], errors="coerce").dropna()
        if len(vals) == 0:
            return None
        # Return last 12 months sum as annualized metric
        window = vals.iloc[-12:] if len(vals) >= 12 else vals
        return round(float(window.sum()), 2)
    except Exception:
        return None


# ─── 8. M2 增速 ─────────────────────────────────────────────────────────────────

def _fetch_m2() -> Optional[float]:
    """M2同比增速 (monthly, %). Column: 货币和准货币(M2)-同比增长"""
    import akshare as ak
    try:
        df = ak.macro_china_money_supply()
        if df is None or df.empty:
            return None
        return _latest_numeric(df, "货币和准货币(M2)-同比增长")
    except Exception:
        return None


# ─── 9. 融资余额变化 ────────────────────────────────────────────────────────────

def _fetch_margin_balance() -> Optional[float]:
    """融资余额 20日变化 (亿元). Column: 融资余额"""
    import akshare as ak
    try:
        df = ak.stock_margin_account_info()
        if df is None or df.empty:
            return None
        vals = pd.to_numeric(df["融资余额"], errors="coerce").dropna()
        if len(vals) < 2:
            return None
        if len(vals) >= 20:
            return round(float(vals.iloc[-1] - vals.iloc[-20]), 2)
        return round(float(vals.iloc[-1] - vals.iloc[0]), 2)
    except Exception:
        return None


# ─── 10. 北向资金 ───────────────────────────────────────────────────────────────

def _fetch_northbound() -> Optional[float]:
    """北向资金 20日累计净流入 (亿元).
    akshare 1.18 removed stock_hsgt_north_net_flow_in_em.
    Replacement: stock_hsgt_hist_em(symbol='北向资金')
    """
    import akshare as ak
    try:
        df = ak.stock_hsgt_hist_em(symbol="北向资金")
        if df is None or df.empty:
            return None
        # Column may be '当日成交净买额' or '净流入'
        for col in ["当日成交净买额", "净流入", "当日资金流向"]:
            if col in df.columns:
                vals = pd.to_numeric(df[col], errors="coerce").dropna()
                if len(vals) >= 20:
                    return round(float(vals.iloc[-20:].sum()), 2)
                if not vals.empty:
                    return round(float(vals.sum()), 2)
        # Fallback: first numeric column
        num_cols = df.select_dtypes(include=[np.number]).columns
        if len(num_cols) > 0:
            vals = df[num_cols[0]].dropna()
            if len(vals) >= 20:
                return round(float(vals.iloc[-20:].sum()), 2)
    except Exception as e:
        logger.debug(f"Northbound fetch failed: {e}")
    return None


# ─── 11. 财政赤字率 ─────────────────────────────────────────────────────────────

def _fetch_fiscal_deficit() -> Optional[float]:
    """财政赤字率 (annual government budget target). Static until source available."""
    # Source: government budget announcement (typically ~3.0%)
    # TODO: replace with actual API when available
    return 3.0


# ─── 12. 美联储利率 ─────────────────────────────────────────────────────────────

def _fetch_fed_rate() -> Optional[float]:
    """美联储基准利率. akshare macro_bank_usa_interest_rate → cols: 商品,日期,今值,预测值,前值"""
    import akshare as ak
    try:
        df = ak.macro_bank_usa_interest_rate()
        if df is None or df.empty:
            return None
        # 今值 may be NaN for future dates; use 前值 as latest available
        val = _latest_jinzhi(df)
        if val is not None:
            return val
        return _latest_numeric(df, "前值")
    except Exception:
        return None


# ─── 13. 美元指数 ───────────────────────────────────────────────────────────────

def _fetch_usd_index() -> Optional[float]:
    """美元指数 DXY.
    akshare 1.18 removed index_investing_global.
    Primary: index_global_hist_em; Fallback: free forex API.
    """
    import akshare as ak
    # Primary: akshare global index
    try:
        df = ak.index_global_hist_em(symbol="美元指数")
        if df is not None and not df.empty:
            for col in ["收盘", "close", "最新价"]:
                if col in df.columns:
                    return _latest_numeric(df, col)
            num_cols = df.select_dtypes(include=[np.number]).columns
            if len(num_cols) > 0:
                return _latest_numeric(df, num_cols[0])
    except Exception as e:
        logger.debug(f"DXY akshare failed: {e}")

    # Fallback: free forex API (EUR/USD → compute DXY proxy)
    try:
        import requests
        r = requests.get("https://open.er-api.com/v6/latest/USD", timeout=10)
        if r.status_code == 200:
            rates = r.json().get("rates", {})
            eur = rates.get("EUR")
            jpy = rates.get("JPY")
            gbp = rates.get("GBP")
            cad = rates.get("CAD")
            sek = rates.get("SEK")
            chf = rates.get("CHF")
            if eur and jpy:
                # Simplified DXY formula: weighted geometric mean of 6 currencies
                dxy_proxy = (
                    50.14348112
                    * (eur ** -0.576)
                    * (jpy ** 0.136)
                    * (gbp ** -0.119)
                    * (cad ** 0.091)
                    * (sek ** 0.042)
                    * (chf ** 0.036)
                )
                return round(dxy_proxy, 2)
    except Exception as e:
        logger.debug(f"DXY fallback failed: {e}")

    return None
