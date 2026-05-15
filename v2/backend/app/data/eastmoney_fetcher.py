"""东方财富API数据获取层"""
import json
import urllib.request
from typing import Optional, List, Dict, Any
from ..utils import console_error


def _fetch_json(url: str) -> Optional[Any]:
    """请求JSON数据"""
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://fund.eastmoney.com/",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8")
            # 处理JSONP
            if text.startswith("jQuery") or text.startswith("jsonpgz"):
                text = text[text.index("(") + 1:text.rindex(")")]
            return json.loads(text)
    except Exception as e:
        console_error(f"EastMoney fetch error: {e}")
        return None


def get_fund_detail_em(code: str) -> Optional[Dict[str, Any]]:
    """获取基金详情（东方财富）"""
    url = f"https://fundgz.1702.com/js/{code}.js"
    data = _fetch_json(url)
    if data and isinstance(data, dict):
        return {
            "code": data.get("fundcode", code),
            "name": data.get("name", ""),
            "nav": data.get("gsz"),
            "nav_date": data.get("gztime", ""),
            "day_growth": data.get("gszzl"),
        }
    return None


def get_fund_ranking_em(fund_type: str = "全部", sort_by: str = "3nzf") -> List[Dict[str, Any]]:
    """
    获取基金排名（东方财富）
    sort_by: 1nzf(近1月), 3nzf(近3月), 6nzf(近6月), 1nzf(近1年), 3nzf(近3年)
    """
    type_map = {
        "全部": "all", "股票型": "gp", "混合型": "hh",
        "债券型": "zq", "指数型": "zs", "QDII": "qdii",
        "FOF": "fof", "货币": "hb",
    }
    ft = type_map.get(fund_type, "all")
    url = f"https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft={ft}&rs=&gs=0&sc={sort_by}&st=desc&sd=&ed=&qdii=&tabSubtype=,,,,,&pi=1&pn=50&dx=1"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://fund.eastmoney.com/",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8")
        # 解析东方财富返回的特殊格式
        if "var rankData" in text:
            data_str = text[text.index("=") + 2:text.rindex(";") - 1]
            data = json.loads(data_str)
            items = data.get("datas", [])
            result = []
            for item in items:
                parts = item.split(",")
                if len(parts) >= 20:
                    result.append({
                        "code": parts[0],
                        "name": parts[1],
                        "type": parts[3],
                        "nav": float(parts[4]) if parts[4] else None,
                        "acc_nav": float(parts[5]) if parts[5] else None,
                        "day_growth": float(parts[6]) if parts[6] else None,
                        "near_1w": float(parts[7]) if parts[7] else None,
                        "near_1m": float(parts[8]) if parts[8] else None,
                        "near_3m": float(parts[9]) if parts[9] else None,
                        "near_6m": float(parts[10]) if parts[10] else None,
                        "near_1y": float(parts[11]) if parts[11] else None,
                        "near_2y": float(parts[12]) if parts[12] else None,
                        "near_3y": float(parts[13]) if parts[13] else None,
                        "ytd": float(parts[14]) if parts[14] else None,
                        "near_1y_annual": float(parts[15]) if parts[15] else None,
                    })
            return result
    except Exception as e:
        console_error(f"EastMoney ranking error: {e}")
    return []


def get_fund_manager_em(code: str) -> Optional[Dict[str, Any]]:
    """获取基金经理信息（东方财富）"""
    url = f"https://fund.eastmoney.com/manager/{code}.html"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8")
        # 简单解析 - 实际部署时可用BeautifulSoup
        return {"code": code, "raw_html_length": len(html)}
    except Exception as e:
        console_error(f"EastMoney manager error for {code}: {e}")
        return None
