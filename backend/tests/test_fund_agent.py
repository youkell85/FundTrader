from unittest.mock import patch

from app.agents.fund_agent import build_fund_agent_plan, list_fund_agent_templates


def _fake_pack():
    return {
        "subject": {"type": "fund", "id": "000001", "name": "测试基金"},
        "data_quality": {"status": "partial", "coverage": 0.75},
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

    assert template_ids == {"single_fund_diagnosis", "portfolio_allocation_explanation", "dca_review"}
    for item in payload["templates"]:
        assert item["allowed_tools"]
        assert all("." in tool for tool in item["allowed_tools"])


def test_fund_agent_plan_uses_evidence_pack_sources():
    with patch("app.agents.fund_agent.build_fund_evidence_pack", return_value=_fake_pack()):
        plan = build_fund_agent_plan("single_fund_diagnosis", "000001")

    assert plan["dataStatus"] == "available"
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
