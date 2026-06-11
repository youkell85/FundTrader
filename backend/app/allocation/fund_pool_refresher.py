"""Fund Pool Refresher — refresh fund pool metadata from live sources.

Complements fund_data_refresher (which refreshes NAV-derived metrics like
return_1y and sharpe_1y) by refreshing structural metadata: AUM, fees,
subscription/redemption status, and staleness tracking.

Sources: efinance (primary) → Tushare (secondary) → SQLite cache → static.
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_STALE_THRESHOLD_DAYS = 7

def refresh_pool_metadata(profiles: Dict) -> Dict:
    """Refresh metadata for all funds in the pool.

    Returns a new dict with updated profiles. Does not mutate the input.
    """
    result = {}
    for code, profile in profiles.items():
        try:
            result[code] = _refresh_single(profile)
        except Exception as e:
            logger.debug(f"Metadata refresh failed for {code}: {e}")
            result[code] = profile
    return result


def _refresh_single(profile) -> object:
    """Refresh a single fund's metadata from live sources."""
    # Try efinance first
    meta = _fetch_efinance_meta(profile.code)
    if meta is None:
        meta = _fetch_tushare_meta(profile.code)
    if meta is None:
        meta = _fetch_sqlite_meta(profile.code)

    if meta is None:
        # No live data available — determine staleness from last known as_of
        if profile.metadata_as_of is None:
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


def _fetch_efinance_meta(code: str) -> Optional[dict]:
    """Fetch fund metadata from efinance."""
    try:
        import efinance as ef
        df = ef.fund.get_base_info([code])
        if df is None or df.empty:
            return None
        row = df.iloc[0]
        result = {"_source": "efinance"}
        # Map efinance columns to our fields
        for col, key in [("基金名称", "name"), ("基金类型", "fund_type")]:
            if col in row.index and pd.notna(row[col]):
                result[key] = str(row[col])
        for col, key in [("基金规模(亿元)", "aum"), ("管理费", "management_fee"), ("托管费", "custody_fee")]:
            if col in row.index:
                try:
                    val = float(row[col])
                    result[key] = val
                except (ValueError, TypeError):
                    pass
        # daily_turnover: efinance doesn't provide a direct column for this,
        # but we can compute from 成交量 if available
        # TODO: add volume mapping once efinance API column is confirmed
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
        db = get_db()
        row = db.execute(
            "SELECT name, aum, management_fee, custody_fee, metadata_as_of "
            "FROM fund_metadata_cache WHERE code = ? ORDER BY metadata_as_of DESC LIMIT 1",
            (code,),
        ).fetchone()
        if row is None:
            return None
        result = {"_source": "sqlite_cache"}
        if row[0]: result["name"] = row[0]
        if row[1] is not None: result["aum"] = float(row[1])
        if row[2] is not None: result["management_fee"] = float(row[2])
        if row[3] is not None: result["custody_fee"] = float(row[3])
        if row[4]: result["metadata_as_of"] = str(row[4])
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
