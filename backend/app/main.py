"""FundTrader FastAPI 主入口"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import API_PREFIX, CORS_ORIGINS, MARKET_DATA_REFRESH_INTERVAL
from .api import fund, analysis, recommend, dca, professional, settings, allocation, storage
from .storage.database import init_db

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan: startup data refresh + background task."""
    # Initialize database
    try:
        logger.info("Initializing database...")
        init_db()
    except Exception as e:
        logger.warning(f"Database initialization failed: {e}")

    # Startup: initial data refresh (non-blocking via thread)
    try:
        from .allocation.data import market_data_service
        logger.info("Initial market data refresh on startup...")
        await asyncio.to_thread(market_data_service.refresh)
    except Exception as e:
        logger.warning(f"Startup data refresh failed (will retry later): {e}")

    # Spawn background refresh task
    task = asyncio.create_task(_background_refresh_loop())
    yield
    # Shutdown: cancel background task
    task.cancel()
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
    allow_origins=CORS_ORIGINS.split(",") if CORS_ORIGINS != "*" else ["*"],
    allow_credentials=True,
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


if __name__ == "__main__":
    import uvicorn
    from .config import API_HOST, API_PORT
    uvicorn.run("app.main:app", host=API_HOST, port=API_PORT, reload=True)
