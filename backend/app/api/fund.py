"""基金排名筛选API"""
import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Query
from starlette.concurrency import run_in_threadpool
from typing import Optional

from ..services.fund_service import get_fund_list, get_fund_list_from_watchlist
from ..constants.guoyuan_funds import GUOYUAN_FUND_LIST

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fund", tags=["基金排名筛选"])


@router.get("/list")
async def fund_list(
    category: str = Query("全部", description="基金类型"),
    tag: Optional[str] = Query(None, description="标签筛选"),
    keyword: Optional[str] = Query(None, description="关键词搜索"),
    sort_by: str = Query("今年来", description="排序字段"),
    sort_order: str = Query("desc", description="排序方向"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=5000, description="每页数量"),
    guoyuan_only: bool = Query(True, description="仅国元名单"),
    use_watchlist: bool = Query(False, description="使用自选基金列表"),
):
    if use_watchlist:
        return await run_in_threadpool(
            get_fund_list_from_watchlist,
            category,
            tag,
            keyword,
            sort_by,
            sort_order,
            page,
            page_size,
        )
    return await run_in_threadpool(
        get_fund_list,
        category,
        tag,
        keyword,
        sort_by,
        sort_order,
        page,
        page_size,
        guoyuan_only,
    )


@router.get("/categories")
async def fund_categories():
    from ..constants.guoyuan_funds import FUND_CATEGORIES, FUND_TYPES
    return {"categories": FUND_CATEGORIES, "types": FUND_TYPES}


@router.post("/refresh-snapshot")
async def refresh_fund_snapshot():
    """Refresh all fund data to SQLite (called after market close)."""
    import akshare as ak
    import pandas as pd
    import numpy as np
    from ..storage.database import FundSnapshotCache

    try:
        logger.info("Starting fund snapshot refresh...")
        codes = [f["code"] for f in GUOYUAN_FUND_LIST]
        cached = FundSnapshotCache.get_codes()

        # Fetch from akshare (batch if possible)
        df = ak.fund_open_fund_rank_em(symbol="全部")
        if df is None or df.empty:
            return {"status": "error", "message": "akshare返回空数据"}

        now = datetime.now().isoformat()
        rows = []
        for _, row in df.iterrows():
            code = str(row.get("基金代码", "")).strip()
            if code not in codes and code not in cached:
                continue
            try:
                rows.append((
                    code,
                    str(row.get("基金简称", "")),
                    str(row.get("基金类型", "")),
                    float(row.get("单位净值", 0) or 0),
                    float(row.get("日增长率", 0) or 0),
                    float(row.get("近1月", 0) or 0),
                    float(row.get("近3月", 0) or 0),
                    float(row.get("近6月", 0) or 0),
                    float(row.get("近1年", 0) or 0),
                    float(row.get("近3年", 0) or 0),
                    float(row.get("今年以来", 0) or 0),
                    json.dumps(["鑫基荟"], ensure_ascii=False),
                    "",
                    now,
                ))
            except (ValueError, TypeError):
                continue

        if rows:
            FundSnapshotCache.save_batch(rows)
            logger.info(f"Fund snapshot refreshed: {len(rows)} funds")

        return {"status": "ok", "count": len(rows), "updated_at": now}
    except Exception as e:
        logger.error(f"Fund snapshot refresh failed: {e}")
        return {"status": "error", "message": str(e)[:200]}
