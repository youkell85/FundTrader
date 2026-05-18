"""FundTrader FastAPI 主入口"""
from pathlib import Path
from dotenv import load_dotenv

# 加载 .env 文件（优先加载 backend/.env，再加载项目根目录 .env）
_env_backend = Path(__file__).resolve().parent.parent / ".env"
_env_root = Path(__file__).resolve().parent.parent.parent / ".env"
if _env_backend.exists():
    load_dotenv(_env_backend)
elif _env_root.exists():
    load_dotenv(_env_root)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import API_PREFIX, CORS_ORIGINS
from .api import fund, analysis, recommend, dca, professional, settings

app = FastAPI(
    title="FundTrader API",
    description="公募基金智能分析平台",
    version="1.0.0",
    root_path=API_PREFIX,
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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "FundTrader"}


if __name__ == "__main__":
    import uvicorn
    from .config import API_HOST, API_PORT
    uvicorn.run("app.main:app", host=API_HOST, port=API_PORT, reload=True)
