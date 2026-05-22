"""东方财富API数据获取层

数据获取策略：API 优先 → 被封/超时自动降级 CloakBrowser 反指纹浏览器
CloakBrowser 按需启动，用完即关，平时不占内存。
"""
import json
import threading
import time
import urllib.request
from typing import Optional, List, Dict, Any
from ..utils import console_error

# ── CloakBrowser 熔断器 ──
# 连续失败 N 次后暂停使用，避免每次都浪费时间启动浏览器
_cloak_fail_count = 0
_cloak_disabled_until = 0.0  # Unix timestamp
_CLOAK_MAX_FAILS = 3
_CLOAK_COOLDOWN = 300  # 5 分钟冷却


def _is_cloak_available() -> bool:
    """检查 CloakBrowser 是否可用（未被熔断）"""
    global _cloak_fail_count, _cloak_disabled_until
    if _cloak_fail_count >= _CLOAK_MAX_FAILS:
        if time.time() < _cloak_disabled_until:
            return False
        # 冷却期已过，重置计数器
        _cloak_fail_count = 0
        _cloak_disabled_until = 0.0
    return True


def _record_cloak_failure():
    """记录 CloakBrowser 失败"""
    global _cloak_fail_count, _cloak_disabled_until
    _cloak_fail_count += 1
    if _cloak_fail_count >= _CLOAK_MAX_FAILS:
        _cloak_disabled_until = time.time() + _CLOAK_COOLDOWN
        console_error(f"[CloakBrowser] 连续失败 {_cloak_fail_count} 次，暂停使用 {_CLOAK_COOLDOWN}s")


def _record_cloak_success():
    """记录 CloakBrowser 成功"""
    global _cloak_fail_count
    _cloak_fail_count = 0


def _fetch_json_cloak(url: str, referer: str = "https://fund.eastmoney.com/") -> Optional[Any]:
    """使用 CloakBrowser 反指纹浏览器获取 JSON（降级方案）
    在独立线程中运行，避免与 FastAPI 异步事件循环冲突。
    """
    result = [None, None]  # [data, error]

    def _do_fetch():
        try:
            from cloakbrowser import launch
            console_error(f"[CloakBrowser] 降级抓取: {url[:80]}...")
            browser = launch(headless=True)
            page = browser.new_page()
            page.set_extra_http_headers({"Referer": referer})
            page.goto(url, timeout=20000, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            body = page.content()
            browser.close()

            # 提取 JSON/JSONP 内容
            text = body
            if "<body>" in text:
                text = text.split("<body>")[1].split("</body>")[0].strip()
            if text.startswith("jQuery") or text.startswith("jsonpgz"):
                text = text[text.index("(") + 1:text.rindex(")")]
            result[0] = json.loads(text)
        except ImportError:
            console_error("[CloakBrowser] 未安装，跳过降级")
            result[1] = "not_installed"
        except Exception as e:
            result[1] = str(e)

    t = threading.Thread(target=_do_fetch, daemon=True)
    t.start()
    t.join(timeout=35)
    if t.is_alive():
        console_error("[CloakBrowser] 降级超时 (35s)")
        _record_cloak_failure()
        return None
    if result[1]:
        console_error(f"[CloakBrowser] 降级失败: {result[1]}")
        _record_cloak_failure()
        return None
    _record_cloak_success()
    return result[0]


def _fetch_json(url: str, referer: str = "https://fund.eastmoney.com/") -> Optional[Any]:
    """请求JSON数据，优先 API，失败自动降级 CloakBrowser"""
    # 第一优先：直接 HTTP API
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": referer,
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8")
            # 处理JSONP
            if text.startswith("jQuery") or text.startswith("jsonpgz"):
                text = text[text.index("(") + 1:text.rindex(")")]
            return json.loads(text)
    except urllib.error.HTTPError as e:
        # 403/429 等被封 → 降级 CloakBrowser
        if e.code in (403, 429, 503) and _is_cloak_available():
            console_error(f"[EastMoney] API 返回 {e.code}，降级 CloakBrowser")
            return _fetch_json_cloak(url, referer)
        console_error(f"EastMoney fetch error: {e}")
        return None
    except Exception as e:
        # 超时/网络错误 → 降级 CloakBrowser
        if _is_cloak_available():
            console_error(f"[EastMoney] API 异常 ({type(e).__name__})，降级 CloakBrowser")
            return _fetch_json_cloak(url, referer)
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


def _loose_json_to_dict(text: str) -> dict:
    """将东方财富松散 JSON（未加引号的键）转为标准 JSON 并解析"""
    import re
    # 东方财富排名格式: {datas:[...],allRecords:827,pageIndex:1,...}
    # 策略: 找到 datas 数组结束位置(],), 分别处理
    bracket_idx = text.index('],') + 1  # 指向 ]
    datas_part = text[:bracket_idx + 1]  # 包含 ]
    meta_part = text[bracket_idx + 1:]    # allRecords:827,... (可能以 , 开头也可能不以 , 开头)

    # 修复 datas 键
    datas_part = '{"datas"' + datas_part[len('{datas'):]
    # 修复 meta 部分的 unquoted keys
    # 先处理开头的 key (前面没有 , 或 {)
    meta_part = re.sub(r'^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'"\1":', meta_part)
    # 再处理 ,key: 模式
    meta_part = re.sub(r'([{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1"\2":', meta_part)
    # 补上缺失的闭合 }
    if not meta_part.endswith('}'):
        meta_part += '}'
    return json.loads(datas_part + meta_part)


def _parse_ranking_text(text: str) -> List[Dict[str, Any]]:
    """解析东方财富排名数据文本"""
    if "var rankData" not in text:
        return []
    data_str = text[text.index("=") + 2:text.rindex(";") - 1]
    try:
        data = json.loads(data_str)
    except json.JSONDecodeError:
        # 东方财富返回松散 JSON（未加引号的键），尝试修复
        try:
            data = _loose_json_to_dict(data_str)
        except Exception:
            console_error(f"[EastMoney] 排名数据 JSON 解析失败")
            return []
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
    # 优先 API
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://fund.eastmoney.com/",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8")
        return _parse_ranking_text(text)
    except Exception as e:
        console_error(f"EastMoney ranking API error: {e}")
    # 降级 CloakBrowser
    if _is_cloak_available():
        data = _fetch_json_cloak(url)
        if data and isinstance(data, dict):
            items = data.get("datas", [])
            return _parse_ranking_text("var rankData = " + json.dumps(data) + ";")
    return []


def get_fund_manager_em(code: str) -> Optional[Dict[str, Any]]:
    """获取基金经理信息（东方财富）"""
    url = f"https://fund.eastmoney.com/manager/{code}.html"
    # 优先 API
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8")
        return {"code": code, "raw_html_length": len(html)}
    except Exception as e:
        console_error(f"EastMoney manager API error for {code}: {e}")
    # 降级 CloakBrowser
    if _is_cloak_available():
        result = [None, None]
        def _do_fetch():
            try:
                from cloakbrowser import launch
                console_error(f"[CloakBrowser] 降级抓取经理页: {code}")
                browser = launch(headless=True)
                page = browser.new_page()
                page.goto(url, timeout=20000, wait_until="domcontentloaded")
                html = page.content()
                browser.close()
                result[0] = {"code": code, "raw_html_length": len(html), "source": "cloakbrowser"}
            except Exception as e:
                result[1] = str(e)
        t = threading.Thread(target=_do_fetch, daemon=True)
        t.start()
        t.join(timeout=35)
        if t.is_alive():
            console_error("[CloakBrowser] 经理页降级超时")
            _record_cloak_failure()
        elif result[1]:
            console_error(f"[CloakBrowser] 经理页降级失败: {result[1]}")
            _record_cloak_failure()
        elif result[0]:
            _record_cloak_success()
            return result[0]
    return None
