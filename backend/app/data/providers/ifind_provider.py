"""iFinD MCP 数据适配器 - 基于 MCP SSE 协议

iFinD MCP 提供 4 个独立服务器：
- 股票: hexin-ifind-ds-stock-mcp (9个工具)
- 基金: hexin-ifind-ds-fund-mcp (7个工具)
- 宏观: hexin-ifind-ds-edb-mcp (1个工具)
- 新闻: hexin-ifind-ds-news-mcp (1个工具)

调用方式：通过 MCP SSE 协议连接，使用 mcporter CLI 或直接 HTTP POST
"""
import os
import json
import subprocess
import urllib.request
from typing import Optional, List, Dict, Any
from .base import (
    DataProvider, FundBasic, FundNav, FundHolding, FundDetail,
    FundPerformance, FundRisk, FundDividend, FundScale, FundCompany,
)
from ...utils import console_error


class iFinDProvider(DataProvider):
    """iFinD MCP 金融数据适配器

    支持两种调用方式：
    1. MCP SSE 协议 (api-mcp.51ifind.com:8643) — 推荐，通过 HTTP POST 调用
    2. mcporter CLI — 备选，通过命令行调用
    """

    name = "ifind"
    priority = 5  # 最高优先级（专业数据）

    # MCP Server 端点
    MCP_BASE = "https://api-mcp.51ifind.com:8643/ds-mcp-servers"
    MCP_FUND_URL = f"{MCP_BASE}/hexin-ifind-ds-fund-mcp"
    MCP_STOCK_URL = f"{MCP_BASE}/hexin-ifind-ds-stock-mcp"
    MCP_EDB_URL = f"{MCP_BASE}/hexin-ifind-ds-edb-mcp"
    MCP_NEWS_URL = f"{MCP_BASE}/hexin-ifind-ds-news-mcp"

    def __init__(self):
        self._token = os.getenv("IFIND_TOKEN", "")
        self._use_mcp = os.getenv("IFIND_USE_MCP", "true").lower() == "true"
        self._mcporter_config = os.path.expanduser("~/.openclaw/mcporter.json")

    def is_available(self) -> bool:
        return bool(self._token)

    def _mcp_http_request(self, server_url: str, tool_name: str, query: str) -> Optional[Dict]:
        """通过 HTTP POST 调用 iFinD MCP Server (SSE 协议)

        MCP 协议使用 JSON-RPC 2.0 格式：
        - 先 initialize 握手
        - 再调用 tools/call
        """
        if not self._token:
            return None
        try:
            # MCP tools/call 请求
            payload = json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": {
                        "query": query
                    }
                }
            }).encode("utf-8")

            req = urllib.request.Request(
                server_url,
                data=payload,
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "User-Agent": "FundTrader/1.0",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                content_type = resp.headers.get("Content-Type", "")
                raw = resp.read().decode("utf-8")

                # 处理 SSE 响应
                if "text/event-stream" in content_type:
                    return self._parse_sse_response(raw)
                # 处理 JSON 响应
                elif "application/json" in content_type:
                    data = json.loads(raw)
                    if "result" in data:
                        content = data["result"].get("content", [])
                        return self._parse_mcp_content(content)
                    return data
                else:
                    # 尝试解析为 JSON
                    try:
                        return json.loads(raw)
                    except Exception:
                        return {"raw": raw}

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")[:500]
            console_error(f"iFinD MCP HTTP error {e.code}: {error_body}")
            return None
        except Exception as e:
            console_error(f"iFinD MCP request error ({tool_name}): {e}")
            return None

    def _parse_sse_response(self, raw: str) -> Optional[Dict]:
        """解析 SSE 格式的 MCP 响应"""
        try:
            for line in raw.split("\n"):
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str:
                        data = json.loads(data_str)
                        if "result" in data:
                            content = data["result"].get("content", [])
                            return self._parse_mcp_content(content)
            return {"raw": raw[:1000]}
        except Exception as e:
            console_error(f"iFinD SSE parse error: {e}")
            return None

    def _parse_mcp_content(self, content: list) -> Optional[Dict]:
        """解析 MCP content 数组"""
        if not content:
            return None
        # MCP content 通常是 [{type: "text", text: "..."}]
        texts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                texts.append(item.get("text", ""))
        if texts:
            full_text = "\n".join(texts)
            # 尝试解析为 JSON
            try:
                return json.loads(full_text)
            except Exception:
                return {"data": full_text}
        return None

    def _mcporter_call(self, server_name: str, tool_name: str, query: str) -> Optional[Dict]:
        """通过 mcporter CLI 调用 iFinD MCP (备选方案)"""
        try:
            cmd = [
                "mcporter", "--config", self._mcporter_config,
                "call", f"{server_name}.{tool_name}",
                f"query:{query}"
            ]
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30,
                encoding="utf-8", errors="replace"
            )
            if result.returncode == 0 and result.stdout.strip():
                try:
                    return json.loads(result.stdout.strip())
                except Exception:
                    return {"data": result.stdout.strip()}
            else:
                console_error(f"mcporter error: {result.stderr[:200]}")
                return None
        except FileNotFoundError:
            console_error("mcporter not installed, run: npm install -g mcporter")
            return None
        except Exception as e:
            console_error(f"mcporter call error: {e}")
            return None

    def _request(self, server_url: str, server_name: str, tool_name: str, query: str) -> Optional[Dict]:
        """统一请求入口：先尝试 HTTP，失败则回退 mcporter"""
        # 方式1: HTTP POST (MCP SSE 协议)
        result = self._mcp_http_request(server_url, tool_name, query)
        if result is not None:
            return result

        # 方式2: mcporter CLI
        if os.path.exists(self._mcporter_config):
            result = self._mcporter_call(server_name, tool_name, query)
            if result is not None:
                return result

        return None

    # ========== 基金数据接口 ==========

    def get_fund_list(self, market: str = "O") -> List[FundBasic]:
        """搜索基金列表"""
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "search_funds", "全部基金")
        if not result:
            return []
        items = result.get("data", []) if isinstance(result.get("data"), list) else []
        if not items and isinstance(result, list):
            items = result
        funds = []
        for item in items:
            if isinstance(item, dict):
                funds.append(FundBasic(
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
        return funds

    def get_fund_detail(self, code: str) -> Optional[FundDetail]:
        """获取基金详情"""
        # 先获取基本资料
        profile = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_profile", code)
        if not profile:
            return None

        item = profile.get("data", profile) if isinstance(profile, dict) else {}

        # 获取行情与业绩
        perf_data = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_market_performance", code)
        perf_item = {}
        if perf_data:
            perf_item = perf_data.get("data", perf_data) if isinstance(perf_data, dict) else {}

        # 合并数据
        merged = {**item, **perf_item}

        perf = merged.get("performance", {})
        risk = merged.get("risk", {})

        # 解析分红记录
        dividends = []
        for div in merged.get("dividends", []):
            dividends.append(FundDividend(
                ex_date=div.get("ex_date", ""),
                div_cash=self._safe_float(div.get("div_cash")) or 0,
                pay_date=div.get("pay_date", ""),
                record_date=div.get("record_date", ""),
            ))

        # 解析规模
        scale = None
        scale_data = merged.get("scale", {})
        if scale_data:
            scale = FundScale(
                end_date=scale_data.get("end_date", ""),
                total_nav=self._safe_float(scale_data.get("total_nav")),
                fd_share=self._safe_float(scale_data.get("fd_share")),
            )

        # 解析基金公司
        company = None
        comp_data = merged.get("company", {})
        if comp_data:
            company = FundCompany(
                name=comp_data.get("name", ""),
                manager_count=self._safe_float(comp_data.get("manager_count")),
                fund_count=self._safe_float(comp_data.get("fund_count")),
                total_scale=self._safe_float(comp_data.get("total_scale")),
            )

        return FundDetail(
            code=code,
            name=merged.get("name", code),
            type=merged.get("type", ""),
            nav=self._safe_float(merged.get("nav")),
            nav_date=merged.get("nav_date", ""),
            day_growth=self._safe_float(merged.get("day_growth")),
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
        """获取基金净值"""
        query = code
        if start_date:
            query += f" {start_date}至{end_date}" if end_date else f" {start_date}以来"
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_market_performance", query)
        if not result:
            return []

        items = result.get("data", []) if isinstance(result.get("data"), list) else []
        navs = []
        for item in items:
            if isinstance(item, dict):
                navs.append(FundNav(
                    date=self._parse_date(item.get("date", "")),
                    nav=self._safe_float(item.get("nav")),
                    accum_nav=self._safe_float(item.get("accum_nav")),
                    adj_nav=None,
                    day_growth=self._safe_float(item.get("day_growth")),
                ))
        return navs

    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        """获取基金持仓"""
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_portfolio", code)
        if not result:
            return []

        items = result.get("data", []) if isinstance(result.get("data"), list) else []
        holdings = []
        for item in items:
            if isinstance(item, dict):
                holdings.append(FundHolding(
                    name=item.get("name", ""),
                    code=item.get("code", ""),
                    ratio=self._safe_float(item.get("ratio")) or 0,
                    industry=item.get("industry", ""),
                ))
        return holdings

    # ========== MCP 专属方法 ==========

    def search_funds(self, query: str) -> List[Dict[str, Any]]:
        """MCP: 自然语言搜索基金"""
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "search_funds", query)
        if not result:
            return []
        data = result.get("data", [])
        return data if isinstance(data, list) else []

    def get_fund_profile(self, code: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金基本资料"""
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_profile", code)
        if not result:
            return None
        return result.get("data", result)

    def get_fund_market_performance(self, code: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金行情与业绩"""
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_market_performance", code)
        if not result:
            return None
        return result.get("data", result)

    def get_fund_ownership(self, code: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金份额与持有人结构"""
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_ownership", code)
        if not result:
            return None
        return result.get("data", result)

    def get_fund_portfolio(self, code: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金投资标的与资产配置"""
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_portfolio", code)
        if not result:
            return None
        return result.get("data", result)

    def get_fund_financials(self, code: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金财务指标"""
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_financials", code)
        if not result:
            return None
        return result.get("data", result)

    def get_fund_company_info(self, company_name: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取基金公司信息"""
        result = self._request(self.MCP_FUND_URL, "hexin-ifind-fund", "get_fund_company_info", company_name)
        if not result:
            return None
        return result.get("data", result)

    # ========== 股票数据接口 ==========

    def get_stock_summary(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取股票信息摘要"""
        result = self._request(self.MCP_STOCK_URL, "hexin-ifind-stock", "get_stock_summary", query)
        if not result:
            return None
        return result.get("data", result)

    def search_stocks(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 智能选股"""
        result = self._request(self.MCP_STOCK_URL, "hexin-ifind-stock", "search_stocks", query)
        if not result:
            return None
        return result.get("data", result)

    def get_stock_performance(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取股票历史行情与技术指标"""
        result = self._request(self.MCP_STOCK_URL, "hexin-ifind-stock", "get_stock_perfomance", query)
        if not result:
            return None
        return result.get("data", result)

    def get_stock_info(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取股票基本资料"""
        result = self._request(self.MCP_STOCK_URL, "hexin-ifind-stock", "get_stock_info", query)
        if not result:
            return None
        return result.get("data", result)

    def get_stock_shareholders(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取股本结构与股东数据"""
        result = self._request(self.MCP_STOCK_URL, "hexin-ifind-stock", "get_stock_shareholders", query)
        if not result:
            return None
        return result.get("data", result)

    def get_stock_financials(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取股票财务数据与指标"""
        result = self._request(self.MCP_STOCK_URL, "hexin-ifind-stock", "get_stock_financials", query)
        if not result:
            return None
        return result.get("data", result)

    def get_risk_indicators(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取风险指标"""
        result = self._request(self.MCP_STOCK_URL, "hexin-ifind-stock", "get_risk_indicators", query)
        if not result:
            return None
        return result.get("data", result)

    def get_stock_events(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取公开披露事件"""
        result = self._request(self.MCP_STOCK_URL, "hexin-ifind-stock", "get_stock_events", query)
        if not result:
            return None
        return result.get("data", result)

    def get_esg_data(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取ESG评级"""
        result = self._request(self.MCP_STOCK_URL, "hexin-ifind-stock", "get_esg_data", query)
        if not result:
            return None
        return result.get("data", result)

    # ========== 宏观/新闻接口 ==========

    def get_macro_data(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取宏观经济数据"""
        result = self._request(self.MCP_EDB_URL, "hexin-ifind-edb", "get_macro_data", query)
        if not result:
            return None
        return result.get("data", result)

    def get_company_news(self, query: str) -> Optional[Dict[str, Any]]:
        """MCP: 获取公司公告与新闻资讯"""
        result = self._request(self.MCP_NEWS_URL, "hexin-ifind-news", "get_company_news", query)
        if not result:
            return None
        return result.get("data", result)
