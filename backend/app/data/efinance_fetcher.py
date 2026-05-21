"""efinance 数据获取层 - 基金净值与定投回测"""
import html
import re
import urllib.request
import efinance as ef
import pandas as pd
from typing import Optional, List, Dict, Any
from ..utils import console_error


def get_fund_scale(code: str) -> Optional[float]:
    """获取基金规模（亿元）"""
    try:
        df = ef.fund.get_types_percentage(code)
        if df is not None and not df.empty:
            scale_col = "总规模(亿元)" if "总规模(亿元)" in df.columns else df.columns[4] if len(df.columns) > 4 else None
            if scale_col:
                scale = df.iloc[0].get(scale_col)
                if scale is not None:
                    return float(scale)
    except Exception as e:
        console_error(f"efinance scale error for {code}: {e}")
    return None


def get_fund_manager_basic(code: str) -> Optional[Dict[str, Any]]:
    """从 efinance 获取基金经理基本信息（姓名、任职天数等，作为 fusal/akshare 失败时的备用）"""
    try:
        if hasattr(ef.fund, "get_base_info"):
            series = ef.fund.get_base_info(code)
            if series is not None and not (hasattr(series, 'empty') and series.empty):
                # Series or dict
                info = series.to_dict() if hasattr(series, 'to_dict') else dict(series) if isinstance(series, dict) else {}
                name = info.get("基金经理", info.get("manager", ""))
                if name:
                    return {"name": name}
        # 备用方式：通过 get_fund_base_info
        if hasattr(ef.fund, "get_fund_base_info"):
            df = ef.fund.get_fund_base_info(code)
            if df is not None and not df.empty:
                name = df.iloc[0].get("基金经理", df.iloc[0].get("manager", ""))
                if name:
                    return {"name": name}
    except Exception as e:
        console_error(f"efinance manager basic error for {code}: {e}")
    return None


def get_fund_fees(code: str) -> Optional[Dict[str, Any]]:
    """从 efinance 获取基金管理费率和托管费率"""
    result = {}
    try:
        if hasattr(ef.fund, "get_base_info"):
            series = ef.fund.get_base_info(code)
            if series is not None and not (hasattr(series, 'empty') and series.empty):
                info = series.to_dict() if hasattr(series, 'to_dict') else dict(series) if isinstance(series, dict) else {}
                # 管理费率和托管费率，东方财富字段名
                mgmt_fee = info.get("管理费率", info.get("management_fee"))
                custody_fee = info.get("托管费率", info.get("custody_fee"))
                if mgmt_fee is not None:
                    result["feeManage"] = _parse_fee(mgmt_fee)
                if custody_fee is not None:
                    result["feeCustody"] = _parse_fee(custody_fee)
                if result.get("feeManage") is not None and result.get("feeCustody") is not None:
                    return result
        # 备用：get_fund_base_info
        if hasattr(ef.fund, "get_fund_base_info"):
            df = ef.fund.get_fund_base_info(code)
            if df is not None and not df.empty:
                mgmt_fee = df.iloc[0].get("管理费率", df.iloc[0].get("management_fee"))
                custody_fee = df.iloc[0].get("托管费率", df.iloc[0].get("custody_fee"))
                if mgmt_fee is not None:
                    result["feeManage"] = _parse_fee(mgmt_fee)
                if custody_fee is not None:
                    result["feeCustody"] = _parse_fee(custody_fee)
                if result.get("feeManage") is not None and result.get("feeCustody") is not None:
                    return result
    except Exception as e:
        console_error(f"efinance fees error for {code}: {e}")

    try:
        eastmoney_fees = _get_fund_fees_from_eastmoney(code)
        if eastmoney_fees:
            result.update({k: v for k, v in eastmoney_fees.items() if v is not None})
    except Exception as e:
        console_error(f"eastmoney fees error for {code}: {e}")

    return result or None


def _get_fund_fees_from_eastmoney(code: str) -> Optional[Dict[str, Any]]:
    """从东方财富 F10 基本概况页兜底解析费率。"""
    url = f"https://fundf10.eastmoney.com/jbgk_{code}.html"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()

    text = ""
    for encoding in ("utf-8", "gb18030"):
        try:
            text = raw.decode(encoding)
            if "管理费率" in text:
                break
        except UnicodeDecodeError:
            continue
    if not text:
        return None

    result = {}
    mgmt_fee = _extract_fee_cell(text, "管理费率")
    custody_fee = _extract_fee_cell(text, "托管费率")
    if mgmt_fee is not None:
        result["feeManage"] = mgmt_fee
    if custody_fee is not None:
        result["feeCustody"] = custody_fee
    return result or None


def _extract_fee_cell(text: str, label: str) -> Optional[float]:
    match = re.search(rf"<th[^>]*>\s*{re.escape(label)}\s*</th>\s*<td[^>]*>(.*?)</td>", text, re.S)
    if not match:
        return None
    value = html.unescape(re.sub(r"<[^>]+>", "", match.group(1))).strip()
    return _parse_fee(value)


def _parse_fee(value) -> Optional[float]:
    """解析费率值，可能带%符号，如 '1.50%' -> 0.015"""
    if value is None:
        return None
    try:
        s = str(value).strip()
        is_pct = "%" in s
        match = re.search(r"-?\d+(?:\.\d+)?", s.replace(",", ""))
        if not match:
            return None
        val = float(match.group(0))
        if is_pct:
            val = val / 100
        return val
    except (ValueError, TypeError):
        return None


def get_fund_nav_history(code: str, start_date: str = "", end_date: str = "") -> List[Dict[str, Any]]:
    """获取基金历史净值数据（efinance 新版使用 get_quote_history）"""
    try:
        # 新版 efinance API：get_quote_history(基金代码)
        # 所有基金都可用该接口获取“成立以来”全量净值历史
        df = None
        if hasattr(ef.fund, "get_quote_history"):
            df = ef.fund.get_quote_history(code)
        elif hasattr(ef.fund, "get_fund_net_value"):
            df = ef.fund.get_fund_net_value(code)
        if df is None or df.empty:
            return []
        # 兼容不同版本列名
        rename_map = {
            "基金代码": "code", "净值日期": "date", "日期": "date",
            "单位净值": "nav", "累计净值": "acc_nav",
            "日增长率": "day_growth", "增长率": "day_growth",
        }
        df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})
        if "date" not in df.columns or "nav" not in df.columns:
            return []
        if start_date:
            df = df[df["date"] >= start_date]
        if end_date:
            df = df[df["date"] <= end_date]
        return df.to_dict(orient="records")
    except Exception as e:
        console_error(f"efinance nav history error for {code}: {e}")
        return []


def get_fund_names(codes: List[str]) -> Dict[str, str]:
    """批量获取基金名称"""
    result = {}
    try:
        for code in codes:
            try:
                df = ef.fund.get_fund_base_info(code)
                if df is not None and not df.empty:
                    result[code] = df.iloc[0].get("基金简称", code)
                else:
                    result[code] = code
            except Exception:
                result[code] = code
    except Exception as e:
        console_error(f"efinance fund names error: {e}")
    return result


def calculate_dca_backtest(
    code: str,
    amount: float = 1000,
    frequency: str = "monthly",
    strategy: str = "compare",
    start_date: str = "",
    end_date: str = "",
    ma_window: int = 200,
) -> Dict[str, Any]:
    """
    计算定投回测
    strategy: fixed(固定金额), ma(均线偏离), compare(对比所有策略)
    """
    try:
        nav_data = get_fund_nav_history(code, start_date, end_date)
        if not nav_data:
            return {"error": f"无法获取基金 {code} 的净值数据"}

        # 按日期排序
        nav_data.sort(key=lambda x: x["date"])

        results = {}
        if strategy in ("fixed", "compare"):
            results["fixed"] = _calc_fixed_dca(nav_data, amount, frequency)
        if strategy in ("ma", "compare"):
            results["ma"] = _calc_ma_dca(nav_data, amount, frequency, ma_window)
        if strategy == "compare":
            return {"fund_code": code, "strategies": results}

        return results.get(strategy, {})

    except Exception as e:
        return {"error": str(e)}


def _calc_fixed_dca(
    nav_data: List[Dict], amount: float, frequency: str
) -> Dict[str, Any]:
    """固定金额定投回测"""
    total_invested = 0.0
    total_shares = 0.0
    trade_count = 0
    curve = []
    invest_dates = set()

    # 确定定投日期
    for i, point in enumerate(nav_data):
        date = point["date"]
        if frequency == "weekly":
            if i % 5 == 0:
                invest_dates.add(date)
        else:  # monthly
            day = date.split("-")[2] if "-" in date else date[6:8]
            if day in ("01", "02", "03", "04", "05"):
                if date[:7] not in [d[:7] for d in invest_dates]:
                    invest_dates.add(date)

    for point in nav_data:
        nav = point.get("nav", 0)
        if nav <= 0:
            continue
        date = point["date"]

        if date in invest_dates:
            shares = amount / nav
            total_shares += shares
            total_invested += amount
            trade_count += 1

        current_value = total_shares * nav
        curve.append({
            "date": date,
            "invested": round(total_invested, 2),
            "value": round(current_value, 2),
            "profit_rate": round((current_value - total_invested) / total_invested * 100, 2) if total_invested > 0 else 0,
        })

    # 计算统计
    final_value = total_shares * nav_data[-1]["nav"] if nav_data and total_shares > 0 else 0
    total_profit = final_value - total_invested
    profit_rate = (total_profit / total_invested * 100) if total_invested > 0 else 0

    # 计算最大回撤
    max_drawdown = _calc_max_drawdown(curve)

    # 年化收益
    if len(nav_data) >= 2:
        years = _calc_years(nav_data[0]["date"], nav_data[-1]["date"])
        annual_return = ((final_value / total_invested) ** (1 / years) - 1) * 100 if years > 0 and total_invested > 0 else 0
    else:
        years = 0
        annual_return = 0

    return {
        "strategy": "固定金额定投",
        "start_date": nav_data[0]["date"] if nav_data else None,
        "end_date": nav_data[-1]["date"] if nav_data else None,
        "years": round(years, 2),
        "total_invested": round(total_invested, 2),
        "total_value": round(final_value, 2),
        "total_profit": round(total_profit, 2),
        "total_profit_rate": round(profit_rate, 2),
        "annual_return": round(annual_return, 2),
        "max_drawdown": round(max_drawdown, 2),
        "trade_count": trade_count,
        "nav_curve": curve,  # 全量数据，供图表展示完整回测历史
    }


def _calc_ma_dca(
    nav_data: List[Dict], amount: float, frequency: str, ma_window: int = 200
) -> Dict[str, Any]:
    """均线偏离定投回测 - 低于均线多投，高于均线少投"""
    if len(nav_data) < ma_window:
        return _calc_fixed_dca(nav_data, amount, frequency)

    # 计算均线
    navs = [p.get("nav", 0) for p in nav_data]
    ma_values = []
    for i in range(len(navs)):
        if i < ma_window:
            ma_values.append(sum(navs[:i+1]) / (i+1))
        else:
            ma_values.append(sum(navs[i-ma_window:i]) / ma_window)

    total_invested = 0.0
    total_shares = 0.0
    trade_count = 0
    skip_count = 0
    curve = []
    invest_dates = set()

    for i, point in enumerate(nav_data):
        date = point["date"]
        if frequency == "monthly":
            day = date.split("-")[2] if "-" in date else date[6:8]
            if day in ("01", "02", "03", "04", "05"):
                if date[:7] not in [d[:7] for d in invest_dates]:
                    invest_dates.add(date)
        else:
            if i % 5 == 0:
                invest_dates.add(date)

    for i, point in enumerate(nav_data):
        nav = point.get("nav", 0)
        if nav <= 0:
            continue
        date = point["date"]

        if date in invest_dates:
            ma = ma_values[i]
            deviation = (nav - ma) / ma if ma > 0 else 0

            # 偏离策略：低于均线多投，高于均线少投
            if deviation < -0.1:
                invest_amount = amount * 1.5
            elif deviation < -0.05:
                invest_amount = amount * 1.2
            elif deviation > 0.1:
                invest_amount = amount * 0.5
            elif deviation > 0.05:
                invest_amount = amount * 0.8
            else:
                invest_amount = amount

            shares = invest_amount / nav
            total_shares += shares
            total_invested += invest_amount
            trade_count += 1

        current_value = total_shares * nav
        curve.append({
            "date": date,
            "invested": round(total_invested, 2),
            "value": round(current_value, 2),
            "profit_rate": round((current_value - total_invested) / total_invested * 100, 2) if total_invested > 0 else 0,
        })

    final_value = total_shares * nav_data[-1]["nav"] if nav_data and total_shares > 0 else 0
    total_profit = final_value - total_invested
    profit_rate = (total_profit / total_invested * 100) if total_invested > 0 else 0
    max_drawdown = _calc_max_drawdown(curve)

    if len(nav_data) >= 2:
        years = _calc_years(nav_data[0]["date"], nav_data[-1]["date"])
        annual_return = ((final_value / total_invested) ** (1 / years) - 1) * 100 if years > 0 and total_invested > 0 else 0
    else:
        years = 0
        annual_return = 0

    return {
        "strategy": "均线偏离定投",
        "start_date": nav_data[0]["date"] if nav_data else None,
        "end_date": nav_data[-1]["date"] if nav_data else None,
        "years": round(years, 2),
        "total_invested": round(total_invested, 2),
        "total_value": round(final_value, 2),
        "total_profit": round(total_profit, 2),
        "total_profit_rate": round(profit_rate, 2),
        "annual_return": round(annual_return, 2),
        "max_drawdown": round(max_drawdown, 2),
        "trade_count": trade_count,
        "skip_count": skip_count,
        "nav_curve": curve[-60:],
    }


def _calc_max_drawdown(curve: List[Dict]) -> float:
    """计算最大回撤"""
    if not curve:
        return 0
    peak = 0
    max_dd = 0
    for point in curve:
        value = point.get("value", 0)
        if value > peak:
            peak = value
        if peak > 0:
            dd = (peak - value) / peak * 100
            if dd > max_dd:
                max_dd = dd
    return max_dd


def _calc_years(start_date: str, end_date: str) -> float:
    """计算年份差"""
    try:
        from datetime import datetime
        s = datetime.strptime(start_date[:10], "%Y-%m-%d")
        e = datetime.strptime(end_date[:10], "%Y-%m-%d")
        return (e - s).days / 365.25
    except Exception:
        return 0
