"""Macro Data Fetcher 鈥?fetch 13 macro indicators.

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
    """Fetch all 13 macro indicators. Never raises 鈥?returns partial data on failure."""
    pro = _get_tushare()
    indicators = {}

    fetchers = [
        ("PMI鍒堕€犱笟",       lambda: _fetch_pmi(pro),            TTL_MONTHLY),
        ("GDP鍚屾瘮",         lambda: _fetch_gdp(pro),            TTL_MONTHLY),
        ("CPI鍚屾瘮",         lambda: _fetch_cpi(pro),            TTL_MONTHLY),
        ("PPI鍚屾瘮",         lambda: _fetch_ppi(pro),            TTL_MONTHLY),
        ("10Y鍥藉€烘敹鐩婄巼",    lambda: _fetch_bond_yield_10y(pro), TTL_DAILY),
        ("DR007",           lambda: _fetch_dr007(pro),          TTL_DAILY),
        ("绀捐瀺澧為€?,         lambda: _fetch_social_financing(pro), TTL_MONTHLY),
        ("M2澧為€?,          lambda: _fetch_m2(pro),             TTL_MONTHLY),
        ("铻嶈祫浣欓鍙樺寲",     lambda: _fetch_margin_balance(pro), TTL_DAILY),
        ("鍖楀悜璧勯噾鍑€娴佸叆",   _fetch_northbound,                  TTL_DAILY),
        ("璐㈡斂璧ゅ瓧鐜?,       _fetch_fiscal_deficit,              TTL_MONTHLY),
        ("缇庤仈鍌ㄥ埄鐜?,       _fetch_fed_rate,                    TTL_MONTHLY),
        ("缇庡厓鎸囨暟",         _fetch_usd_index,                   TTL_DAILY),
    ]

    for name, fetcher, ttl in fetchers:
        try:
            value = fetcher()
            src = "tushare" if pro and name not in ("鍖楀悜璧勯噾鍑€娴佸叆","璐㈡斂璧ゅ瓧鐜?,"缇庤仈鍌ㄥ埄鐜?,"缇庡厓鎸囨暟") else "akshare"
            if name == "璐㈡斂璧ゅ瓧鐜?:
                src = "static"
            elif name == "缇庡厓鎸囨暟":
                src = "forex_api"
            if value is not None:
                conf = 0.95 if src == "tushare" else 0.9
                # 璐㈡斂璧ゅ瓧鐜? hardcoded placeholder, force low confidence so
                # TAA score=0 (B5). Without this, the placeholder would
                # affect allocations with full weight.
                if name == "璐㈡斂璧ゅ瓧鐜?:
                    conf = 0.3
                # DR007: confidence depends on actual data source used
                # - FR007 (akshare) is best proxy 鈫?conf 0.9
                # - Shibor 1W (tushare) is rough proxy 鈫?conf 0.7
                # - LPR 1W final fallback 鈫?conf 0.5
                if name == "DR007":
                    if _dr007_actual_source == "tushare":
                        conf = 0.7  # Shibor 1W as rough DR007 proxy
                    elif _dr007_actual_source == "lpr_fallback":
                        conf = 0.5  # LPR 1W as very rough proxy
                    else:
                        conf = 0.9  # FR007 from akshare
                # Lower confidence for DXY (computed from forex rates, not direct)
                if name == "缇庡厓鎸囨暟":
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


# 鈹€鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _latest(df: pd.DataFrame, col: str) -> Optional[float]:
    """Latest non-NaN numeric value from column."""
    if col not in df.columns:
        return None
    s = pd.to_numeric(df[col], errors="coerce").dropna()
    return float(s.iloc[-1]) if not s.empty else None


def _latest_0(df: pd.DataFrame, col: str) -> Optional[float]:
    """Latest non-NaN from column 鈥?uses iloc[0] for DESC-sorted data."""
    if col not in df.columns:
        return None
    s = pd.to_numeric(df[col], errors="coerce").dropna()
    return float(s.iloc[0]) if not s.empty else None


# 鈹€鈹€鈹€ 1. PMI 鍒堕€犱笟 (Tushare cn_pmi) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_pmi(pro) -> Optional[float]:
    """鍒堕€犱笟PMI. Tushare cn_pmi 鈫?PMI010000 = 缁煎悎鎸囨暟."""
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
            mask = df["鍟嗗搧"].str.contains("鍒堕€犱笟PMI", na=False)
            return _latest(df[mask] if mask.any() else df, "浠婂€?)
    except Exception:
        return None


# 鈹€鈹€鈹€ 2. GDP 鍚屾瘮 (Tushare cn_gdp) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_gdp(pro) -> Optional[float]:
    """GDP鍚屾瘮澧為€? Tushare cn_gdp 鈫?gdp_yoy."""
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
            df = df.sort_values("瀛ｅ害")
            return _latest(df, "鍥藉唴鐢熶骇鎬诲€?鍚屾瘮澧為暱")
    except Exception:
        return None


# 鈹€鈹€鈹€ 3. CPI 鍚屾瘮 (Tushare cn_cpi) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_cpi(pro) -> Optional[float]:
    """CPI鍚屾瘮. Tushare cn_cpi 鈫?nt_yoy (鍏ㄥ浗灞呮皯娑堣垂浠锋牸鎸囨暟)."""
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
        return _latest(df, "浠婂€?) if df is not None and not df.empty else None
    except Exception:
        return None


# 鈹€鈹€鈹€ 4. PPI 鍚屾瘮 (Tushare cn_ppi) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_ppi(pro) -> Optional[float]:
    """PPI鍚屾瘮. Tushare cn_ppi 鈫?ppi_yoy."""
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
        return _latest(df, "浠婂€?) if df is not None and not df.empty else None
    except Exception:
        return None


# 鈹€鈹€鈹€ 5. 10Y 鍥藉€烘敹鐩婄巼 (Tushare yc_cb) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_bond_yield_10y(pro) -> Optional[float]:
    """10骞存湡鍥藉€烘敹鐩婄巼. Tushare yc_cb 鈫?curve_name=涓€哄浗鍊? curve_term=10."""
    if pro:
        try:
            df = pro.yc_cb(start_m=_month(-2), end_m=_month(0))
            if df is not None and not df.empty:
                mask = df["curve_name"].str.contains("鍥藉€?, na=False) & (df["curve_term"] == 10)
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
            mask = df["鏇茬嚎鍚嶇О"].str.contains("涓€哄浗鍊?, na=False)
            return _latest(df[mask] if mask.any() else df, "10骞?)
    except Exception:
        return None


# 鈹€鈹€鈹€ 6. DR007 (FR007 first, Shibor 1W as fallback proxy) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
    """FR007 (鍥炶喘瀹氱洏鍒╃巼) from akshare 鈥?best proxy for DR007."""
    import akshare as ak
    try:
        df = ak.repo_rate_hist()
        if df is not None and not df.empty and "FR007" in df.columns:
            return _latest(df, "FR007")
    except Exception:
    logger.exception("Ignored non-fatal exception")
    return None


def _ak_dr007_fallback() -> Optional[float]:
    """Fallback: LPR 1Y as very rough proxy for short-term rate."""
    import akshare as ak
    try:
        df = ak.macro_china_lpr()
        if df is not None and not df.empty:
            return _latest(df, "LPR1Y")
    except Exception:
    logger.exception("Ignored non-fatal exception")
    return None


# 鈹€鈹€鈹€ 7. 绀捐瀺澧為€?(Tushare sf_month 鈫?compute YoY) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_social_financing(pro) -> Optional[float]:
    """绀句細铻嶈祫瑙勬ā瀛橀噺鍚屾瘮澧為€?(%). Compute YoY from monthly incremental data."""
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
    """绀句細铻嶈祫瑙勬ā瀛橀噺鍚屾瘮澧為€?(%) from akshare."""
    import akshare as ak
    try:
        # Try to get social financing stock (瀛橀噺) YoY directly
        df = ak.macro_china_shrzgm()
        if df is not None and not df.empty:
            # Check if there's a YoY growth column
            for col in ["绀句細铻嶈祫瑙勬ā瀛橀噺鍚屾瘮", "绀句細铻嶈祫瑙勬ā澧為噺"]:
                if col in df.columns:
                    vals = pd.to_numeric(df[col], errors="coerce").dropna()
                    if col == "绀句細铻嶈祫瑙勬ā瀛橀噺鍚屾瘮" and not vals.empty:
                        return round(float(vals.iloc[-1]), 2)
            # Fallback: compute YoY from incremental data
            col = "绀句細铻嶈祫瑙勬ā澧為噺" if "绀句細铻嶈祫瑙勬ā澧為噺" in df.columns else df.columns[-1]
            vals = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(vals) >= 24:
                current_12m = float(vals.iloc[-12:].sum())
                prior_12m = float(vals.iloc[-24:-12].sum())
                if prior_12m > 0:
                    yoy = (current_12m / prior_12m - 1) * 100
                    return round(yoy, 2)
    except Exception:
        return None


# 鈹€鈹€鈹€ 8. M2 澧為€?(Tushare cn_m 鈫?compute YoY) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_m2(pro) -> Optional[float]:
    """M2鍚屾瘮澧為€?(%). Tushare cn_m 鈫?compute YoY from absolute values."""
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
            return _latest(df, "璐у竵鍜屽噯璐у竵(M2)-鍚屾瘮澧為暱")
    except Exception:
        return None


# 鈹€鈹€鈹€ 9. 铻嶈祫浣欓鍙樺寲 (Tushare margin) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_margin_balance(pro) -> Optional[float]:
    """铻嶈祫浣欓 20鏃ュ彉鍖?(浜垮厓). Tushare margin 鈫?rzye, sum across exchanges."""
    if pro:
        try:
            end = datetime.now().strftime("%Y%m%d")
            start = (datetime.now() - timedelta(days=35)).strftime("%Y%m%d")
            df = pro.margin(start_date=start, end_date=end)
            if df is not None and not df.empty and "rzye" in df.columns:
                # Sum across exchanges per date
                daily = df.groupby("trade_date")["rzye"].sum() / 1e8  # yuan 鈫?浜垮厓
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
        if df is not None and not df.empty and "铻嶈祫浣欓" in df.columns:
            vals = pd.to_numeric(df["铻嶈祫浣欓"], errors="coerce").dropna()
            if len(vals) >= 20:
                return round(float(vals.iloc[-1] - vals.iloc[-20]), 2)
            if len(vals) >= 2:
                return round(float(vals.iloc[-1] - vals.iloc[0]), 2)
    except Exception:
        return None


# 鈹€鈹€鈹€ 10. 鍖楀悜璧勯噾 (akshare 鈥?Tushare moneyflow_hsgt unit unclear) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_northbound() -> Optional[float]:
    """鍖楀悜璧勯噾 20鏃ョ疮璁″噣娴佸叆 (浜垮厓). akshare stock_hsgt_hist_em."""
    import akshare as ak
    try:
        df = ak.stock_hsgt_hist_em(symbol="鍖楀悜璧勯噾")
        if df is not None and not df.empty:
            for col in ["褰撴棩鎴愪氦鍑€涔伴", "鍑€娴佸叆"]:
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
    logger.exception("Ignored non-fatal exception")
    return None


# 鈹€鈹€鈹€ 11. 璐㈡斂璧ゅ瓧鐜?(static placeholder; real source needs iFinD/EDB) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_fiscal_deficit() -> Optional[float]:
    """璐㈡斂璧ゅ瓧鐜?(%). Placeholder until iFinD EDB / official data source wired.

    The hardcoded 3.0 below is the 2026 government work report target. Treat
    as low confidence in fetch_all() 鈥?confidence is overridden to 0.3 there.
    """
    return 3.0


# 鈹€鈹€鈹€ 12. 缇庤仈鍌ㄥ埄鐜?(akshare 鈥?Tushare us_trl not available at 6000pts) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_fed_rate() -> Optional[float]:
    """缇庤仈鍌ㄥ熀鍑嗗埄鐜? akshare macro_bank_usa_interest_rate."""
    import akshare as ak
    try:
        df = ak.macro_bank_usa_interest_rate()
        if df is not None and not df.empty:
            # 浠婂€?may be NaN for future dates; try 鍓嶅€?first as it's the actual latest rate
            val = _latest(df, "鍓嶅€?)
            if val is not None:
                return val
            return _latest(df, "浠婂€?)
    except Exception:
        return None


# 鈹€鈹€鈹€ 13. 缇庡厓鎸囨暟 (free forex API 鈥?Tushare DXY no data at 6000pts) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

def _fetch_usd_index() -> Optional[float]:
    """缇庡厓鎸囨暟 DXY. Free forex API with correct DXY formula."""
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
                    * (eur ** 0.576)     # EURUSD^-0.576 鈫?(1/eur)^-0.576 = eur^0.576
                    * (jpy ** 0.136)     # USDJPY
                    * (gbp ** 0.119)     # GBPUSD^-0.119 鈫?(1/gbp)^-0.119 = gbp^0.119
                    * (cad ** 0.091)     # USDCAD
                    * (sek ** 0.042)     # USDSEK
                    * (chf ** 0.036)     # USDCHF
                )
                return round(dxy, 2)
    except Exception:
    logger.exception("Ignored non-fatal exception")
    return None


# 鈹€鈹€鈹€ Date helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

