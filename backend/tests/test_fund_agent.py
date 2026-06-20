from unittest.mock import patch

from app.agents.fund_agent import build_fund_agent_plan, list_fund_agent_templates


def _fake_pack():
    return {
        "subject": {"type": "fund", "id": "000001", "name": "测试基金"},
        "data_quality": {"status": "partial", "coverage": 0.75},
        "schemaVersion": "fund-evidence-pack.v2",
        "conclusionReadiness": {
            "status": "partial",
            "conclusionStrength": "limited",
            "missingCriticalCount": 0,
            "blockingMissingCount": 0,
            "reason": "partial evidence",
        },
        "criticalMissingEvidence": [],
        "coverageSummary": {"status": "partial", "coverage": 0.75},
        "risk_metrics": {"status": "available"},
        "market_context": {"dataStatus": "partial"},
        "manager_report": {"status": "missing"},
        "field_sources": {
            "nav": {
                "status": "available",
                "source": "fund_quote_snapshot",
                "asOf": "2026-06-15",
                "missingReason": None,
            },
            "rating": {
                "status": "partial",
                "source": "fund_metrics_snapshot",
                "asOf": "2026-06-15",
                "missingReason": "缺少真实星级",
            },
        },
        "warnings": ["缺少真实星级"],
    }


def test_fund_agent_templates_are_fixed_and_whitelisted():
    payload = list_fund_agent_templates()
    template_ids = {item["id"] for item in payload["templates"]}

    assert template_ids == {"single_fund_diagnosis", "portfolio_explanation", "dca_review"}
    for item in payload["templates"]:
        assert item["allowed_tools"]
        assert all("." in tool for tool in item["allowed_tools"])


def test_fund_agent_plan_uses_evidence_pack_sources():
    with patch("app.agents.fund_agent.build_fund_evidence_pack", return_value=_fake_pack()):
        plan = build_fund_agent_plan("single_fund_diagnosis", "000001")

    assert plan["dataStatus"] == "available"
    assert plan["planStatus"] == "limited"
    assert plan["conclusionStrength"] == "limited"
    assert plan["conclusionReadiness"]["status"] == "partial"
    assert plan["criticalMissingEvidence"] == []
    assert plan["evidence"]["schemaVersion"] == "fund-evidence-pack.v2"
    assert plan["template"] == "single_fund_diagnosis"
    assert plan["allowedTools"] == ["fund.evidence_pack", "fund.market_context", "fund.risk_metrics", "fund.manager_report"]
    assert "只能使用 allowed_tools" in plan["prompt"]
    assert "source/asOf/status" in plan["prompt"]
    assert plan["evidence"]["field_sources"][0]["source"] == "fund_quote_snapshot"
    assert plan["evidence"]["warnings"] == ["缺少真实星级"]


def test_fund_agent_plan_rejects_unsupported_template():
    plan = build_fund_agent_plan("general_agent", "000001")

    assert plan["dataStatus"] == "missing"
    assert "unsupported template" in plan["missingReason"]
    assert "single_fund_diagnosis" in plan["supportedTemplates"]


def test_fund_agent_all_fixed_templates_build_from_evidence_pack():
    with patch("app.agents.fund_agent.build_fund_evidence_pack", return_value=_fake_pack()):
        for template in ("single_fund_diagnosis", "portfolio_explanation", "dca_review"):
            plan = build_fund_agent_plan(template, "000001")
            assert plan["template"] == template
            assert plan["allowedTools"]
            assert plan["evidence"]["subject"]["id"] == "000001"


def test_fund_agent_missing_evidence_downgrades_plan_status():
    pack = _fake_pack()
    pack["data_quality"] = {"status": "missing", "coverage": 0.0}
    pack["conclusionReadiness"] = {
        "status": "insufficient_data",
        "conclusionStrength": "none",
        "missingCriticalCount": 2,
        "blockingMissingCount": 2,
        "reason": "Missing NAV or risk evidence blocks a reliable conclusion.",
    }
    pack["criticalMissingEvidence"] = [
        {"category": "nav_performance", "status": "missing", "blocking": True},
        {"category": "risk_metrics", "status": "missing", "blocking": True},
    ]
    pack["warnings"] = ["insufficient evidence"]

    with patch("app.agents.fund_agent.build_fund_evidence_pack", return_value=pack):
        plan = build_fund_agent_plan("dca_review", "000001")

    assert plan["planStatus"] == "insufficient_data"
    assert plan["conclusionStrength"] == "none"
    assert plan["conclusionReadiness"]["blockingMissingCount"] == 2
    assert len(plan["criticalMissingEvidence"]) == 2
