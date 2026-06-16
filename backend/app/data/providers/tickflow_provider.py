"""TickFlow 市场数据适配器."""

from __future__ import annotations

import contextlib
import io
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from .base import DataProvider, FundBasic, FundDetail, FundHolding, FundNav
from ...utils import console_error


class TickflowClientFactory:
    """Build TickFlow SDK clients under configured mode."""

    @staticmethod
    def _build_free_client(TickFlow) -> Optional[Any]:
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                return TickFlow.free()
        except UnicodeEncodeError:
            console_error("TickFlow free client notice could not be printed under current console encoding")
            return None

    @staticmethod
    def build_client(mode: str = "auto", api_key: str = "", base_url: str = "") -> Optional[Any]:
        try:
            from tickflow import TickFlow
        except ImportError:
            console_error("tickflow not installed, run: pip install tickflow")
            return None

        request_mode = (mode or "auto").strip().lower()
        key = (api_key or os.getenv("TICKFLOW_API_KEY", "")).strip()
        endpoint = (base_url or os.getenv("TICKFLOW_BASE_URL", "")).strip() or None

        if request_mode == "paid":
            if not key:
                console_error("paid mode requested but TICKFLOW_API_KEY is missing")
                return None
            return TickFlow(api_key=key, base_url=endpoint)

        if request_mode == "free":
            return TickflowClientFactory._build_free_client(TickFlow)

        # auto
        if key:
            try:
                return TickFlow(api_key=key, base_url=endpoint)
            except Exception as e:
                console_error(f"TickFlow paid client init failed, fallback to free: {e}")
                return TickflowClientFactory._build_free_client(TickFlow)
        return TickflowClientFactory._build_free_client(TickFlow)

    @classmethod
    def build_klines_client(cls, mode: str = "auto", api_key: str = "", base_url: str = "") -> Optional[Any]:
        return cls.build_client(mode=mode, api_key=api_key, base_url=base_url)

    @classmethod
    def build_quotes_client(cls, mode: str = "auto", api_key: str = "", base_url: str = "") -> Optional[Any]:
        return cls.build_client(mode=mode, api_key=api_key, base_url=base_url)

    @classmethod
    def build_orderbook_client(cls, mode: str = "auto", api_key: str = "", base_url: str = "") -> Optional[Any]:
        return cls.build_client(mode=mode, api_key=api_key, base_url=base_url)


class TickflowQuotaPolicy:
    """Quota helpers for the paid TickFlow package."""

    @staticmethod
    def normalize_period(period: str) -> str:
        p = (period or "").strip()
        return p if p else "1d"

    @staticmethod
    def validate_batch_size(symbols_count: int, period: str = "1d") -> bool:
        if symbols_count <= 0:
            return False
        period = TickflowQuotaPolicy.normalize_period(period)
        if period in {"1m", "5m", "15m", "30m", "60m", "1d", "1w", "1M", "1Q", "1Y"}:
            return symbols_count <= 100
        return symbols_count <= 100

    @staticmethod
    def normalize_request_window(period: str, count: int = 0) -> int:
        p = TickflowQuotaPolicy.normalize_period(period)
        if p in {"1m", "5m", "15m", "30m", "60m"}:
            return max(1, min(int(count or 5000), 5000))
        return max(1, int(count or 1))


class TickflowProvider(DataProvider):
    """TickFlow 行情与 K 线适配器（支持有 Key 正式服务/无 Key 免费服务）。"""

    name = "tickflow"
    priority = 3

    def __init__(self):
        self._client = None
        self._api_key = os.getenv("TICKFLOW_API_KEY", "").strip()
        self._api_level = os.getenv("TICKFLOW_API_LEVEL", "auto").strip().lower()
        self._base_url = os.getenv("TICKFLOW_BASE_URL", "https://api.tickflow.org").strip()

    def _get_client(self):
        if self._client is None:
            self._client = TickflowClientFactory.build_client(
                mode=self._api_level,
                api_key=self._api_key,
                base_url=self._base_url,
            )
            if self._client is None:
                console_error("TickFlow client init failed")
        return self._client

    def is_available(self) -> bool:
        return self._get_client() is not None

    def get_fund_list(self, market: str = "O") -> List[FundBasic]:
        # TickFlow currently does not expose a first-party fund list API for this project.
        return []

    def get_fund_detail(self, code: str) -> Optional[FundDetail]:
        nav_list = self.get_fund_nav(code)
        latest = nav_list[-1] if nav_list else None
        if latest:
            return FundDetail(
                code=code,
                nav=latest.nav,
                nav_date=latest.date,
                day_growth=latest.day_growth,
                nav_history=nav_list[-120:],
                source=self.name,
            )
        return None

    def get_realtime_quotes(self, symbols: List[str], universes: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        tf = self._get_client()
        if tf is None or (not symbols and not universes):
            return []
        try:
            if universes:
                response = tf.quotes.get(universes=universes)
            else:
                response = tf.quotes.get(symbols=symbols)
            if hasattr(response, "to_dict"):
                response = response.to_dict()
            if isinstance(response, dict) and response.get("data"):
                return list(response["data"])
            if isinstance(response, list):
                return list(response)
        except Exception as e:
            console_error(f"Tickflow quotes failed: {e}")
        return []

    def get_kline_bars(
        self,
        symbol: str,
        period: str = "1d",
        count: int = 500,
        fields: Optional[List[str]] = None,
        start_time: str = "",
        end_time: str = "",
    ) -> List[Dict[str, Any]]:
        tf = self._get_client()
        if tf is None:
            return []

        p = TickflowQuotaPolicy.normalize_period(period)
        if p in {"1m", "5m", "15m", "30m", "60m"}:
            limit = TickflowQuotaPolicy.normalize_request_window(p, count)
            raw = tf.klines.get(symbol, period=p, count=limit, as_dataframe=True)
        else:
            raw = tf.klines.get(
                symbol,
                period=p,
                count=TickflowQuotaPolicy.normalize_request_window(p, count),
                start_time=start_time or None,
                end_time=end_time or None,
                as_dataframe=True,
            )
        if raw is None:
            return []
        if hasattr(raw, "to_dict"):
            rows = raw.to_dict("records")
        elif isinstance(raw, list):
            rows = raw
        else:
            rows = []
        if fields:
            return [{k: row.get(k) for k in fields if isinstance(row, dict) and k in row} for row in rows if isinstance(row, dict)]
        return [row for row in rows if isinstance(row, dict)]

    def get_minute_bars(self, symbol: str, count: int = 5000) -> List[Dict[str, Any]]:
        return self.get_kline_bars(symbol=symbol, period="1m", count=count)

    def get_market_depth(self, symbol: str) -> Dict[str, Any]:
        tf = self._get_client()
        if tf is None:
            return {}
        try:
            response = tf.depth.get(symbol)
            if hasattr(response, "to_dict"):
                response = response.to_dict()
            if isinstance(response, dict):
                return response
        except Exception as e:
            console_error(f"Tickflow depth failed: {e}")
        return {}

    def get_adjustment_factors(self, symbols: List[str] | str) -> List[Dict[str, Any]]:
        tf = self._get_client()
        if tf is None:
            return []
        if isinstance(symbols, str):
            symbols = [symbols]
        if not symbols or not TickflowQuotaPolicy.validate_batch_size(len(symbols), period="1d"):
            return []
        try:
            response = tf.klines.ex_factors(symbols)
            if hasattr(response, "to_dict"):
                response = response.to_dict("records")
            if isinstance(response, dict) and response.get("data"):
                return [x for x in response.get("data") if isinstance(x, dict)]
            if isinstance(response, list):
                return [x for x in response if isinstance(x, dict)]
        except Exception as e:
            console_error(f"Tickflow adjustment factors failed: {e}")
        return []

    @staticmethod
    def _pick(row, names):
        for name in names:
            if name in row:
                value = row.get(name)
                if value is not None and str(value) != "":
                    return value
        return None

    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> List[FundNav]:
        tf = self._get_client()
        if tf is None:
            return []

        for symbol in self._candidate_fund_symbols(code):
            bars = self.get_kline_bars(symbol, period="1d", count=500)
            if not bars:
                continue
            result = []
            for row in bars:
                date_value = self._pick(row, ["trade_date", "trade_time", "date", "datetime", "time"])
                close_value = self._pick(row, ["close", "Close", "收盘"])
                pct_value = self._pick(row, ["change_pct", "pct_change", "change_percent", "pct"])
                if close_value is None:
                    continue
                result.append(
                    FundNav(
                        date=self._parse_date(str(date_value or "")),
                        nav=self._safe_float(close_value),
                        accum_nav=None,
                        adj_nav=None,
                        day_growth=self._safe_float(pct_value),
                    ),
                )
            if result:
                self._touch_symbol_hit(code, symbol, start_date, end_date)
                return result
        return []

    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        return []

    @staticmethod
    def _touch_symbol_hit(code: str, symbol: str, start_date: str = "", end_date: str = "") -> None:
        _ = (code, symbol, start_date, end_date)

    def _candidate_fund_symbols(self, code: str) -> List[str]:
        raw = str(code or "").strip()
        if "." in raw:
            return [raw]
        if not raw:
            return []

        if raw.startswith(("5", "6")):
            candidates = [f"{raw}.SH", f"{raw}.SZ"]
        elif raw.startswith(("15", "16", "18")):
            candidates = [f"{raw}.SZ", f"{raw}.SH"]
        else:
            candidates = [f"{raw}.SH", f"{raw}.SZ", f"{raw}.OF"]

        uniq = []
        seen = set()
        for item in candidates:
            if item and item not in seen:
                uniq.append(item)
                seen.add(item)
        return uniq
