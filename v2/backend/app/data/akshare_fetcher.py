"""AkShare 数据获取层"""
import akshare as ak
import pandas as pd
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
    """获取基金经理信息"""
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
        # 尝试多种可能的列名
        name = row.get("姓名", row.get("基金经理", row.get("manager_name", "")))
        tenure = row.get("任职时间", row.get("任职天数", row.get("tenure", 0)))
        best = row.get("代表基金", row.get("best_fund", ""))
        return {"name": name, "tenure_days": tenure, "best_fund": best}
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
                    })
                break  # 成功获取后退出
        except Exception:
            continue

    return {"stock_holdings": holdings}


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
    """获取主要市场指数"""
    try:
        indices = {"sh000001": "上证指数", "sz399001": "深证成指", "sz399006": "创业板指"}
        result = []
        for code, name in indices.items():
            df = ak.stock_zh_index_daily(symbol=code)
            if df is not None and not df.empty:
                latest = df.iloc[-1]
                prev = df.iloc[-2] if len(df) > 1 else latest
                change = (latest["close"] - prev["close"]) / prev["close"] * 100
                result.append({
                    "code": code, "name": name,
                    "close": float(latest["close"]),
                    "change": round(float(change), 2),
                })
        return result
    except Exception as e:
        console_error(f"AkShare market index error: {e}")
        return []
