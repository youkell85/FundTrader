"""缓存管理器"""
import json
import os
import time
import threading
from typing import Any, Optional
from ..utils import console_error


class CacheManager:
    """简单的文件缓存管理器（线程安全）"""

    def __init__(self, cache_dir: str = "/tmp/fundtrader_cache"):
        self.cache_dir = cache_dir
        self._lock = threading.Lock()
        os.makedirs(cache_dir, exist_ok=True)

    def _key_to_path(self, key: str) -> str:
        safe_key = key.replace("/", "_").replace(":", "_").replace("?", "_")
        return os.path.join(self.cache_dir, f"{safe_key}.json")

    def get(self, key: str, ttl: int = 3600) -> Optional[Any]:
        path = self._key_to_path(key)
        if not os.path.exists(path):
            return None
        try:
            with self._lock:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            if time.time() - data.get("timestamp", 0) > ttl:
                try:
                    os.remove(path)
                except OSError:
                    pass
                return None
            return data.get("value")
        except (json.JSONDecodeError, OSError):
            return None

    def set(self, key: str, value: Any) -> None:
        path = self._key_to_path(key)
        try:
            with self._lock:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump({"timestamp": time.time(), "value": value}, f, ensure_ascii=False)
        except OSError as e:
            console_error(f"Cache write error: {e}")

    def delete(self, key: str) -> None:
        path = self._key_to_path(key)
        try:
            os.remove(path)
        except OSError:
            pass

    def clear(self) -> None:
        try:
            for f in os.listdir(self.cache_dir):
                if f.endswith(".json"):
                    try:
                        os.remove(os.path.join(self.cache_dir, f))
                    except OSError:
                        pass
        except OSError:
            pass


cache = CacheManager()
