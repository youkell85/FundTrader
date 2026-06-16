"""Fixed-template fund agent plans built from audited evidence packs."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from ..reports.fund_research_report import build_fund_evidence_pack


AGENT_TEMPLATES: dict[str, dict[str, Any]] = {
    "single_fund_diagnosis": {
        "title": "单基金诊断",
        "allowed_tools": ["fund.evidence_pack", "fund.market_context", "fund.risk_metrics", "fund.manager_report"],
        "sections": ["结论", "数据依据", "风险", "缺口"],
    },
    "portfolio_allocation_explanation": {
        "title": "组合配置解释",
        "allowed_tools": ["fund.evidence_pack", "allocation.result", "allocation.backtest", "data_sources.status"],
        "sections": ["配置逻辑", "组合风险", "回测证据", "再平衡观察"],
    },
    "dca_review": {
        "title": "定投复盘",
        "allowed_tools": ["fund.evidence_pack", "dca.backtest", "data_sources.status"],
        "sections": ["定投表现", "基准比较", "风险与回撤", "执行建议"],
    },
}


def list_fund_agent_templates() -> dict[str, Any]:
    return {
        "templates": [
            {"id": key, **value}
            for key, value in AGENT_TEMPLATES.items()
        ]
    }


def _source_rows(evidence_pack: dict[str, Any]) -> list[dict[str, Any]]:
    fields = evidence_pack.get("field_sources") or {}
    rows = []
    for field, item in fields.items():
        rows.append({
            "field": field,
            "status": item.get("status"),
            "source": item.get("source"),
            "asOf": item.get("asOf"),
            "missingReason": item.get("missingReason"),
        })
    return rows


def _compact_evidence(evidence_pack: dict[str, Any]) -> dict[str, Any]:
    subject = evidence_pack.get("subject") or {}
    data_quality = evidence_pack.get("data_quality") or {}
    return {
        "subject": subject,
        "data_quality": data_quality,
        "risk_status": (evidence_pack.get("risk_metrics") or {}).get("status"),
        "market_context_status": (evidence_pack.get("market_context") or {}).get("dataStatus")
            or (evidence_pack.get("market_context") or {}).get("status"),
        "manager_report_status": (evidence_pack.get("manager_report") or {}).get("status"),
        "field_sources": _source_rows(evidence_pack),
        "warnings": evidence_pack.get("warnings") or [],
    }


def build_fund_agent_plan(template: str, code: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    if template not in AGENT_TEMPLATES:
        return {
            "dataStatus": "missing",
            "missingReason": f"unsupported template: {template}",
            "supportedTemplates": sorted(AGENT_TEMPLATES.keys()),
        }

    evidence_pack = build_fund_evidence_pack(code)
    template_spec = AGENT_TEMPLATES[template]
    compact = _compact_evidence(evidence_pack)
    prompt = "\n".join([
        f"任务: {template_spec['title']}",
        f"对象: {compact['subject'].get('name') or code} ({code})",
        "约束:",
        "- 只能使用 allowed_tools 中列出的数据工具。",
        "- 不得引用 evidence_pack、context 或白名单工具之外的数据。",
        "- 每个关键判断必须引用 field_sources 中的 source/asOf/status。",
        "- 对 partial/missing/stale 数据必须降低结论强度并说明限制。",
        f"输出章节: {', '.join(template_spec['sections'])}",
        f"数据覆盖: {compact['data_quality'].get('coverage')} / {compact['data_quality'].get('status')}",
    ])

    return {
        "dataStatus": "available",
        "template": template,
        "title": template_spec["title"],
        "code": code,
        "allowedTools": template_spec["allowed_tools"],
        "sections": template_spec["sections"],
        "prompt": prompt,
        "evidence": compact,
        "context": context or {},
        "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
    }
