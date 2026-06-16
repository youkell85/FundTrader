"""FundTrader 后端配置"""
import os
from .env import load_backend_env

# 在任何 os.getenv 之前加载 .env 文件
load_backend_env()

# 服务配置
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8766"))
API_PREFIX = "/fund/api"

# 缓存配置
CACHE_DIR = os.getenv("CACHE_DIR", "/tmp/fundtrader_cache")
CACHE_TTL_RANKING = int(os.getenv("CACHE_TTL_RANKING", "86400"))  # 基金排名/阶段收益日频更新
CACHE_TTL_NAV = int(os.getenv("CACHE_TTL_NAV", "86400"))  # 基金净值日频更新
CACHE_TTL_INFO = int(os.getenv("CACHE_TTL_INFO", "86400"))  # 基础信息/分析指标默认日缓存
# 数据源配置
TUSHARE_TOKEN = os.getenv("TUSHARE_TOKEN", "")
TICKFLOW_API_KEY = os.getenv("TICKFLOW_API_KEY", "")
TICKFLOW_API_LEVEL = os.getenv("TICKFLOW_API_LEVEL", "auto")
TICKFLOW_BASE_URL = os.getenv("TICKFLOW_BASE_URL", "https://api.tickflow.org")
IFIND_TOKEN = os.getenv("IFIND_TOKEN", "")
IFIND_USE_MCP = os.getenv("IFIND_USE_MCP", "true")

# LLM配置
LLM_API_URL = os.getenv("LLM_API_URL", "https://api.minimaxi.com/v1/chat/completions")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "MiniMax-M2.7")

# Astorn DeepSeek v4 Flash 配置（用于风险摘要、运作分析等基金详情页文本生成）
ASTORN_API_URL = os.getenv("ASTORN_API_URL", "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions")
ASTORN_API_KEY = os.getenv("ASTORN_API_KEY", "")
ASTORN_MODEL = os.getenv("ASTORN_MODEL", "xopdeepseekv4flash")

# CORS
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "")

# Market data refresh intervals (seconds)
MARKET_DATA_REFRESH_INTERVAL = int(os.getenv("MARKET_DATA_REFRESH_INTERVAL", "900"))  # 15min
MACRO_REFRESH_INTERVAL = int(os.getenv("MACRO_REFRESH_INTERVAL", "86400"))  # 24h
