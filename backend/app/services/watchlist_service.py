"""自选基金管理服务"""
import json
import os
from typing import List, Dict, Any, Optional
from ..utils import console_error

WATCHLIST_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "watchlist.json")


def _ensure_file():
    """确保自选文件存在"""
    os.makedirs(os.path.dirname(WATCHLIST_FILE), exist_ok=True)
    if not os.path.exists(WATCHLIST_FILE):
        with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
            json.dump({"funds": []}, f, ensure_ascii=False)


def get_watchlist() -> List[Dict[str, Any]]:
    """获取自选基金列表"""
    _ensure_file()
    try:
        with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("funds", [])
    except Exception as e:
        console_error(f"Watchlist read error: {e}")
        return []


def add_fund(code: str, name: str = "", type_: str = "", tags: List[str] = []) -> Dict[str, Any]:
    """添加自选基金"""
    watchlist = get_watchlist()
    # 检查是否已存在
    for f in watchlist:
        if f["code"] == code:
            return {"status": "duplicate", "message": f"基金 {code} 已在自选列表中"}

    # 尝试从AkShare获取基金名称（如果未提供）
    if not name:
        try:
            from ..data.akshare_fetcher import get_fund_info
            info = get_fund_info(code)
            if info:
                name = info.get("基金简称", "")
                type_ = info.get("基金类型", type_)
        except Exception:
            pass

    fund = {
        "code": code,
        "name": name or code,
        "type": type_ or "未知",
        "tags": tags,
    }
    watchlist.append(fund)
    _save_watchlist(watchlist)
    return {"status": "added", "fund": fund}


def add_funds_batch(funds: List[Dict[str, Any]]) -> Dict[str, Any]:
    """批量添加自选基金"""
    watchlist = get_watchlist()
    existing_codes = {f["code"] for f in watchlist}
    added = []
    skipped = []

    for fund in funds:
        code = fund.get("code", "")
        if not code:
            continue
        if code in existing_codes:
            skipped.append(code)
            continue

        # 尝试补全名称
        name = fund.get("name", "")
        if not name:
            try:
                from ..data.akshare_fetcher import get_fund_info
                info = get_fund_info(code)
                if info:
                    name = info.get("基金简称", "")
                    fund["type"] = info.get("基金类型", fund.get("type", ""))
            except Exception:
                pass

        watchlist.append({
            "code": code,
            "name": name or code,
            "type": fund.get("type", "未知"),
            "tags": fund.get("tags", []),
        })
        added.append(code)
        existing_codes.add(code)

    _save_watchlist(watchlist)
    return {"added": added, "skipped": skipped, "total": len(watchlist)}


def remove_fund(code: str) -> Dict[str, Any]:
    """移除自选基金"""
    watchlist = get_watchlist()
    new_list = [f for f in watchlist if f["code"] != code]
    if len(new_list) == len(watchlist):
        return {"status": "not_found", "message": f"基金 {code} 不在自选列表中"}
    _save_watchlist(new_list)
    return {"status": "removed", "code": code}


def clear_watchlist() -> Dict[str, Any]:
    """清空自选基金"""
    _save_watchlist([])
    return {"status": "cleared"}


def _save_watchlist(watchlist: List[Dict[str, Any]]):
    """保存自选列表"""
    _ensure_file()
    try:
        with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
            json.dump({"funds": watchlist}, f, ensure_ascii=False)
    except Exception as e:
        console_error(f"Watchlist save error: {e}")