"""AkShare 数据获取层"""
import akshare as ak
import pandas as pd
from typing import Optional, List, Dict, Any


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
        managers = df[df["基金代码"] == code]
        if managers.empty:
            return None
        row = managers.iloc[0]
        return {
            "name": row.get("姓名", ""),
            "tenure_days": row.get("任职时间", 0),
            "best_fund": row.get("代表基金", ""),
        }
    except Exception as e:
        console_error(f"AkShare fund manager error for {code}: {e}")
        return None


def get_fund_portfolio(code: str) -> Optional[Dict[str, Any]]:
    """获取基金持仓信息"""
    try:
        # 股票持仓
        stock_df = ak.fund_portfolio_hold_em(symbol=code, date="2024")
        holdings = []
        if stock_df is not None and not stock_df.empty:
            for _, row in stock_df.head(10).iterrows():
                holdings.append({
                    "name": row.get("股票名称", ""),
                    "code": row.get("股票代码", ""),
                    "ratio": row.get("占净值比例", 0),
                })
        return {"stock_holdings": holdings}
    except Exception as e:
        console_error(f"AkShare fund portfolio error for {code}: {e}")
        return None


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
