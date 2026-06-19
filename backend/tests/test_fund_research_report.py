from unittest.mock import patch

from app.data.market_context_fetcher import MARKET_FLOW_INDICATOR, get_fund_market_context
from app.data.providers.fusion import DataFusion
from app.reports.fund_research_report import build_fund_evidence_pack, render_fund_research_report


def _fake_dca_backtest():
    return {
        "individual": [
            {
                "fund_code": "000001",
                "total_invested": 12000,
                "final_value": 12600,
                "total_profit_rate": 5.0,
                "annual_return": 4.8,
                "cagr": 4.8,
                "max_drawdown": 3.2,
                "max_drawdown_duration_days": 18,
                "sharpe_ratio": 1.1,
                "benchmark_return": 3.7,
                "benchmark_excess": 1.1,
                "benchmark_status": "available",
                "best_month": {"month": "2026-01", "return": 2.1},
                "worst_month": {"month": "2026-02", "return": -1.2},
                "nav_curve": [
                    {"date": "2025-01-01", "value": 1000},
                    {"date": "2025-12-31", "value": 12600},
                ],
                "benchmark": {
                    "annual_return": 3.7,
                    "max_drawdown": 4.0,
                    "sharpe_ratio": 0.8,
                    "curve": [
                        {"date": "2025-01-01", "value": 12000},
                        {"date": "2025-12-31", "value": 12450},
                    ],
                },
            }
        ]
    }


def _fake_fund_events():
    return {
        "dataStatus": "available",
        "events": [
            {
                "title": "基金经理发布季度观点",
                "published_at": "2026-06-15",
                "event_type": "announcement",
                "source": "static_fund_events",
            }
        ],
        "data_quality": {"status": "available", "source": "static_fund_events", "missing_reason": None},
    }


def _fake_bond_holdings():
    return {
        "dataStatus": "partial",
        "source": "AkShare 东方财富F10 债券持仓",
        "asOf": "2026-03-31",
        "coverage": 0.75,
        "missingReason": "票息和评级仍缺少真实来源",
        "rows": [
            {
                "bondName": "26国债01",
                "bondCode": "019827",
                "navRatio": 2.4,
                "bondType": "国家债券",
                "issuer": "中华人民共和国财政部",
                "marketValue": 1.2,
                "marketValueUnit": "亿元",
            }
        ],
    }


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
         patch("app.reports.fund_research_report.get_fund_manager_report", return_value={"dataStatus": "missing", "report": None}), \
         patch("app.reports.fund_research_report.get_fund_bond_holdings", return_value=_fake_bond_holdings()), \
         patch("app.reports.fund_research_report.run_dca_backtest", return_value=_fake_dca_backtest()), \
         patch("app.reports.fund_research_report.collect_fund_events", return_value=_fake_fund_events()):
        first = render_fund_research_report("000001")
        second = render_fund_research_report("000001")

    assert first["markdown"] == second["markdown"]
    assert "# 测试基金（000001）基金诊断报告" in first["markdown"]
    assert "数据源覆盖" in first["markdown"]
    assert "回测证据" in first["markdown"]
    assert "债券持仓证据" in first["markdown"]
    assert "26国债01" in first["markdown"]
    assert "基金事件" in first["markdown"]
    assert "基金经理发布季度观点" in first["markdown"]
    assert "fund_quote_snapshot" in first["markdown"]
    assert first["evidencePack"]["backtest"]["available"] is True
    assert first["evidencePack"]["backtest"]["metrics"]["benchmark_excess"] == 1.1
    assert first["evidencePack"]["event_summary"]["count"] == 1
    assert first["evidencePack"]["bond_summary"]["count"] == 1
    assert first["evidencePack"]["data_quality"]["coverage"] > 0


def test_fund_evidence_pack_downgrades_when_critical_evidence_missing():
    snapshot = {
        "code": "000001",
        "updated_at": "2026-06-15T00:00:00",
    }
    with patch("app.reports.fund_research_report.FundDataStore.get_snapshot", return_value=snapshot), \
         patch("app.reports.fund_research_report.get_fund_market_context", return_value={"status": "missing", "sections": {}, "warnings": []}), \
         patch("app.reports.fund_research_report.get_fund_risk_summary", return_value={"dataStatus": "missing", "summary": None}), \
         patch("app.reports.fund_research_report.get_fund_manager_report", return_value={"dataStatus": "missing", "report": None}), \
         patch("app.reports.fund_research_report.get_fund_bond_holdings", return_value={"dataStatus": "missing", "rows": [], "missingReason": "no bonds"}), \
         patch("app.reports.fund_research_report.run_dca_backtest", return_value={"individual": [{"error": "无法获取基金 000001 的净值数据"}]}), \
         patch("app.reports.fund_research_report.collect_fund_events", return_value={"events": [], "data_quality": {"status": "missing", "missing_reason": "no events returned"}}):
        pack = build_fund_evidence_pack("000001")

    assert pack["diagnosis"]["status"] == "insufficient_data"
    assert pack["diagnosis"]["conclusion_strength"] == "none"
    assert pack["diagnosis"]["llm_input_contract"] == "evidence_pack_only"
    assert any(item["field"] == "nav" for item in pack["missing_evidence"])
    assert any(item["field"] == "risk" for item in pack["missing_evidence"])
    assert pack["backtest"]["available"] is False
    assert "净值数据" in pack["backtest"]["missingReason"]


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


def test_sectorflow_uses_cached_industry_flow_when_available():
    def history(indicator, limit=1):
        if indicator == "行业资金流:银行":
            return [("2026-06-19", 123456.0, "macro_history:sector_flow")]
        if indicator == "行业资金流:电子":
            return [("2026-06-19", -123.0, "macro_history:sector_flow")]
        return []

    with patch("app.data.market_context_fetcher._snapshot_basic", return_value={"name": "测试基金", "fund_type": "混合型"}), \
         patch("app.data.market_context_fetcher._top_industries", return_value=([
             {"industry": "银行", "weight": 20.0},
             {"industry": "电子", "weight": 10.0},
         ], "fund_portfolio_snapshot", "2026-06-18")), \
         patch("app.allocation.data.market_data_service.MarketDataService.get_macro_snapshot", return_value=None), \
         patch("app.storage.database.MacroCache.get_history", side_effect=history), \
         patch("app.storage.database.MacroCache.get", return_value=None):
        payload = get_fund_market_context("000001")

    sector = payload["sections"]["sectorFlow"]
    assert sector["dataStatus"] == "available"
    assert len(sector["data"]["matchedFlows"]) == 2
    assert sector["data"]["matchedFlows"][0]["trend"] == "inflow"


def test_sectorflow_uses_market_flow_fallback_when_industry_cache_missing():
    def history(indicator, limit=1):
        if indicator == "市场主力净流入":
            return [("2026-06-19", -5000.0, "akshare:stock_market_fund_flow")]
        return []

    with patch("app.data.market_context_fetcher._snapshot_basic", return_value={"name": "测试基金", "fund_type": "混合型"}), \
         patch("app.data.market_context_fetcher._top_industries", return_value=([
             {"industry": "银行", "weight": 20.0},
         ], "fund_portfolio_snapshot", "2026-06-18")), \
         patch("app.allocation.data.market_data_service.MarketDataService.get_macro_snapshot", return_value=None), \
         patch("app.storage.database.MacroCache.get_history", side_effect=history), \
         patch("app.storage.database.MacroCache.get", return_value=None):
        payload = get_fund_market_context("000001")

    sector = payload["sections"]["sectorFlow"]
    assert sector["dataStatus"] == "partial"
    assert sector["data"]["marketFlow"]["trend"] == "outflow"


def test_sectorflow_uses_market_flow_fallback_without_industries():
    def history(indicator, limit=1):
        if indicator == MARKET_FLOW_INDICATOR:
            return [("2026-06-19", 8800.0, "akshare:stock_market_fund_flow")]
        return []

    with patch("app.data.market_context_fetcher._snapshot_basic", return_value={"name": "test fund", "fund_type": "mixed"}), \
         patch("app.data.market_context_fetcher._top_industries", return_value=([], None, None)), \
         patch("app.allocation.data.market_data_service.MarketDataService.get_macro_snapshot", return_value=None), \
         patch("app.storage.database.MacroCache.get_history", side_effect=history), \
         patch("app.storage.database.MacroCache.get", return_value=None):
        payload = get_fund_market_context("000001")

    sector = payload["sections"]["sectorFlow"]
    assert sector["dataStatus"] == "partial"
    assert sector["coverage"] == 0.5
    assert sector["data"]["topIndustries"] == []
    assert sector["data"]["marketFlow"]["netInflow"] == 8800.0
    assert sector["data"]["marketFlow"]["trend"] == "inflow"
    assert "全市场资金流" in sector["missingReason"]
