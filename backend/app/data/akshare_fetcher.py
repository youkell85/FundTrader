"""AkShare 鏁版嵁鑾峰彇灞?""
import akshare as ak
import pandas as pd
import efinance as ef
from typing import Optional, List, Dict, Any
from ..utils import console_error


def get_fund_ranking(fund_type: str = "鍏ㄩ儴") -> List[Dict[str, Any]]:
    """鑾峰彇寮€鏀惧紡鍩洪噾鎺掑悕鏁版嵁"""

import logging

    try:
        df = ak.fund_open_fund_rank_em(symbol=fund_type)
        if df is None or df.empty:
            return []
        df = df.rename(columns={
            "鍩洪噾浠ｇ爜": "code", "鍩洪噾绠€绉?: "name",
            "鏃ユ湡": "nav_date", "鍗曚綅鍑€鍊?: "nav",
            "鏃ュ闀跨巼": "day_growth",
            "杩?鍛?: "near_1w", "杩?鏈?: "near_1m",
            "杩?鏈?: "near_3m", "杩?鏈?: "near_6m",
            "杩?骞?: "near_1y", "杩?骞?: "near_3y",
            "浠婂勾鏉?: "ytd", "鎴愮珛鏉?: "since_inception",
        })
        result = df.to_dict(orient="records")
        return result
    except Exception as e:
        console_error(f"AkShare fund ranking error: {e}")
        return []


def get_fund_info(code: str) -> Optional[Dict[str, Any]]:
    """鑾峰彇鍩洪噾鍩烘湰淇℃伅"""
    try:
        df = ak.fund_individual_basic_info_xq(symbol=code)
        if df is None or df.empty:
            return None
        info = {}
        for _, row in df.iterrows():
            info[row["item"]] = row["value"]
        return info
    except Exception as e:
        console_error(f"AkShare fund info error for {code}: {e}")
        return None


def get_fund_manager_info(code: str) -> Optional[Dict[str, Any]]:
    """鑾峰彇鍩洪噾缁忕悊淇℃伅 - 鍖呭惈浠昏亴鍥炴姤銆佸勾鍖栧洖鎶ャ€佸鍘嗙瓑"""
    try:
        df = ak.fund_manager_em()
        if df is None or df.empty:
            return None
        # 澶勭悊鍒楀悕鍙兘涓嶅悓鐨勬儏鍐?
        code_col = "鍩洪噾浠ｇ爜" if "鍩洪噾浠ｇ爜" in df.columns else df.columns[0] if len(df.columns) > 0 else None
        if code_col is None:
            return None
        managers = df[df[code_col] == code]
        if managers.empty:
            return None
        row = managers.iloc[0]
        # 鎻愬彇鎵€鏈夊彲鐢ㄥ瓧娈?
        name = row.get("濮撳悕", row.get("鍩洪噾缁忕悊", row.get("manager_name", "")))
        tenure_days = row.get("浠昏亴鏃堕棿", row.get("浠昏亴澶╂暟", row.get("tenure", 0)))

        # 浠昏亴鍥炴姤锛堝彲鑳藉甫%绗﹀彿锛?
        return_since = row.get("浠昏亴鍥炴姤", row.get("return_since_tenure"))
        if return_since is not None:
            try:
                return_since = float(str(return_since).replace("%", "").strip())
            except (ValueError, TypeError):
                return_since = None

        # 骞村寲鍥炴姤
        annual_return = row.get("骞村寲鍥炴姤", row.get("annualized_return"))
        if annual_return is not None:
            try:
                annual_return = float(str(annual_return).replace("%", "").strip())
            except (ValueError, TypeError):
                annual_return = None

        # 绠＄悊鍩洪噾鏁伴噺
        fund_count = row.get("绠＄悊鍩洪噾鏁?, row.get("鍦ㄤ换鍩洪噾鏁?, row.get("fund_count")))
        if fund_count is not None:
            try:
                fund_count = int(fund_count)
            except (ValueError, TypeError):
                fund_count = 1

        # 瀛﹀巻
        education = row.get("瀛﹀巻", row.get("education"))

        # 鍩洪噾绠＄悊瑙勬ā
        total_scale = row.get("鍩洪噾绠＄悊瑙勬ā(浜?", row.get("绠＄悊瑙勬ā", row.get("total_scale")))

        result = {
            "name": name,
            "tenure_days": tenure_days,
            "return_since_tenure": return_since,
            "annualized_return": annual_return,
            "fund_count": fund_count,
            "education": education,
            "total_scale": total_scale,
        }

        # 杩囨护鎺夊€间负 None/NaN 鐨勫瓧娈?
        result = {k: v for k, v in result.items()
                  if v is not None and not (isinstance(v, float) and pd.isna(v))}

        return result
    except Exception as e:
        console_error(f"AkShare fund manager error for {code}: {e}")
        return None


def get_fund_portfolio(code: str) -> Optional[Dict[str, Any]]:
    """鑾峰彇鍩洪噾鎸佷粨淇℃伅 - 鑷姩閫傞厤鏈€鏂版姤鍛婃湡"""
    from datetime import datetime
    current_year = datetime.now().year
    holdings = []

    # 灏濊瘯褰撳墠骞翠唤鍜屼笂涓€骞?
    for year in [current_year, current_year - 1, current_year - 2]:
        try:
            stock_df = ak.fund_portfolio_hold_em(symbol=code, date=str(year))
            if stock_df is not None and not stock_df.empty:
                for _, row in stock_df.head(10).iterrows():
                    ratio_val = row.get("鍗犲噣鍊兼瘮渚?, 0)
                    # 澶勭悊鐧惧垎姣斿瓧绗︿覆锛屽 "12.34%"
                    if isinstance(ratio_val, str):
                        ratio_val = ratio_val.replace("%", "").strip()
                    try:
                        ratio = float(ratio_val)
                    except (ValueError, TypeError):
                        ratio = 0
                    holdings.append({
                        "name": row.get("鑲＄エ鍚嶇О", ""),
                        "code": row.get("鑲＄エ浠ｇ爜", ""),
                        "ratio": ratio,
                        "quarter": str(row.get("鎶ュ憡鏈?) or row.get("鎸佷粨鏃ユ湡") or year),
                        "source": "AkShare 涓滄柟璐㈠瘜F10",
                        "updated_at": str(row.get("鎶ュ憡鏈?) or row.get("鎸佷粨鏃ユ湡") or year),
                    })
                break  # 鎴愬姛鑾峰彇鍚庨€€鍑?
        except Exception:
            continue

    return {"stock_holdings": holdings}




def get_fund_bond_portfolio(code: str) -> Optional[Dict[str, Any]]:
    """鑾峰彇鍩洪噾鍊哄埜鎸佷粨淇℃伅 - 鐢ㄤ簬鍊哄埜鍨嬪熀閲?""
    from datetime import datetime
    current_year = datetime.now().year
    bond_holdings = []

    for year in [current_year, current_year - 1, current_year - 2]:
        try:
            bond_df = ak.fund_portfolio_bond_hold_em(symbol=code, date=str(year))
            if bond_df is not None and not bond_df.empty:
                for _, row in bond_df.head(10).iterrows():
                    ratio_val = row.get("鍗犲噣鍊兼瘮渚?, 0)
                    if isinstance(ratio_val, str):
                        ratio_val = ratio_val.replace("%", "").strip()
                    try:
                        ratio = float(ratio_val)
                    except (ValueError, TypeError):
                        ratio = 0
                    bond_holdings.append({
                        "name": row.get("鍊哄埜鍚嶇О", ""),
                        "code": row.get("鍊哄埜浠ｇ爜", ""),
                        "ratio": ratio,
                        "quarter": str(row.get("鎶ュ憡鏈?) or year),
                        "source": "AkShare 涓滄柟璐㈠瘜F10 鍊哄埜鎸佷粨",
                        "updated_at": str(row.get("鎶ュ憡鏈?) or year),
                    })
                break
        except Exception:
            continue

    return {"bond_holdings": bond_holdings}

def _normalize_stock_code(code: str) -> str:
    raw = str(code or "").strip().lower()
    if not raw:
        return ""
    if "." in raw:
        symbol, market = raw.split(".", 1)
        if market.startswith("sh"):
            return f"sh{symbol}"
        if market.startswith("sz"):
            return f"sz{symbol}"
        if market.startswith("bj"):
            return f"bj{symbol}"
        if market.startswith("hk"):
            return f"hk{symbol.zfill(5)}"
    if raw.startswith(("sh", "sz", "bj")):
        return raw
    if raw.startswith("hk"):
        return f"hk{raw[2:].zfill(5)}"
    if raw.startswith(("6", "5", "9")):
        return f"sh{raw}"
    if raw.startswith(("0", "2", "3")):
        return f"sz{raw}"
    if raw.startswith(("4", "8")):
        return f"bj{raw}"
    return raw


def _to_quote_code(code: str) -> str:
    raw = str(code or "").strip()
    if not raw:
        return ""
    if "." in raw:
        symbol, market = raw.split(".", 1)
        if market.lower().startswith("hk"):
            return symbol.zfill(5)
        return symbol
    if raw.lower().startswith("hk"):
        return raw[2:].zfill(5)
    return raw


def _normalize_quote_row(code: str, market_type: str = "") -> str:
    symbol = str(code or "").strip()
    market = str(market_type or "")
    if "娓偂" in market:
        return f"hk{symbol.zfill(5)}"
    if "娌? in market:
        return f"sh{symbol.zfill(6)}"
    if "娣? in market:
        return f"sz{symbol.zfill(6)}"
    if "鍖? in market:
        return f"bj{symbol.zfill(6)}"
    return _normalize_stock_code(symbol)


def get_stock_daily_changes(codes: List[str]) -> Dict[str, float]:
    """鎵归噺鑾峰彇鑲＄エ鏈€杩戜竴浜ゆ槗鏃ユ定璺屽箙锛岃繑鍥炲師濮嬩唬鐮佸埌娑ㄨ穼骞呯櫨鍒嗘瘮鐨勬槧灏勩€?""
    requested = [str(code or "").strip() for code in codes if str(code or "").strip()]
    if not requested:
        return {}

    try:
        from .cache_manager import cache
        cached = cache.get("stock_daily_changes_v2", 600)
        if isinstance(cached, dict) and cached:
            by_normalized = cached
        else:
            by_normalized = {}

        missing_requested = [
            code for code in requested
            if _normalize_stock_code(code) not in by_normalized
        ]
        if missing_requested:
            quote_codes = sorted({_to_quote_code(code) for code in missing_requested if _to_quote_code(code)})
            try:
                df = ef.stock.get_latest_quote(quote_codes)
            except Exception:
                df = None
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    normalized = _normalize_quote_row(row.get("浠ｇ爜", ""), row.get("甯傚満绫诲瀷", ""))
                    if not normalized:
                        continue
                    try:
                        by_normalized[normalized] = round(float(row.get("娑ㄨ穼骞?)), 2)
                    except (ValueError, TypeError):
                        continue

            still_missing = [
                code for code in requested
                if _normalize_stock_code(code) not in by_normalized
            ]
            if still_missing:
                df = ak.stock_zh_a_spot()
                if df is not None and not df.empty:
                    for _, row in df.iterrows():
                        normalized = _normalize_stock_code(row.get("浠ｇ爜", ""))
                        if not normalized:
                            continue
                        try:
                            by_normalized[normalized] = round(float(row.get("娑ㄨ穼骞?)), 2)
                        except (ValueError, TypeError):
                            continue
        if by_normalized:
            cache.set("stock_daily_changes_v2", by_normalized)

        result = {}
        for code in requested:
            normalized = _normalize_stock_code(code)
            if normalized in by_normalized:
                result[code] = by_normalized[normalized]
        return result
    except Exception as e:
        console_error(f"stock daily changes error: {e}")
        return {}


def get_fund_industry_board() -> List[Dict[str, Any]]:
    """鑾峰彇琛屼笟鏉垮潡鏁版嵁"""
    try:
        df = ak.stock_board_industry_name_em()
        if df is None or df.empty:
            return []
        return df.to_dict(orient="records")[:20]
    except Exception as e:
        console_error(f"AkShare industry board error: {e}")
        return []


def get_market_index() -> List[Dict[str, Any]]:
    """鑾峰彇涓昏甯傚満鎸囨暟锛堜紭鍏?Tushare index_daily锛屽洖閫€ AkShare 鏈€鏂?鏃ユ暟鎹級"""
    try:
        from .providers.tushare_provider import TushareProvider
        tp = TushareProvider()
        if tp.is_available():
            index_map = {
                "000001.SH": "涓婅瘉鎸囨暟",
                "399001.SZ": "娣辫瘉鎴愭寚",
                "399006.SZ": "鍒涗笟鏉挎寚",
            }
            result = []
            for ts_code, name in index_map.items():
                daily = tp.get_index_daily(ts_code=ts_code)
                if daily and len(daily) >= 2:
                    latest = daily[-1]
                    prev = daily[-2]
                    if latest.close and prev.close and prev.close > 0:
                        change = (latest.close - prev.close) / prev.close * 100
                        result.append({
                            "code": ts_code, "name": name,
                            "close": float(latest.close),
                            "change": round(float(change), 2),
                        })
            if result:
                return result
    except Exception:
    logging.exception("Ignored non-fatal exception")

    # 鍥為€€锛歛kshare 鎸囨暟鏃ョ嚎
    try:
        indices = {"sh000001": "涓婅瘉鎸囨暟", "sz399001": "娣辫瘉鎴愭寚", "sz399006": "鍒涗笟鏉挎寚"}
        result = []
        for code, name in indices.items():
            try:
                # 闄愬埗鑾峰彇鏈€杩?0涓氦鏄撴棩鏁版嵁锛屽噺灏戠綉缁滃紑閿€
                df = ak.stock_zh_index_daily(symbol=code)
                if df is not None and not df.empty:
                    # 鍙栨渶鏂颁袱琛岃绠楁定璺屽箙
                    df_tail = df.tail(2)
                    if len(df_tail) >= 2:
                        latest = df_tail.iloc[-1]
                        prev = df_tail.iloc[-2]
                        prev_close = float(prev["close"])
                        curr_close = float(latest["close"])
                        change = (curr_close - prev_close) / prev_close * 100 if prev_close > 0 else 0
                    elif len(df_tail) == 1:
                        latest = df_tail.iloc[-1]
                        change = 0
                    else:
                        continue
                    result.append({
                        "code": code, "name": name,
                        "close": float(latest["close"]),
                        "change": round(float(change), 2),
                    })
            except Exception as e:
                console_error(f"AkShare market index error for {code}: {e}")
        return result
    except Exception as e:
        console_error(f"Market index error: {e}")
        return []

