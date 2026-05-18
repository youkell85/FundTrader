"""iFinD MCP 数据适配器 - MCP Server 版
支持两种调用方式：
1. MCP Server (api-mcp.51ifind.com) — 推荐，支持自然语言查询
2. REST API (quantapi.51ifind.com) — 备选，传统接口调用
"""
import os
import json
import urllib.request
from typing import Optional, List, Dict, Any
from .base import (
    DataProvider, FundBasic, FundNav, FundHolding, FundDetail,
    FundPerformance, FundRisk, FundDividend, FundScale, FundCompany,
)
from ...utils import console_error


class iFinDProvider(DataProvider):
    """iFinD MCP 金融数据适配器
    MCP Server 端点:
    - 股票: https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp
    - 基金: https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-fund-mcp
    - 宏观: https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-edb-mcp
    - 新闻: https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-news-mcp
    """

    name = "ifind"
    priority = 5  # 最高优先级（专业数据）

    # MCP Server 端点
    MCP_FUND_URL = "https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-fund-mcp"
    MCP_STOCK_URL = "https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp"
    # REST API 端点（备选）
    REST_BASE_URL = "https://quantapi.51ifind.com/api/v1"

    def __init__(self):
        self._token = os.getenv("IFIND_TOKEN", "")
        self._use_mcp = os.getenv("IFIND_USE_MCP", "true").lower() == "true"

    def is_available(self) -> bool:
        return bool(self._token)

    def _mcp_request(self, server_url: str, tool_name: str, query: str) -> Optional[Dict]:
        """通过 MCP Server 调用 iFinD 数据"""
        if not self._token:
            return None
        try:
            payload = json.dumps({
                "tool": tool_name,
                "query": query,
            }).encode("utf-8")
            req = urllib.request.Request(
                server_url,
                data=payload,
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                    "User-Agent": "FundTrader/1.0",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data
        except Exception as e:
            console_error(f"iFinD MCP request error ({tool_name}): {e}")
            return None

    def _rest_request(self, endpoint: str, params: dict = None) -> Optional[dict]:
        """通过 REST API 调用 iFinD 数据（备选）"""
        if not self._token:
            return None
        try:
            url = f"{self.REST_BASE_URL}/{endpoint}"
            if params:
                query = "&".join([f"{k}={v}" for k, v in params.items()])
                url = f"{url}?{query}"
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0",
                }
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data
        except Exception as e:
            console_error(f"iFinD REST request error: {e}")
            return None

    def _request(self, endpoint: str, params: dict = None) -> Optional[dict]:
        """统一请求入口"""
        if self._use_mcp:
            # MCP 模式：将 REST endpoint 映射到 MCP tool
            tool_map = {
                "fund/list": ("search_funds", params.get("market", "全部基金") if params else "全部基金"),
                "fund/detail": ("get_fund_profile", params.get("code", "") if params else ""),
                "fund/nav": ("get_fund_market_performance", params.get("code", "") if params else ""),
                "fund/holdings": ("get_fund_portfolio", params.get("code", "") if params else ""),
            }
            if endpoint in tool_map:
                tool_name, query = tool_map[endpoint]
                return self._mcp_request(self.MCP_FUND_URL, tool_name, query)
        # REST 模式
        return self._rest_request(endpoint, params)

    def get_fund_list(self, market: str = "O") -> List[FundBasic]:
        data = self._request("fund/list", {"market": market})
        if not data or "data" not in data:
            return []
        result = []
        for item in data.get("data", []):
            result.append(FundBasic(
                code=item.get("code", ""),
                name=item.get("name", ""),
                type=item.get("type", ""),
                management=item.get("management", ""),
                custodian=item.get("custodian", ""),
                manager=item.get("manager", ""),
                found_date=item.get("found_date", ""),
                benchmark=item.get("benchmark", ""),
                status=item.get("status", ""),
            ))
        return result

    def get_fund_detail(self, code: str) -> Optional[FundDetail]:
        data = self._request("fund/detail", {"code": code})
        if not data or "data" not in data:
            return None

        item = data["data"]
        perf = item.get("performance", {})
        risk = item.get("risk", {})

        # 解析分红记录
        dividends = []
        for div in item.get("dividends", []):
            dividends.append(FundDividend(
                ex_date=div.get("ex_date", ""),
                div_cash=self._safe_float(div.get("div_cash")) or 0,
                pay_date=div.get("pay_date", ""),
                record_date=div.get("record_date", ""),
            ))

        # 解析规模
        scale = None
        scale_data = item.get("scale", {})
        if scale_data:
            scale = FundScale(
                end_date=scale_data.get("end_date", ""),
                total_nav=self._safe_float(scale_data.get("total_nav")),
                fd_share=self._safe_float(scale_data.get("fd_share")),
            )

        # 解析基金公司
        company = None
        comp_data = item.get("company", {})
        if comp_data:
            company = FundCompany(
                name=comp_data.get("name", ""),
                manager_count=self._safe_float(comp_data.get("manager_count")),
                fund_count=self._safe_float(comp_data.get("fund_count")),
                total_scale=self._safe_float(comp_data.get("total_scale")),
            )

        return FundDetail(
            code=code,
            name=item.get("name", code),
            type=item.get("type", ""),
            nav=self._safe_float(item.get("nav")),
            nav_date=item.get("nav_date", ""),
            day_growth=self._safe_float(item.get("day_growth")),
            performance=FundPerformance(
                near_1m=self._safe_float(perf.get("near_1m")),
                near_3m=self._safe_float(perf.get("near_3m")),
                near_6m=self._safe_float(perf.get("near_6m")),
                near_1y=self._safe_float(perf.get("near_1y")),
                near_3y=self._safe_float(perf.get("near_3y")),
                ytd=self._safe_float(perf.get("ytd")),
            ),
            risk=FundRisk(
                volatility=self._safe_float(risk.get("volatility")),
                sharpe=self._safe_float(risk.get("sharpe")),
                max_drawdown=self._safe_float(risk.get("max_drawdown")),
                calmar=self._safe_float(risk.get("calmar")),
                sortino=self._safe_float(risk.get("sortino")),
            ),
            source=self.name,
            dividends=dividends,
            scale=scale,
            company=company,
        )

    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> List[FundNav]:
        params = {"code": code}
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        data = self._request("fund/nav", params)
        if not data or "data" not in data:
            return []

        result = []
        for item in data.get("data", []):
            result.append(FundNav(
                date=self._parse_date(item.get("date", "")),
                nav=self._safe_float(item.get("nav")),
                accum_nav=self._safe_float(item.get("accum_nav")),
                adj_nav=None,
                day_growth=self._safe_float(item.get("day_growth")),
            ))
        return result

    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        data = self._request("fund/holdings", {"code": code})
        if not data or "data" not in data:
            return []

        result = []
        for item in data.get("data", []):
            result.append(FundHolding(
                name=item.get("name", ""),
                code=item.get("code", ""),
                ratio=self._safe_float(item.get("ratio")) or 0,
                industry=item.get("industry", ""),
            ))
        return result

    # ========== MCP 专属方法 ==========

    def search_funds(self, query: str) -> List[Dict[str, Any]]:
        """MCP: 自然语言搜索基金"""
        result = self._mcp_request(self.MCP_FUND_URL, "search_funds", query)
        if not result:
            return []
        return result.get("data", [])

    def get_fund_profile(self, code: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金基本资料"""
        result = self._mcp_request(self.MCP_FUND_URL, "get_fund_profile", code)
        if not result:
            return None
        return result.get("data")

    def get_fund_market_performance(self, code: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金行情与业绩"""
        result = self._mcp_request(self.MCP_FUND_URL, "get_fund_market_performance", code)
        if not result:
            return None
        return result.get("data")

    def get_fund_ownership(self, code: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金份额与持有人结构"""
        result = self._mcp_request(self.MCP_FUND_URL, "get_fund_ownership", code)
        if not result:
            return None
        return result.get("data")

    def get_fund_financials(self, code: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金财务指标"""
        result = self._mcp_request(self.MCP_FUND_URL, "get_fund_financials", code)
        if not result:
            return None
        return result.get("data")

    def get_fund_company_info(self, company_name: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金公司信息"""
        result = self._mcp_request(self.MCP_FUND_URL, "get_fund_company_info", company_name)
        if not result:
            return None
        return result.get("data")

    def get_stock_summary(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取股票信息摘要"""
        result = self._mcp_request(self.MCP_STOCK_URL, "get_stock_summary", query)
        if not result:
            return None
        return result.get("data")

    def get_macro_data(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取宏观经济数据"""
        edb_url = "https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-edb-mcp"
        result = self._mcp_request(edb_url, "get_macro_data", query)
        if not result:
            return None
        return result.get("data")

    def get_company_news(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取公司新闻/公告"""
        news_url = "https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-news-mcp"
        result = self._mcp_request(news_url, "get_company_news", query)
        if not result:
            return None
        return result.get("data")
