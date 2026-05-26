"""Tushare Pro 数据适配器"""
import os
import time
from typing import Optional, List, Dict, Any
from .base import (
    DataProvider, FundBasic, FundNav, FundHolding, FundDetail,
    FundPerformance, FundRisk, FundDividend, FundScale, AdjFactor,
    FundCompany, TradeCal, IndexDaily,
)
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

        # Tushare 增强：分红/规模/复权/公司（付费账户高频可用）
        dividends = self.get_fund_dividend(code)
        scale = self.get_fund_scale(code)
        adj_factors = self.get_fund_adj(code)
        company = self.get_fund_company(code)

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
            dividends=dividends,
            scale=scale,
            adj_factors=adj_factors[-120:],
            company=company,
        )

    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> List[FundNav]:
        pro = self._get_pro()
        if pro is None:
            return []

        # 尝试多种后缀：.OF（场外默认）→ .SH → .SZ，解决部分基金代码不匹配问题
        suffixes = [".OF"]
        if code.startswith(("5", "508")):
            suffixes.insert(0, ".SH")
        elif code.startswith(("15", "16", "18")):
            suffixes.insert(0, ".SZ")
        else:
            suffixes.extend([".SH", ".SZ"])

        df = None
        for suffix in suffixes:
            kwargs = {"ts_code": f"{code}{suffix}"}
            if start_date:
                kwargs["start_date"] = start_date
            if end_date:
                kwargs["end_date"] = end_date
            df = self._safe_call(pro.fund_nav, **kwargs)
            if df is not None and not df.empty:
                break
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

    def _fund_portfolio_codes(self, code: str) -> List[str]:
        raw = str(code or "").strip()
        codes = [f"{raw}.OF"]
        if raw.startswith(("5", "508")):
            codes.append(f"{raw}.SH")
        elif raw.startswith(("15", "16", "18")):
            codes.append(f"{raw}.SZ")
        return list(dict.fromkeys(codes))

    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        pro = self._get_pro()
        if pro is None:
            return []
        df = None
        used_ts_code = ""
        for ts_code in self._fund_portfolio_codes(code):
            df = self._safe_call(pro.fund_portfolio, ts_code=ts_code)
            if df is not None and not df.empty:
                used_ts_code = ts_code
                break
        if df is None or df.empty:
            return []

        report_col = "end_date" if "end_date" in df.columns else "ann_date" if "ann_date" in df.columns else ""
        report_period = ""
        if report_col:
            try:
                df = df.sort_values(by=report_col, ascending=False)
                report_period = str(df.iloc[0].get(report_col, "") or "")
                if report_period:
                    df = df[df[report_col].astype(str) == report_period]
            except Exception:
                report_period = ""

        # 提取持仓股票代码
        holdings_raw = []
        symbols = []
        for _, row in df.head(10).iterrows():
            ratio = row.get("stk_mkv_ratio", 0)
            if isinstance(ratio, str):
                ratio = ratio.replace("%", "").strip()
            symbol = str(row.get("symbol", ""))
            holdings_raw.append((symbol, self._safe_float(ratio) or 0))
            if symbol:
                symbols.append(symbol)

        # 批量查询股票名称（带兜底：查询失败时保留symbol作为名称）
        name_map = {}
        if symbols:
            try:
                ts_codes = ",".join(symbols)
                stock_df = self._safe_call(pro.stock_basic, ts_code=ts_codes)
                if stock_df is not None and not stock_df.empty:
                    for _, row in stock_df.iterrows():
                        name_map[str(row.get("ts_code", ""))] = row.get("name", "")
            except Exception as e:
                console_error(f"stock_basic batch query error: {e}")

        # 兜底：查询失败时保留symbol作为显示名称
        for symbol in symbols:
            if symbol not in name_map:
                name_map[symbol] = symbol

        result = []
        for symbol, ratio in holdings_raw:
            stock_name = name_map.get(symbol, symbol)
            result.append(FundHolding(
                name=stock_name,
                code=symbol,
                ratio=ratio,
                quarter=report_period,
                source=f"Tushare fund_portfolio:{used_ts_code}" if used_ts_code else "Tushare fund_portfolio",
                updated_at=report_period,
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

    # ========== Tushare 增强接口（付费账户高频可用） ==========

    def get_fund_dividend(self, code: str) -> List[FundDividend]:
        """获取基金分红记录（替代 efinance 缺失的分红数据）"""
        pro = self._get_pro()
        if pro is None:
            return []
        df = self._safe_call(pro.fund_div, ts_code=f"{code}.OF")
        if df is None or df.empty:
            return []
        result = []
        for _, row in df.head(20).iterrows():
            result.append(FundDividend(
                ex_date=self._parse_date(str(row.get("ex_date", ""))),
                div_cash=self._safe_float(row.get("div_cash")) or 0,
                pay_date=self._parse_date(str(row.get("pay_date", ""))),
                record_date=self._parse_date(str(row.get("record_date", ""))),
                ann_date=self._parse_date(str(row.get("ann_date", ""))),
                imp_anndate=self._parse_date(str(row.get("imp_anndate", ""))),
                base_date=self._parse_date(str(row.get("base_date", ""))),
            ))
        return result

    def get_fund_scale(self, code: str) -> Optional[FundScale]:
        """获取基金最新规模 — fund_share × unit_nav 精确计算（替代 efinance 不可靠接口）"""
        pro = self._get_pro()
        if pro is None:
            return None
        ts_code = f"{code}.OF"
        share_df = self._safe_call(pro.fund_share, ts_code=ts_code)
        if share_df is None or share_df.empty:
            return None
        share_df = share_df.sort_values(by="trade_date", ascending=False)
        row = share_df.iloc[0]
        fd_share = self._safe_float(row.get("fd_share"))
        total_nav = None
        nav_df = self._safe_call(pro.fund_nav, ts_code=ts_code, end_date=str(row.get("trade_date", "")))
        if nav_df is not None and not nav_df.empty:
            nav_df = nav_df.sort_values(by="nav_date", ascending=False)
            latest_nav = self._safe_float(nav_df.iloc[0].get("unit_nav"))
            if latest_nav and fd_share:
                total_nav = round(latest_nav * fd_share / 100000, 4)  # 万份×净值/100000=亿元
        return FundScale(
            end_date=self._parse_date(str(row.get("trade_date", ""))),
            total_nav=total_nav,
            fd_share=fd_share,
        )

    def get_fund_adj(self, code: str) -> List[AdjFactor]:
        """获取基金复权因子（用于精确收益计算）"""
        pro = self._get_pro()
        if pro is None:
            return []
        df = self._safe_call(pro.fund_adj, ts_code=f"{code}.OF")
        if df is None or df.empty:
            return []
        result = []
        for _, row in df.iterrows():
            result.append(AdjFactor(
                date=self._parse_date(str(row.get("trade_date", row.get("end_date", "")))),
                adj_factor=self._safe_float(row.get("adj_factor")) or 1.0,
            ))
        return result

    def get_fund_company(self, code: str) -> Optional[FundCompany]:
        """获取基金公司信息（经理人数/基金数/管理总规模）"""
        pro = self._get_pro()
        if pro is None:
            return None
        basic_df = self._safe_call(pro.fund_basic, ts_code=f"{code}.OF")
        if basic_df is None or basic_df.empty:
            return None
        mgmt = basic_df.iloc[0].get("management", "")
        if not mgmt:
            return None
        company_df = self._safe_call(pro.fund_company, name=mgmt)
        if company_df is None or company_df.empty:
            return FundCompany(name=mgmt)
        row = company_df.iloc[0]
        return FundCompany(
            name=row.get("name", mgmt),
            manager_count=self._safe_float(row.get("manager_count")),
            fund_count=self._safe_float(row.get("fund_count")),
            total_scale=self._safe_float(row.get("total_scale")),
        )

    def get_trade_cal(self, exchange: str = "SSE", start_date: str = "", end_date: str = "") -> List[TradeCal]:
        """获取交易日历"""
        pro = self._get_pro()
        if pro is None:
            return []
        kwargs = {"exchange": exchange}
        if start_date:
            kwargs["start_date"] = start_date.replace("-", "")
        if end_date:
            kwargs["end_date"] = end_date.replace("-", "")
        df = self._safe_call(pro.trade_cal, **kwargs)
        if df is None or df.empty:
            return []
        result = []
        for _, row in df.iterrows():
            result.append(TradeCal(
                cal_date=self._parse_date(str(row.get("cal_date", ""))),
                is_open=str(row.get("is_open", "")),
            ))
        return result

    def get_index_daily(self, ts_code: str = "000001.SH", start_date: str = "", end_date: str = "") -> List[IndexDaily]:
        """获取指数日线行情（替代 akshare 市场指数接口）"""
        pro = self._get_pro()
        if pro is None:
            return []
        kwargs = {"ts_code": ts_code}
        if start_date:
            kwargs["start_date"] = start_date.replace("-", "")
        if end_date:
            kwargs["end_date"] = end_date.replace("-", "")
        df = self._safe_call(pro.index_daily, **kwargs)
        if df is None or df.empty:
            return []
        df = df.sort_values(by="trade_date", ascending=True)
        result = []
        for _, row in df.iterrows():
            result.append(IndexDaily(
                date=self._parse_date(str(row.get("trade_date", ""))),
                close=self._safe_float(row.get("close")),
                open=self._safe_float(row.get("open")),
                high=self._safe_float(row.get("high")),
                low=self._safe_float(row.get("low")),
                pre_close=self._safe_float(row.get("pre_close")),
                change=self._safe_float(row.get("change")),
                pct_chg=self._safe_float(row.get("pct_chg")),
                vol=self._safe_float(row.get("vol")),
                amount=self._safe_float(row.get("amount")),
            ))
        return result
