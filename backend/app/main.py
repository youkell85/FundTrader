"""FundTrader FastAPI 主入口"""
import asyncio
import logging
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import API_PREFIX, CORS_ORIGINS, MARKET_DATA_REFRESH_INTERVAL
from .api import fund, analysis, recommend, dca, professional, settings, allocation, storage, auth, admin_api
from .storage.database import init_db, get_db_context

logger = logging.getLogger(__name__)


async def _background_refresh_loop():
    """Background task that periodically refreshes market data."""
    from .allocation.data import market_data_service
    while True:
        await asyncio.sleep(MARKET_DATA_REFRESH_INTERVAL)
        try:
            logger.info("Scheduled market data refresh starting...")
            await asyncio.to_thread(market_data_service.refresh)
        except Exception as e:
            logger.error(f"Background refresh failed: {e}")


async def _db_cleanup_scheduler():
    """Background task: periodically clean up stale data from growing tables."""
    while True:
        await asyncio.sleep(86400)
        try:
            from .storage.database import FundDataStore
            result = await asyncio.to_thread(FundDataStore.cleanup_stale_data)
            logger.info(f"DB cleanup: {result}")
        except Exception as e:
            logger.error(f"DB cleanup failed: {e}")


async def _fund_snapshot_scheduler():
    """Background task: refresh fund snapshots on trading days after market close."""
    while True:
        await asyncio.sleep(1800)  # Check every 30 minutes
        try:
            if not _is_trading_day():
                continue
            now = datetime.now()
            # Market close 15:00 CST = 07:00 UTC (Singapore = UTC+8)
            close_hour = 15
            if now.hour < close_hour:
                continue
            # Only refresh if not already refreshed today
            last = _get_last_snapshot_date()
            today = now.strftime("%Y-%m-%d")
            if last == today:
                continue
            logger.info(f"Trading day {today}: refreshing fund snapshots...")
            _do_fund_snapshot_refresh()
        except Exception as e:
            logger.error(f"Fund snapshot scheduler error: {e}")


def _is_trading_day() -> bool:
    """Check if today is a Chinese A-share trading day. Uses Tushare if available, falls back to weekday check."""
    from datetime import date, timedelta
    today = date.today()
    # Quick check: weekend
    if today.weekday() >= 5:
        return False
    # Try Tushare
    try:
        from .config import TUSHARE_TOKEN
        if TUSHARE_TOKEN:
            import tushare as ts
            ts.set_token(TUSHARE_TOKEN)
            pro = ts.pro_api()
            df = pro.trade_cal(exchange="SSE", start_date=today.strftime("%Y%m%d"), end_date=today.strftime("%Y%m%d"))
            if df is not None and not df.empty:
                return int(df.iloc[0]["is_open"]) == 1
    except Exception:
        pass
    return True  # Fallback: assume it's a trading day


def _get_last_snapshot_date() -> str | None:
    """Get the date of the most recent fund snapshot."""
    try:
        from .storage.database import FundSnapshotCache
        ts = FundSnapshotCache.get_last_update()
        if ts:
            return ts[:10]
    except Exception:
        pass
    return None


def _do_fund_snapshot_refresh():
    """Execute fund snapshot refresh synchronously."""
    import json as _json
    from .data.data_gateway import data_gateway
    from .storage.database import FundDataStore, FundSnapshotCache
    from .constants.guoyuan_funds import GUOYUAN_FUND_LIST

    codes = {f["code"] for f in GUOYUAN_FUND_LIST}
    cached = FundSnapshotCache.get_codes()

    def _fetch_rank():
        import akshare as ak
        return ak.fund_open_fund_rank_em(symbol="全部")

    gateway_result = data_gateway.call(
        "akshare",
        "fund_open_fund_rank_em",
        _fetch_rank,
        cache_key="akshare:fund_open_fund_rank_em:all",
        ttl_seconds=24 * 60 * 60,
    )
    if gateway_result.error:
        logger.warning(f"Fund snapshot: akshare failed: {gateway_result.error}")
        return
    df = gateway_result.data
    if df is None or df.empty:
        logger.warning("Fund snapshot: akshare returned empty")
        return

    now_str = datetime.now().isoformat()
    rows = []
    quote_rows = []
    for _, row in df.iterrows():
        code = str(row.get("基金代码", "")).strip()
        if code not in codes and code not in cached:
            continue
        try:
            item = {
                "code": code,
                "name": str(row.get("基金简称", "")),
                "type": str(row.get("基金类型", "")),
                "nav": float(row.get("单位净值", 0) or 0),
                "day_growth": float(row.get("日增长率", 0) or 0),
                "near_1m": float(row.get("近1月", 0) or 0),
                "near_3m": float(row.get("近3月", 0) or 0),
                "near_6m": float(row.get("近6月", 0) or 0),
                "near_1y": float(row.get("近1年", 0) or 0),
                "near_3y": float(row.get("近3年", 0) or 0),
                "ytd": float(row.get("今年以来", 0) or 0),
                "tags": ["鑫基荟"],
                "company": "",
                "is_xinjihui": True,
                "is_preferred": True,
                "updated_at": now_str,
            }
            quote_rows.append(item)
            rows.append((
                item["code"],
                item["name"],
                item["type"],
                item["nav"],
                item["day_growth"],
                item["near_1m"],
                item["near_3m"],
                item["near_6m"],
                item["near_1y"],
                item["near_3y"],
                item["ytd"],
                _json.dumps(["鑫基荟"], ensure_ascii=False),
                "",
                now_str,
            ))
        except (ValueError, TypeError):
            continue

    if rows:
        FundSnapshotCache.save_batch(rows)
        FundDataStore.save_quote_batch(quote_rows, source="akshare_rank_refresh")
        logger.info(f"Fund snapshot refreshed: {len(rows)} funds")
    else:
        logger.warning("Fund snapshot: no matching funds found")


async def _metrics_compute_on_startup():
    """Background task: compute risk metrics on startup if fund_metrics_snapshot is empty."""
    await asyncio.sleep(60)
    try:
        from .storage.database import FundDataStore
        with get_db_context() as conn:
            count = conn.execute("SELECT COUNT(*) as c FROM fund_metrics_snapshot").fetchone()["c"]
        if count > 0:
            logger.info(f"Metrics already computed ({count} rows), skipping startup compute")
            return
        logger.info("fund_metrics_snapshot is empty, computing risk metrics (concurrent)...")
        from .services.fund_service import compute_and_save_metrics
        result = await asyncio.to_thread(compute_and_save_metrics, limit=0, skip_existing=True, max_workers=8)
        logger.info(f"Metrics compute result: computed={result['computed']}, saved={result['saved']}, "
                     f"skipped={result['skipped']}, errors={result['errors']}")
    except Exception as e:
        logger.error(f"Startup metrics compute failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan: startup data refresh + background task."""
    # Initialize database
    try:
        logger.info("Initializing database...")
        init_db()
    except Exception as e:
        logger.warning(f"Database initialization failed: {e}")

    # Startup: initial data refresh (non-blocking via thread, 30s timeout)
    try:
        from .allocation.data import market_data_service
        logger.info("Initial market data refresh on startup (30s timeout)...")
        await asyncio.wait_for(
            asyncio.to_thread(market_data_service.refresh),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        logger.warning("Startup data refresh timed out — loading from SQLite cache")
        from .allocation.data.market_data_service import market_data_service as mds
        mds._load_macro_from_db()
        mds._load_stats_from_db()
    except Exception as e:
        logger.warning(f"Startup data refresh failed — loading from SQLite cache: {e}")
        from .allocation.data.market_data_service import market_data_service as mds
        mds._load_macro_from_db()
        mds._load_stats_from_db()

    # Spawn background refresh tasks
    task = asyncio.create_task(_background_refresh_loop())
    fund_task = asyncio.create_task(_fund_snapshot_scheduler())
    cleanup_task = asyncio.create_task(_db_cleanup_scheduler())
    metrics_task = asyncio.create_task(_metrics_compute_on_startup())
    yield
    # Shutdown: cancel background tasks
    task.cancel()
    fund_task.cancel()
    cleanup_task.cancel()
    metrics_task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="FundTrader API",
    description="公募基金智能分析平台",
    version="1.0.0",
    root_path=API_PREFIX,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS != ["*"] else ["https://fundtrader.example.com"].split(",") if CORS_ORIGINS != "*" else ["*"],
    allow_credentials=True if CORS_ORIGINS != ["*"] else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(fund.router)
app.include_router(analysis.router)
app.include_router(recommend.router)
app.include_router(dca.router)
app.include_router(professional.router)
app.include_router(settings.router)
app.include_router(allocation.router)
app.include_router(storage.router)
app.include_router(auth.router)
app.include_router(admin_api.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "FundTrader"}


@app.get("/api/health")
async def api_health():
    """Health endpoint under root_path prefix (/fund/api/health)"""
    return {"status": "ok", "service": "FundTrader"}


@app.get("/fund/api/health")
async def full_path_health():
    """Health endpoint for direct access with full path"""
    return {"status": "ok", "service": "FundTrader"}


@app.get("/market-data/status")
async def market_data_status():
    """Check market data service status."""
    from .allocation.data import market_data_service
    return market_data_service.get_status()


@app.post("/market-data/refresh")
async def market_data_refresh():
    """Force refresh market data immediately (async, returns immediately)."""
    from .allocation.data import market_data_service
    import asyncio

    async def _safe_refresh():
        try:
            await asyncio.to_thread(market_data_service.refresh)
            logger.info("Manual refresh completed successfully")
            s = market_data_service.get_status()
            logger.info(f"Status after refresh: macro={s['macro_available']}, vol={s['vol_ratio']}")
        except Exception as e:
            logger.error(f"Manual refresh failed: {e}", exc_info=True)

    asyncio.create_task(_safe_refresh())
    return {"status": "refresh_started"}


if __name__ == "__main__":
    import uvicorn
    from .config import API_HOST, API_PORT
    uvicorn.run("app.main:app", host=API_HOST, port=API_PORT, reload=True)
