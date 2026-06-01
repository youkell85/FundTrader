"""Unified guarded gateway for external market-data providers.

Page-facing APIs should read SQLite snapshots. This gateway is for scheduled
refresh jobs and explicit low-priority backfill jobs, so external sources are
rate-limited, cooled down after failures, deduplicated by TTL and audited.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, Optional, Tuple

from ..storage.database import FundDataStore


@dataclass
class GatewayResult:
    data: Any
    source: str
    fetched_at: str
    ttl_seconds: int
    error: Optional[str] = None
    from_cache: bool = False


class DataGateway:
    """Synchronous gateway with simple in-process controls and SQLite logging."""

    DEFAULT_TTLS = {
        "akshare": 24 * 60 * 60,
        "efinance": 24 * 60 * 60,
        "eastmoney": 24 * 60 * 60,
        "tushare": 24 * 60 * 60,
        "ifind": 24 * 60 * 60,
        "tencent": 15 * 60,
    }
    FAILURE_COOLDOWN_SECONDS = {
        "akshare": 10 * 60,
        "efinance": 10 * 60,
        "eastmoney": 5 * 60,
        "tushare": 15 * 60,
        "ifind": 15 * 60,
        "tencent": 60,
    }

    def __init__(self) -> None:
        self._cache: Dict[str, Tuple[float, GatewayResult]] = {}
        self._failures: Dict[str, float] = {}
        self._lock = threading.Lock()
        self._source_locks: Dict[str, threading.Semaphore] = {
            "akshare": threading.Semaphore(1),
            "efinance": threading.Semaphore(1),
            "eastmoney": threading.Semaphore(2),
            "tushare": threading.Semaphore(1),
            "ifind": threading.Semaphore(1),
            "tencent": threading.Semaphore(2),
        }

    def call(
        self,
        source: str,
        endpoint: str,
        fn: Callable[[], Any],
        *,
        code: str = "",
        cache_key: str = "",
        ttl_seconds: Optional[int] = None,
        retry: int = 0,
    ) -> GatewayResult:
        ttl = ttl_seconds if ttl_seconds is not None else self.DEFAULT_TTLS.get(source, 3600)
        key = cache_key or f"{source}:{endpoint}:{code}"
        now = time.time()
        with self._lock:
            cached = self._cache.get(key)
            if cached and cached[0] > now:
                return GatewayResult(
                    data=cached[1].data,
                    source=source,
                    fetched_at=cached[1].fetched_at,
                    ttl_seconds=ttl,
                    error=cached[1].error,
                    from_cache=True,
                )
            failed_until = self._failures.get(key, 0)
            if failed_until > now:
                result = GatewayResult(
                    data=None,
                    source=source,
                    fetched_at=datetime.now().isoformat(),
                    ttl_seconds=ttl,
                    error="cooldown",
                )
                FundDataStore.log_external_api_call(source, endpoint, code, key, 0, False, "cooldown")
                return result

        semaphore = self._source_locks.get(source, threading.Semaphore(1))
        attempts = max(1, retry + 1)
        last_error = ""
        start = time.perf_counter()
        with semaphore:
            for _ in range(attempts):
                try:
                    data = fn()
                    duration = int((time.perf_counter() - start) * 1000)
                    result = GatewayResult(
                        data=data,
                        source=source,
                        fetched_at=datetime.now().isoformat(),
                        ttl_seconds=ttl,
                    )
                    with self._lock:
                        self._cache[key] = (time.time() + ttl, result)
                        self._failures.pop(key, None)
                    FundDataStore.log_external_api_call(source, endpoint, code, key, duration, True, "")
                    return result
                except Exception as exc:  # pragma: no cover - provider errors are environmental
                    last_error = str(exc)[:500]
                    time.sleep(0.2)

        duration = int((time.perf_counter() - start) * 1000)
        cooldown = self.FAILURE_COOLDOWN_SECONDS.get(source, 300)
        with self._lock:
            self._failures[key] = time.time() + cooldown
        FundDataStore.log_external_api_call(source, endpoint, code, key, duration, False, last_error)
        return GatewayResult(
            data=None,
            source=source,
            fetched_at=datetime.now().isoformat(),
            ttl_seconds=ttl,
            error=last_error or "external provider failed",
        )


data_gateway = DataGateway()
