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


def test_northflow_populated_from_cached_macro_snapshot():
    """When market_data_service has 北向资金净流入, northFlow uses cached data."""
    from app.allocation.data.models import MacroIndicator, MacroSnapshot

    macro_snapshot = MacroSnapshot(
        indicators={
            "北向资金净流入": MacroIndicator(
                name="北向资金净流入",
                value=52.3,
                source="akshare",
                confidence=0.9,
                fetch_time="2026-06-15T10:00:00",
            ),
        },
        overall_confidence=0.9,
    )

    with patch("app.data.market_context_fetcher._snapshot_basic", return_value={"name": "测试基金", "fund_type": "混合型"}), \
         patch("app.data.market_context_fetcher._top_industries", return_value=([], None, None)), \
         patch("app.allocation.data.market_data_service.MarketDataService.get_macro_snapshot", return_value=macro_snapshot):
        payload = get_fund_market_context("000001")

    north = payload["sections"]["northFlow"]
    assert north["dataStatus"] == "available"
    assert north["data"]["netInflow"] == 52.3
    assert north["data"]["trend"] == "inflow"
    assert north["missingReason"] is None
    assert north["coverage"] > 0.35  # upgraded from placeholder


def test_northflow_falls_back_to_placeholder_when_cache_missing():
    """When no cached northbound data exists, placeholder semantics are preserved."""
    with patch("app.data.market_context_fetcher._snapshot_basic", return_value={"name": "测试基金", "fund_type": "混合型"}), \
         patch("app.data.market_context_fetcher._top_industries", return_value=([], None, None)), \
         patch("app.allocation.data.market_data_service.MarketDataService.get_macro_snapshot", return_value=None), \
         patch("app.storage.database.MacroCache.get_history", return_value=[]), \
         patch("app.storage.database.MacroCache.get", return_value=None):
        payload = get_fund_market_context("000001")

    north = payload["sections"]["northFlow"]
    assert north["dataStatus"] == "partial"
    assert north["data"]["netInflow"] is None
    assert north["data"]["trend"] is None
    assert north["missingReason"] is not None
    assert "北向资金" in north["missingReason"]
    # The overall payload must still be structured and non-blocking
    assert payload["fundCode"] == "000001"
    assert "sections" in payload
    assert "warnings" in payload
