"""Tushare Pro 鏁版嵁閫傞厤鍣?""
import os
import time
from typing import Any

from ...utils import console_error
from .base import (
    AdjFactor,
    DataProvider,
    FundBasic,
    FundCompany,
    FundDetail,
    FundDividend,
    FundHolding,
    FundNav,
    FundPerformance,
    FundScale,
    IndexDaily,
    TradeCal,
)


class TushareProvider(DataProvider):
    """Tushare Pro 鏁版嵁婧愰€傞厤鍣?""

import logging


    name = "tushare"
    priority = 4  # 鏈€楂樹紭鍏堢骇

    def __init__(self):
        self._pro = None
        self._token = os.getenv("TUSHARE_TOKEN", "")

    def _get_pro(self):
        """鎳掑姞杞絧ro_api"""
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
        """瀹夊叏璋冪敤Tushare鎺ュ彛"""
        pro = self._get_pro()
        if pro is None:
            return None
        try:
            result = func(**kwargs)
            time.sleep(0.15)  # 棰戞鎺у埗
            return result
        except Exception as e:
            console_error(f"Tushare call error: {e}")
            return None

    def get_fund_list(self, market: str = "O", fetch_all: bool = False) -> list[FundBasic]:
        pro = self._get_pro()
        if pro is None:
            return []

        if not fetch_all:
            # 鍗曢〉妯″紡锛堝悜鍚庡吋瀹癸級
            df = self._safe_call(pro.fund_basic, market=market)
            if df is None or df.empty:
                return []
            result = []
            for _, row in df.iterrows():
                result.append(self._row_to_fund_basic(row))
            return result

        # 鍏ㄩ噺鍒嗛〉妯″紡
        all_rows = []
        offset = 0
        limit = 15000
        while True:
            df = self._safe_call(pro.fund_basic, market=market, offset=offset, limit=limit)
            if df is None or df.empty:
                break
            for _, row in df.iterrows():
                all_rows.append(self._row_to_fund_basic(row))
            if len(df) < limit:
                break
            offset += limit
        return all_rows

    def _row_to_fund_basic(self, row) -> FundBasic:
        return FundBasic(
            code=str(row.get("ts_code", "")).replace(".OF", "").replace(".SH", "").replace(".SZ", ""),
            name=row.get("name", ""),
            type=row.get("fund_type", ""),
            management=row.get("management", ""),
            custodian=row.get("custodian", ""),
            manager=row.get("manager", ""),
            found_date=str(row.get("found_date", "")),
            benchmark=row.get("benchmark", ""),
            status=row.get("status", ""),
        )

    def get_fund_detail(self, code: str) -> FundDetail | None:
        pro = self._get_pro()
        if pro is None:
            return None

        # 澶氬悗缂€鍥為€€锛?OF锛堝満澶栵級鈫?.SH锛堟勃甯?ETF/LOF锛夆啋 .SZ锛堟繁甯?ETF/LOF锛?        ts_code = f"{code}.OF"
        basic_df = None
        for candidate in self._fund_portfolio_codes(code):
            candidate_df = self._safe_call(pro.fund_basic, ts_code=candidate)
            if candidate_df is not None and not candidate_df.empty:
                basic_df = candidate_df
                ts_code = candidate
                break
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

        # 鍑€鍊?        nav_list = self.get_fund_nav(code)
        latest_nav = nav_list[-1] if nav_list else None

        # 鎸佷粨
        holdings = self.get_fund_holdings(code)

        # 鍩洪噾缁忕悊
        manager_info = self.get_fund_manager(code)

        # 浠介瑙勬ā
        share_df = self._safe_call(pro.fund_share, ts_code=ts_code)
        if share_df is not None and not share_df.empty and basic is not None:
            basic.fund_share = self._safe_float(share_df.iloc[0].get("fd_share"))

        # 鍩洪噾璇勭骇
        rating = None
        rating_df = self._safe_call(pro.fund_rating, ts_code=ts_code)
        if rating_df is not None and not rating_df.empty:
            rating = self._safe_float(rating_df.iloc[0].get("star_rating"))
            if rating is not None:
                rating = int(rating)

        # Tushare 澧炲己锛氬垎绾?瑙勬ā/澶嶆潈/鍏徃锛堜粯璐硅处鎴烽珮棰戝彲鐢級
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

    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> list[FundNav]:
        pro = self._get_pro()
        if pro is None:
            return []

        # 灏濊瘯澶氱鍚庣紑锛?OF锛堝満澶栭粯璁わ級鈫?.SH 鈫?.SZ锛岃В鍐抽儴鍒嗗熀閲戜唬鐮佷笉鍖归厤闂
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

        # 鎸夋棩鏈熷崌搴忔帓鍒楋紝渚夸簬璁＄畻鏃ュ闀跨巼
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

    def _fund_portfolio_codes(self, code: str) -> list[str]:
        raw = str(code or "").strip()
        codes = [f"{raw}.OF"]
        if raw.startswith(("5", "508")):
            codes.append(f"{raw}.SH")
        elif raw.startswith(("15", "16", "18")):
            codes.append(f"{raw}.SZ")
        return list(dict.fromkeys(codes))

    def get_fund_holdings(self, code: str) -> list[FundHolding]:
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

        # 鎻愬彇鎸佷粨鑲＄エ浠ｇ爜
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

        # 鎵归噺鏌ヨ鑲＄エ鍚嶇О锛堝甫鍏滃簳锛氭煡璇㈠け璐ユ椂淇濈暀symbol浣滀负鍚嶇О锛?        name_map = {}
        industry_map = {}
        if symbols:
            try:
                ts_codes = ",".join(symbols)
                stock_df = self._safe_call(pro.stock_basic, ts_code=ts_codes)
                if stock_df is not None and not stock_df.empty:
                    for _, row in stock_df.iterrows():
                        name_map[str(row.get("ts_code", ""))] = row.get("name", "")
                        ind = row.get("industry", "")
                        if ind:
                            industry_map[str(row.get("ts_code", ""))] = str(ind)
            except Exception as e:
                console_error(f"stock_basic batch query error: {e}")

        # 鍏滃簳锛氭煡璇㈠け璐ユ椂淇濈暀symbol浣滀负鏄剧ず鍚嶇О
        for symbol in symbols:
            if symbol not in name_map:
                name_map[symbol] = symbol

        result = []
        for symbol, ratio in holdings_raw:
            stock_name = name_map.get(symbol, symbol)
            stock_industry = industry_map.get(symbol, "")
            result.append(FundHolding(
                name=stock_name,
                code=symbol,
                ratio=ratio,
                industry=stock_industry,
                quarter=report_period,
                source=f"Tushare fund_portfolio:{used_ts_code}" if used_ts_code else "Tushare fund_portfolio",
                updated_at=report_period,
            ))
        return result

    def get_fund_performance(self, code: str) -> FundPerformance | None:
        """鍩轰簬鍑€鍊煎巻鍙叉湰鍦拌绠楅樁娈垫敹鐩?""
        nav_list = self.get_fund_nav(code)
        if not nav_list or len(nav_list) < 30:
            return None

        from datetime import datetime, timedelta

        def _find_nav(target_date: datetime) -> float | None:
            """鎵惧埌鏈€鎺ヨ繎target_date涓斾笉鏅氫簬瀹冪殑鍑€鍊?""
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

        def _calc(start_dt: datetime) -> float | None:
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

    def get_fund_manager(self, code: str) -> dict[str, Any]:
        """鑾峰彇鍩洪噾缁忕悊璇︾粏淇℃伅"""
        pro = self._get_pro()
        if pro is None:
            return {}
        df = self._safe_call(pro.fund_manager, ts_code=f"{code}.OF")
        if df is None or df.empty:
            return {}

        # 鍙栨渶鏂颁换鑱岀殑鍩洪噾缁忕悊
        df = df.sort_values(by="begin_date", ascending=False)
        row = df.iloc[0]
        return {
            "name": row.get("name", ""),
            "begin_date": str(row.get("begin_date", "")),
            "end_date": str(row.get("end_date", "")),
            "reward": self._safe_float(row.get("reward")),
        }

    # ========== Tushare 澧炲己鎺ュ彛锛堜粯璐硅处鎴烽珮棰戝彲鐢級 ==========

    def get_fund_dividend(self, code: str) -> list[FundDividend]:
        """鑾峰彇鍩洪噾鍒嗙孩璁板綍锛堟浛浠?efinance 缂哄け鐨勫垎绾㈡暟鎹級"""
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

    def get_fund_scale(self, code: str) -> FundScale | None:
        """鑾峰彇鍩洪噾鏈€鏂拌妯?鈥?fund_share 脳 unit_nav 绮剧‘璁＄畻锛堟浛浠?efinance 涓嶅彲闈犳帴鍙ｏ級"""
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
                total_nav = round(latest_nav * fd_share / 100000, 4)  # 涓囦唤脳鍑€鍊?100000=浜垮厓
        return FundScale(
            end_date=self._parse_date(str(row.get("trade_date", ""))),
            total_nav=total_nav,
            fd_share=fd_share,
        )

    def get_fund_adj(self, code: str) -> list[AdjFactor]:
        """鑾峰彇鍩洪噾澶嶆潈鍥犲瓙锛堢敤浜庣簿纭敹鐩婅绠楋級"""
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

    def get_fund_company(self, code: str) -> FundCompany | None:
        """????????????/??????"""
        pro = self._get_pro()
        if pro is None:
            return None
        # ??????.OF????? .SH??? ETF/LOF?? .SZ??? ETF/LOF?
        basic_df = None
        for candidate in self._fund_portfolio_codes(code):
            candidate_df = self._safe_call(pro.fund_basic, ts_code=candidate)
            if candidate_df is not None and not candidate_df.empty:
                basic_df = candidate_df
                break
        if basic_df is None or basic_df.empty:
            return None
        mgmt = basic_df.iloc[0].get("management", "")
        if not mgmt:
            return None

        # Get company name from fund_company API
        company_name = mgmt
        company_df = self._safe_call(pro.fund_company, name=mgmt)
        if company_df is not None and not company_df.empty:
            company_name = company_df.iloc[0].get("name", mgmt) or mgmt

        # Count funds managed by this company using fund_basic
        fund_count = None
        total_scale = None
        try:
            funds_df = self._safe_call(pro.fund_basic, management=mgmt)
            if funds_df is not None and not funds_df.empty:
                fund_count = len(funds_df)
        except Exception:
        logging.exception("Ignored non-fatal exception")

        return FundCompany(
            name=company_name,
            fund_count=fund_count,
            total_scale=total_scale,
        )

    def get_trade_cal(self, exchange: str = "SSE", start_date: str = "", end_date: str = "") -> list[TradeCal]:
        """鑾峰彇浜ゆ槗鏃ュ巻"""
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

    def get_index_daily(self, ts_code: str = "000001.SH", start_date: str = "", end_date: str = "") -> list[IndexDaily]:
        """鑾峰彇鎸囨暟鏃ョ嚎琛屾儏锛堟浛浠?akshare 甯傚満鎸囨暟鎺ュ彛锛?""
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

