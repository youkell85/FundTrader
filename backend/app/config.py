"""FundTrader 后端配置"""
import os

# 服务配置
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8766"))
API_PREFIX = "/fund/api"

# 缓存配置
CACHE_DIR = os.getenv("CACHE_DIR", "/tmp/fundtrader_cache")
CACHE_TTL_RANKING = int(os.getenv("CACHE_TTL_RANKING", "1800"))  # 30分钟
CACHE_TTL_NAV = int(os.getenv("CACHE_TTL_NAV", "3600"))  # 1小时
CACHE_TTL_INFO = int(os.getenv("CACHE_TTL_INFO", "7200"))  # 2小时

# LLM配置
LLM_API_URL = os.getenv("LLM_API_URL", "https://api.deepseek.com/v1/chat/completions")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-v4-flash")

# CORS
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")
