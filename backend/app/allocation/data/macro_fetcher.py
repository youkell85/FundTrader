"""Macro Data Fetcher — fetch 13 macro indicators.

Primary source: Tushare Pro (authoritative NBS/PBOC data, 6000-point token).
Fallback: akshare (free but less reliable, API changes frequently).
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from .models import MacroIndicator, MacroSnapshot

logger = logging.getLogger(__name__)

TTL_DAILY = 14400     # 4 hours
TTL_MONTHLY = 86400   # 24 hours


def _get_tushare():
    """Lazy-init Tushare pro API. Returns None if not configured."""
    try:
        import tushare as ts
        from app.config import TUSHARE_TOKEN
        if not TUSHARE_TOKEN:
            return None
        ts.set_token(TUSHARE_TOKEN)
        return ts.pro_api()
    except Exception:
        return None


def fetch_all() -> MacroSnapshot:
    """Fetch all 13 macro indicators. Never raises — returns partial data on failure."""
    pro = _get_tushare()
    indicators = {}

    fetchers = [
        ("PMI制造业",       lambda: _fetch_pmi(pro),            TTL_MONTHLY),
        ("GDP同比",         lambda: _fetch_gdp(pro),            TTL_MONTHLY),
        ("CPI同比",         lambda: _fetch_cpi(pro),            TTL_MONTHLY),
        ("PPI同比",         lambda: _fetch_ppi(pro),            TTL_MONTHLY),
        ("10Y国债收益率",    lambda: _fetch_bond_yield_10y(pro), TTL_DAILY),
        ("DR007",           lambda: _fetch_dr007(pro),          TTL_DAILY),
        ("社融增速",         lambda: _fetch_social_financing(pro), TTL_MONTHLY),
        ("M2增速",          lambda: _fetch_m2(pro),             TTL_MONTHLY),
        ("融资余额变化",     lambda: _fetch_margin_balance(pro), TTL_DAILY),
        ("北向资金净流入",   _fetch_northbound,                  TTL_DAILY),
        ("财政赤字率",       _fetch_fiscal_deficit,              TTL_MONTHLY),
        ("美联储利率",       _fetch_fed_rate,                    TTL_MONTHLY),
        ("美元指数",         _fetch_usd_index,                   TTL_DAILY),
    ]

    for name, fetcher, ttl in fetchers:
        try:
            value = fetcher()
            src = "tushare" if pro and name not in ("北向资金净流入","财政赤字率","美联储利率","美元指数") else "akshare"
            if name == "财政赤字率":
                src = "static"
            elif name == "美元指数":
                src = "forex_api"
            if value is not None:
                conf = 0.95 if src == "tushare" else 0.9
                # 财政赤字率: hardcoded placeholder, force low confidence so
                # TAA score=0 (B5). Without this, the placeholder would
                # affect allocations with full weight.
                if name == "财政赤字率":
                    conf = 0.3
                # DR007: confidence depends on actual data source used
                # - FR007 (akshare) is best proxy → conf 0.9
                # - Shibor 1W (tushare) is rough proxy → conf 0.7
                # - LPR 1W final fallback → conf 0.5
                if name == "DR007":
                    if _dr007_actual_source == "tushare":
                        conf = 0.7  # Shibor 1W as rough DR007 proxy
                    elif _dr007_actual_source == "lpr_fallback":
                        conf = 0.5  # LPR 1W as very rough proxy
                    else:
                        conf = 0.9  # FR007 from akshare
                # Lower confidence for DXY (computed from forex rates, not direct)
                if name == "美元指数":
                    conf = 0.7
                indicators[name] = MacroIndicator(
                    name=name, value=float(value), source=src,
                    confidence=conf,
                    fetch_time=datetime.now().isoformat(), ttl_seconds=ttl,
                )
            else:
                indicators[name] = MacroIndicator(name=name, value=None, source="static", confidence=0.3)
        except Exception as e:
            logger.warning(f"Failed to fetch {name}: {e}")
            indicators[name] = MacroIndicator(name=name, value=None, source="static", confidence=0.3)

    confs = [ind.confidence for ind in indicators.values() if ind.value is not None]
    overall = float(np.mean(confs)) if confs else 0.3
    return MacroSnapshot(indicators=indicators, overall_confidence=overall)


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _latest(df: pd.DataFrame, col: str) -> Optional[float]:
    """Latest non-NaN numeric value from column."""
    if col not in df.columns:
        return None
    s = pd.to_numeric(df[col], errors="coerce").dropna()
    return float(s.iloc[-1]) if not s.empty else None


def _latest_0(df: pd.DataFrame, col: str) -> Optional[float]:
    """Latest non-NaN from column — uses iloc[0] for DESC-sorted data."""
    if col not in df.columns:
        return None
    s = pd.to_numeric(df[col], errors="coerce").dropna()
    return float(s.iloc[0]) if not s.empty else None


# ─── 1. PMI 制造业 (Tushare cn_pmi) ────────────────────────────────────────────

def _fetch_pmi(pro) -> Optional[float]:
    """制造业PMI. Tushare cn_pmi → PMI010000 = 综合指数."""
    if pro:
        try:
            df = pro.cn_pmi(start_m=_month(-2), end_m=_month(0))
            if df is not None and not df.empty and "PMI010000" in df.columns:
                df = df.sort_values("MONTH")
                return _latest(df, "PMI010000")
        except Exception as e:
            logger.debug(f"Tushare PMI failed: {e}")
    # Fallback: akshare
    return _ak_pmi()


def _ak_pmi() -> Optional[float]:
    import akshare as ak
    try:
        df = ak.macro_china_pmi_yearly()
        if df is not None and not df.empty:
            mask = df["商品"].str.contains("制造业PMI", na=False)
            return _latest(df[mask] if mask.any() else df, "今值")
    except Exception:
        return None


# ─── 2. GDP 同比 (Tushare cn_gdp) ──────────────────────────────────────────────

def _fetch_gdp(pro) -> Optional[float]:
    """GDP同比增速. Tushare cn_gdp → gdp_yoy."""
    if pro:
        try:
            df = pro.cn_gdp(start_q=_quarter(-4), end_q=_quarter(0), fields="quarter,gdp_yoy")
            if df is not None and not df.empty:
                df = df.sort_values("quarter")
                return _latest(df, "gdp_yoy")
        except Exception as e:
            logger.debug(f"Tushare GDP failed: {e}")
    return _ak_gdp()


def _ak_gdp() -> Optional[float]:
    import akshare as ak
    try:
        df = ak.macro_china_gdp()
        if df is not None and not df.empty:
            df = df.sort_values("季度")
            return _latest(df, "国内生产总值-同比增长")
    except Exception:
        return None


# ─── 3. CPI 同比 (Tushare cn_cpi) ──────────────────────────────────────────────

def _fetch_cpi(pro) -> Optional[float]:
    """CPI同比. Tushare cn_cpi → nt_yoy (全国居民消费价格指数)."""
    if pro:
        try:
            df = pro.cn_cpi(start_m=_month(-3), end_m=_month(0), fields="month,nt_yoy")
            if df is not None and not df.empty:
                df = df.sort_values("month")
                return _latest(df, "nt_yoy")
        except Exception as e:
            logger.debug(f"Tushare CPI failed: {e}")
    return _ak_cpi()


def _ak_cpi() -> Optional[float]:
    import akshare as ak
    try:
        df = ak.macro_china_cpi_yearly()
        return _latest(df, "今值") if df is not None and not df.empty else None
    except Exception:
        return None


# ─── 4. PPI 同比 (Tushare cn_ppi) ──────────────────────────────────────────────

def _fetch_ppi(pro) -> Optional[float]:
    """PPI同比. Tushare cn_ppi → ppi_yoy."""
    if pro:
        try:
            df = pro.cn_ppi(start_m=_month(-3), end_m=_month(0), fields="month,ppi_yoy")
            if df is not None and not df.empty:
                df = df.sort_values("month")
                return _latest(df, "ppi_yoy")
        except Exception as e:
            logger.debug(f"Tushare PPI failed: {e}")
    return _ak_ppi()


def _ak_ppi() -> Optional[float]:
    import akshare as ak
    try:
        df = ak.macro_china_ppi_yearly()
        return _latest(df, "今值") if df is not None and not df.empty else None
    except Exception:
        return None


# ─── 5. 10Y 国债收益率 (Tushare yc_cb) ─────────────────────────────────────────

def _fetch_bond_yield_10y(pro) -> Optional[float]:
    """10年期国债收益率. Tushare yc_cb → curve_name=中债国债, curve_term=10."""
    if pro:
        try:
            df = pro.yc_cb(start_m=_month(-2), end_m=_month(0))
            if df is not None and not df.empty:
                mask = df["curve_name"].str.contains("国债", na=False) & (df["curve_term"] == 10)
                if mask.any():
                    df = df[mask].sort_values("trade_date")
                    return _latest(df, "yield")
        except Exception as e:
            logger.debug(f"Tushare yc_cb failed: {e}")
    return _ak_bond()


def _ak_bond() -> Optional[float]:
    import akshare as ak
    try:
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
        df = ak.bond_china_yield(start_date=start, end_date=end)
        if df is not None and not df.empty:
            mask = df["曲线名称"].str.contains("中债国债", na=False)
            return _latest(df[mask] if mask.any() else df, "10年")
    except Exception:
        return None


# ─── 6. DR007 (FR007 first, Shibor 1W as fallback proxy) ────────────────────────

_dr007_actual_source = "akshare"  # track which source was actually used


def _fetch_dr007(pro) -> Optional[float]:
    """DR007 proxy: prefer FR007 (repo fixing rate), fallback to Shibor 1W."""
    global _dr007_actual_source
    # Try FR007 from akshare first (more accurate proxy for DR007)
    fr007 = _ak_fr007()
    if fr007 is not None:
        _dr007_actual_source = "akshare"
        return fr007
    # Fallback: Shibor 1W from Tushare (less accurate proxy)
    if pro:
        try:
            end = datetime.now().strftime("%Y%m%d")
            start = (datetime.now() - timedelta(days=7)).strftime("%Y%m%d")
            df = pro.shibor(start_date=start, end_date=end, fields="date,1w")
            if df is not None and not df.empty:
                df = df.sort_values("date")
                val = _latest(df, "1w")
                _dr007_actual_source = "tushare"
                return val
        except Exception as e:
            logger.debug(f"Tushare shibor failed: {e}")
    _dr007_actual_source = "lpr_fallback"
    return _ak_dr007_fallback()


def _ak_fr007() -> Optional[float]:
    """FR007 (回购定盘利率) from akshare — best proxy for DR007."""
    import akshare as ak
    try:
        df = ak.repo_rate_hist()
        if df is not None and not df.empty and "FR007" in df.columns:
            return _latest(df, "FR007")
    except Exception:
        pass
    return None


def _ak_dr007_fallback() -> Optional[float]:
    """Fallback: LPR 1Y as very rough proxy for short-term rate."""
    import akshare as ak
    try:
        df = ak.macro_china_lpr()
        if df is not None and not df.empty:
            return _latest(df, "LPR1Y")
    except Exception:
        pass
    return None


# ─── 7. 社融增速 (Tushare sf_month → compute YoY) ──────────────────────────────

def _fetch_social_financing(pro) -> Optional[float]:
    """社会融资规模存量同比增速 (%). Compute YoY from monthly incremental data."""
    if pro:
        try:
            df = pro.sf_month(start_m=_month(-25), end_m=_month(0), fields="month,inc_month")
            if df is not None and not df.empty and "inc_month" in df.columns:
                df = df.sort_values("month")
                vals = pd.to_numeric(df["inc_month"], errors="coerce").dropna()
                # Compute rolling 12-month cumulative for current and prior year
                if len(vals) >= 24:
                    current_12m = float(vals.iloc[-12:].sum())
                    prior_12m = float(vals.iloc[-24:-12].sum())
                    if prior_12m > 0:
                        yoy = (current_12m / prior_12m - 1) * 100
                        return round(yoy, 2)
                elif len(vals) >= 13:
                    # Not enough for full YoY, use last 12m vs available prior
                    current_12m = float(vals.iloc[-12:].sum())
                    prior_12m = float(vals.iloc[:-12].sum())
                    if prior_12m > 0:
                        yoy = (current_12m / prior_12m - 1) * 100
                        return round(yoy, 2)
        except Exception as e:
            logger.debug(f"Tushare sf_month failed: {e}")
    return _ak_sf()


def _ak_sf() -> Optional[float]:
    """社会融资规模存量同比增速 (%) from akshare."""
    import akshare as ak
    try:
        # Try to get social financing stock (存量) YoY directly
        df = ak.macro_china_shrzgm()
        if df is not None and not df.empty:
            # Check if there's a YoY growth column
            for col in ["社会融资规模存量同比", "社会融资规模增量"]:
                if col in df.columns:
                    vals = pd.to_numeric(df[col], errors="coerce").dropna()
                    if col == "社会融资规模存量同比" and not vals.empty:
                        return round(float(vals.iloc[-1]), 2)
            # Fallback: compute YoY from incremental data
            col = "社会融资规模增量" if "社会融资规模增量" in df.columns else df.columns[-1]
            vals = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(vals) >= 24:
                current_12m = float(vals.iloc[-12:].sum())
                prior_12m = float(vals.iloc[-24:-12].sum())
                if prior_12m > 0:
                    yoy = (current_12m / prior_12m - 1) * 100
                    return round(yoy, 2)
    except Exception:
        return None


# ─── 8. M2 增速 (Tushare cn_m → compute YoY) ───────────────────────────────────

def _fetch_m2(pro) -> Optional[float]:
    """M2同比增速 (%). Tushare cn_m → compute YoY from absolute values."""
    if pro:
        try:
            df = pro.cn_m(start_m=_month(-14), end_m=_month(0), fields="month,m2")
            if df is not None and not df.empty and "m2" in df.columns:
                df = df.sort_values("month")
                vals = pd.to_numeric(df["m2"], errors="coerce").dropna()
                if len(vals) >= 13:
                    yoy = (vals.iloc[-1] / vals.iloc[-13] - 1) * 100
                    return round(float(yoy), 2)
        except Exception as e:
            logger.debug(f"Tushare cn_m failed: {e}")
    return _ak_m2()


def _ak_m2() -> Optional[float]:
    import akshare as ak
    try:
        df = ak.macro_china_money_supply()
        if df is not None and not df.empty:
            return _latest(df, "货币和准货币(M2)-同比增长")
    except Exception:
        return None


# ─── 9. 融资余额变化 (Tushare margin) ───────────────────────────────────────────

def _fetch_margin_balance(pro) -> Optional[float]:
    """融资余额 20日变化 (亿元). Tushare margin → rzye, sum across exchanges."""
    if pro:
        try:
            end = datetime.now().strftime("%Y%m%d")
            start = (datetime.now() - timedelta(days=35)).strftime("%Y%m%d")
            df = pro.margin(start_date=start, end_date=end)
            if df is not None and not df.empty and "rzye" in df.columns:
                # Sum across exchanges per date
                daily = df.groupby("trade_date")["rzye"].sum() / 1e8  # yuan → 亿元
                daily = daily.sort_index()
                if len(daily) >= 2:
                    chg = round(float(daily.iloc[-1] - daily.iloc[0]), 2)
                    return chg
        except Exception as e:
            logger.debug(f"Tushare margin failed: {e}")
    return _ak_margin()


def _ak_margin() -> Optional[float]:
    import akshare as ak
    try:
        df = ak.stock_margin_account_info()
        if df is not None and not df.empty and "融资余额" in df.columns:
            vals = pd.to_numeric(df["融资余额"], errors="coerce").dropna()
            if len(vals) >= 20:
                return round(float(vals.iloc[-1] - vals.iloc[-20]), 2)
            if len(vals) >= 2:
                return round(float(vals.iloc[-1] - vals.iloc[0]), 2)
    except Exception:
        return None


# ─── 10. 北向资金 (akshare — Tushare moneyflow_hsgt unit unclear) ───────────────

def _fetch_northbound() -> Optional[float]:
    """北向资金 20日累计净流入 (亿元). akshare stock_hsgt_hist_em."""
    import akshare as ak
    try:
        df = ak.stock_hsgt_hist_em(symbol="北向资金")
        if df is not None and not df.empty:
            for col in ["当日成交净买额", "净流入"]:
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
    except Exception:
        pass
    return None


# ─── 11. 财政赤字率 (static placeholder; real source needs iFinD/EDB) ──────────

def _fetch_fiscal_deficit() -> Optional[float]:
    """财政赤字率 (%). Placeholder until iFinD EDB / official data source wired.

    The hardcoded 3.0 below is the 2026 government work report target. Treat
    as low confidence in fetch_all() — confidence is overridden to 0.3 there.
    """
    return 3.0


# ─── 12. 美联储利率 (akshare — Tushare us_trl not available at 6000pts) ─────────

def _fetch_fed_rate() -> Optional[float]:
    """美联储基准利率. akshare macro_bank_usa_interest_rate."""
    import akshare as ak
    try:
        df = ak.macro_bank_usa_interest_rate()
        if df is not None and not df.empty:
            # 今值 may be NaN for future dates; try 前值 first as it's the actual latest rate
            val = _latest(df, "前值")
            if val is not None:
                return val
            return _latest(df, "今值")
    except Exception:
        return None


# ─── 13. 美元指数 (free forex API — Tushare DXY no data at 6000pts) ────────────

def _fetch_usd_index() -> Optional[float]:
    """美元指数 DXY. Free forex API with correct DXY formula."""
    # Try open.er-api.com free forex rates
    try:
        import requests
        r = requests.get("https://open.er-api.com/v6/latest/USD", timeout=10)
        if r.status_code == 200:
            rates = r.json().get("rates", {})
            eur, jpy = rates.get("EUR"), rates.get("JPY")
            gbp, cad = rates.get("GBP"), rates.get("CAD")
            sek, chf = rates.get("SEK"), rates.get("CHF")
            if eur and jpy:
                dxy = (
                    50.14348112
                    * (eur ** 0.576)     # EURUSD^-0.576 → (1/eur)^-0.576 = eur^0.576
                    * (jpy ** 0.136)     # USDJPY
                    * (gbp ** 0.119)     # GBPUSD^-0.119 → (1/gbp)^-0.119 = gbp^0.119
                    * (cad ** 0.091)     # USDCAD
                    * (sek ** 0.042)     # USDSEK
                    * (chf ** 0.036)     # USDCHF
                )
                return round(dxy, 2)
    except Exception:
        pass
    return None


# ─── Date helpers ──────────────────────────────────────────────────────────────

def _month(offset: int) -> str:
    """Return YYYYMM string offset from current month."""
    d = datetime.now()
    # Adjust month
    m = d.month + offset
    y = d.year + (m - 1) // 12
    m = ((m - 1) % 12) + 1
    return f"{y}{m:02d}"


def _quarter(offset: int) -> str:
    """Return YYYYQN string offset from current quarter."""
    d = datetime.now()
    q = (d.month - 1) // 3 + 1
    q += offset
    y = d.year + (q - 1) // 4
    q = ((q - 1) % 4) + 1
    return f"{y}Q{q}"
