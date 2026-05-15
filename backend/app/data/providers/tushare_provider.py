"""Tushare Pro 数据适配器"""
import os
import time
from typing import Optional, List, Dict, Any
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

        # 基金经理
        manager_info = self.get_fund_manager(code)

        # 份额规模
        share_df = self._safe_call(pro.fund_share, ts_code=ts_code)
        if share_df is not None and not share_df.empty and basic is not None:
            basic.fund_share = self._safe_float(share_df.iloc[0].get("fd_share"))

        # 基金评级
        rating = None
        rating_df = self._safe_call(pro.fund_rating, ts_code=ts_code)
        if rating_df is not None and not rating_df.empty:
            rating = self._safe_float(rating_df.iloc[0].get("star_rating"))
            if rating is not None:
                rating = int(rating)

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
            manager_info=manager_info,
            rating=rating,
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

        # 按日期升序排列，便于计算日增长率
        df = df.sort_values(by="nav_date", ascending=True)

        result = []
        prev_nav = None
        for _, row in df.iterrows():
            nav = self._safe_float(row.get("unit_nav"))
            day_growth = None
            if prev_nav is not None and prev_nav > 0 and nav is not None:
                day_growth = round((nav - prev_nav) / prev_nav * 100, 4)
            result.append(FundNav(
                date=self._parse_date(str(row.get("nav_date", ""))),
                nav=nav,
                accum_nav=self._safe_float(row.get("accum_nav")),
                adj_nav=self._safe_float(row.get("adj_nav")),
                day_growth=day_growth,
            ))
            if nav is not None:
                prev_nav = nav
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
            # 优先使用 name 字段，回退到 symbol
            stock_name = row.get("name", "") or row.get("symbol", "")
            stock_code = str(row.get("symbol", ""))
            result.append(FundHolding(
                name=stock_name,
                code=stock_code,
                ratio=self._safe_float(ratio) or 0,
            ))
        return result

    def get_fund_performance(self, code: str) -> Optional[FundPerformance]:
        """基于净值历史本地计算阶段收益"""
        nav_list = self.get_fund_nav(code)
        if not nav_list or len(nav_list) < 30:
            return None

        from datetime import datetime, timedelta

        def _find_nav(target_date: datetime) -> Optional[float]:
            """找到最接近target_date且不晚于它的净值"""
            best = None
            best_diff = None
            for nav in nav_list:
                try:
                    nav_dt = datetime.strptime(nav.date, "%Y-%m-%d")
                except Exception:
                    continue
                if nav_dt > target_date:
                    continue
                diff = (target_date - nav_dt).days
                if best_diff is None or diff < best_diff:
                    best_diff = diff
                    best = nav.nav
            return best

        latest = nav_list[-1].nav if nav_list[-1].nav else None
        if latest is None or latest == 0:
            return None

        today = datetime.now()

        def _calc(start_dt: datetime) -> Optional[float]:
            start_nav = _find_nav(start_dt)
            if start_nav and start_nav > 0:
                return round((latest - start_nav) / start_nav * 100, 2)
            return None

        perf = FundPerformance()
        perf.near_1m = _calc(today - timedelta(days=30))
        perf.near_3m = _calc(today - timedelta(days=90))
        perf.near_6m = _calc(today - timedelta(days=180))
        perf.near_1y = _calc(today - timedelta(days=365))
        perf.near_3y = _calc(today - timedelta(days=365 * 3))
        perf.ytd = _calc(datetime(today.year, 1, 1))
        return perf

    def get_fund_manager(self, code: str) -> Dict[str, Any]:
        """获取基金经理详细信息"""
        pro = self._get_pro()
        if pro is None:
            return {}
        df = self._safe_call(pro.fund_manager, ts_code=f"{code}.OF")
        if df is None or df.empty:
            return {}

        # 取最新任职的基金经理
        df = df.sort_values(by="begin_date", ascending=False)
        row = df.iloc[0]
        return {
            "name": row.get("name", ""),
            "begin_date": str(row.get("begin_date", "")),
            "end_date": str(row.get("end_date", "")),
            "reward": self._safe_float(row.get("reward")),
        }