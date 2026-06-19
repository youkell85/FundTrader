"""Fund evidence pack and deterministic research report generation."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from ..data.fund_events import collect_fund_events
from ..data.market_context_fetcher import get_fund_market_context
from ..services.fund_service import (
    get_fund_bond_holdings,
    get_fund_manager_report,
    get_fund_risk_summary,
)
from ..services.dca_service import run_dca_backtest
from ..storage.database import FundDataStore
from .markdown_renderer import section, table


def _section_status(payload: dict[str, Any] | None) -> str:
    if not payload:
        return "missing"
    return str(payload.get("dataStatus") or payload.get("status") or "partial")


def _field(field: str, value: Any, source: str | None, as_of: str | None, status: str, reason: str | None = None) -> dict[str, Any]:
    return {
        "field": field,
        "value": value,
        "source": source,
        "asOf": as_of,
        "status": status,
        "coverage": 1.0 if status == "available" else 0.5 if status == "partial" else 0.0,
        "missingReason": reason if status != "available" else None,
    }


def _missing_evidence(field_sources: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    missing: list[dict[str, Any]] = []
    for name, item in field_sources.items():
        status = str(item.get("status") or "missing")
        if status == "available":
            continue
        missing.append({
            "field": name,
            "status": status,
            "source": item.get("source"),
            "asOf": item.get("asOf"),
            "missingReason": item.get("missingReason") or "field is not available",
        })
    return missing


def _diagnosis_status(missing: list[dict[str, Any]]) -> str:
    critical = {"name", "nav", "risk", "top_holdings"}
    missing_critical = {str(item.get("field")) for item in missing if item.get("status") == "missing"}
    if critical & missing_critical:
        return "insufficient_data"
    return "partial" if missing else "available"


def _select_backtest_metrics(result: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "total_invested",
        "final_value",
        "total_profit_rate",
        "annual_return",
        "cagr",
        "max_drawdown",
        "max_drawdown_duration_days",
        "sharpe_ratio",
        "benchmark_return",
        "benchmark_excess",
        "benchmark_status",
        "best_month",
        "worst_month",
    ]
    return {key: result.get(key) for key in keys if key in result}


def _curve_window(result: dict[str, Any]) -> dict[str, Any]:
    curve = result.get("nav_curve") or result.get("curve") or []
    if not isinstance(curve, list) or not curve:
        benchmark_curve = result.get("benchmark", {}).get("curve", []) if isinstance(result.get("benchmark"), dict) else []
        curve = benchmark_curve if isinstance(benchmark_curve, list) else []
    if not curve:
        return {}
    return {
        "start": curve[0].get("date"),
        "end": curve[-1].get("date"),
        "points": len(curve),
    }


def _build_dca_backtest_summary(code: str) -> dict[str, Any]:
    try:
        payload = run_dca_backtest(
            [code],
            amount=1000,
            frequency="monthly",
            strategy="fixed",
        )
    except Exception as exc:  # pragma: no cover - defensive against provider/network failures
        return {
            "available": False,
            "status": "missing",
            "metrics": {},
            "window": {},
            "source": "dca_service.run_dca_backtest",
            "missingReason": f"DCA 回测执行失败：{exc}",
        }

    individual = payload.get("individual") if isinstance(payload, dict) else None
    result = individual[0] if isinstance(individual, list) and individual else {}
    if not isinstance(result, dict) or result.get("error"):
        return {
            "available": False,
            "status": "missing",
            "metrics": {},
            "window": {},
            "source": "dca_service.run_dca_backtest",
            "missingReason": result.get("error") if isinstance(result, dict) else "DCA 回测无有效结果",
        }

    metrics = _select_backtest_metrics(result)
    benchmark = result.get("benchmark") if isinstance(result.get("benchmark"), dict) else {}
    return {
        "available": True,
        "status": "available",
        "strategy": "fixed_monthly_dca",
        "amount": 1000,
        "frequency": "monthly",
        "metrics": metrics,
        "benchmark": _select_backtest_metrics(benchmark),
        "window": _curve_window(result),
        "source": "dca_service.run_dca_backtest",
        "missingReason": None,
    }


def _summarize_fund_events(fund_events: dict[str, Any]) -> dict[str, Any]:
    events = fund_events.get("events") if isinstance(fund_events, dict) else []
    events = events if isinstance(events, list) else []
    quality = fund_events.get("data_quality") if isinstance(fund_events, dict) else {}
    return {
        "status": fund_events.get("dataStatus") or quality.get("status") or ("available" if events else "missing"),
        "count": len(events),
        "latest": [
            {
                "title": item.get("title"),
                "published_at": item.get("published_at"),
                "event_type": item.get("event_type"),
                "source": item.get("source"),
            }
            for item in events[:3]
            if isinstance(item, dict)
        ],
        "source": quality.get("source") or fund_events.get("source") or "fund_events",
        "missingReason": quality.get("missing_reason") or fund_events.get("missingReason"),
    }


def _summarize_bond_holdings(payload: dict[str, Any]) -> dict[str, Any]:
    rows = payload.get("rows") if isinstance(payload, dict) else []
    rows = rows if isinstance(rows, list) else []
    return {
        "status": payload.get("dataStatus") or payload.get("status") or ("available" if rows else "missing"),
        "count": len(rows),
        "coverage": payload.get("coverage"),
        "source": payload.get("source"),
        "asOf": payload.get("asOf"),
        "missingReason": payload.get("missingReason"),
        "top": [
            {
                "name": row.get("bondName"),
                "code": row.get("bondCode"),
                "navRatio": row.get("navRatio"),
                "bondType": row.get("bondType"),
                "issuer": row.get("issuer"),
                "marketValue": row.get("marketValue"),
                "marketValueUnit": row.get("marketValueUnit"),
            }
            for row in rows[:5]
            if isinstance(row, dict)
        ],
    }


def _report_conclusion(pack: dict[str, Any]) -> str:
    status = pack.get("data_quality", {}).get("status")
    diagnosis = pack.get("diagnosis", {})
    strength = diagnosis.get("conclusion_strength")
    missing_count = diagnosis.get("missing_evidence_count")
    market_status = pack.get("market_context", {}).get("dataStatus") or pack.get("market_context", {}).get("status")
    backtest_status = pack.get("backtest", {}).get("status")
    bond_status = pack.get("bond_summary", {}).get("status")
    if status == "available" and strength == "normal":
        return "核心数据、市场上下文和风险证据基本可用，报告结论可作为常规研究参考。"
    return (
        f"当前结论强度为 {strength or 'limited'}，数据质量为 {status}；"
        f"市场上下文 {market_status or 'unknown'}，DCA 回测 {backtest_status or 'unknown'}，"
        f"债券持仓 {bond_status or 'unknown'}。仍有 {missing_count or 0} 项关键/半关键证据需要关注。"
    )


def build_fund_evidence_pack(code: str) -> dict[str, Any]:
    snapshot = FundDataStore.get_snapshot(code) or {"code": code, "data_quality": "missing"}
    market_context = get_fund_market_context(code)
    risk_summary = get_fund_risk_summary(code, "1y") or {
        "code": code,
        "dataStatus": "missing",
        "missingReason": "缺少风险指标或净值历史。",
    }
    manager_report = get_fund_manager_report(code) or {
        "code": code,
        "dataStatus": "missing",
        "report": None,
        "missingReason": "缺少真实基金定期报告原文。",
    }

    fund_events = collect_fund_events(code)
    backtest = _build_dca_backtest_summary(code)
    event_summary = _summarize_fund_events(fund_events)
    bond_holdings = get_fund_bond_holdings(code)
    bond_summary = _summarize_bond_holdings(bond_holdings)

    field_sources = {
        "name": _field("name", snapshot.get("name"), snapshot.get("source") or "fund_master", snapshot.get("updated_at"), "available" if snapshot.get("name") else "missing", "缺少基金名称"),
        "type": _field("type", snapshot.get("type"), "fund_master", snapshot.get("updated_at"), "available" if snapshot.get("type") else "missing", "缺少基金类型"),
        "company": _field("company", snapshot.get("company"), "fund_master/tushare.fund_basic", snapshot.get("updated_at"), "available" if snapshot.get("company") else "partial", "基金公司字段未完全补齐"),
        "nav": _field("nav", snapshot.get("nav"), "fund_quote_snapshot", snapshot.get("nav_date"), "available" if snapshot.get("nav") else "missing", "缺少净值"),
        "nav_date": _field("nav_date", snapshot.get("nav_date"), "fund_quote_snapshot", snapshot.get("nav_date"), "available" if snapshot.get("nav_date") else "missing", "缺少净值日期"),
        "fund_scale": _field("fund_scale", snapshot.get("total_scale"), "tushare.fund_share*fund_nav/fund_metrics_snapshot", snapshot.get("metrics_updated_at") or snapshot.get("updated_at"), "available" if snapshot.get("total_scale") else "missing", "缺少规模快照"),
        "top_holdings": _field("top_holdings", len(snapshot.get("holdings") or []), "tushare.fund_portfolio/fund_portfolio_snapshot", snapshot.get("updated_at"), "available" if snapshot.get("holdings") else "missing", "缺少真实持仓"),
        "bond_holdings": _field("bond_holdings", bond_summary["count"], bond_summary["source"], bond_summary["asOf"], bond_summary["status"], bond_summary["missingReason"] or "缺少真实重仓债券明细"),
        "rating": _field("rating", snapshot.get("score"), "tushare.fund_rating/fund_metrics_snapshot", snapshot.get("metrics_updated_at"), "partial" if snapshot.get("score") is not None else "missing", "缺少真实星级评级"),
        "risk": _field("risk", snapshot.get("max_drawdown"), "local_nav_metrics/ifind", snapshot.get("metrics_updated_at"), "available" if snapshot.get("max_drawdown") is not None else "missing", "缺少风险指标"),
    }
    available_weight = sum(item["coverage"] for item in field_sources.values())
    coverage = round(available_weight / max(1, len(field_sources)), 4)
    data_quality_status = "available" if coverage >= 0.9 else "partial" if coverage > 0 else "missing"
    warnings = [
        item["missingReason"]
        for item in field_sources.values()
        if item.get("missingReason")
    ] + list(market_context.get("warnings") or [])
    missing_evidence = _missing_evidence(field_sources)
    diagnosis_status = _diagnosis_status(missing_evidence)

    return {
        "subject": {
            "type": "etf" if str(snapshot.get("type") or "").upper().find("ETF") >= 0 else "fund",
            "id": code,
            "name": snapshot.get("name") or code,
        },
        "fund_detail": {
            "status": data_quality_status,
            "fields": field_sources,
        },
        "market_context": market_context,
        "risk_metrics": {
            "status": _section_status(risk_summary),
            "fields": risk_summary,
        },
        "backtest": backtest,
        "bond_holdings": bond_holdings,
        "bond_summary": bond_summary,
        "manager_report": {
            "status": _section_status(manager_report),
            "text": manager_report.get("report"),
            "period": manager_report.get("period"),
            "source": manager_report.get("source"),
        },
        "fund_events": fund_events,
        "event_summary": event_summary,
        "data_quality": {
            "status": data_quality_status,
            "coverage": coverage,
            "missing_reason": None if data_quality_status == "available" else "存在缺失或 partial 字段，详见 field_sources。",
        },
        "diagnosis": {
            "status": diagnosis_status,
            "conclusion_strength": "none" if diagnosis_status == "insufficient_data" else "limited" if diagnosis_status == "partial" else "normal",
            "llm_input_contract": "evidence_pack_only",
            "missing_evidence_count": len(missing_evidence),
        },
        "missing_evidence": missing_evidence,
        "field_sources": field_sources,
        "warnings": warnings,
        "generated_at": datetime.now().replace(microsecond=0).isoformat(),
    }


def render_fund_research_report(code: str) -> dict[str, Any]:
    pack = build_fund_evidence_pack(code)
    subject = pack["subject"]
    fields = pack["field_sources"]
    source_rows = [
        [name, item["status"], item["source"], item["asOf"], item["missingReason"] or ""]
        for name, item in fields.items()
    ]
    risk_fields = pack["risk_metrics"]["fields"]
    backtest = pack.get("backtest") or {}
    event_summary = pack.get("event_summary") or {}
    warnings = pack.get("warnings") or ["无"]
    backtest_metrics = backtest.get("metrics") or {}
    bond_summary = pack.get("bond_summary") or {}
    bond_rows = [
        [
            item.get("name"),
            item.get("code"),
            item.get("navRatio"),
            item.get("bondType"),
            item.get("issuer") or "",
            f"{item.get('marketValue')}{item.get('marketValueUnit') or ''}" if item.get("marketValue") is not None else "",
        ]
        for item in bond_summary.get("top") or []
    ]
    event_rows = [
        [item.get("published_at"), item.get("event_type"), item.get("title"), item.get("source")]
        for item in event_summary.get("latest") or []
    ]
    markdown = "\n".join([
        f"# {subject['name']}（{subject['id']}）基金诊断报告",
        section("核心结论", f"{_report_conclusion(pack)}\n\n当前数据覆盖率为 {pack['data_quality']['coverage']:.0%}，状态为 {pack['data_quality']['status']}。本报告只基于 evidence pack 中已取得的数据生成。"),
        section("数据源覆盖", table(["字段", "状态", "来源", "日期", "缺失说明"], source_rows)),
        section("市场上下文", table(
            ["section", "状态", "来源", "日期", "说明"],
            [[k, v.get("status"), v.get("source"), v.get("asOf"), v.get("missingReason") or ""] for k, v in (pack["market_context"].get("sections") or {}).items()],
        )),
        section("回测证据", table(
            ["项目", "值"],
            [
                ["状态", backtest.get("status")],
                ["策略", backtest.get("strategy") or ""],
                ["窗口", f"{(backtest.get('window') or {}).get('start', '')} 至 {(backtest.get('window') or {}).get('end', '')}".strip()],
                ["年化收益", backtest_metrics.get("annual_return")],
                ["最大回撤", backtest_metrics.get("max_drawdown")],
                ["夏普", backtest_metrics.get("sharpe_ratio")],
                ["基准超额", backtest_metrics.get("benchmark_excess")],
                ["缺失说明", backtest.get("missingReason") or ""],
            ],
        )),
        section("债券持仓证据", table(
            ["简称", "代码", "占净值比", "类型", "发行主体", "估算市值"],
            bond_rows,
        ) if bond_rows else (bond_summary.get("missingReason") or "暂无真实重仓债券明细。")),
        section("基金事件", table(["日期", "类型", "标题", "来源"], event_rows) if event_rows else (event_summary.get("missingReason") or "暂无基金公告/新闻事件。")),
        section("风险和不确定性", str(risk_fields.get("summary") or "缺少足量风险指标，暂不输出强结论。")),
        section("缺失字段说明", "\n".join(f"- {item}" for item in warnings)),
        section("使用参数", table(["参数", "值"], [["code", code], ["generated_at", pack["generated_at"]], ["report_format", "markdown"]])),
        section("后续观察项", "- 继续补齐债券发行主体、票息、信用评级等真实细项\n- 定期刷新北向资金与行业资金流缓存\n- 将 provider health 与字段覆盖率纳入生产 smoke"),
    ])
    return {"code": code, "markdown": markdown, "evidencePack": pack, "dataStatus": pack["data_quality"]["status"]}
