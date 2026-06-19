"""Fund Pool Refresher — refresh fund pool metadata from live sources.

Complements fund_data_refresher (which refreshes NAV-derived metrics like
return_1y and sharpe_1y) by refreshing structural metadata: AUM, fees,
subscription/redemption status, and staleness tracking.

Sources: efinance (primary) → Tushare (secondary) → SQLite cache → static.

Uses an in-memory cache (6h TTL) to avoid hitting efinance on every
allocation request — metadata (name, fees, AUM) changes very slowly.
"""
import logging
import os
import json
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_STALE_THRESHOLD_DAYS = 7

# In-memory cache: code -> (timestamp, updated_profile)
_meta_cache: Dict[str, tuple] = {}
_meta_cache_lock = threading.Lock()
_META_CACHE_TTL = 6 * 3600  # 6 hours
_ENABLE_LIVE_PROVIDER_META = os.environ.get(
    "FUNDTRADER_ENABLE_LIVE_PROVIDER_META", ""
).lower() in {"1", "true", "yes"}
_LIVE_METADATA_TIMEOUT_S = float(os.environ.get("FUNDTRADER_LIVE_METADATA_TIMEOUT_S", "35"))


def _profile_cache_signature(profile) -> tuple:
    return (
        getattr(profile, "metadata_status", None),
        getattr(profile, "metadata_source", None),
        getattr(profile, "metadata_as_of", None),
        getattr(profile, "stale_days", None),
    )


def refresh_pool_metadata(profiles: Dict) -> Dict:
    """Refresh metadata for all funds in the pool.

    Returns a new dict with updated profiles. Does not mutate the input.
    """
    result = {}
    for code, profile in profiles.items():
        try:
            # Check in-memory cache first
            signature = _profile_cache_signature(profile)
            with _meta_cache_lock:
                if code in _meta_cache:
                    ts, cached, cached_signature = _meta_cache[code]
                    if cached_signature == signature and time.time() - ts < _META_CACHE_TTL:
                        result[code] = cached
                        continue
            refreshed = _refresh_single(profile)
            if getattr(refreshed, "metadata_status", None) == "real":
                with _meta_cache_lock:
                    _meta_cache[code] = (time.time(), refreshed, signature)
            result[code] = refreshed
        except Exception as e:
            logger.debug(f"Metadata refresh failed for {code}: {e}")
            result[code] = profile
    return result


def refresh_live_metadata_cache(profiles: Dict, timeout_s: Optional[float] = None) -> dict:
    """Refresh structural metadata into SQLite from live providers.

    This is intended for background jobs. Provider SDKs run in a child Python
    process so a hung network call cannot block API worker threads.
    """
    codes = [str(code) for code in profiles.keys() if code]
    if not codes:
        return {"status": "skipped", "total": 0, "saved": 0, "source": None, "error": None}

    timeout = timeout_s if timeout_s is not None else _LIVE_METADATA_TIMEOUT_S
    try:
        rows = _fetch_eastmoney_meta_batch(codes, timeout_s=timeout)
        source = "eastmoney"
        if not rows:
            rows = _fetch_efinance_meta_batch(codes, timeout_s=timeout)
            source = "efinance"
    except Exception as exc:
        logger.warning("Live fund metadata refresh failed: %s", exc)
        return {"status": "failed", "total": len(codes), "saved": 0, "source": None, "error": str(exc)}

    saved = _save_metadata_cache(rows)
    with _meta_cache_lock:
        _meta_cache.clear()
    return {
        "status": "ok" if saved else "empty",
        "total": len(codes),
        "saved": saved,
        "source": source,
        "error": None,
    }


def _refresh_single(profile) -> object:
    """Refresh a single fund's metadata from live sources."""
    # Allocation generation is latency-sensitive. Use the local cache first and
    # keep direct provider calls opt-in because some SDK calls can block inside
    # their own worker pools without honoring request timeouts.
    meta = _fetch_sqlite_meta(profile.code)
    if meta is None and _ENABLE_LIVE_PROVIDER_META:
        meta = _fetch_efinance_meta(profile.code)
    if meta is None and _ENABLE_LIVE_PROVIDER_META:
        meta = _fetch_tushare_meta(profile.code)

    if meta is None:
        # No live data available — determine staleness from last known as_of
        if profile.metadata_as_of is None:
            if getattr(profile, "metadata_source", None) == "static_fund_pool":
                return _update_profile(profile, {
                    "metadata_status": "assumption",
                    "metadata_source": "static_fund_pool",
                    "stale_days": None,
                })
            # Never refreshed successfully — mark as missing
            return _update_profile(profile, {
                "metadata_status": "missing",
                "stale_days": None,
            })
        stale_days = _compute_stale_days(profile.metadata_as_of)
        if stale_days is not None and stale_days > _STALE_THRESHOLD_DAYS:
            return _update_profile(profile, {
                "metadata_status": "stale",
                "stale_days": stale_days,
            })
        # Within grace period — keep current status but note assumption
        return _update_profile(profile, {
            "metadata_status": "assumption",
            "stale_days": stale_days,
        })

    # Apply live metadata
    meta["metadata_status"] = "real"
    meta["metadata_source"] = meta.get("_source", "efinance")
    meta["metadata_as_of"] = datetime.now().date().isoformat()
    meta["stale_days"] = 0
    meta.pop("_source", None)

    return _update_profile(profile, meta)


def _update_profile(profile, updates: dict) -> object:
    """Create a new FundProfile with updated fields."""
    from .fund_scorer import FundProfile
    kwargs = {
        "code": profile.code,
        "name": updates.get("name", profile.name),
        "fund_type": updates.get("fund_type", profile.fund_type),
        "asset_class": profile.asset_class,
        "company": updates.get("company", profile.company),
        "management_fee": updates.get("management_fee", profile.management_fee),
        "custody_fee": updates.get("custody_fee", profile.custody_fee),
        "aum": updates.get("aum", profile.aum),
        "daily_turnover": updates.get("daily_turnover", profile.daily_turnover),
        "tracking_error": updates.get("tracking_error", profile.tracking_error),
        "return_1y": profile.return_1y,
        "sharpe_1y": profile.sharpe_1y,
        "base_quality": profile.base_quality,
        "metadata_status": updates.get("metadata_status", profile.metadata_status),
        "metadata_source": updates.get("metadata_source", profile.metadata_source),
        "metadata_as_of": updates.get("metadata_as_of", profile.metadata_as_of),
        "stale_days": updates.get("stale_days", profile.stale_days),
    }
    return FundProfile(**kwargs)


def _fetch_efinance_meta_batch(codes: list[str], timeout_s: float) -> list[dict]:
    """Fetch metadata for many funds in a bounded child process."""
    script = r"""
import json
import sys

codes = json.loads(sys.argv[1])
import efinance as ef
import pandas as pd

df = ef.fund.get_base_info(codes)
rows = []
if df is not None and not df.empty:
    code_cols = ["基金代码", "代码", "fund_code", "code"]
    name_cols = ["基金名称", "name"]
    type_cols = ["基金类型", "fund_type"]
    company_cols = ["基金公司", "基金管理人", "管理人", "company"]
    aum_cols = ["基金规模(亿元)", "基金规模", "aum"]
    m_fee_cols = ["管理费", "management_fee"]
    c_fee_cols = ["托管费", "custody_fee"]

    def pick(row, candidates):
        for col in candidates:
            if col in row.index and pd.notna(row[col]):
                return row[col]
        return None

    def as_float(value):
        if value is None:
            return None
        try:
            text = str(value).replace("%", "").replace(",", "").strip()
            if text in ("", "-", "--", "nan"):
                return None
            number = float(text)
            return number / 100 if number > 1 and "%" in str(value) else number
        except Exception:
            return None

    for _, row in df.iterrows():
        code = pick(row, code_cols)
        if code is None:
            continue
        item = {
            "code": str(code).strip().zfill(6),
            "name": str(pick(row, name_cols) or "").strip(),
            "fund_type": str(pick(row, type_cols) or "").strip(),
            "company": str(pick(row, company_cols) or "").strip(),
            "aum": as_float(pick(row, aum_cols)),
            "management_fee": as_float(pick(row, m_fee_cols)),
            "custody_fee": as_float(pick(row, c_fee_cols)),
            "raw": {str(k): (None if pd.isna(v) else str(v)) for k, v in row.items()},
        }
        rows.append(item)
print(json.dumps(rows, ensure_ascii=False))
"""
    completed = subprocess.run(
        [sys.executable, "-c", script, json.dumps(codes)],
        capture_output=True,
        text=True,
        timeout=timeout_s,
        check=False,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        raise RuntimeError(stderr or f"efinance exited with {completed.returncode}")
    try:
        rows = json.loads(completed.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"efinance returned invalid JSON: {exc}") from exc
    return [row for row in rows if isinstance(row, dict) and row.get("code")]


def _fetch_eastmoney_meta_batch(codes: list[str], timeout_s: float) -> list[dict]:
    """Fetch metadata directly from Eastmoney with bounded HTTP timeouts."""
    import concurrent.futures
    import requests

    url = "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation"
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://fund.eastmoney.com/",
    }
    request_timeout = max(2.0, min(8.0, timeout_s / 4))
    started = time.monotonic()

    def parse_float(value):
        if value in (None, "", "-", "--"):
            return None
        try:
            return float(str(value).replace(",", "").replace("%", "").strip())
        except (TypeError, ValueError):
            return None

    def fetch_one(code: str) -> Optional[dict]:
        remaining = timeout_s - (time.monotonic() - started)
        if remaining <= 0:
            return None
        per_request_timeout = min(request_timeout, max(0.5, remaining))
        params = {
            "FCODE": code,
            "deviceid": "3EA024C2-7F22-408B-95E4-383D38160FB3",
            "plat": "Iphone",
            "product": "EFund",
            "version": "6.3.8",
        }
        response = requests.get(url, params=params, headers=headers, timeout=per_request_timeout)
        response.raise_for_status()
        data = response.json().get("Datas") or {}
        if not data:
            return None
        aum_raw = parse_float(data.get("ENDNAV"))
        aum = round(aum_raw / 100000000, 4) if aum_raw is not None else None
        management_fee = parse_float(data.get("RATE"))
        if management_fee is not None and management_fee > 1:
            management_fee = management_fee / 100
        return {
            "code": str(data.get("FCODE") or code).strip().zfill(6),
            "name": str(data.get("SHORTNAME") or "").strip(),
            "fund_type": str(data.get("FTYPE") or "").strip(),
            "company": str(data.get("JJGS") or "").strip(),
            "aum": aum,
            "management_fee": management_fee,
            "custody_fee": None,
            "_source": "eastmoney",
            "raw": data,
        }

    rows: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, max(1, len(codes)))) as executor:
        future_to_code = {executor.submit(fetch_one, code): code for code in codes}
        try:
            for future in concurrent.futures.as_completed(future_to_code, timeout=timeout_s):
                try:
                    row = future.result()
                    if row:
                        rows.append(row)
                except Exception as exc:
                    logger.debug("Eastmoney metadata fetch failed for %s: %s", future_to_code[future], exc)
        except concurrent.futures.TimeoutError:
            logger.warning("Eastmoney metadata batch timed out after %.1fs", timeout_s)
    return rows


def _save_metadata_cache(rows: list[dict]) -> int:
    """Persist provider metadata rows into SQLite."""
    if not rows:
        return 0
    from app.storage.database import get_db

    as_of = datetime.now().date().isoformat()
    updated_at = datetime.now().isoformat()
    saved = 0
    with get_db() as db:
        for row in rows:
            code = str(row.get("code") or "").strip().zfill(6)
            if not code:
                continue
            db.execute(
                """INSERT OR REPLACE INTO fund_metadata_cache
                   (code, name, fund_type, company, aum, management_fee, custody_fee,
                    metadata_as_of, source, raw_json, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    code,
                    str(row.get("name") or ""),
                    str(row.get("fund_type") or ""),
                    str(row.get("company") or ""),
                    row.get("aum"),
                    row.get("management_fee"),
                    row.get("custody_fee"),
                    as_of,
                    str(row.get("_source") or "efinance"),
                    json.dumps(row.get("raw") or row, ensure_ascii=False),
                    updated_at,
                ),
            )
            saved += 1
    return saved


def _fetch_efinance_meta(code: str) -> Optional[dict]:
    """Fetch fund metadata from efinance — batch call to avoid per-fund overhead."""
    try:
        import efinance as ef
        import pandas as pd
        df = ef.fund.get_base_info([code])
        if df is None or df.empty:
            return None
        row = df.iloc[0]
        result = {"_source": "efinance"}
        # Map efinance columns to our fields
        for col, key in [("\u57fa\u91d1\u540d\u79f0", "name"), ("\u57fa\u91d1\u7c7b\u578b", "fund_type")]:
            if col in row.index and pd.notna(row[col]):
                result[key] = str(row[col])
        for col, key in [("\u57fa\u91d1\u89c4\u6a21(\u4ebf\u5143)", "aum"), ("\u7ba1\u7406\u8d39", "management_fee"), ("\u6258\u7ba1\u8d39", "custody_fee")]:
            if col in row.index:
                try:
                    val = float(row[col])
                    result[key] = val
                except (ValueError, TypeError):
                    pass
        return result
    except Exception as e:
        logger.debug(f"efinance metadata fetch failed for {code}: {e}")
    return None


def _fetch_tushare_meta(code: str) -> Optional[dict]:
    """Fetch fund metadata from Tushare."""
    try:
        import tushare as ts
        from app.config import TUSHARE_TOKEN
        if not TUSHARE_TOKEN:
            return None
        ts.set_token(TUSHARE_TOKEN)
        pro = ts.pro_api()
        ts_code = f"{code}.SH" if code.startswith(("5", "6")) else f"{code}.SZ"
        df = pro.fund_basic(ts_code=ts_code, fields="ts_code,name,fund_type,issue_date,m_fee,c_fee")
        if df is None or df.empty:
            return None
        row = df.iloc[0]
        result = {"_source": "tushare"}
        if "name" in row.index:
            result["name"] = str(row["name"])
        for col, key in [("m_fee", "management_fee"), ("c_fee", "custody_fee")]:
            if col in row.index:
                try:
                    result[key] = float(row[col]) / 100  # Tushare gives basis points
                except (ValueError, TypeError):
                    pass
        return result
    except Exception as e:
        logger.debug(f"Tushare metadata fetch failed for {code}: {e}")
    return None


def _fetch_sqlite_meta(code: str) -> Optional[dict]:
    """Fetch fund metadata from SQLite cache."""
    try:
        from app.storage.database import get_db
        with get_db() as db:
            row = db.execute(
                "SELECT name, fund_type, company, aum, management_fee, custody_fee, metadata_as_of, source "
                "FROM fund_metadata_cache WHERE code = ? ORDER BY metadata_as_of DESC, updated_at DESC LIMIT 1",
                (code,),
            ).fetchone()
        if row is None:
            return None
        result = {"_source": "sqlite_cache"}
        if row[0]: result["name"] = row[0]
        if row[1]: result["fund_type"] = row[1]
        if row[2]: result["company"] = row[2]
        if row[3] is not None: result["aum"] = float(row[3])
        if row[4] is not None: result["management_fee"] = float(row[4])
        if row[5] is not None: result["custody_fee"] = float(row[5])
        if row[6]: result["metadata_as_of"] = str(row[6])
        if row[7]: result["_provider_source"] = str(row[7])
        return result
    except Exception:
        return None


def _compute_stale_days(as_of: Optional[str]) -> Optional[int]:
    """Compute how many days since the metadata was last refreshed."""
    if as_of is None:
        return None
    try:
        last = datetime.fromisoformat(as_of).date()
        return (datetime.now().date() - last).days
    except (ValueError, TypeError):
        return None


import pandas as pd  # needed by _fetch_efinance_meta
