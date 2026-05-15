"""Tushare Pro 数据适配器"""
import os
import time
from typing import Optional, List
from .base import DataProvider, FundBasic, FundNav, FundHolding, FundDetail, FundPerformance, FundRisk
from ...utils import console_error


class TushareProvider(DataProvider):
    """Tushare Pro 数据源适配器"""

    name = "tushare"
    priority = 4  # 最高优先级

    def __init__(self):
        self._pro = None
        self._token = os.getenv("TUSHARE_TOKEN", "")

    def _get_pro(self):
        """懒加载pro_api"""
        if self._pro is None:
            try:
                import tushare as ts
                if not self._token:
                    token_path = os.path.expanduser("~/.tushare_token")
                    if os.path.exists(token_path):
                        with open(token_path) as f:
                            self._token = f.read().strip()
                if not self._token:
                    return None
                self._pro = ts.pro_api(self._token)
            except ImportError:
                console_error("tushare not installed")
                return None
        return self._pro

    def is_available(self) -> bool:
        return self._get_pro() is not None

    def _safe_call(self, func, **kwargs):
        """安全调用Tushare接口"""
        pro = self._get_pro()
        if pro is None:
            return None
        try:
            result = func(**kwargs)
            time.sleep(0.15)  # 频次控制
            return result
        except Exception as e:
            console_error(f"Tushare call error: {e}")
            return None

    def get_fund_list(self, market: str = "O") -> List[FundBasic]:
        pro = self._get_pro()
        if pro is None:
            return []
        df = self._safe_call(pro.fund_basic, market=market)
        if df is None or df.empty:
            return []
        result = []
        for _, row in df.iterrows():
            result.append(FundBasic(
                code=str(row.get("ts_code", "")).replace(".OF", "").replace(".SH", "").replace(".SZ", ""),
                name=row.get("name", ""),
                type=row.get("fund_type", ""),
                management=row.get("management", ""),
                custodian=row.get("custodian", ""),
                manager=row.get("manager", ""),
                found_date=str(row.get("found_date", "")),
                benchmark=row.get("benchmark", ""),
                status=row.get("status", ""),
            ))
        return result

    def get_fund_detail(self, code: str) -> Optional[FundDetail]:
        pro = self._get_pro()
        if pro is None:
            return None

        ts_code = f"{code}.OF"
        # 基本信息
        basic_df = self._safe_call(pro.fund_basic, ts_code=ts_code)
        basic = None
        if basic_df is not None and not basic_df.empty:
            row = basic_df.iloc[0]
            basic = FundBasic(
                code=code,
                name=row.get("name", ""),
                type=row.get("fund_type", ""),
                management=row.get("management", ""),
                custodian=row.get("custodian", ""),
                manager=row.get("manager", ""),
                found_date=str(row.get("found_date", "")),
                benchmark=row.get("benchmark", ""),
                status=row.get("status", ""),
            )

        # 净值
        nav_list = self.get_fund_nav(code)
        latest_nav = nav_list[-1] if nav_list else None

        # 持仓
        holdings = self.get_fund_holdings(code)

        return FundDetail(
            code=code,
            name=basic.name if basic else code,
            type=basic.type if basic else "",
            nav=latest_nav.nav if latest_nav else None,
            nav_date=latest_nav.date if latest_nav else "",
            day_growth=latest_nav.day_growth if latest_nav else None,
            basic=basic,
            holdings=holdings,
            nav_history=nav_list[-120:],
            source=self.name,
        )

    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> List[FundNav]:
        pro = self._get_pro()
        if pro is None:
            return []
        kwargs = {"ts_code": f"{code}.OF"}
        if start_date:
            kwargs["start_date"] = start_date
        if end_date:
            kwargs["end_date"] = end_date
        df = self._safe_call(pro.fund_nav, **kwargs)
        if df is None or df.empty:
            return []

        result = []
        for _, row in df.iterrows():
            result.append(FundNav(
                date=self._parse_date(str(row.get("nav_date", ""))),
                nav=self._safe_float(row.get("unit_nav")),
                accum_nav=self._safe_float(row.get("accum_nav")),
                adj_nav=self._safe_float(row.get("adj_nav")),
                day_growth=None,  # Tushare fund_nav 不含日涨跌幅
            ))
        return result

    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        pro = self._get_pro()
        if pro is None:
            return []
        df = self._safe_call(pro.fund_portfolio, ts_code=f"{code}.OF")
        if df is None or df.empty:
            return []

        result = []
        for _, row in df.head(10).iterrows():
            ratio = row.get("stk_mkv_ratio", 0)
            if isinstance(ratio, str):
                ratio = ratio.replace("%", "").strip()
            result.append(FundHolding(
                name=row.get("symbol", ""),
                code=str(row.get("symbol", "")),
                ratio=self._safe_float(ratio) or 0,
            ))
        return result