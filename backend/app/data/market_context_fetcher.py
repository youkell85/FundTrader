"""Structured market context for fund detail pages.

The context is intentionally best-effort: each section carries its own
availability metadata so a failed market source never blocks the fund detail.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from ..storage.database import get_db_context

logger = logging.getLogger(__name__)

EXCHANGE_FUND_CODE_PREFIXES = ("15", "16", "18", "5")
NORTHBOUND_INDICATOR = "北向资金净流入"
MARKET_FLOW_INDICATOR = "市场主力净流入"
SECTOR_FLOW_PREFIX = "行业资金流:"


def _status_section(
    status: str,
    *,
    source: str | None,
    as_of: str | None = None,
    coverage: float | None = None,
    missing_reason: str | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "dataStatus": status,
        "source": source,
        "asOf": as_of,
        "coverage": coverage if coverage is not None else (1.0 if status == "available" else 0.5 if status == "partial" else 0.0),
        "missingReason": missing_reason if status in {"partial", "stale", "missing"} else None,
        "data": data or {},
    }


def _is_exchange_fund(code: str, fund_type: str | None = None, name: str | None = None) -> bool:
    text = f"{fund_type or ''}{name or ''}".upper()
    return code.startswith(EXCHANGE_FUND_CODE_PREFIXES) or "ETF" in text or "LOF" in text


def _snapshot_basic(code: str) -> dict[str, Any]:
    try:
        with get_db_context() as conn:
            return dict(conn.execute(
                """SELECT m.name, m.fund_type, m.company, q.nav_date, q.updated_at,
                          q.near_1m, q.near_3m, q.near_6m, q.near_1y, q.ytd
                   FROM fund_master m
                   LEFT JOIN fund_quote_snapshot q ON q.code = m.code
                   WHERE m.code = ?""",
                (code,),
            ).fetchone() or {})
    except Exception:
        return {}


def _top_industries(code: str) -> tuple[list[dict[str, Any]], str | None, str | None]:
    try:
        with get_db_context() as conn:
            row = conn.execute(
                """SELECT holdings_json, asset_allocation_json, source, updated_at
                   FROM fund_portfolio_snapshot
                   WHERE code = ?
                   ORDER BY updated_at DESC LIMIT 1""",
                (code,),
            ).fetchone()
    except Exception:
        row = None
    if not row:
        return [], None, None
    import json

    industries: dict[str, float] = {}
    for item in json.loads(row["holdings_json"] or "[]"):
        if not isinstance(item, dict):
            continue
        industry = str(item.get("industry") or item.get("asset_type") or "").strip()
        ratio = item.get("ratio") or item.get("weight") or item.get("market_value_ratio")
        try:
            value = float(ratio)
        except Exception:
            value = 0.0
        if industry:
            industries[industry] = industries.get(industry, 0.0) + value
    rows = [
        {"industry": industry, "weight": round(weight, 4)}
        for industry, weight in sorted(industries.items(), key=lambda x: x[1], reverse=True)[:5]
    ]
    return rows, row["source"], row["updated_at"]


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.replace(",", "").replace("%", "").strip()
        if not value or value in {"-", "--"}:
            return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _pick_value(row: Any, keys: tuple[str, ...]) -> Any:
    for key in keys:
        try:
            value = row.get(key)
        except Exception:
            value = None
        if value not in (None, ""):
            return value
    return None


def refresh_market_context_cache(limit: int = 30) -> dict[str, Any]:
    """Best-effort live refresh for northbound and sector flow cache.

    This function is intentionally explicit and callable from scripts/tests; the
    detail endpoint reads the cache and does not block on live providers.
    """
    from ..storage.database import MacroCache

    now = datetime.now().date().isoformat()
    saved: list[str] = []
    warnings: list[str] = []

    try:
        import akshare as ak

        north_df = ak.stock_hsgt_fund_flow_summary_em()
        if north_df is not None and not north_df.empty:
            north_rows = north_df[north_df.get("资金方向") == "北向"] if "资金方向" in north_df.columns else north_df
            value = 0.0
            trade_date = now
            for _, row in north_rows.iterrows():
                amount = _to_float(_pick_value(row, ("资金净流入", "成交净买额")))
                if amount is not None:
                    value += amount
                trade_date = str(_pick_value(row, ("交易日", "date")) or trade_date)
            MacroCache.save(NORTHBOUND_INDICATOR, value, trade_date, "akshare:stock_hsgt_fund_flow_summary_em")
            saved.append(NORTHBOUND_INDICATOR)
    except Exception as exc:  # pragma: no cover - live provider shape/network drift
        warnings.append(f"northbound refresh failed: {exc}")

    try:
        import akshare as ak

        market_df = ak.stock_market_fund_flow()
        if market_df is not None and not market_df.empty:
            row = market_df.iloc[-1]
            value = _to_float(_pick_value(row, ("主力净流入-净额", "资金净流入", "净流入")))
            trade_date = str(_pick_value(row, ("日期", "date")) or now)
            if value is not None:
                MacroCache.save(MARKET_FLOW_INDICATOR, value, trade_date, "akshare:stock_market_fund_flow")
                saved.append(MARKET_FLOW_INDICATOR)
    except Exception as exc:  # pragma: no cover - live provider shape/network drift
        warnings.append(f"market flow refresh failed: {exc}")

    try:
        import akshare as ak

        sector_df = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="行业资金流")
        if sector_df is not None and not sector_df.empty:
            rows = sector_df.head(max(1, min(limit, 100)))
            batch = []
            for _, row in rows.iterrows():
                name = str(_pick_value(row, ("名称", "行业", "板块名称")) or "").strip()
                amount = _to_float(_pick_value(row, ("今日主力净流入-净额", "主力净流入-净额", "净流入", "资金净流入")))
                if name and amount is not None:
                    batch.append((f"{SECTOR_FLOW_PREFIX}{name}", amount, now, "akshare:stock_sector_fund_flow_rank"))
            if batch:
                MacroCache.save_batch(batch)
                saved.extend(row[0] for row in batch)
    except Exception as exc:  # pragma: no cover - live provider shape/network drift
        warnings.append(f"sector flow refresh failed: {exc}")

    return {
        "status": "available" if saved else "partial",
        "saved": saved,
        "warnings": warnings,
        "updatedAt": datetime.now().replace(microsecond=0).isoformat(),
    }


def _resolve_northbound_section(now: str) -> dict[str, Any]:
    """Build northFlow section from cached macro data.

    Priority:
      1. In-memory market_data_service MacroSnapshot (instant, no I/O)
      2. SQLite MacroCache.get_history / get (best-effort, non-fatal)
      3. Fall back to partial placeholder
    """
    indicator_name = NORTHBOUND_INDICATOR
    net_inflow: float | None = None
    source: str | None = None
    as_of: str | None = None

    # 1. Try in-memory macro snapshot (the preferred path)
    try:
        from ..allocation.data.market_data_service import market_data_service

        snapshot = market_data_service.get_macro_snapshot()
        if snapshot is not None:
            indicator = snapshot.indicators.get(indicator_name)
            if indicator is not None and indicator.value is not None:
                net_inflow = indicator.value
                source = indicator.source
                as_of = indicator.fetch_time
    except Exception:
        logger.debug("northFlow: in-memory macro snapshot unavailable", exc_info=True)

    # 2. Fall back to SQLite MacroCache
    if net_inflow is None:
        try:
            from ..storage.database import MacroCache

            history = MacroCache.get_history(indicator_name, limit=1)
            if history:
                date_str, value, hist_source = history[0]
                net_inflow = value
                source = hist_source or "sqlite_cache"
                as_of = date_str
            else:
                value = MacroCache.get(indicator_name)
                if value is not None:
                    net_inflow = value
                    source = "sqlite_cache"
        except Exception:
            logger.debug("northFlow: SQLite MacroCache unavailable", exc_info=True)

    # 3. Build section from resolved data or placeholder
    if net_inflow is not None:
        trend = "inflow" if net_inflow > 0 else "outflow" if net_inflow < 0 else "flat"
        return _status_section(
            "available",
            source=source or "macro_cache",
            as_of=as_of,
            coverage=0.9,
            data={"trend": trend, "netInflow": net_inflow},
        )

    # Placeholder: no cached northbound data available
    return _status_section(
        "partial",
        source="akshare/eastmoney",
        as_of=now,
        coverage=0.35,
        missing_reason="当前未持久化北向资金行业映射；详情页保留结构化占位，不阻塞主链路。",
        data={"trend": None, "netInflow": None},
    )


def _resolve_sector_flow_section(
    industries: list[dict[str, Any]],
    holdings_source: str | None,
    holdings_as_of: str | None,
    now: str,
) -> dict[str, Any]:
    if not industries:
        market_flow: tuple[str, float, str] | None = None
        try:
            from ..storage.database import MacroCache

            history = MacroCache.get_history(MARKET_FLOW_INDICATOR, limit=1)
            if history:
                date_str, value, source = history[0]
                market_flow = (date_str, value, source)
        except Exception:
            logger.debug("sectorFlow: market flow cache unavailable", exc_info=True)

        if market_flow:
            date_str, value, source = market_flow
            return _status_section(
                "partial",
                source=source,
                as_of=date_str,
                coverage=0.5,
                missing_reason="缺少持仓行业数据，无法匹配行业/概念资金流；当前仅提供真实全市场资金流。",
                data={
                    "topIndustries": [],
                    "matchedFlows": [],
                    "marketFlow": {
                        "netInflow": value,
                        "trend": "inflow" if value > 0 else "outflow" if value < 0 else "flat",
                        "asOf": date_str,
                        "source": source,
                    },
                },
            )

        return _status_section(
            "missing",
            source=holdings_source or "fund_portfolio_snapshot",
            as_of=holdings_as_of,
            coverage=0.0,
            missing_reason="缺少持仓行业数据，无法匹配行业/概念资金流。",
            data={"topIndustries": []},
        )

    matched: list[dict[str, Any]] = []
    try:
        from ..storage.database import MacroCache

        for item in industries:
            industry = str(item.get("industry") or "").strip()
            if not industry:
                continue
            history = MacroCache.get_history(f"{SECTOR_FLOW_PREFIX}{industry}", limit=1)
            if not history:
                continue
            date_str, value, source = history[0]
            matched.append({
                "industry": industry,
                "weight": item.get("weight"),
                "netInflow": value,
                "asOf": date_str,
                "source": source,
                "trend": "inflow" if value > 0 else "outflow" if value < 0 else "flat",
            })
    except Exception:
        logger.debug("sectorFlow: MacroCache unavailable", exc_info=True)

    if matched:
        return _status_section(
            "available" if len(matched) >= min(3, len(industries)) else "partial",
            source="macro_history:sector_flow",
            as_of=matched[0].get("asOf"),
            coverage=round(len(matched) / max(1, len(industries)), 4),
            missing_reason=None if len(matched) == len(industries) else "仅部分持仓行业有真实资金流缓存。",
            data={"topIndustries": industries, "matchedFlows": matched},
        )

    market_flow: tuple[str, float, str] | None = None
    try:
        from ..storage.database import MacroCache

        history = MacroCache.get_history(MARKET_FLOW_INDICATOR, limit=1)
        if history:
            date_str, value, source = history[0]
            market_flow = (date_str, value, source)
    except Exception:
        logger.debug("sectorFlow: market flow cache unavailable", exc_info=True)

    if market_flow:
        date_str, value, source = market_flow
        return _status_section(
            "partial",
            source=source,
            as_of=date_str,
            coverage=0.5,
            missing_reason="已有真实大盘资金流缓存，但尚未匹配到持仓行业级资金流。",
            data={
                "topIndustries": industries,
                "matchedFlows": [],
                "marketFlow": {
                    "netInflow": value,
                    "trend": "inflow" if value > 0 else "outflow" if value < 0 else "flat",
                    "asOf": date_str,
                    "source": source,
                },
            },
        )

    return _status_section(
        "partial",
        source=holdings_source or "fund_portfolio_snapshot",
        as_of=holdings_as_of or now,
        coverage=0.45,
        missing_reason="已有真实持仓行业，但尚未刷新行业资金流缓存；可运行 market context cache refresh。",
        data={"topIndustries": industries, "matchedFlows": []},
    )


def get_fund_market_context(code: str) -> dict[str, Any]:
    code = str(code or "").strip()
    basic = _snapshot_basic(code)
    is_etf = _is_exchange_fund(code, basic.get("fund_type"), basic.get("name"))
    now = datetime.now().date().isoformat()
    industries, holdings_source, holdings_as_of = _top_industries(code)

    sections: dict[str, dict[str, Any]] = {
        "etfKline": _status_section(
            "partial" if is_etf else "missing",
            source="TickFlow" if is_etf else None,
            as_of=basic.get("nav_date") or basic.get("updated_at"),
            coverage=0.5 if is_etf else 0.0,
            missing_reason=None if is_etf else "非 ETF/LOF 基金不提供分钟 K 线；日频净值仍由基金详情展示。",
            data={
                "isExchangeFund": is_etf,
                "periods": ["1d", "1w", "1m", "5m"] if is_etf else [],
                "latestNavDate": basic.get("nav_date"),
            },
        ),
        "northFlow": _resolve_northbound_section(now),
        "sectorFlow": _resolve_sector_flow_section(industries, holdings_source, holdings_as_of, now),
        "holdingsStyle": _status_section(
            "available" if industries else "missing",
            source=holdings_source or "fund_portfolio_snapshot",
            as_of=holdings_as_of,
            coverage=1.0 if industries else 0.0,
            missing_reason=None if industries else "缺少真实重仓持仓，无法判断持仓风格。",
            data={"topIndustries": industries, "fundType": basic.get("fund_type")},
        ),
    }
    available_weight = sum(float(item["coverage"]) for item in sections.values())
    coverage = round(available_weight / max(1, len(sections)), 4)
    status = "available" if coverage >= 0.9 else "partial" if coverage > 0 else "missing"
    warnings = [
        item["missingReason"]
        for item in sections.values()
        if item.get("missingReason")
    ]
    return {
        "fundCode": code,
        "asOf": now,
        "status": status,
        "dataStatus": status,
        "coverage": coverage,
        "sections": sections,
        "warnings": warnings,
    }
