"""多数据源融合层 - 按优先级聚合多个数据源的数据"""
from typing import Optional, List, Dict, Any
from .base import (
    DataProvider, FundDetail, FundNav, FundHolding, FundPerformance, FundRisk,
    FundDividend, FundScale, AdjFactor, FundCompany, TradeCal, IndexDaily,
)
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
        from ...data.common import get_fund_detail_with_fallback
        
        available = self._get_available()
        if not available:
            return None

        def detail_extractor(provider, code):
            return provider.get_fund_detail(code)

        def merger(primary, detail):
            # 合并字段：其他数据源的非空字段覆盖主数据源的空字段
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
            # 补充净值历史
            if not primary.nav_history and detail.nav_history:
                primary.nav_history = detail.nav_history
            # 补充基金经理信息
            if not primary.manager_info and detail.manager_info:
                primary.manager_info = detail.manager_info
            # 补充basic信息（如份额规模）
            if primary.basic and detail.basic:
                if not primary.basic.fund_share and detail.basic.fund_share:
                    primary.basic.fund_share = detail.basic.fund_share
            # 补充分红记录
            if not primary.dividends and detail.dividends:
                primary.dividends = detail.dividends
            # 补充规模
            if not primary.scale and detail.scale:
                primary.scale = detail.scale
            # 补充复权因子
            if not primary.adj_factors and detail.adj_factors:
                primary.adj_factors = detail.adj_factors
            # 补充基金公司
            if not primary.company and detail.company:
                primary.company = detail.company
            # 补充风险指标
            if not primary.risk and detail.risk:
                primary.risk = detail.risk
            # 补充业绩指标
            if not primary.performance and detail.performance:
                primary.performance = detail.performance
            return primary

        return get_fund_detail_with_fallback(code, available, detail_extractor, merger)

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

    def get_fund_performance(self, code: str) -> Optional[FundPerformance]:
        """获取融合后的阶段收益数据，优先使用Tushare本地计算"""
        available = self._get_available()
        for provider in available:
            # 优先使用Tushare的本地计算能力
            if provider.name == "tushare" and hasattr(provider, "get_fund_performance"):
                try:
                    perf = provider.get_fund_performance(code)
                    if perf:
                        return perf
                except Exception as e:
                    console_error(f"Tushare performance calc error: {e}")
            # 其他数据源的performance字段
            try:
                detail = provider.get_fund_detail(code)
                if detail and detail.performance:
                    return detail.performance
            except Exception:
                continue
        return None

    # ========== 新增融合接口 ==========

    def get_fund_dividends(self, code: str) -> List[FundDividend]:
        """获取融合后的分红记录"""
        available = self._get_available()
        for provider in available:
            if hasattr(provider, "get_fund_dividend"):
                try:
                    dividends = provider.get_fund_dividend(code)
                    if dividends:
                        return dividends
                except Exception as e:
                    console_error(f"Provider {provider.name} dividends error: {e}")
        # 从detail中提取
        detail = self.get_fund_detail(code)
        if detail and detail.dividends:
            return detail.dividends
        return []

    def get_fund_scale(self, code: str) -> Optional[FundScale]:
        """获取融合后的基金规模"""
        available = self._get_available()
        for provider in available:
            if hasattr(provider, "get_fund_scale"):
                try:
                    scale = provider.get_fund_scale(code)
                    if scale:
                        return scale
                except Exception as e:
                    console_error(f"Provider {provider.name} scale error: {e}")
        # 从detail中提取
        detail = self.get_fund_detail(code)
        if detail and detail.scale:
            return detail.scale
        return None

    def get_fund_adj_factors(self, code: str) -> List[AdjFactor]:
        """获取融合后的复权因子"""
        available = self._get_available()
        for provider in available:
            if hasattr(provider, "get_fund_adj"):
                try:
                    factors = provider.get_fund_adj(code)
                    if factors:
                        return factors
                except Exception as e:
                    console_error(f"Provider {provider.name} adj_factors error: {e}")
        # 从detail中提取
        detail = self.get_fund_detail(code)
        if detail and detail.adj_factors:
            return detail.adj_factors
        return []

    def get_fund_company(self, code: str) -> Optional[FundCompany]:
        """获取融合后的基金公司信息"""
        available = self._get_available()
        for provider in available:
            if hasattr(provider, "get_fund_company"):
                try:
                    company = provider.get_fund_company(code)
                    if company:
                        return company
                except Exception as e:
                    console_error(f"Provider {provider.name} company error: {e}")
        # 从detail中提取
        detail = self.get_fund_detail(code)
        if detail and detail.company:
            return detail.company
        return None

    def get_trade_cal(self, exchange: str = "SSE", start_date: str = "", end_date: str = "") -> List[TradeCal]:
        """获取交易日历（仅Tushare提供）"""
        available = self._get_available()
        for provider in available:
            if hasattr(provider, "get_trade_cal"):
                try:
                    cal = provider.get_trade_cal(exchange, start_date, end_date)
                    if cal:
                        return cal
                except Exception as e:
                    console_error(f"Provider {provider.name} trade_cal error: {e}")
        return []

    def get_index_daily(self, ts_code: str = "000001.SH", start_date: str = "", end_date: str = "") -> List[IndexDaily]:
        """获取指数日线行情（仅Tushare提供）"""
        available = self._get_available()
        for provider in available:
            if hasattr(provider, "get_index_daily"):
                try:
                    data = provider.get_index_daily(ts_code, start_date, end_date)
                    if data:
                        return data
                except Exception as e:
                    console_error(f"Provider {provider.name} index_daily error: {e}")
        return []

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