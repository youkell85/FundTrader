"""鑷€夊熀閲戠鐞嗘湇鍔?""
import json
import os
import re
from datetime import datetime
from typing import List, Dict, Any, Optional
from ..utils import console_error

WATCHLIST_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "watchlist.json")

# 鍩洪噾浠ｇ爜鏍煎紡鏍￠獙
FUND_CODE_PATTERN = re.compile(r'^\d{6}$')


def _ensure_file():
    """纭繚鑷€夋枃浠跺瓨鍦?""

import logging

    os.makedirs(os.path.dirname(WATCHLIST_FILE), exist_ok=True)
    if not os.path.exists(WATCHLIST_FILE):
        with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
            json.dump({"funds": []}, f, ensure_ascii=False)


def get_watchlist() -> List[Dict[str, Any]]:
    """鑾峰彇鑷€夊熀閲戝垪琛?""
    _ensure_file()
    try:
        with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("funds", [])
    except Exception as e:
        console_error(f"Watchlist read error: {e}")
        return []


def add_fund(code: str, name: str = "", type_: str = "", tags: List[str] = []) -> Dict[str, Any]:
    """娣诲姞鑷€夊熀閲?""
    # 鏍￠獙鍩洪噾浠ｇ爜鏍煎紡
    if not FUND_CODE_PATTERN.match(code):
        return {"status": "error", "message": "鏃犳晥鐨勫熀閲戜唬鐮佹牸寮忥紝搴斾负6浣嶆暟瀛?}

    watchlist = get_watchlist()
    now = datetime.now().isoformat(timespec="seconds")
    # 妫€鏌ユ槸鍚﹀凡瀛樺湪
    for index, f in enumerate(watchlist):
        if f["code"] == code:
            updated = {
                **f,
                "name": name or f.get("name", code),
                "type": type_ or f.get("type", ""),
                "tags": tags or f.get("tags", []),
                "updated_at": now,
            }
            watchlist.pop(index)
            watchlist.append(updated)
            _save_watchlist(watchlist)
            return {"status": "duplicate", "message": f"鍩洪噾 {code} 宸插湪鑷€夊垪琛ㄤ腑", "fund": updated}

    # 灏濊瘯浠嶢kShare鑾峰彇鍩洪噾鍚嶇О锛堝鏋滄湭鎻愪緵锛?
    if not name:
        try:
            from ..data.akshare_fetcher import get_fund_info
            info = get_fund_info(code)
            if info:
                name = info.get("鍩洪噾绠€绉?, "")
                type_ = info.get("鍩洪噾绫诲瀷", type_)
        except Exception:
        logging.exception("Ignored non-fatal exception")

    fund = {
        "code": code,
        "name": name or code,
        "type": type_ or "鏈煡",
        "tags": tags,
        "created_at": now,
        "updated_at": now,
    }
    watchlist.append(fund)
    _save_watchlist(watchlist)
    return {"status": "added", "fund": fund}


def add_funds_batch(funds: List[Dict[str, Any]]) -> Dict[str, Any]:
    """鎵归噺娣诲姞鑷€夊熀閲?""
    watchlist = get_watchlist()
    existing_codes = {f["code"] for f in watchlist}
    added = []
    skipped = []
    invalid = []

    for fund in funds:
        code = fund.get("code", "")
        if not code:
            continue
        # 鏍￠獙鍩洪噾浠ｇ爜鏍煎紡
        if not FUND_CODE_PATTERN.match(code):
            invalid.append(code)
            continue
        if code in existing_codes:
            skipped.append(code)
            continue

        # 灏濊瘯琛ュ叏鍚嶇О
        name = fund.get("name", "")
        if not name:
            try:
                from ..data.akshare_fetcher import get_fund_info
                info = get_fund_info(code)
                if info:
                    name = info.get("鍩洪噾绠€绉?, "")
                    fund["type"] = info.get("鍩洪噾绫诲瀷", fund.get("type", ""))
            except Exception:
            logging.exception("Ignored non-fatal exception")

        watchlist.append({
            "code": code,
            "name": name or code,
            "type": fund.get("type", "鏈煡"),
            "tags": fund.get("tags", []),
        })
        added.append(code)
        existing_codes.add(code)

    _save_watchlist(watchlist)
    return {"added": added, "skipped": skipped, "invalid": invalid, "total": len(watchlist)}


def remove_fund(code: str) -> Dict[str, Any]:
    """绉婚櫎鑷€夊熀閲?""
    watchlist = get_watchlist()
    new_list = [f for f in watchlist if f["code"] != code]
    if len(new_list) == len(watchlist):
        return {"status": "not_found", "message": f"鍩洪噾 {code} 涓嶅湪鑷€夊垪琛ㄤ腑"}
    _save_watchlist(new_list)
    return {"status": "removed", "code": code}


def clear_watchlist() -> Dict[str, Any]:
    """娓呯┖鑷€夊熀閲?""
    _save_watchlist([])
    return {"status": "cleared"}


def _save_watchlist(watchlist: List[Dict[str, Any]]):
    """淇濆瓨鑷€夊垪琛?""
    _ensure_file()
    try:
        with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
            json.dump({"funds": watchlist}, f, ensure_ascii=False)
    except Exception as e:
        console_error(f"Watchlist save error: {e}")

