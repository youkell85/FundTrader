"""FundTrader 后端配置"""
import os
from pathlib import Path

# 在任�?os.getenv 之前加载 .env 文件
try:
    from dotenv import load_dotenv
    _env_backend = Path(__file__).resolve().parent.parent / ".env"
    _env_root = Path(__file__).resolve().parent.parent.parent / ".env"
    if _env_backend.exists():
        load_dotenv(_env_backend)
    elif _env_root.exists():
        load_dotenv(_env_root)
except ImportError:
    pass

# 服务配置
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8766"))
API_PREFIX = "/fund/api"

# 缓存配置
CACHE_DIR = os.getenv("CACHE_DIR", "/tmp/fundtrader_cache")
CACHE_TTL_RANKING = int(os.getenv("CACHE_TTL_RANKING", "86400"))  # 基金排名/阶段收益日频更新
CACHE_TTL_NAV = int(os.getenv("CACHE_TTL_NAV", "86400"))  # 基金净值日频更�?CACHE_TTL_INFO = int(os.getenv("CACHE_TTL_INFO", "86400"))  # 基础信息/分析指标默认日缓�?
# 数据源配�?
TUSHARE_TOKEN = os.getenv("TUSHARE_TOKEN", "")
TICKFLOW_API_KEY = os.getenv("TICKFLOW_API_KEY", "")
TICKFLOW_API_LEVEL = os.getenv("TICKFLOW_API_LEVEL", "free")
IFIND_TOKEN = os.getenv("IFIND_TOKEN", "")
IFIND_USE_MCP = os.getenv("IFIND_USE_MCP", "true")

# LLM配置
LLM_API_URL = os.getenv("LLM_API_URL", "https://api.minimaxi.com/v1/chat/completions")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "MiniMax-M2.7")

# CORS
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "")
