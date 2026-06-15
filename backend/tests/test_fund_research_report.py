from unittest.mock import patch

from app.data.market_context_fetcher import get_fund_market_context
from app.data.providers.fusion import DataFusion
from app.reports.fund_research_report import render_fund_research_report


def test_market_context_non_etf_has_structured_missing_reason():
    with patch("app.data.market_context_fetcher._snapshot_basic", return_value={"name": "主动权益基金", "fund_type": "混合型"}), \
         patch("app.data.market_context_fetcher._top_industries", return_value=([], None, None)):
        payload = get_fund_market_context("000001")

    assert payload["fundCode"] == "000001"
    assert payload["sections"]["etfKline"]["dataStatus"] == "missing"
    assert "非 ETF" in payload["sections"]["etfKline"]["missingReason"]
    assert payload["dataStatus"] in {"partial", "missing"}


def test_provider_status_contains_health_contract_fields():
    fusion = DataFusion()
    status = fusion.get_provider_health_snapshot()
    first = status["providers"][0]

    assert "capabilities" in first
    assert "status" in first
    assert "lastSuccessAt" in first
    assert "lastError" in first
    assert "cooldownUntil" in first


def test_fund_research_report_markdown_is_deterministic_and_source_backed():
    snapshot = {
        "code": "000001",
        "name": "测试基金",
        "type": "混合型",
        "company": "测试基金公司",
        "nav": 1.23,
        "nav_date": "2026-06-15",
        "total_scale": 12.3,
        "holdings": [{"name": "测试股票", "ratio": 10.0}],
        "score": 80,
        "max_drawdown": -0.12,
        "updated_at": "2026-06-15T00:00:00",
        "metrics_updated_at": "2026-06-15T00:00:00",
    }
    with patch("app.reports.fund_research_report.FundDataStore.get_snapshot", return_value=snapshot), \
         patch("app.reports.fund_research_report.get_fund_market_context", return_value={"status": "partial", "sections": {}, "warnings": []}), \
         patch("app.reports.fund_research_report.get_fund_risk_summary", return_value={"dataStatus": "available", "summary": "风险摘要", "source": "rule-engine"}), \
         patch("app.reports.fund_research_report.get_fund_manager_report", return_value={"dataStatus": "missing", "report": None}):
        first = render_fund_research_report("000001")
        second = render_fund_research_report("000001")

    assert first["markdown"] == second["markdown"]
    assert "# 测试基金（000001）基金诊断报告" in first["markdown"]
    assert "数据源覆盖" in first["markdown"]
    assert "fund_quote_snapshot" in first["markdown"]
    assert first["evidencePack"]["data_quality"]["coverage"] > 0
