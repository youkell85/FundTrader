"""iFinD MCP 数据适配器"""
import os
import json
import urllib.request
from typing import Optional, List
from .base import DataProvider, FundBasic, FundNav, FundHolding, FundDetail, FundPerformance
from ...utils import console_error


class iFinDProvider(DataProvider):
    """iFinD MCP 金融数据适配器
    需要 iFinD 账号和 API Token
    接口地址: https://quantapi.51ifind.com/
    """

    name = "ifind"
    priority = 5  # 最高优先级（专业数据）

    def __init__(self):
        self._token = os.getenv("IFIND_TOKEN", "")
        self._base_url = "https://quantapi.51ifind.com/api/v1"

    def is_available(self) -> bool:
        return bool(self._token)

    def _request(self, endpoint: str, params: dict = None) -> Optional[dict]:
        """发送API请求"""
        if not self._token:
            return None
        try:
            url = f"{self._base_url}/{endpoint}"
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
            console_error(f"iFinD request error: {e}")
            return None

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