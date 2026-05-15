"""Tickflow 数据适配器"""
import os
from typing import Optional, List
from .base import DataProvider, FundBasic, FundNav, FundHolding, FundDetail
from ...utils import console_error


class TickflowProvider(DataProvider):
    """Tickflow 行情数据适配器（支持免费版日K）"""

    name = "tickflow"
    priority = 3

    def __init__(self):
        self._client = None
        self._api_key = os.getenv("TICKFLOW_API_KEY", "")

    def _get_client(self):
        """懒加载Tickflow客户端"""
        if self._client is None:
            try:
                from tickflow import TickFlow
                if self._api_key:
                    self._client = TickFlow(api_key=self._api_key)
                else:
                    # 免费版（仅日K线，无需API Key）
                    self._client = TickFlow.free()
            except ImportError:
                console_error("tickflow not installed, run: pip install tickflow")
                return None
        return self._client

    def is_available(self) -> bool:
        return self._get_client() is not None

    def get_fund_list(self, market: str = "O") -> List[FundBasic]:
        # Tickflow 不提供基金列表接口，返回空
        return []

    def get_fund_detail(self, code: str) -> Optional[FundDetail]:
        # Tickflow 主要针对股票行情，基金数据有限
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

    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> List[FundNav]:
        """获取ETF/场内基金日K线（Tickflow主要覆盖场内标的）"""
        tf = self._get_client()
        if tf is None:
            return []

        # 尝试多种代码格式
        symbols = [f"{code}.SH", f"{code}.SZ"]
        for symbol in symbols:
            try:
                df = tf.klines.get(symbol, period="1d", count=500, as_dataframe=True)
                if df is not None and not df.empty:
                    result = []
                    for _, row in df.iterrows():
                        result.append(FundNav(
                            date=self._parse_date(str(row.get("date", row.get("datetime", "")))),
                            nav=self._safe_float(row.get("close")),
                            accum_nav=None,
                            adj_nav=None,
                            day_growth=self._safe_float(row.get("change_pct")),
                        ))
                    return result
            except Exception as e:
                console_error(f"Tickflow klines error for {symbol}: {e}")
                continue
        return []

    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        return []
