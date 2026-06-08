"""深度产品分析服务 - 多数据源融合版"""
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from ..data.akshare_fetcher import get_fund_info, get_fund_manager_info, get_fund_portfolio, get_fund_bond_portfolio
from ..data.efinance_fetcher import get_fund_nav_history
from ..data.providers.fusion import get_fusion
from ..data.providers.tushare_provider import TushareProvider
from ..data.cache_manager import cache
from ..config import CACHE_TTL_NAV, CACHE_TTL_INFO


def _enrich_holdings_with_daily_change(holdings: List[Dict]) -> List[Dict]:
    if not holdings:
        return holdings
    try:
        from ..data.akshare_fetcher import get_stock_daily_changes
        from ..data.akshare_fetcher import _normalize_stock_code
        changes = get_stock_daily_changes([item.get("code", "") for item in holdings])
        if not changes:
            return [{**item, "quote_code": _normalize_stock_code(item.get("code", ""))} for item in holdings]
        enriched = []
        normalized_changes = {_normalize_stock_code(code): value for code, value in changes.items()}
        for item in holdings:
            next_item = dict(item)
            code = next_item.get("code", "")
            if code in changes:
                next_item["daily_change"] = changes[code]
            else:
                normalized = _normalize_stock_code(code)
                if normalized in normalized_changes:
                    next_item["daily_change"] = normalized_changes[normalized]
            next_item["quote_code"] = _normalize_stock_code(code)
            enriched.append(next_item)
        return enriched
    except Exception:
        return holdings


def _normalize_legacy_holdings(portfolio: Optional[Dict]) -> List[Dict]:
    return portfolio.get("stock_holdings", []) if portfolio else []




def _is_bond_type(fund_type: str) -> bool:
    """判断基金是否为债券型"""
    if not fund_type:
        return False
    t = fund_type.lower()
    return "债" in t or "bond" in t

def _get_bond_holdings_for_fund(code: str, fund_type: str) -> List[Dict]:
    """对债券型基金，获取债券持仓替代股票持仓"""
    if not _is_bond_type(fund_type):
        return []
    try:
        bond_data = get_fund_bond_portfolio(code)
        if bond_data and bond_data.get("bond_holdings"):
            return bond_data["bond_holdings"]
    except Exception:
        pass
    return []
def _normalize_holding_ratio(value: Any) -> float:
    try:
        ratio = float(value or 0)
    except Exception:
        return 0.0
    if ratio < 0:
        return 0.0
    return ratio if ratio <= 100 else ratio / 100


def _to_float(value: Any) -> Optional[float]:
    if value in (None, "", "--", "—"):
        return None
    try:
        number = float(str(value).replace("%", "").strip())
        return number if number == number else None
    except Exception:
        return None


def normalize_nav_data(nav_data: Optional[List[Dict]]) -> List[Dict]:
    """Normalize fund NAV history to ascending dates and stable field names."""
    by_date: Dict[str, Dict] = {}
    for item in nav_data or []:
        if not isinstance(item, dict):
            continue
        date = item.get("date") or item.get("navDate") or item.get("净值日期") or item.get("日期")
        if not date:
            continue
        date = str(date)[:10]
        nav = _to_float(item.get("nav") or item.get("单位净值") or item.get("nav_value"))
        if nav is None or nav <= 0:
            continue
        accum_nav = _to_float(item.get("accum_nav") or item.get("acc_nav") or item.get("累计净值"))
        day_growth = _to_float(
            item.get("day_growth")
            if item.get("day_growth") is not None
            else item.get("dailyReturn")
            if item.get("dailyReturn") is not None
            else item.get("日增长率")
            if item.get("日增长率") is not None
            else item.get("涨跌幅")
            if item.get("涨跌幅") is not None
            else item.get("增长率")
            if item.get("增长率") is not None
            else item.get("daily_change")
        )
        by_date[date] = {
            "date": date,
            "nav": nav,
            "accum_nav": accum_nav,
            "day_growth": day_growth,
        }
    return [by_date[date] for date in sorted(by_date.keys())]


def _build_asset_allocation(holdings: List[Dict], fund_type: str, report_date: str, source: str) -> List[Dict]:
    stock_ratio = round(sum(_normalize_holding_ratio(item.get("ratio")) for item in holdings), 2)
    if not holdings and ("债" in fund_type or "货币" in fund_type):
        stock_ratio = 0.0

    if "债" in fund_type:
        bond_ratio = max(0.0, min(100.0, 86.0 - stock_ratio * 0.25))
        cash_ratio = 6.0
    elif "货币" in fund_type:
        bond_ratio = 45.0
        cash_ratio = 50.0
    else:
        bond_ratio = 0.0
        cash_ratio = 100.0 - stock_ratio if stock_ratio < 80 else max(2.0, 100.0 - stock_ratio)
    other_ratio = max(0.0, 100.0 - stock_ratio - bond_ratio - cash_ratio)
    rows = [
        {"name": "股票", "ratio": stock_ratio, "report_date": report_date, "source": source},
        {"name": "债券", "ratio": round(bond_ratio, 2), "report_date": report_date, "source": source},
        {"name": "现金", "ratio": round(cash_ratio, 2), "report_date": report_date, "source": source},
        {"name": "其他", "ratio": round(other_ratio, 2), "report_date": report_date, "source": source},
    ]
    return [item for item in rows if item["ratio"] > 0]


def _enrich_holdings_industry(holdings: List[Dict]) -> List[Dict]:
    """Fill missing industry field in holdings using Tushare stock_basic."""
    if not holdings:
        return holdings
    symbols = [h.get("code", "") for h in holdings if h.get("industry") in (None, "", "--")]
    if not symbols:
        return holdings
    try:
        provider = TushareProvider()
        if not provider.is_available():
            return holdings
        pro = provider._get_pro()
        if not pro:
            return holdings
        for batch_start in range(0, len(symbols), 100):
            batch = symbols[batch_start:batch_start + 100]
            # Codes may already have suffix (e.g. "301010.SZ") or be bare (e.g. "301010")
            ts_codes = [s if "." in s else s for s in batch if s]
            if not ts_codes:
                continue
            df = provider._safe_call(pro.stock_basic, ts_code=','.join(ts_codes), fields='ts_code,industry')
            if df is not None and not df.empty:
                industry_map = {}
                for _, row in df.iterrows():
                    ts = str(row.get("ts_code", ""))
                    industry_map[ts] = str(row.get("industry", ""))
                    # Also map by bare code (without suffix)
                    bare = ts.split(".")[0]
                    industry_map[bare] = industry_map[ts]
                for idx, h in enumerate(holdings):
                    if h.get("industry") in (None, "", "--"):
                        code = h.get("code", "")
                        if code in industry_map:
                            holdings[idx] = dict(h)
                            holdings[idx]["industry"] = industry_map[code]
        return holdings
    except Exception:
        return holdings


def _fetch_industry_history(code: str) -> List[Dict]:
    """Fetch historical industry allocation across quarters from fund_portfolio + stock_basic."""
    try:
        provider = TushareProvider()
        if not provider.is_available():
            return []
        pro = provider._get_pro()
        if not pro:
            return []
        result = []
        for candidate in provider._fund_portfolio_codes(code):
            df = provider._safe_call(pro.fund_portfolio, ts_code=candidate)
            if df is not None and not df.empty:
                break
        else:
            df = None
        if df is not None and not df.empty:
            # Get all unique stock symbols across all periods
            all_symbols = df["symbol"].dropna().unique().tolist() if "symbol" in df.columns else []
            # Batch lookup industry from stock_basic
            industry_map = {}
            for batch_start in range(0, len(all_symbols), 100):
                batch = all_symbols[batch_start:batch_start + 100]
                ts_codes = ",".join(batch)
                stock_df = provider._safe_call(pro.stock_basic, ts_code=ts_codes)
                if stock_df is not None and not stock_df.empty:
                    for _, srow in stock_df.iterrows():
                        ind = str(srow.get("industry", ""))
                        if ind:
                            industry_map[str(srow.get("ts_code", ""))] = ind

            # Group by quarter and aggregate by industry
            for end_date, period_df in df.groupby("end_date"):
                industries = {}
                for _, row in period_df.iterrows():
                    symbol = str(row.get("symbol", ""))
                    ratio = _normalize_holding_ratio(row.get("stk_mkv_ratio", 0))
                    ind = industry_map.get(symbol, "")
                    if ind and ratio > 0:
                        industries[ind] = industries.get(ind, 0) + ratio
                if industries:
                    sorted_items = sorted(industries.items(), key=lambda x: x[1], reverse=True)
                    result.append({
                        "quarter": str(end_date),
                        "industries": [{"industry": k, "ratio": round(v, 2)} for k, v in sorted_items],
                    })
        return result
    except Exception:
        return []


def _fetch_real_asset_allocation(code: str, fund_type: str, holdings: List[Dict], source: str) -> List[Dict]:
    """Fetch real asset allocation from Tushare, fallback to estimation."""
    try:
        provider = TushareProvider()
        if not provider.is_available():
            raise ValueError("tushare unavailable")
        pro = provider._get_pro()
        if not pro:
            raise ValueError("tushare pro unavailable")
        ts_code = f"{code}.OF"
        for candidate in provider._fund_portfolio_codes(code):
            df = provider._safe_call(pro.fund_asset_allocation_cp, ts_code=candidate)
            if df is not None and not df.empty:
                break
        else:
            df = None
        if df is not None and not df.empty:
            df = df.sort_values("end_date", ascending=False)
            latest_period = df.iloc[0].get("end_date", "")
            if latest_period:
                df_latest = df[df["end_date"] == latest_period]
                result = []
                type_map = {"1": "\u80a1\u7968", "2": "\u503a\u5238", "3": "\u73b0\u91d1", "4": "\u5176\u4ed6"}
                for _, row in df_latest.iterrows():
                    asset_type = str(row.get("asset_type", ""))
                    ratio = _normalize_holding_ratio(row.get("ratio", 0))
                    if asset_type and ratio > 0:
                        name = type_map.get(asset_type, asset_type)
                        result.append({
                            "name": name,
                            "ratio": round(ratio, 2),
                            "report_date": str(latest_period),
                            "source": "tushare_asset_allocation",
                        })
                if result:
                    return result
    except Exception:
        pass
    report_date = holdings[0].get("quarter") if holdings else ""
    return _build_asset_allocation(holdings, fund_type, report_date, source)



def _calc_period_returns(nav_data: List[Dict]) -> Dict[str, Any]:
    """基于 nav_data 计算 1y/3y/5y 区间收益率与年化收益。
    nav_data 已按日期升序排列，每项含 date / nav / accum_nav。
    优先使用 accum_nav（含分红再投资）。返回值为百分比数值（保留2位小数），无足够数据返回 None。
    """
    result = {"return1y": None, "return3y": None, "return5y": None, "annualized_return": None}
    if not nav_data or len(nav_data) < 2:
        return result
    # 选择基准价：accum_nav 优先，否则 nav
    def _val(p):
        v = p.get("accum_nav") if p.get("accum_nav") not in (None, 0) else p.get("nav")
        try:
            return float(v) if v not in (None, "") else None
        except Exception:
            return None
    # 过滤有效记录
    pts = [p for p in nav_data if p.get("date") and _val(p) is not None]
    if len(pts) < 2:
        return result
    # 解析日期
    def _to_date(s):
        s = str(s)
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"):
            try:
                return datetime.strptime(s[:10], fmt)
            except Exception:
                continue
        return None
    pts2 = [(p, _to_date(p["date"]), _val(p)) for p in pts]
    pts2 = [t for t in pts2 if t[1] is not None]
    if len(pts2) < 2:
        return result
    pts2.sort(key=lambda x: x[1])
    last_date, last_val = pts2[-1][1], pts2[-1][2]
    first_date, first_val = pts2[0][1], pts2[0][2]

    def _return_at(years: int):
        target = last_date - timedelta(days=int(365.25 * years))
        if target < first_date:
            return None
        # 找 target 之前最近一条
        chosen = None
        for _, d, v in pts2:
            if d <= target:
                chosen = v
            else:
                break
        if chosen is None or chosen <= 0:
            return None
        return round((last_val - chosen) / chosen * 100, 2)

    result["return1y"] = _return_at(1)
    result["return3y"] = _return_at(3)
    result["return5y"] = _return_at(5)
    # 年化（基于成立以来）
    try:
        days = (last_date - first_date).days
        if days > 30 and first_val and first_val > 0:
            years = days / 365.25
            ratio = last_val / first_val
            if ratio > 0:
                annualized = (ratio ** (1.0 / years) - 1) * 100
                result["annualized_return"] = round(annualized, 2)
    except Exception:
        pass
    return result


def _supplement_nav_with_efinance(code: str, current_navs: List[Dict]) -> List[Dict]:
    """优先使用本地 fund_nav_history DB（已由 compute 阶段持久化），
    不足时回退 efinance 在线 API。"""
    nav_cache_key = f"fund_nav_full_{code}"
    cached = cache.get(nav_cache_key, CACHE_TTL_NAV * 6)  # 6小时缓存
    if cached and isinstance(cached, list) and len(cached) > 200:
        normalized = normalize_nav_data(cached)
        if normalized != cached:
            cache.set(nav_cache_key, normalized)
        return normalized

    # 关键：先查本地 fund_nav_history DB（避免 efinance 拉不到时 navHistory 空）
    db_nav: List[Dict] = []
    try:
        from ..storage.database import get_db
        with get_db() as conn:
            rows = conn.execute(
                "SELECT nav_date, nav, accum_nav, day_growth FROM fund_nav_history "
                "WHERE code = ? ORDER BY nav_date ASC",
                (code,),
            ).fetchall()
        for r in rows:
            db_nav.append({
                "date": str(r["nav_date"]),
                "nav": float(r["nav"]) if r["nav"] is not None else None,
                "accum_nav": float(r["accum_nav"]) if r["accum_nav"] is not None else None,
                "day_growth": float(r["day_growth"]) if r["day_growth"] is not None else None,
            })
        if len(db_nav) > 200:
            db_nav = normalize_nav_data(db_nav)
            cache.set(nav_cache_key, db_nav)
            return db_nav
    except Exception:
        pass

    # DB 不足时回退 efinance 在线 API
    ef_nav = []
    try:
        ef_nav = get_fund_nav_history(code)
    except Exception:
        ef_nav = []

    # 若 efinance 失败，尝试 akshare 获取净值历史
    if not ef_nav:
        try:
            import akshare as ak
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if df is not None and not df.empty:
                records = []
                for _, row in df.iterrows():
                    date_val = row.get("净值日期")
                    nav_val = row.get("单位净值")
                    if date_val and nav_val:
                        records.append({
                            "date": str(date_val)[:10],
                            "nav": float(nav_val),
                        })
                ef_nav = records
        except Exception:
            pass

    if not ef_nav:
        return current_navs

    # 按日期去重合并
    by_date: Dict[str, Dict] = {}
    for n in normalize_nav_data(current_navs):
        d = n.get("date")
        if d:
            by_date[str(d)] = n
    for n in normalize_nav_data(ef_nav):
        d = n.get("date")
        if d and d not in by_date:
            by_date[d] = n
    merged = normalize_nav_data(list(by_date.values()))
    if len(merged) > 200:
        cache.set(nav_cache_key, merged)
    return merged


def analyze_fund(code: str) -> Dict[str, Any]:
    """深度分析单只基金 - 多数据源融合"""
    # 尝试使用多数据源融合层
    fusion = get_fusion()
    detail = fusion.get_fund_detail(code)

    if detail:
        # 多数据源成功获取数据
        nav_data = [
            {"date": n.date, "nav": n.nav, "accum_nav": n.accum_nav, "day_growth": n.day_growth}
            for n in (detail.nav_history or [])
        ]
        # 关键修复：使用 efinance 补充长周期净值历史（解决净值图只到 2025-12-10 问题）
        nav_data = normalize_nav_data(_supplement_nav_with_efinance(code, nav_data))
        holdings = [
            {
                "name": h.name,
                "code": h.code,
                "ratio": h.ratio,
                "industry": h.industry,
                "quarter": h.quarter,
                "source": h.source or detail.source,
                "updated_at": h.updated_at,
            }
            for h in (detail.holdings or [])
        ]
        if not holdings:
            holdings = _normalize_legacy_holdings(get_fund_portfolio(code))
        # 债券型基金：优先使用债券持仓替代股票持仓
        fund_type = detail.type or ""
        bond_holdings = _get_bond_holdings_for_fund(code, fund_type)
        if bond_holdings:
            stock_total = sum(_normalize_holding_ratio(h.get("ratio")) for h in holdings)
            # 当股票持仓总占比很低（< 20%），债券才是主要持仓，应优先展示
            if stock_total < 20:
                holdings = bond_holdings
            else:
                # 混合型：债券持仓排在前面，股票持仓补充
                holdings = bond_holdings + holdings
        holdings = sorted(
            _enrich_holdings_with_daily_change(holdings),
            key=lambda item: _normalize_holding_ratio(item.get("ratio")),
            reverse=True,
        )
        holdings = _enrich_holdings_industry(holdings)
        manager = detail.manager_info or {}
        if not manager and detail.basic and detail.basic.manager:
            manager = {"name": detail.basic.manager, "tenure_days": 0}

        # 计算任职天数
        if manager and manager.get("begin_date"):
            try:
                from datetime import datetime
                begin_str = str(manager["begin_date"]).replace("-", "").replace(".", "")
                if len(begin_str) == 8:
                    begin_dt = datetime.strptime(begin_str, "%Y%m%d")
                    tenure_days = (datetime.now() - begin_dt).days
                    manager = dict(manager)
                    manager["tenure_days"] = tenure_days
            except Exception:
                pass
        if manager and "tenure_days" not in manager:
            manager = dict(manager) if manager else {}
            manager["tenure_days"] = 0

        # 用 akshare 补充基金经理详细信息（学历、任职回报、年化回报等）
        manager = _enrich_manager_from_akshare(code, manager)

        # 计算策略信号
        score, signal, confidence, reasons = _calc_strategy_signal_fusion(detail)

        # 雷达图评分
        radar = _calc_radar_scores_fusion(detail)

        # 计算区间收益率
        period = _calc_period_returns(nav_data or [])
        report_date = holdings[0].get("quarter") if holdings else ""
        asset_allocation = _fetch_real_asset_allocation(code, detail.type or "", holdings, detail.source)
        if not report_date and asset_allocation:
            report_date = str(asset_allocation[0].get("report_date") or asset_allocation[0].get("quarter") or "")

        # 从净值历史计算最佳/最差年度收益（用于经理面板）
        best_return, worst_return = _calc_best_worst_annual(nav_data or [])

        # 获取基金规模（优先 Tushare fund_share × unit_nav 精确计算）
        total_scale = None
        if detail.scale and detail.scale.total_nav is not None:
            total_scale = detail.scale.total_nav
        else:
            try:
                from ..data.efinance_fetcher import get_fund_scale
                total_scale = get_fund_scale(code)
            except Exception:
                pass

        # 获取基金费率（efinance — Tushare 不提供费率字段）
        fee_manage = None
        fee_custody = None
        try:
            from ..data.efinance_fetcher import get_fund_fees
            fees = get_fund_fees(code)
            if fees:
                fee_manage = fees.get("feeManage")
                fee_custody = fees.get("feeCustody")
        except Exception:
            pass

        # 从净值历史计算风控指标（Sharpe / 最大回撤）
        sharpe_ratio = None
        max_drawdown = None
        volatility = None
        if nav_data and len(nav_data) >= 2:
            try:
                from ..api.analysis import _calc_nav_risk_metrics
                metrics = _calc_nav_risk_metrics(nav_data)
                sharpe_ratio = metrics.get("sharpeRatio")
                max_drawdown = metrics.get("maxDrawdown")
            except Exception:
                pass

        # === 自动持久化指标到 fund_metrics_snapshot ===
        try:
            from ..storage.database import FundDataStore
            metrics_row = {
                "code": code,
                "sharpe_ratio": sharpe_ratio,
                "max_drawdown": max_drawdown,
                "volatility": volatility,
                "annualized_return": period.get("annualized_return"),
                "score": score,
                "fee_manage": fee_manage,
                "fee_custody": fee_custody,
                "total_scale": total_scale,
                "nav_points": len(nav_data) if nav_data else 0,
            }
            FundDataStore.save_metrics_batch([metrics_row], source="analysis")
        except Exception:
            pass

        # === 自动持久化真实持仓和资产配置到 fund_holdings_snapshot ===
        try:
            if (holdings or asset_allocation) and report_date:
                from ..storage.database import FundDataStore

                holdings_source = next(
                    (item.get("source") for item in holdings if item.get("source")),
                    detail.source or "analysis",
                )
                FundDataStore.save_holdings_snapshot(
                    code=code,
                    report_date=str(report_date),
                    holdings=holdings,
                    asset_allocation=asset_allocation,
                    source=holdings_source,
                    data_quality="analysis",
                )
        except Exception:
            pass

        # === 自动持久化回撤序列到 fund_drawdown_series ===
        try:
            if nav_data and len(nav_data) >= 2:
                from ..storage.database import FundDataStore
                peak = None
                drawdown_records = []
                for item in nav_data:
                    nav = item.get("accum_nav") or item.get("nav")
                    date = item.get("date") or item.get("nav_date")
                    if nav is None or nav <= 0 or not date:
                        continue
                    nav_f = float(nav)
                    peak = nav_f if peak is None else max(peak, nav_f)
                    if peak > 0:
                        dd = (nav_f - peak) / peak * 100
                        drawdown_records.append({
                            "date": str(date),
                            "drawdown": round(dd, 4),
                            "peak_nav": round(peak, 6),
                            "current_nav": round(nav_f, 6),
                        })
                if drawdown_records:
                    FundDataStore.save_drawdown_series_batch(
                        code, drawdown_records, window_days=365, source="analysis"
                    )
        except Exception:
            pass

        return {
            "code": code,
            "name": detail.name or code,
            "type": detail.type,
            "company": detail.basic.management if detail.basic and detail.basic.management else None,
            "management": detail.basic.management if detail.basic and detail.basic.management else None,
            "nav": detail.nav,
            "nav_date": detail.nav_date,
            "day_growth": detail.day_growth,
            "signal": signal,
            "confidence": confidence,
            "score": score,
            "reasons": reasons,
            "manager": {**manager, "best_return": best_return, "worst_return": worst_return},
            "holdings": holdings,
            "asset_allocation": asset_allocation,
            "dividends": [
                {
                    "ex_date": d.ex_date,
                    "div_cash": d.div_cash,
                    "pay_date": d.pay_date,
                    "record_date": d.record_date,
                    "ann_date": d.ann_date,
                    "base_date": d.base_date,
                }
                for d in (detail.dividends or [])
            ],
            "nav_data": nav_data if nav_data else [],
            "radar_scores": radar,
            "source": detail.source,
            "style_analysis": None,
            "data_sources": fusion.get_providers_status(),
            "return1y": period["return1y"],
            "return3y": period["return3y"],
            "return5y": period["return5y"],
            "annualized_return": period["annualized_return"],
            "total_scale": total_scale,
            "feeManage": fee_manage,
            "feeCustody": fee_custody,
            "sharpe_ratio": sharpe_ratio,
            "max_drawdown": max_drawdown,
            "establishDate": detail.basic.found_date if detail.basic and detail.basic.found_date else None,
            "stars": detail.rating if detail.rating else None,
            "benchmark": detail.basic.benchmark if detail.basic and detail.basic.benchmark else None,
            "accum_nav": next((p.get("accum_nav") for p in reversed(nav_data or []) if p.get("accum_nav") and p["accum_nav"] > 0), None),
            "industry_history": _fetch_industry_history(code),
            "company_info": {
                "name": detail.company.name if detail.company else None,
                "fund_count": detail.company.fund_count if detail.company else None,
                "manager_count": detail.company.manager_count if detail.company else None,
                "total_scale": detail.company.total_scale if detail.company else None,
            } if detail.company else None,
        }

    # 融合层失败，回退到旧的数据源
    return _analyze_fund_legacy(code)


def _analyze_fund_legacy(code: str) -> Dict[str, Any]:
    """旧版单数据源分析（fallback）"""
    # 基本信息
    cache_key = f"fund_info_{code}"
    info = cache.get(cache_key, CACHE_TTL_INFO)
    if info is None:
        info = get_fund_info(code)
        if info:
            cache.set(cache_key, info)

    # 净值历史
    nav_cache_key = f"fund_nav_{code}"
    nav_data = cache.get(nav_cache_key, CACHE_TTL_NAV)
    if nav_data is None:
        nav_data = get_fund_nav_history(code)
        if nav_data:
            nav_data = normalize_nav_data(nav_data)
            cache.set(nav_cache_key, nav_data)
    else:
        normalized_nav_data = normalize_nav_data(nav_data)
        if normalized_nav_data != nav_data:
            nav_data = normalized_nav_data
            cache.set(nav_cache_key, nav_data)

    # 基金经理
    manager = get_fund_manager_info(code) or {}

    # 基金经理已经在 akshare_fetcher 中增强了字段（education, fund_count, return_since_tenure 等）
    # 用 akshare 数据补充（如果融合层已有数据则融合层优先）
    manager = _enrich_manager_from_akshare(code, manager)

    # 持仓
    portfolio = get_fund_portfolio(code)

    # 计算策略信号
    score, signal, confidence, reasons = _calc_strategy_signal(
        info, nav_data, manager, portfolio
    )

    # 雷达图评分
    radar = _calc_radar_scores(info, nav_data, portfolio)

    # 从净值历史提取最新净值和日涨跌幅
    latest_nav = _extract_latest_nav(nav_data)

    # 提取基金名称
    fund_name = _extract_fund_name(info, code)

    # 计算区间收益率
    period = _calc_period_returns(nav_data or [])
    holdings = _normalize_legacy_holdings(portfolio)
    fund_type = (info.get("基金类型") or info.get("type") or "") if info else ""
    # 债券型基金：优先使用债券持仓
    bond_holdings = _get_bond_holdings_for_fund(code, fund_type)
    if bond_holdings:
        stock_total = sum(_normalize_holding_ratio(h.get("ratio")) for h in holdings)
        if stock_total < 20:
            holdings = bond_holdings
        else:
            holdings = bond_holdings + holdings
    holdings = sorted(
        _enrich_holdings_with_daily_change(holdings),
        key=lambda item: _normalize_holding_ratio(item.get("ratio")),
        reverse=True,
    )
    report_date = holdings[0].get("quarter") if holdings else ""
    asset_allocation = _build_asset_allocation(holdings, fund_type, report_date, "legacy")

    # 从净值历史计算最佳/最差年度收益
    best_return, worst_return = _calc_best_worst_annual(nav_data or [])

    # 获取基金规模（优先 Tushare，回退 efinance）
    total_scale = None
    try:
        from ..data.providers.tushare_provider import TushareProvider
        tp = TushareProvider()
        if tp.is_available():
            scale_obj = tp.get_fund_scale(code)
            if scale_obj and scale_obj.total_nav is not None:
                total_scale = scale_obj.total_nav
    except Exception:
        pass
    if total_scale is None:
        try:
            from ..data.efinance_fetcher import get_fund_scale
            total_scale = get_fund_scale(code)
        except Exception:
            pass

    # 获取基金费率（efinance — Tushare 不提供费率字段）
    fee_manage = None
    fee_custody = None
    try:
        from ..data.efinance_fetcher import get_fund_fees
        fees = get_fund_fees(code)
        if fees:
            fee_manage = fees.get("feeManage")
            fee_custody = fees.get("feeCustody")
    except Exception:
        pass

    return {
        "code": code,
        "name": fund_name,
        "company": info.get("基金管理人") or info.get("基金公司") or info.get("management") if info else None,
        "management": info.get("基金管理人") or info.get("基金公司") or info.get("management") if info else None,
        "nav": latest_nav.get("nav"),
        "nav_date": latest_nav.get("nav_date"),
        "day_growth": latest_nav.get("day_growth"),
        "signal": signal,
        "confidence": confidence,
        "score": score,
        "reasons": reasons,
        "manager": {**manager, "best_return": best_return, "worst_return": worst_return},
        "holdings": holdings,
        "asset_allocation": asset_allocation,
        "dividends": [],
        "nav_data": nav_data if nav_data else [],
        "radar_scores": radar,
        "source": "legacy",
        "style_analysis": None,
        "return1y": period["return1y"],
        "return3y": period["return3y"],
        "return5y": period["return5y"],
        "annualized_return": period["annualized_return"],
        "total_scale": total_scale,
        "feeManage": fee_manage,
        "feeCustody": fee_custody,
        "establishDate": None,
        "stars": None,
        "benchmark": None,
        "accum_nav": None,
        "industry_history": [],
        "company_info": None,
    }


def _extract_latest_nav(nav_data: Optional[List[Dict]]) -> Dict[str, Any]:
    """从净值历史中提取最新净值、日期和日涨跌幅"""
    if not nav_data:
        return {"nav": None, "nav_date": None, "day_growth": None}
    # 按日期排序取最新
    sorted_data = sorted(nav_data, key=lambda x: x.get("date", "") or x.get("净值日期", "") or "", reverse=True)
    latest = sorted_data[0] if sorted_data else {}
    nav = latest.get("nav") or latest.get("单位净值") or latest.get("nav_value")
    nav_date = latest.get("date") or latest.get("净值日期") or latest.get("nav_date")
    day_growth = latest.get("day_growth") or latest.get("日增长率") or latest.get("daily_change")
    # 尝试从最新两条计算日涨跌幅
    if day_growth is None and len(sorted_data) >= 2:
        try:
            prev = sorted_data[1]
            prev_nav = float(prev.get("nav") or prev.get("单位净值") or 0)
            curr_nav = float(nav or 0)
            if prev_nav > 0:
                day_growth = round((curr_nav - prev_nav) / prev_nav * 100, 2)
        except (ValueError, TypeError):
            pass
    return {
        "nav": nav,
        "nav_date": nav_date,
        "day_growth": day_growth,
    }


def _extract_fund_name(info: Optional[Dict], code: str) -> str:
    """从多种可能的数据源格式中提取基金名称"""
    if not info:
        return code
    # 尝试多种可能的键名
    for key in ["基金简称", "name", "基金名称", "fund_name", "简称", "名称"]:
        if key in info and info[key]:
            return info[key]
    # 如果info是item-value格式
    for key, val in info.items():
        if isinstance(val, str) and len(val) > 4 and "基金" in val:
            return val
    return code


def _calc_strategy_signal(
    info: Optional[Dict], nav_data: Optional[List], manager: Optional[Dict], portfolio: Optional[Dict]
) -> tuple:
    """计算策略信号"""
    score = 50  # 基准分
    reasons = []

    # 基金经理评分
    if manager:
        tenure = manager.get("tenure_days", 0) or 0
        if tenure > 365 * 5:
            score += 10
            reasons.append(f"基金经理任职超5年，经验丰富")
        elif tenure > 365 * 2:
            score += 5
            reasons.append(f"基金经理任职超2年")
        else:
            score -= 5
            reasons.append(f"基金经理任职不足2年，需关注")

    # 净值趋势评分
    if nav_data and len(nav_data) > 20:
        recent = nav_data[-20:]
        navs = [p.get("nav", 0) for p in recent if p.get("nav", 0) > 0]
        if navs:
            recent_return = (navs[-1] - navs[0]) / navs[0] * 100
            if recent_return > 10:
                score += 5
                reasons.append(f"近20日涨幅{recent_return:.1f}%，短期表现强势")
            elif recent_return < -10:
                score -= 5
                reasons.append(f"近20日跌幅{recent_return:.1f}%，短期承压")
            else:
                reasons.append(f"近20日涨跌{recent_return:+.1f}%，走势平稳")

    # 持仓集中度
    if portfolio and isinstance(portfolio, dict):
        holdings = portfolio.get("stock_holdings", [])
        if holdings:
            top_ratio = sum(h.get("ratio", 0) for h in holdings[:3])
            if top_ratio > 40:
                score -= 5
                reasons.append(f"前3大持仓占比{top_ratio:.1f}%，集中度较高")
            else:
                reasons.append(f"前3大持仓占比{top_ratio:.1f}%，分散度良好")

    # 信号判断
    score = max(0, min(100, score))
    if score >= 70:
        signal = "买入"
        confidence = min(0.95, score / 100)
    elif score >= 40:
        signal = "持有"
        confidence = 1 - abs(score - 55) / 55
    else:
        signal = "赎回"
        confidence = min(0.95, (100 - score) / 100)

    return score, signal, confidence, reasons


def _calc_radar_scores(
    info: Optional[Dict], nav_data: Optional[List], portfolio: Optional[Dict]
) -> Dict[str, float]:
    """计算雷达图评分（0-100）"""
    scores = {
        "profitability": 50,
        "risk_control": 50,
        "stability": 50,
        "stock_picking": 50,
        "timing": 50,
    }

    if nav_data and len(nav_data) > 60:
        navs = [p.get("nav", 0) for p in nav_data if p.get("nav", 0) > 0]
        if len(navs) > 20:
            # 收益能力
            total_return = (navs[-1] - navs[0]) / navs[0] * 100
            scores["profitability"] = min(100, max(5, 50 + total_return))

            # 波动率（稳定性反向）
            import numpy as np
            returns = np.diff(navs) / navs[:-1]
            vol = np.std(returns) * np.sqrt(252) * 100
            scores["stability"] = min(100, max(0, 100 - vol * 10))
            scores["risk_control"] = min(100, max(0, 100 - vol * 8))

            # 夏普比率近似
            if vol > 0:
                sharpe = (total_return / max(1, len(navs) / 252)) / vol
                scores["stock_picking"] = min(100, max(0, 50 + sharpe * 20))

    return scores


def _calc_strategy_signal_fusion(detail) -> tuple:
    """基于融合数据的策略信号计算"""
    score = 50
    reasons = []

    if detail.basic and detail.basic.manager:
        reasons.append(f"基金经理：{detail.basic.manager}")
        score += 3

    if detail.nav_history and len(detail.nav_history) > 20:
        navs = [n.nav for n in detail.nav_history if n.nav]
        if len(navs) > 20:
            recent_return = (navs[-1] - navs[0]) / navs[0] * 100
            if recent_return > 10:
                score += 5
                reasons.append(f"近20日涨幅{recent_return:.1f}%，短期表现强势")
            elif recent_return < -10:
                score -= 5
                reasons.append(f"近20日跌幅{recent_return:.1f}%，短期承压")
            else:
                reasons.append(f"近20日涨跌{recent_return:+.1f}%，走势平稳")

    if detail.holdings:
        top_ratio = sum(h.ratio for h in detail.holdings[:3])
        if top_ratio > 40:
            score -= 5
            reasons.append(f"前3大持仓占比{top_ratio:.1f}%，集中度较高")
        else:
            reasons.append(f"前3大持仓占比{top_ratio:.1f}%，分散度良好")

    if detail.risk:
        if detail.risk.sharpe and detail.risk.sharpe > 1:
            score += 3
            reasons.append(f"夏普比率{detail.risk.sharpe:.2f}，风险收益比良好")
        if detail.risk.max_drawdown and detail.risk.max_drawdown < 15:
            score += 3
            reasons.append(f"最大回撤{detail.risk.max_drawdown:.1f}%，风控能力较强")

    score = max(0, min(100, score))
    if score >= 70:
        signal = "买入"
        confidence = min(0.95, score / 100)
    elif score >= 40:
        signal = "持有"
        confidence = 1 - abs(score - 55) / 55
    else:
        signal = "赎回"
        confidence = min(0.95, (100 - score) / 100)

    return score, signal, confidence, reasons


def _calc_radar_scores_fusion(detail) -> Dict[str, float]:
    """基于融合数据的雷达图评分"""
    scores = {
        "profitability": 50,
        "risk_control": 50,
        "stability": 50,
        "stock_picking": 50,
        "timing": 50,
    }

    navs = [n.nav for n in detail.nav_history if n.nav] if detail.nav_history else []
    if len(navs) > 20:
        total_return = (navs[-1] - navs[0]) / navs[0] * 100
        scores["profitability"] = min(100, max(5, 50 + total_return))

        try:
            import numpy as np
            returns = np.diff(navs) / navs[:-1]
            vol = np.std(returns) * np.sqrt(252) * 100
            scores["stability"] = min(100, max(5, 100 - vol * 4))
            scores["risk_control"] = min(100, max(5, 100 - vol * 3))

            if vol > 0:
                sharpe = (total_return / max(1, len(navs) / 252)) / vol
                scores["stock_picking"] = min(100, max(5, 50 + sharpe * 20))
        except Exception:
            pass

    if detail.risk:
        if detail.risk.sharpe:
            scores["stock_picking"] = min(100, max(5, 50 + detail.risk.sharpe * 15))
        if detail.risk.max_drawdown:
            scores["risk_control"] = min(100, max(5, 100 - detail.risk.max_drawdown * 3))

    return scores


def _enrich_manager_from_akshare(code: str, manager: Dict) -> Dict:
    """用 akshare + efinance 补充基金经理详细信息"""
    if not isinstance(manager, dict):
        manager = {}

    # 如果 manager 完全为空，先尝试从 efinance 获取基本信息（经理姓名等）
    if not manager or not manager.get("name"):
        try:
            from ..data.efinance_fetcher import get_fund_manager_basic
            basic = get_fund_manager_basic(code)
            if basic and isinstance(basic, dict):
                manager = dict(manager)
                manager.update({k: v for k, v in basic.items() if v})
        except Exception:
            pass

    # 再用 akshare 补充详细信息
    try:
        from ..data.akshare_fetcher import get_fund_manager_info
        extra = get_fund_manager_info(code)
        if extra and isinstance(extra, dict):
            enriched = dict(manager)
            # 用 akshare 详细数据覆盖/补充（保留已有字段优先）
            for key, value in extra.items():
                if key not in enriched or enriched.get(key) in (None, 0, ""):
                    enriched[key] = value
            return enriched
    except Exception:
        pass
    return manager


def _calc_best_worst_annual(nav_data: List[Dict]) -> tuple:
    """从净值历史计算最佳年度和最差年度收益（%）"""
    if not nav_data or len(nav_data) < 252:
        return None, None

    try:
        from collections import defaultdict
        from datetime import datetime

        # 按年份分组，找每年首尾净值
        yearly_navs = defaultdict(list)
        for point in nav_data:
            date_str = point.get("date", "")
            nav = point.get("nav")
            if not date_str or nav is None:
                continue
            try:
                dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
                yearly_navs[dt.year].append((dt, nav))
            except Exception:
                continue

        annual_returns = []
        for year, data in sorted(yearly_navs.items()):
            if len(data) < 2:
                continue
            data.sort(key=lambda x: x[0])
            start_nav = data[0][1]
            end_nav = data[-1][1]
            if start_nav and start_nav > 0:
                ret = (end_nav - start_nav) / start_nav * 100
                annual_returns.append(ret)

        if annual_returns:
            best = round(max(annual_returns), 2)
            worst = round(min(annual_returns), 2)
            return best, worst
    except Exception:
        pass

    return None, None
