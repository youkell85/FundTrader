"""多数据源融合层 - 按优先级聚合多个数据源的数据"""
from typing import Optional, List, Dict, Any
from .base import DataProvider, FundDetail, FundNav, FundHolding, FundPerformance, FundRisk
from .tushare_provider import TushareProvider
from .tickflow_provider import TickflowProvider
from .tencent_provider import TencentProvider
from .ifind_provider import iFinDProvider
from ...utils import console_error


class DataFusion:
    """数据融合器 - 管理多个数据源，按优先级聚合结果"""

    def __init__(self):
        self.providers: List[DataProvider] = [
            iFinDProvider(),      # 优先级5 - 专业数据
            TushareProvider(),    # 优先级4 - 结构化数据
            TickflowProvider(),   # 优先级3 - 行情数据
            TencentProvider(),    # 优先级2 - 实时行情
        ]
        self._available_providers = None

    def _get_available(self) -> List[DataProvider]:
        """获取可用的数据源列表（已排序）"""
        if self._available_providers is None:
            self._available_providers = [
                p for p in self.providers if p.is_available()
            ]
            self._available_providers.sort(key=lambda p: p.priority, reverse=True)
            console_error(f"Available data providers: {[p.name for p in self._available_providers]}")
        return self._available_providers

    def refresh_providers(self):
        """刷新数据源可用性状态"""
        self._available_providers = None
        self._get_available()

    def get_fund_detail(self, code: str) -> Optional[FundDetail]:
        """融合多个数据源的基金详情
        策略：按优先级逐个获取，合并非空字段
        """
        available = self._get_available()
        if not available:
            return None

        # 主数据源：取优先级最高的完整数据
        primary = None
        for provider in available:
            try:
                detail = provider.get_fund_detail(code)
                if detail:
                    primary = detail
                    break
            except Exception as e:
                console_error(f"Provider {provider.name} detail error: {e}")

        if primary is None:
            return None

        # 补充数据源：合并其他数据源的非空字段
        for provider in available:
            if provider.name == primary.source:
                continue
            try:
                detail = provider.get_fund_detail(code)
                if not detail:
                    continue
                # 合并字段：其他数据源的非空字段覆盖主数据源的空字段
                if not primary.nav and detail.nav:
                    primary.nav = detail.nav
                if not primary.nav_date and detail.nav_date:
                    primary.nav_date = detail.nav_date
                if primary.day_growth is None and detail.day_growth is not None:
                    primary.day_growth = detail.day_growth
                if not primary.name and detail.name:
                    primary.name = detail.name
                # 补充净值历史
                if not primary.nav_history and detail.nav_history:
                    primary.nav_history = detail.nav_history
            except Exception as e:
                console_error(f"Provider {provider.name} merge error: {e}")

        # 获取持仓（所有数据源中最好的）
        primary.holdings = self._merge_holdings(code, available)

        # 获取净值历史（所有数据源合并）
        if not primary.nav_history:
            primary.nav_history = self._merge_nav_history(code, available)

        # 补充最新净值信息
        if primary.nav_history and not primary.nav:
            latest = primary.nav_history[-1]
            primary.nav = latest.nav
            primary.nav_date = latest.date

        return primary

    def _merge_holdings(self, code: str, providers: List[DataProvider]) -> List[FundHolding]:
        """合并多个数据源的持仓数据"""
        best_holdings = []
        for provider in providers:
            try:
                holdings = provider.get_fund_holdings(code)
                if len(holdings) > len(best_holdings):
                    best_holdings = holdings
            except Exception as e:
                console_error(f"Provider {provider.name} holdings error: {e}")
        return best_holdings

    def _merge_nav_history(self, code: str, providers: List[DataProvider]) -> List[FundNav]:
        """合并多个数据源的净值历史"""
        all_navs = {}
        for provider in providers:
            try:
                navs = provider.get_fund_nav(code)
                for nav in navs:
                    if nav.date and nav.nav:
                        # 去重：保留最新数据源的数据
                        all_navs[nav.date] = nav
            except Exception as e:
                console_error(f"Provider {provider.name} nav error: {e}")

        # 按日期排序
        sorted_dates = sorted(all_navs.keys())
        return [all_navs[d] for d in sorted_dates]

    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> List[FundNav]:
        """获取融合后的净值历史"""
        available = self._get_available()
        return self._merge_nav_history(code, available)

    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        """获取融合后的持仓数据"""
        available = self._get_available()
        return self._merge_holdings(code, available)

    def get_providers_status(self) -> List[Dict[str, Any]]:
        """获取所有数据源的状态"""
        return [
            {
                "name": p.name,
                "priority": p.priority,
                "available": p.is_available(),
            }
            for p in self.providers
        ]


# 全局融合器实例
_fusion = None


def get_fusion() -> DataFusion:
    """获取全局数据融合器"""
    global _fusion
    if _fusion is None:
        _fusion = DataFusion()
    return _fusion