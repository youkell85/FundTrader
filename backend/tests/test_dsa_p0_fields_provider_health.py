"""DSA-P0: field-level provenance and provider health contract tests."""
import unittest
from unittest.mock import patch

from app.models.fund import FieldSource, FieldSourceGroup, ProviderHealth
from app.data.data_gateway import DataGateway
from app.api.fund import FUND_DETAIL_FIELD_GROUPS, _field_sources_from_sections


class FieldSourceContractTest(unittest.TestCase):
    """FieldSource Pydantic model enforces the DSA-P0 provenance contract."""

    def test_field_source_defaults_to_missing(self):
        fs = FieldSource(field="fund_scale")
        self.assertEqual(fs.status, "missing")
        self.assertEqual(fs.coverage, 0.0)
        self.assertIsNone(fs.source)
        self.assertIsNone(fs.asOf)

    def test_field_source_accepts_valid_status(self):
        for status in ("available", "partial", "stale", "missing"):
            fs = FieldSource(
                field="nav",
                value=1.234,
                source="tushare.fund_nav",
                asOf="2026-06-15",
                status=status,
                coverage=1.0,
            )
            self.assertEqual(fs.status, status)

    def test_field_source_full_contract(self):
        fs = FieldSource(
            field="max_drawdown",
            value=-15.3,
            source="local nav metrics",
            asOf="2026-03-31",
            status="available",
            coverage=1.0,
            missingReason=None,
        )
        d = fs.model_dump()
        self.assertEqual(d["field"], "max_drawdown")
        self.assertEqual(d["source"], "local nav metrics")
        self.assertEqual(d["status"], "available")
        self.assertEqual(d["coverage"], 1.0)

    def test_field_source_serializes_missing_reason(self):
        fs = FieldSource(
            field="sharpe",
            status="missing",
            missingReason="缺少净值历史，无法计算夏普比率",
        )
        d = fs.model_dump()
        self.assertEqual(d["missingReason"], "缺少净值历史，无法计算夏普比率")

    def test_provider_health_defaults(self):
        ph = ProviderHealth(name="akshare")
        self.assertEqual(ph.status, "unknown")
        self.assertFalse(ph.available)
        self.assertEqual(ph.failureCount, 0)
        self.assertFalse(ph.circuitOpen)

    def test_provider_health_full_contract(self):
        ph = ProviderHealth(
            name="tushare",
            capabilities=["fund_basic", "fund_nav", "fund_share"],
            status="available",
            available=True,
            lastSuccessAt="2026-06-18T10:00:00",
            lastError=None,
            cooldownUntil=None,
            failureCount=0,
            circuitOpen=False,
        )
        d = ph.model_dump()
        self.assertEqual(d["capabilities"], ["fund_basic", "fund_nav", "fund_share"])
        self.assertEqual(d["status"], "available")


class FundDetailFieldGroupsTest(unittest.TestCase):
    """Verify FUND_DETAIL_FIELD_GROUPS covers the required P0 field groups."""

    REQUIRED_GROUPS = {"basic", "nav", "scale", "holdings", "risk"}

    def test_required_groups_exist(self):
        missing = self.REQUIRED_GROUPS - set(FUND_DETAIL_FIELD_GROUPS.keys())
        self.assertEqual(missing, set(), f"Missing required field groups: {missing}")

    def test_basic_info_fields(self):
        basic = FUND_DETAIL_FIELD_GROUPS["basic"]
        self.assertIn("name", basic["fields"])
        self.assertIn("type", basic["fields"])
        self.assertIn("company", basic["fields"])
        self.assertIn("manager", basic["fields"])
        self.assertIn("establish_date", basic["fields"])
        self.assertIn("benchmark", basic["fields"])

    def test_nav_fields(self):
        nav = FUND_DETAIL_FIELD_GROUPS["nav"]
        self.assertIn("nav", nav["fields"])
        self.assertIn("adj_nav", nav["fields"])
        self.assertIn("daily_return", nav["fields"])
        self.assertIn("nav_date", nav["fields"])

    def test_scale_fields(self):
        scale = FUND_DETAIL_FIELD_GROUPS["scale"]
        self.assertIn("fund_scale", scale["fields"])
        self.assertIn("fund_share", scale["fields"])
        self.assertIn("share_date", scale["fields"])

    def test_holdings_fields(self):
        h = FUND_DETAIL_FIELD_GROUPS["holdings"]
        self.assertIn("top_holdings", h["fields"])
        self.assertIn("industry_exposure", h["fields"])

    def test_bond_holdings_fields(self):
        bond = FUND_DETAIL_FIELD_GROUPS["bondHoldings"]
        self.assertIn("bond_name", bond["fields"])
        self.assertIn("bond_code", bond["fields"])
        self.assertIn("bond_nav_ratio", bond["fields"])
        self.assertIn("bond_coupon_rate", bond["fields"])
        self.assertIn("bond_issuer", bond["fields"])
        self.assertIn("bond_type", bond["fields"])
        self.assertIn("bond_credit_rating", bond["fields"])

    def test_risk_fields(self):
        r = FUND_DETAIL_FIELD_GROUPS["risk"]
        self.assertIn("volatility", r["fields"])
        self.assertIn("max_drawdown", r["fields"])
        self.assertIn("sharpe", r["fields"])

    def test_each_group_has_source(self):
        for group, config in FUND_DETAIL_FIELD_GROUPS.items():
            self.assertIn("source", config, f"Group '{group}' missing source")
            self.assertIn("section", config, f"Group '{group}' missing section")

    def test_field_sources_from_sections_maps_all_groups(self):
        sections = {
            "overview": {"dataStatus": "available", "source": "fund_quote_snapshot", "asOf": "2026-06-18", "coverage": 1.0},
            "performance": {"dataStatus": "available", "source": "fund_quote_snapshot", "asOf": "2026-06-18", "coverage": 1.0},
            "scaleHistory": {"dataStatus": "partial", "source": "tushare.fund_share", "asOf": "2026-03-31", "coverage": 0.5, "missingReason": "partial scale history"},
            "holdings": {"dataStatus": "available", "source": "fund_portfolio_snapshot", "asOf": "2026-03-31", "coverage": 1.0},
            "bondHoldings": {"dataStatus": "partial", "source": "AkShare 东方财富F10 债券持仓", "asOf": "2026-03-31", "coverage": 0.5, "missingReason": "partial bond fields"},
            "riskSummary": {"dataStatus": "missing", "source": None, "asOf": None, "coverage": 0.0, "missingReason": "no risk metrics"},
        }
        sources = _field_sources_from_sections(sections)

        self.assertIn("name", sources)
        self.assertIn("nav", sources)
        self.assertIn("fund_scale", sources)
        self.assertIn("volatility", sources)

        # basic info group maps to overview section
        self.assertEqual(sources["name"]["source"], "fund_quote_snapshot")
        self.assertEqual(sources["name"]["status"], "available")

        # nav group maps to performance section
        self.assertEqual(sources["nav"]["source"], "fund_quote_snapshot")
        self.assertEqual(sources["nav"]["status"], "available")

        # scale group maps to scaleHistory section
        self.assertEqual(sources["fund_scale"]["status"], "partial")
        self.assertEqual(sources["fund_scale"]["missingReason"], "partial scale history")

        # bond holdings maps to its own section
        self.assertEqual(sources["bond_name"]["source"], "AkShare 东方财富F10 债券持仓")
        self.assertEqual(sources["bond_code"]["status"], "partial")
        self.assertEqual(sources["bond_code"]["missingReason"], "partial bond fields")

        # risk group maps to riskSummary section
        self.assertEqual(sources["volatility"]["status"], "missing")
        self.assertEqual(sources["volatility"]["missingReason"], "no risk metrics")

    def test_missing_section_produces_missing_fields(self):
        sections = {}  # no data at all
        sources = _field_sources_from_sections(sections)

        for field_name in ["name", "nav", "fund_scale", "bond_name", "volatility"]:
            if field_name in sources:
                self.assertEqual(sources[field_name]["status"], "missing")


class DataGatewayHealthTest(unittest.TestCase):
    """DataGateway.get_health_snapshot() exposes gateway provider health."""

    def test_initial_snapshot_has_all_gateway_providers(self):
        gw = DataGateway()
        snap = gw.get_health_snapshot()

        provider_names = {p["name"] for p in snap["providers"]}
        self.assertIn("akshare", provider_names)
        self.assertIn("efinance", provider_names)
        self.assertIn("eastmoney", provider_names)
        self.assertIn("tushare", provider_names)
        self.assertIn("ifind", provider_names)
        self.assertIn("tencent", provider_names)

        self.assertEqual(snap["totalCount"], len(snap["providers"]))

    def test_initial_status_is_unknown_for_unused_providers(self):
        gw = DataGateway()
        snap = gw.get_health_snapshot()

        akshare = next(p for p in snap["providers"] if p["name"] == "akshare")
        self.assertEqual(akshare["status"], "unknown")
        self.assertEqual(akshare["failureCount"], 0)
        self.assertFalse(akshare["circuitOpen"])

    def test_gateway_providers_have_capabilities(self):
        gw = DataGateway()
        snap = gw.get_health_snapshot()

        akshare = next(p for p in snap["providers"] if p["name"] == "akshare")
        self.assertGreater(len(akshare["capabilities"]), 0)
        self.assertIn("fund_ranking", akshare["capabilities"])

        eastmoney = next(p for p in snap["providers"] if p["name"] == "eastmoney")
        self.assertIn("fund_detail", eastmoney["capabilities"])

        tushare = next(p for p in snap["providers"] if p["name"] == "tushare")
        self.assertIn("fund_basic", tushare["capabilities"])

        ifind = next(p for p in snap["providers"] if p["name"] == "ifind")
        self.assertIn("risk_indicators", ifind["capabilities"])

        tencent = next(p for p in snap["providers"] if p["name"] == "tencent")
        self.assertIn("realtime_quote", tencent["capabilities"])

    def test_failure_counts_are_tracked(self):
        gw = DataGateway()
        # inject a failure
        gw._failures["akshare:test_endpoint"] = 9999999999.0  # far future cooldown
        snap = gw.get_health_snapshot()

        akshare = next(p for p in snap["providers"] if p["name"] == "akshare")
        self.assertGreater(akshare["failureCount"], 0)
        self.assertTrue(akshare["circuitOpen"])

    def test_provider_fields_match_contract(self):
        """Each provider entry must have the required health contract fields."""
        gw = DataGateway()
        snap = gw.get_health_snapshot()

        REQUIRED = {"name", "capabilities", "status", "available",
                     "lastSuccessAt", "lastError", "cooldownUntil",
                     "failureCount", "circuitOpen", "enabled", "data_quality"}

        for p in snap["providers"]:
            missing = REQUIRED - set(p.keys())
            self.assertEqual(missing, set(), f"Provider '{p['name']}' missing: {missing}")

    def test_available_count_matches(self):
        gw = DataGateway()
        snap = gw.get_health_snapshot()
        self.assertEqual(snap["availableCount"],
                         sum(1 for p in snap["providers"] if p["available"]))


class ProviderHealthStatusSemanticsTest(unittest.TestCase):
    """Verify provider health status uses the extended semantics: available|partial|stale|cooldown|missing|unknown."""

    VALID_STATUSES = {"available", "partial", "stale", "cooldown", "missing", "unknown"}

    def test_fusion_providers_use_valid_statuses(self):
        from app.data.providers.fusion import DataFusion
        fusion = DataFusion()
        statuses = fusion.get_providers_status()
        for p in statuses:
            self.assertIn(p["status"], self.VALID_STATUSES,
                          f"Provider '{p['name']}' has invalid status: {p['status']}")

    def test_gateway_providers_use_valid_statuses(self):
        gw = DataGateway()
        snap = gw.get_health_snapshot()
        for p in snap["providers"]:
            self.assertIn(p["status"], self.VALID_STATUSES,
                          f"Provider '{p['name']}' has invalid status: {p['status']}")

    def test_fusion_initial_status_is_missing_or_unknown(self):
        from app.data.providers.fusion import DataFusion
        fusion = DataFusion()
        statuses = fusion.get_providers_status()
        for p in statuses:
            self.assertIn(p["status"], {"missing", "unknown"},
                          f"Provider '{p['name']}' initial status should be missing or unknown, got: {p['status']}")

    def test_gateway_initial_status_is_unknown(self):
        gw = DataGateway()
        snap = gw.get_health_snapshot()
        for p in snap["providers"]:
            if p["failureCount"] == 0 and not p["circuitOpen"]:
                self.assertEqual(p["status"], "unknown",
                                 f"Provider '{p['name']}' unused should be unknown, got: {p['status']}")


class DataSourcesStatusEndpointTest(unittest.TestCase):
    """Verify the /fund/api/data-sources/status endpoint returns valid merged health."""

    def test_endpoint_returns_valid_response(self):
        from app.api.health import data_sources_status
        import asyncio
        result = asyncio.run(data_sources_status())
        self.assertIn("status", result)
        self.assertIn("providers", result)
        self.assertIn("availableCount", result)
        self.assertIn("totalCount", result)
        self.assertIsInstance(result["providers"], list)
        self.assertGreaterEqual(result["totalCount"], 4)  # at least fusion providers
        self.assertEqual(result["availableCount"],
                         sum(1 for p in result["providers"] if p.get("available")))

    def test_endpoint_providers_have_required_fields(self):
        from app.api.health import data_sources_status
        import asyncio
        result = asyncio.run(data_sources_status())
        REQUIRED = {"name", "capabilities", "status", "available",
                     "lastSuccessAt", "lastError", "cooldownUntil",
                     "failureCount", "circuitOpen", "enabled", "data_quality"}
        for p in result["providers"]:
            missing = REQUIRED - set(p.keys())
            self.assertEqual(missing, set(),
                             f"Provider '{p.get('name')}' missing fields: {missing}")

    def test_endpoint_deduplicates_fusion_and_gateway(self):
        from app.api.health import data_sources_status
        import asyncio
        result = asyncio.run(data_sources_status())
        names = [p["name"] for p in result["providers"]]
        # fusion providers should appear only once
        for name in ["tushare", "ifind", "tickflow", "tencent"]:
            self.assertEqual(names.count(name), 1,
                             f"Provider '{name}' appears {names.count(name)} times, expected 1")


if __name__ == "__main__":
    unittest.main()
