"""AkShare 数据获取层"""
import akshare as ak
import pandas as pd
import efinance as ef
from typing import Optional, List, Dict, Any
from ..utils import console_error


def get_fund_ranking(fund_type: str = "全部") -> List[Dict[str, Any]]:
    """获取开放式基金排名数据"""
    try:
        df = ak.fund_open_fund_rank_em(symbol=fund_type)
        if df is None or df.empty:
            return []
        df = df.rename(columns={
            "基金代码": "code", "基金简称": "name",
            "日期": "nav_date", "单位净值": "nav",
            "日增长率": "day_growth",
            "近1周": "near_1w", "近1月": "near_1m",
            "近3月": "near_3m", "近6月": "near_6m",
            "近1年": "near_1y", "近3年": "near_3y",
            "今年来": "ytd", "成立来": "since_inception",
        })
        result = df.to_dict(orient="records")
        return result
    except Exception as e:
        console_error(f"AkShare fund ranking error: {e}")
        return []


def get_fund_info(code: str) -> Optional[Dict[str, Any]]:
    """获取基金基本信息"""
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
    """获取基金经理信息 - 包含任职回报、年化回报、学历等"""
    try:
        df = ak.fund_manager_em()
        if df is None or df.empty:
            return None
        # 处理列名可能不同的情况
        code_col = "基金代码" if "基金代码" in df.columns else df.columns[0] if len(df.columns) > 0 else None
        if code_col is None:
            return None
        managers = df[df[code_col] == code]
        if managers.empty:
            return None
        row = managers.iloc[0]
        # 提取所有可用字段
        name = row.get("姓名", row.get("基金经理", row.get("manager_name", "")))
        tenure_days = row.get("任职时间", row.get("任职天数", row.get("tenure", 0)))

        # 任职回报（可能带%符号）
        return_since = row.get("任职回报", row.get("return_since_tenure"))
        if return_since is not None:
            try:
                return_since = float(str(return_since).replace("%", "").strip())
            except (ValueError, TypeError):
                return_since = None

        # 年化回报
        annual_return = row.get("年化回报", row.get("annualized_return"))
        if annual_return is not None:
            try:
                annual_return = float(str(annual_return).replace("%", "").strip())
            except (ValueError, TypeError):
                annual_return = None

        # 管理基金数量
        fund_count = row.get("管理基金数", row.get("在任基金数", row.get("fund_count")))
        if fund_count is not None:
            try:
                fund_count = int(fund_count)
            except (ValueError, TypeError):
                fund_count = 1

        # 学历
        education = row.get("学历", row.get("education"))

        # 基金管理规模
        total_scale = row.get("基金管理规模(亿)", row.get("管理规模", row.get("total_scale")))

        result = {
            "name": name,
            "tenure_days": tenure_days,
            "return_since_tenure": return_since,
            "annualized_return": annual_return,
            "fund_count": fund_count,
            "education": education,
            "total_scale": total_scale,
        }

        # 过滤掉值为 None/NaN 的字段
        result = {k: v for k, v in result.items()
                  if v is not None and not (isinstance(v, float) and pd.isna(v))}

        return result
    except Exception as e:
        console_error(f"AkShare fund manager error for {code}: {e}")
        return None


def get_fund_portfolio(code: str) -> Optional[Dict[str, Any]]:
    """获取基金持仓信息 - 自动适配最新报告期"""
    from datetime import datetime
    current_year = datetime.now().year
    holdings = []

    # 尝试当前年份和上一年
    for year in [current_year, current_year - 1, current_year - 2]:
        try:
            stock_df = ak.fund_portfolio_hold_em(symbol=code, date=str(year))
            if stock_df is not None and not stock_df.empty:
                for _, row in stock_df.head(10).iterrows():
                    ratio_val = row.get("占净值比例", 0)
                    # 处理百分比字符串，如 "12.34%"
                    if isinstance(ratio_val, str):
                        ratio_val = ratio_val.replace("%", "").strip()
                    try:
                        ratio = float(ratio_val)
                    except (ValueError, TypeError):
                        ratio = 0
                    holdings.append({
                        "name": row.get("股票名称", ""),
                        "code": row.get("股票代码", ""),
                        "ratio": ratio,
                        "quarter": str(row.get("报告期") or row.get("持仓日期") or year),
                        "source": "AkShare 东方财富F10",
                        "updated_at": str(row.get("报告期") or row.get("持仓日期") or year),
                    })
                break  # 成功获取后退出
        except Exception:
            continue

    return {"stock_holdings": holdings}


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
    if "港股" in market:
        return f"hk{symbol.zfill(5)}"
    if "沪" in market:
        return f"sh{symbol.zfill(6)}"
    if "深" in market:
        return f"sz{symbol.zfill(6)}"
    if "北" in market:
        return f"bj{symbol.zfill(6)}"
    return _normalize_stock_code(symbol)


def get_stock_daily_changes(codes: List[str]) -> Dict[str, float]:
    """批量获取股票最近一交易日涨跌幅，返回原始代码到涨跌幅百分比的映射。"""
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
                    normalized = _normalize_quote_row(row.get("代码", ""), row.get("市场类型", ""))
                    if not normalized:
                        continue
                    try:
                        by_normalized[normalized] = round(float(row.get("涨跌幅")), 2)
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
                        normalized = _normalize_stock_code(row.get("代码", ""))
                        if not normalized:
                            continue
                        try:
                            by_normalized[normalized] = round(float(row.get("涨跌幅")), 2)
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
    """获取行业板块数据"""
    try:
        df = ak.stock_board_industry_name_em()
        if df is None or df.empty:
            return []
        return df.to_dict(orient="records")[:20]
    except Exception as e:
        console_error(f"AkShare industry board error: {e}")
        return []


def get_market_index() -> List[Dict[str, Any]]:
    """获取主要市场指数（优先 Tushare index_daily，回退 AkShare 最新2日数据）"""
    try:
        from .providers.tushare_provider import TushareProvider
        tp = TushareProvider()
        if tp.is_available():
            index_map = {
                "000001.SH": "上证指数",
                "399001.SZ": "深证成指",
                "399006.SZ": "创业板指",
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
        pass

    # 回退：akshare 指数日线
    try:
        indices = {"sh000001": "上证指数", "sz399001": "深证成指", "sz399006": "创业板指"}
        result = []
        for code, name in indices.items():
            try:
                # 限制获取最近30个交易日数据，减少网络开销
                df = ak.stock_zh_index_daily(symbol=code)
                if df is not None and not df.empty:
                    # 取最新两行计算涨跌幅
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
