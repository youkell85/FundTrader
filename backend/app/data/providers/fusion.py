"""Data federation adapter for fund/detail providers."""

from datetime import datetime
from typing import Optional, List, Dict, Any

from .base import DataProvider, FundDetail, FundNav, FundHolding, FundPerformance, FundRisk
from .tushare_provider import TushareProvider
from .tickflow_provider import TickflowProvider
from .tencent_provider import TencentProvider
from .ifind_provider import iFinDProvider
from ...utils import console_error


PROVIDER_CAPABILITIES = {
    "tushare": ["fund_basic", "fund_nav", "fund_share", "fund_holdings", "fund_dividend", "fund_manager", "fund_rating", "trade_cal"],
    "ifind": ["risk_indicators", "macro", "news", "fund_profile", "fund_market_performance"],
    "tickflow": ["etf_quotes", "etf_klines", "minute_klines", "depth", "adjustment_factors"],
    "tencent": ["realtime_quote", "fund_quote_fallback"],
}


class DataFusion:
    """Data fusion layer: orchestrates multiple provider backends and merges results."""

    def __init__(self):
        self.providers: List[DataProvider] = [
            TushareProvider(),    # primary: Tushare
            iFinDProvider(),      # secondary: iFinD MCP
            TickflowProvider(),   # tertiary: TickFlow
            TencentProvider(),    # fallback: Tencent quotes
        ]
        self._available_providers = None
        self._provider_status: Dict[str, Dict[str, Any]] = {}
        for provider in self.providers:
            self._provider_status[provider.name] = {
                "name": provider.name,
                "priority": provider.priority,
                "available": False,
                "last_check": None,
                "last_error": None,
                "used": False,
                "fallback_reason": None,
                "source_hint": None,
            }

    def _get_available(self) -> List[DataProvider]:
        if self._available_providers is None:
            self._available_providers = [
                p for p in self.providers if p.is_available()
            ]
            self._available_providers.sort(key=lambda p: p.priority, reverse=True)
            console_error(f"Available data providers: {[p.name for p in self._available_providers]}")
        return self._available_providers

    def refresh_providers(self):
        self._available_providers = None
        self._get_available()

    def _reset_runtime_flags(self) -> None:
        for state in self._provider_status.values():
            state["used"] = False
            state["fallback_reason"] = None
            state["source_hint"] = None
            state["last_error"] = None

    @staticmethod
    def _is_blank_text(value: Any) -> bool:
        return value is None or (isinstance(value, str) and not value.strip())

    def _mark_provider_status(
        self,
        provider: DataProvider,
        *,
        success: bool,
        used: bool = False,
        error: str = "",
        fallback_reason: str = "",
        source_hint: str = "",
    ) -> None:
        state = self._provider_status.setdefault(
            provider.name,
            {
                "name": provider.name,
                "priority": provider.priority,
                "available": False,
                "last_check": None,
                "last_error": None,
                "used": False,
                "fallback_reason": None,
                "source_hint": None,
            },
        )
        try:
            state["available"] = provider.is_available()
        except Exception:
            state["available"] = False
        state["last_check"] = datetime.now().isoformat()
        state["used"] = bool(used or state.get("used"))
        state["last_error"] = None if success else (error or "provider call failed")
        if fallback_reason:
            state["fallback_reason"] = fallback_reason
        if source_hint:
            state["source_hint"] = source_hint

    def get_fund_detail(self, code: str) -> Optional[FundDetail]:
        self._reset_runtime_flags()
        available = self._get_available()
        if not available:
            return None

        primary = None
        primary_provider = None
        primary_idx = None
        for idx, provider in enumerate(available):
            try:
                detail = provider.get_fund_detail(code)
                if detail:
                    primary = detail
                    primary_provider = provider
                    primary_idx = idx
                    self._mark_provider_status(provider, success=True, used=True, source_hint="primary")
                    break
            except Exception as e:
                console_error(f"Provider {provider.name} detail error: {e}")
                self._mark_provider_status(provider, success=False, used=False, error=str(e), source_hint="primary")

        if primary is None:
            for provider in available:
                if self._provider_status.get(provider.name, {}).get("last_error") is None:
                    self._mark_provider_status(
                        provider,
                        success=False,
                        used=False,
                        error="No usable detail data",
                        source_hint="primary",
                    )
            return None

        if primary_provider is not None and primary_idx is not None and primary_idx > 0:
            self._mark_provider_status(
                primary_provider,
                success=True,
                used=True,
                fallback_reason=f"fallback_to_{primary_provider.name}",
                source_hint="primary_fallback",
            )

        # Merge supplemental fields from non-primary providers for best-effort enrichment.
        for provider in available:
            if provider.name == primary.source:
                continue
            try:
                detail = provider.get_fund_detail(code)
                if not detail:
                    continue
                if not primary.nav and detail.nav:
                    primary.nav = detail.nav
                if not primary.nav_date and detail.nav_date:
                    primary.nav_date = detail.nav_date
                if primary.day_growth is None and detail.day_growth is not None:
                    primary.day_growth = detail.day_growth
                if not primary.name and detail.name:
                    primary.name = detail.name
                if primary.rating is None and detail.rating is not None:
                    primary.rating = detail.rating
                if not primary.nav_history and detail.nav_history:
                    primary.nav_history = detail.nav_history
                if not primary.manager_info and detail.manager_info:
                    primary.manager_info = detail.manager_info
                elif detail.manager_info:
                    for key, value in detail.manager_info.items():
                        if key not in primary.manager_info or self._is_blank_text(primary.manager_info.get(key)):
                            primary.manager_info[key] = value
                if not primary.type and detail.type:
                    primary.type = detail.type
                if not primary.name and detail.name:
                    primary.name = detail.name
                if not primary.basic and detail.basic:
                    primary.basic = detail.basic
                if primary.basic and detail.basic:
                    if not primary.basic.name and detail.basic.name:
                        primary.basic.name = detail.basic.name
                    if not primary.basic.management and detail.basic.management:
                        primary.basic.management = detail.basic.management
                    if not primary.basic.custodian and detail.basic.custodian:
                        primary.basic.custodian = detail.basic.custodian
                    if not primary.basic.manager and detail.basic.manager:
                        primary.basic.manager = detail.basic.manager
                    if not primary.basic.found_date and detail.basic.found_date:
                        primary.basic.found_date = detail.basic.found_date
                    if not primary.basic.benchmark and detail.basic.benchmark:
                        primary.basic.benchmark = detail.basic.benchmark
                    if not primary.basic.status and detail.basic.status:
                        primary.basic.status = detail.basic.status
                    if primary.basic.fund_share is None and detail.basic.fund_share is not None:
                        primary.basic.fund_share = detail.basic.fund_share
                if not primary.dividends and detail.dividends:
                    primary.dividends = detail.dividends
                if not primary.scale and detail.scale:
                    primary.scale = detail.scale
                if not primary.adj_factors and detail.adj_factors:
                    primary.adj_factors = detail.adj_factors
                if not primary.company and detail.company:
                    primary.company = detail.company
                self._mark_provider_status(provider, success=True, used=True, source_hint="enrich")
            except Exception as e:
                console_error(f"Provider {provider.name} merge error: {e}")
                self._mark_provider_status(provider, success=False, used=False, error=str(e), source_hint="enrich")

        primary.holdings = self._merge_holdings(code, available)
        if not primary.nav_history:
            primary.nav_history = self._merge_nav_history(code, available)

        if primary.nav_history and not primary.nav:
            latest = primary.nav_history[-1]
            primary.nav = latest.nav
            primary.nav_date = latest.date

        return primary

    def _merge_holdings(self, code: str, providers: List[DataProvider]) -> List[FundHolding]:
        best_holdings = []
        for provider in providers:
            try:
                holdings = provider.get_fund_holdings(code)
                if holdings:
                    self._mark_provider_status(provider, success=True, used=True, source_hint="holdings")
                if len(holdings) > len(best_holdings):
                    best_holdings = holdings
            except Exception as e:
                console_error(f"Provider {provider.name} holdings error: {e}")
                self._mark_provider_status(provider, success=False, used=False, error=str(e), source_hint="holdings")
        return best_holdings

    def _merge_nav_history(self, code: str, providers: List[DataProvider]) -> List[FundNav]:
        all_navs = {}
        for provider in providers:
            try:
                navs = provider.get_fund_nav(code)
                if navs:
                    self._mark_provider_status(provider, success=True, used=True, source_hint="nav_history")
                for nav in navs:
                    if nav.date and nav.nav is not None:
                        all_navs[nav.date] = nav
            except Exception as e:
                console_error(f"Provider {provider.name} nav error: {e}")
                self._mark_provider_status(provider, success=False, used=False, error=str(e), source_hint="nav_history")

        sorted_dates = sorted(all_navs.keys())
        return [all_navs[d] for d in sorted_dates]

    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> List[FundNav]:
        self._reset_runtime_flags()
        available = self._get_available()
        return self._merge_nav_history(code, available)

    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        self._reset_runtime_flags()
        available = self._get_available()
        return self._merge_holdings(code, available)

    def get_fund_performance(self, code: str) -> Optional[FundPerformance]:
        self._reset_runtime_flags()
        available = self._get_available()
        for provider in available:
            if provider.name == "tushare" and hasattr(provider, "get_fund_performance"):
                try:
                    perf = provider.get_fund_performance(code)
                    if perf:
                        self._mark_provider_status(provider, success=True, used=True, source_hint="performance")
                        return perf
                except Exception as e:
                    console_error(f"Tushare performance calc error: {e}")
                    self._mark_provider_status(provider, success=False, used=False, error=str(e), source_hint="performance")
            try:
                detail = provider.get_fund_detail(code)
                if detail and detail.performance:
                    self._mark_provider_status(provider, success=True, used=True, source_hint="performance_fallback")
                    return detail.performance
            except Exception as e:
                console_error(f"Provider {provider.name} detail fallback for performance failed: {e}")
                self._mark_provider_status(provider, success=False, used=False, error=str(e), source_hint="performance_fallback")
                continue
        return None

    def get_providers_status(self) -> List[Dict[str, Any]]:
        statuses = []
        for p in self.providers:
            state = self._provider_status.get(p.name, {})
            available = p.is_available()
            last_error = state.get("last_error")
            statuses.append({
                "name": p.name,
                "priority": p.priority,
                "capabilities": PROVIDER_CAPABILITIES.get(p.name, []),
                "available": available,
                "status": "available" if available and not last_error else "degraded" if available else "missing",
                "used": bool(state.get("used", False)),
                "last_check": state.get("last_check"),
                "lastSuccessAt": state.get("last_check") if available and not last_error else None,
                "lastError": last_error,
                "last_error": last_error,
                "cooldownUntil": None,
                "fallback_reason": state.get("fallback_reason"),
                "source_hint": state.get("source_hint"),
            })
        return statuses

    def get_provider_health_snapshot(self) -> Dict[str, Any]:
        provider_status = self.get_providers_status()
        return {
            "updated_at": datetime.now().isoformat(),
            "providers": provider_status,
            "available_count": sum(1 for p in provider_status if p.get("available")),
            "total_count": len(provider_status),
        }


_fusion = None


def get_fusion() -> DataFusion:
    global _fusion
    if _fusion is None:
        _fusion = DataFusion()
    return _fusion
