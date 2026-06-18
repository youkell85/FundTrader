"""Fund evidence pack and deterministic research report generation."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from ..data.fund_events import collect_fund_events
from ..data.market_context_fetcher import get_fund_market_context
from ..services.fund_service import (
    get_fund_manager_report,
    get_fund_risk_summary,
)
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

    field_sources = {
        "name": _field("name", snapshot.get("name"), snapshot.get("source") or "fund_master", snapshot.get("updated_at"), "available" if snapshot.get("name") else "missing", "缺少基金名称"),
        "type": _field("type", snapshot.get("type"), "fund_master", snapshot.get("updated_at"), "available" if snapshot.get("type") else "missing", "缺少基金类型"),
        "company": _field("company", snapshot.get("company"), "fund_master/tushare.fund_basic", snapshot.get("updated_at"), "available" if snapshot.get("company") else "partial", "基金公司字段未完全补齐"),
        "nav": _field("nav", snapshot.get("nav"), "fund_quote_snapshot", snapshot.get("nav_date"), "available" if snapshot.get("nav") else "missing", "缺少净值"),
        "nav_date": _field("nav_date", snapshot.get("nav_date"), "fund_quote_snapshot", snapshot.get("nav_date"), "available" if snapshot.get("nav_date") else "missing", "缺少净值日期"),
        "fund_scale": _field("fund_scale", snapshot.get("total_scale"), "tushare.fund_share*fund_nav/fund_metrics_snapshot", snapshot.get("metrics_updated_at") or snapshot.get("updated_at"), "available" if snapshot.get("total_scale") else "missing", "缺少规模快照"),
        "top_holdings": _field("top_holdings", len(snapshot.get("holdings") or []), "tushare.fund_portfolio/fund_portfolio_snapshot", snapshot.get("updated_at"), "available" if snapshot.get("holdings") else "missing", "缺少真实持仓"),
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
        "backtest": {"available": False, "metrics": {}, "window": {}},
        "manager_report": {
            "status": _section_status(manager_report),
            "text": manager_report.get("report"),
            "period": manager_report.get("period"),
            "source": manager_report.get("source"),
        },
        "fund_events": fund_events,
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
    warnings = pack.get("warnings") or ["无"]
    markdown = "\n".join([
        f"# {subject['name']}（{subject['id']}）基金诊断报告",
        section("核心结论", f"当前数据覆盖率为 {pack['data_quality']['coverage']:.0%}，状态为 {pack['data_quality']['status']}。本报告只基于 evidence pack 中已取得的数据生成。"),
        section("数据源覆盖", table(["字段", "状态", "来源", "日期", "缺失说明"], source_rows)),
        section("市场上下文", table(
            ["section", "状态", "来源", "日期", "说明"],
            [[k, v.get("status"), v.get("source"), v.get("asOf"), v.get("missingReason") or ""] for k, v in (pack["market_context"].get("sections") or {}).items()],
        )),
        section("风险和不确定性", str(risk_fields.get("summary") or "缺少足量风险指标，暂不输出强结论。")),
        section("缺失字段说明", "\n".join(f"- {item}" for item in warnings)),
        section("使用参数", table(["参数", "值"], [["code", code], ["generated_at", pack["generated_at"]], ["report_format", "markdown"]])),
        section("后续观察项", "- 补齐 Tushare 份额/持仓/分红/评级快照\n- 对 ETF 样本补充 TickFlow K 线状态\n- 将 partial 数据源的失败原因纳入 provider health"),
    ])
    return {"code": code, "markdown": markdown, "evidencePack": pack, "dataStatus": pack["data_quality"]["status"]}
