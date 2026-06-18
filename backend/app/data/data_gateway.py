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


    def get_health_snapshot(self) -> Dict[str, Any]:
        """Return a structured health snapshot of all gateway-tracked providers."""
        from datetime import datetime as dt

        now = dt.now()
        now_ts = time.time()
        providers = []
        for source in self.DEFAULT_TTLS:
            cooldown_sec = self.FAILURE_COOLDOWN_SECONDS.get(source, 300)
            failed_until = 0.0
            last_error = None
            last_success_at = None
            last_failure_at = None
            failure_count = 0

            with self._lock:
                # scan failures for this source
                for key, fail_ts in self._failures.items():
                    if key.startswith(f"{source}:"):
                        failure_count += 1
                        if fail_ts > failed_until:
                            failed_until = fail_ts
                # scan cache for last success
                for key, (cache_expiry, cached_result) in list(self._cache.items()):
                    if key.startswith(f"{source}:") and cached_result.fetched_at:
                        last_success_at = max(
                            last_success_at or "", cached_result.fetched_at
                        )

            in_cooldown = bool(failed_until and failed_until > now_ts)
            cooldown_until = dt.fromtimestamp(failed_until).isoformat() if in_cooldown else None

            capabilities = {
                "akshare": ["fund_ranking", "fund_scale", "bond_portfolio"],
                "efinance": ["fund_nav", "fund_info", "fund_scale"],
                "eastmoney": ["fund_ranking", "fund_detail", "fund_report_pdf", "fund_announcement"],
                "tushare": ["fund_basic", "fund_nav", "fund_share", "fund_portfolio"],
                "ifind": ["risk_indicators", "macro", "fund_profile"],
                "tencent": ["realtime_quote", "fund_quote_fallback"],
            }.get(source, [])

            if in_cooldown:
                status = "cooldown"
            elif last_success_at and not in_cooldown:
                status = "available"
            elif failure_count > 0:
                status = "partial"
            else:
                status = "unknown"

            providers.append({
                "name": source,
                "enabled": True,
                "capabilities": capabilities,
                "status": status,
                "available": bool(last_success_at) or (not in_cooldown and failure_count == 0),
                "lastSuccessAt": last_success_at,
                "last_success_at": last_success_at,
                "lastError": last_error,
                "last_error": last_error,
                "cooldownUntil": cooldown_until,
                "cooldown_until": cooldown_until,
                "failureCount": failure_count,
                "failure_count": failure_count,
                "circuitOpen": in_cooldown,
                "circuit_open": in_cooldown,
                "data_quality": {
                    "status": status,
                    "missing_reason": last_error if status in {"partial", "cooldown", "missing"} else None,
                },
            })

        available_count = sum(1 for p in providers if p["available"])
        return {
            "status": "available" if available_count > 0 else "missing",
            "updatedAt": now.isoformat(),
            "providers": providers,
            "availableCount": available_count,
            "totalCount": len(providers),
        }


data_gateway = DataGateway()
