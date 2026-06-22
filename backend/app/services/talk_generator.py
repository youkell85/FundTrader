from __future__ import annotations

import uuid

from ..allocation.models import (
    EvidenceRef,
    FusionDataQuality,
    SalesFact,
    SalesNarrativeRequest,
    SalesNarrativeResponse,
)
from .audit_service import write_audit_event, write_sales_generation
from .compliance_check import DISCLOSURE, check_compliance
from .suitability_guard import check_suitability


REQUIRED_FACTS_BY_SCENE: dict[str, list[str]] = {
    "product_recommendation": ["fund_name", "fund_code", "risk_level", "as_of"],
    "portfolio_review": ["portfolio_name", "holdings", "risk_level", "as_of"],
    "risk_explanation": ["risk_level", "as_of"],
    "first_meeting": ["client_name", "as_of"],
    "after_sales_followup": ["fund_name", "as_of"],
}


def _fact_map(facts: list[SalesFact]) -> dict[str, SalesFact]:
    return {fact.key: fact for fact in facts if fact.value and fact.status != "missing"}


def validate_required_facts(scene: str, facts: list[SalesFact]) -> tuple[bool, list[str]]:
    available = _fact_map(facts)
    missing = [key for key in REQUIRED_FACTS_BY_SCENE.get(scene, []) if key not in available]
    return not missing, missing


def _refs(facts: list[SalesFact]) -> list[EvidenceRef]:
    return [
        EvidenceRef(source=fact.source, as_of=fact.as_of, description=f"{fact.key}={fact.value}", confidence=1.0)
        for fact in facts
        if fact.value and fact.status != "missing"
    ]


def _template(req: SalesNarrativeRequest, facts: dict[str, SalesFact]) -> str:
    scene = req.scene
    client_name = facts.get("client_name").value if facts.get("client_name") else "客户"
    risk_level = facts.get("risk_level").value if facts.get("risk_level") else "待复核"
    as_of = facts.get("as_of").value if facts.get("as_of") else "待补充"

    if scene == "product_recommendation":
        fund_name = facts["fund_name"].value
        fund_code = facts["fund_code"].value
        return (
            f"{client_name}，这次建议重点关注 {fund_name}（{fund_code}）。"
            f"截至 {as_of}，该产品风险等级为 {risk_level}，需与您的风险承受能力匹配后再配置。"
            f"{DISCLOSURE}"
        )
    if scene == "portfolio_review":
        return (
            f"{client_name}，当前组合 {facts['portfolio_name'].value} 包含 {facts['holdings'].value}。"
            f"截至 {as_of}，组合风险等级为 {risk_level}，建议按目标比例和再平衡纪律复核。{DISCLOSURE}"
        )
    if scene == "risk_explanation":
        return f"{client_name}，本次沟通的重点是风险等级 {risk_level} 与客户承受能力匹配。截至 {as_of}，请先完成风险揭示。{DISCLOSURE}"
    if scene == "after_sales_followup":
        return f"{client_name}，关于 {facts['fund_name'].value} 的持有跟踪已更新至 {as_of}。建议结合账户目标和风险等级复核。{DISCLOSURE}"
    return f"{client_name}，本次沟通以客户目标和风险承受能力为基础，截至 {as_of} 的事实材料已用于内部复核。{DISCLOSURE}"


def generate_sales_narrative(req: SalesNarrativeRequest) -> SalesNarrativeResponse:
    generation_id = uuid.uuid4().hex
    facts = _fact_map(req.facts)
    ok, missing = validate_required_facts(req.scene, req.facts)
    client_risk = str(req.client_profile.get("client_risk_level") or req.client_profile.get("risk_tolerance") or "")
    product_risk = facts.get("risk_level").value if facts.get("risk_level") else None
    suitability = check_suitability(client_risk, product_risk)
    evidence_refs = _refs(req.facts)

    if suitability.decision == "rejected":
        missing_reason = "适当性检查未通过，禁止生成推荐话术。"
        audit_id = write_audit_event(
            "suitability_block",
            {"request": req.model_dump(), "suitability": suitability.model_dump()},
            owner_user_id=req.owner_user_id,
            plan_id=req.plan_id,
            data_status="rejected",
        )
        write_sales_generation(
            generation_id,
            req.scene,
            "",
            "rejected",
            suitability.decision,
            "block",
            suitability.reasons,
            [ref.model_dump() for ref in evidence_refs],
            audit_id,
            owner_user_id=req.owner_user_id,
            plan_id=req.plan_id,
            fund_code=req.fund_code,
            portfolio_id=req.portfolio_id,
            missing_reason=missing_reason,
        )
        return SalesNarrativeResponse(
            generation_id=generation_id,
            content="",
            suitability=suitability,
            compliance=check_compliance(""),
            data_quality=FusionDataQuality(status="rejected", source="sales_guard", missing_reason=missing_reason),
            evidence_refs=evidence_refs,
            missing_reason=missing_reason,
        )

    if not ok:
        missing_reason = f"缺少必要事实：{', '.join(missing)}。"
        audit_id = write_audit_event(
            "sales_fact_missing",
            {"request": req.model_dump(), "missing": missing},
            owner_user_id=req.owner_user_id,
            plan_id=req.plan_id,
            data_status="missing",
        )
        write_sales_generation(
            generation_id,
            req.scene,
            "",
            "missing",
            suitability.decision,
            "review",
            [missing_reason],
            [ref.model_dump() for ref in evidence_refs],
            audit_id,
            owner_user_id=req.owner_user_id,
            plan_id=req.plan_id,
            fund_code=req.fund_code,
            portfolio_id=req.portfolio_id,
            missing_reason=missing_reason,
        )
        return SalesNarrativeResponse(
            generation_id=generation_id,
            content="",
            suitability=suitability,
            compliance=check_compliance(""),
            data_quality=FusionDataQuality(status="missing", source="sales_fact_gate", missing_reason=missing_reason),
            evidence_refs=evidence_refs,
            missing_reason=missing_reason,
        )

    content = _template(req, facts)
    compliance = check_compliance(content)
    status = "real" if compliance.level == "pass" else "rejected" if compliance.level == "block" else "partial"
    missing_reason = "; ".join(compliance.issues) if compliance.issues else None
    audit_id = write_audit_event(
        "sales_talk_generated" if compliance.level != "block" else "sales_compliance_block",
        {"request": req.model_dump(), "compliance": compliance.model_dump(), "content": content[:500]},
        owner_user_id=req.owner_user_id,
        plan_id=req.plan_id,
        data_status=status,
    )
    write_sales_generation(
        generation_id,
        req.scene,
        content if compliance.level != "block" else "",
        status,
        suitability.decision,
        compliance.level,
        compliance.issues,
        [ref.model_dump() for ref in evidence_refs],
        audit_id,
        owner_user_id=req.owner_user_id,
        plan_id=req.plan_id,
        fund_code=req.fund_code,
        portfolio_id=req.portfolio_id,
        missing_reason=missing_reason,
    )
    return SalesNarrativeResponse(
        generation_id=generation_id,
        content=content if compliance.level != "block" else "",
        suitability=suitability,
        compliance=compliance,
        data_quality=FusionDataQuality(status=status, source="sales_fact_gate", coverage=1.0, confidence=0.8, missing_reason=missing_reason),
        evidence_refs=evidence_refs,
        missing_reason=missing_reason,
    )
