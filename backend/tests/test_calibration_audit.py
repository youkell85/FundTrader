"""Focused tests for calibration_audit -- read-only audit of StatsSnapshotCache("historical_calibration")."""
import unittest
from unittest.mock import patch

from app.allocation.calibration_audit import (
    AuditPolicy,
    CalibrationSectionItem,
    _apply_numeric_override,
    _build_section,
    _check_jump_drift,
    _check_numeric_drift,
    _find_section,
    _resolve_policy,
    _section_status_from_result,
    _summarize_static_section,
    audit_calibration,
)
from app.allocation.config import EQUILIBRIUM_RETURNS, EQUILIBRIUM_VOLS


class AuditPolicyTest(unittest.TestCase):
    def test_default_policy_has_static_defaults(self):
        policy = AuditPolicy()
        self.assertEqual(policy.return_drift_threshold, 3.0)
        self.assertEqual(policy.vol_drift_threshold, 5.0)
        self.assertEqual(policy.jump_probability_min, 0.0)
        self.assertEqual(policy.jump_probability_max, 0.10)
        self.assertEqual(policy.coverage_threshold, 0.7)
        self.assertEqual(policy.policy_source, "static_defaults")
        self.assertIsNone(policy.policy_version)

    def test_to_dict_includes_all_fields(self):
        policy = AuditPolicy()
        d = policy.to_dict()
        self.assertEqual(d["return_drift_threshold"], 3.0)
        self.assertEqual(d["vol_drift_threshold"], 5.0)
        self.assertEqual(d["jump_probability_min"], 0.0)
        self.assertEqual(d["jump_probability_max"], 0.10)
        self.assertEqual(d["coverage_threshold"], 0.7)
        self.assertEqual(d["policy_source"], "static_defaults")
        self.assertNotIn("policy_version", d)

    def test_to_dict_includes_policy_version_when_set(self):
        policy = AuditPolicy(policy_version="v2.1")
        d = policy.to_dict()
        self.assertEqual(d["policy_version"], "v2.1")


class ResolvePolicyTest(unittest.TestCase):
    def test_none_cache_returns_default(self):
        policy = _resolve_policy(None)
        self.assertEqual(policy.policy_source, "static_defaults")
        self.assertEqual(policy.return_drift_threshold, 3.0)

    def test_empty_cache_returns_default(self):
        policy = _resolve_policy({})
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_no_policy_key_returns_default(self):
        policy = _resolve_policy({"equilibrium_returns": {}})
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_flat_policy_overrides_thresholds(self):
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": 5.0,
                "vol_drift_threshold": 8.0,
                "coverage_threshold": 0.5,
                "policy_version": "v2",
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.return_drift_threshold, 5.0)
        self.assertEqual(policy.vol_drift_threshold, 8.0)
        self.assertEqual(policy.coverage_threshold, 0.5)
        self.assertEqual(policy.policy_version, "v2")
        self.assertEqual(policy.policy_source, "cache_override")

    def test_nested_params_policy_overrides_thresholds(self):
        cache = {
            "calibration_audit_policy": {
                "params": {
                    "return_drift_threshold": 4.0,
                    "jump_probability_min": 0.01,
                    "jump_probability_max": 0.15,
                }
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.return_drift_threshold, 4.0)
        self.assertEqual(policy.jump_probability_min, 0.01)
        self.assertEqual(policy.jump_probability_max, 0.15)
        self.assertEqual(policy.policy_source, "cache_override")

    def test_malformed_non_finite_ignored(self):
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": float("nan"),
                "vol_drift_threshold": float("inf"),
                "coverage_threshold": float("-inf"),
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.return_drift_threshold, 3.0)
        self.assertEqual(policy.vol_drift_threshold, 5.0)
        self.assertEqual(policy.coverage_threshold, 0.7)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_malformed_negative_threshold_ignored(self):
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": -1.0,
                "vol_drift_threshold": -0.5,
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.return_drift_threshold, 3.0)
        self.assertEqual(policy.vol_drift_threshold, 5.0)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_malformed_zero_threshold_ignored(self):
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": 0.0,
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.return_drift_threshold, 3.0)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_malformed_bool_ignored(self):
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": True,
                "coverage_threshold": False,
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.return_drift_threshold, 3.0)
        self.assertEqual(policy.coverage_threshold, 0.7)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_malformed_string_ignored(self):
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": "five",
                "coverage_threshold": "0.8",
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.return_drift_threshold, 3.0)
        self.assertEqual(policy.coverage_threshold, 0.7)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_malformed_policy_not_dict_ignored(self):
        cache = {"calibration_audit_policy": "not_a_dict"}
        policy = _resolve_policy(cache)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_malformed_params_not_dict_ignored(self):
        cache = {"calibration_audit_policy": {"params": "not_a_dict"}}
        policy = _resolve_policy(cache)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_jump_prob_min_exceeds_max_ignored(self):
        cache = {
            "calibration_audit_policy": {
                "jump_probability_min": 0.20,
                "jump_probability_max": 0.10,
            }
        }
        policy = _resolve_policy(cache)
        # jump_probability_min=0.20 fails le=policy.jump_probability_max (0.10)
        self.assertEqual(policy.jump_probability_min, 0.0)
        # jump_probability_max=0.10 passes ge=policy.jump_probability_min (0.0)
        # but equals the default, so no override is detected
        self.assertEqual(policy.jump_probability_max, 0.10)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_jump_prob_max_exceeds_one_ignored(self):
        cache = {
            "calibration_audit_policy": {
                "jump_probability_max": 1.5,
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.jump_probability_max, 0.10)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_coverage_threshold_out_of_range_ignored(self):
        cache = {
            "calibration_audit_policy": {
                "coverage_threshold": 1.5,
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.coverage_threshold, 0.7)
        self.assertEqual(policy.policy_source, "static_defaults")

    def test_partial_override_mixed_valid_and_invalid(self):
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": 4.0,
                "vol_drift_threshold": float("nan"),
                "coverage_threshold": "bad",
                "policy_version": "v3",
            }
        }
        policy = _resolve_policy(cache)
        self.assertEqual(policy.return_drift_threshold, 4.0)
        self.assertEqual(policy.vol_drift_threshold, 5.0)
        self.assertEqual(policy.coverage_threshold, 0.7)
        self.assertEqual(policy.policy_version, "v3")
        self.assertEqual(policy.policy_source, "cache_override")


class ApplyNumericOverrideTest(unittest.TestCase):
    def test_valid_override_applied(self):
        policy = AuditPolicy()
        _apply_numeric_override({"return_drift_threshold": 4.5}, "return_drift_threshold", policy, gt=0.0)
        self.assertEqual(policy.return_drift_threshold, 4.5)

    def test_int_value_accepted(self):
        policy = AuditPolicy()
        _apply_numeric_override({"return_drift_threshold": 4}, "return_drift_threshold", policy, gt=0.0)
        self.assertEqual(policy.return_drift_threshold, 4.0)

    def test_bool_rejected(self):
        policy = AuditPolicy()
        _apply_numeric_override({"return_drift_threshold": True}, "return_drift_threshold", policy, gt=0.0)
        self.assertEqual(policy.return_drift_threshold, 3.0)

    def test_nan_rejected(self):
        policy = AuditPolicy()
        _apply_numeric_override({"return_drift_threshold": float("nan")}, "return_drift_threshold", policy, gt=0.0)
        self.assertEqual(policy.return_drift_threshold, 3.0)

    def test_inf_rejected(self):
        policy = AuditPolicy()
        _apply_numeric_override({"return_drift_threshold": float("inf")}, "return_drift_threshold", policy, gt=0.0)
        self.assertEqual(policy.return_drift_threshold, 3.0)

    def test_ge_bound_enforced(self):
        policy = AuditPolicy()
        _apply_numeric_override({"coverage_threshold": -0.1}, "coverage_threshold", policy, ge=0.0)
        self.assertEqual(policy.coverage_threshold, 0.7)

    def test_le_bound_enforced(self):
        policy = AuditPolicy()
        _apply_numeric_override({"coverage_threshold": 1.2}, "coverage_threshold", policy, le=1.0)
        self.assertEqual(policy.coverage_threshold, 0.7)


class CalibrationSectionItemTest(unittest.TestCase):
    def test_to_dict_includes_key(self):
        item = CalibrationSectionItem(
            key="equilibrium_returns",
            status="real",
            source="historical_market_data",
            as_of="2026-06-10",
            calibration_version="v1",
            coverage=0.95,
            invalid_count=0,
            assumption_count=0,
            warnings=[],
        )
        d = item.to_dict()
        self.assertEqual(d["key"], "equilibrium_returns")
        self.assertEqual(d["status"], "real")
        self.assertEqual(d["source"], "historical_market_data")
        self.assertEqual(d["as_of"], "2026-06-10")
        self.assertEqual(d["calibration_version"], "v1")
        self.assertEqual(d["coverage"], 0.95)

    def test_to_dict_omits_none_optionals(self):
        item = CalibrationSectionItem(
            key="stress_scenarios",
            status="missing",
            source="none",
            warnings=["no data"],
        )
        d = item.to_dict()
        self.assertNotIn("as_of", d)
        self.assertNotIn("calibration_version", d)
        self.assertNotIn("coverage", d)


class SectionStatusTest(unittest.TestCase):
    def test_static_assumption_returns_assumption(self):
        status, warnings = _section_status_from_result({"source": "static_assumption"})
        self.assertEqual(status, "assumption")
        self.assertEqual(warnings, [])

    def test_unknown_source_returns_missing(self):
        status, warnings = _section_status_from_result({"source": "unknown"})
        self.assertEqual(status, "missing")
        self.assertIn("no calibration data loaded", warnings)

    def test_low_coverage_returns_partial(self):
        status, warnings = _section_status_from_result({
            "source": "historical_market_data",
            "coverage": 0.5,
            "values": {"a_share_large": 8.0},
        })
        self.assertEqual(status, "partial")
        self.assertTrue(any("coverage" in w for w in warnings))

    def test_invalid_assets_returns_partial(self):
        status, warnings = _section_status_from_result({
            "source": "historical_market_data",
            "coverage": 0.9,
            "values": {"a_share_large": 8.0},
            "invalid_assets": {"cash": "no_etf"},
        })
        self.assertEqual(status, "partial")
        self.assertTrue(any("rejected" in w for w in warnings))

    def test_assumptions_used_returns_partial(self):
        status, warnings = _section_status_from_result({
            "source": "historical_market_data",
            "coverage": 0.9,
            "values": {"a_share_large": 8.0},
            "assumptions_used": ["cash_fallback"],
        })
        self.assertEqual(status, "partial")
        self.assertTrue(any("assumptions" in w for w in warnings))

    def test_clean_result_returns_real(self):
        status, warnings = _section_status_from_result({
            "source": "historical_market_data",
            "coverage": 0.95,
            "values": {"a_share_large": 8.0},
            "invalid_assets": {},
            "assumptions_used": [],
        })
        self.assertEqual(status, "real")
        self.assertEqual(warnings, [])

    def test_custom_coverage_threshold_changes_classification(self):
        """Coverage 0.6 is partial under default 0.7 but real under custom 0.5."""
        result = {
            "source": "historical_market_data",
            "coverage": 0.6,
            "values": {"a_share_large": 8.0},
            "invalid_assets": {},
            "assumptions_used": [],
        }
        # Default threshold 0.7 -> partial
        status_default, _ = _section_status_from_result(result)
        self.assertEqual(status_default, "partial")
        # Custom threshold 0.5 -> real
        status_custom, _ = _section_status_from_result(result, coverage_threshold=0.5)
        self.assertEqual(status_custom, "real")


class BuildSectionTest(unittest.TestCase):
    def test_none_result_returns_missing(self):
        section = _build_section("equilibrium_returns", None)
        self.assertEqual(section.key, "equilibrium_returns")
        self.assertEqual(section.status, "missing")
        self.assertEqual(section.source, "none")
        self.assertIn("section not found", section.warnings[0])

    def test_valid_result_preserves_key(self):
        result = {
            "source": "historical_market_data",
            "coverage": 0.95,
            "values": {"a_share_large": 8.0},
            "invalid_assets": {},
            "assumptions_used": [],
            "as_of": "2026-06-10",
            "calibration_version": "v1",
        }
        section = _build_section("equilibrium_returns", result)
        self.assertEqual(section.key, "equilibrium_returns")
        self.assertEqual(section.status, "real")
        self.assertEqual(section.as_of, "2026-06-10")
        self.assertEqual(section.calibration_version, "v1")
        self.assertEqual(section.coverage, 0.95)

    def test_custom_coverage_threshold_used(self):
        result = {
            "source": "historical_market_data",
            "coverage": 0.6,
            "values": {"a_share_large": 8.0},
            "invalid_assets": {},
            "assumptions_used": [],
        }
        section = _build_section("equilibrium_returns", result, coverage_threshold=0.5)
        self.assertEqual(section.status, "real")


class SummarizeStaticSectionTest(unittest.TestCase):
    def test_returns_assumption_with_key(self):
        section = _summarize_static_section("jump_params", "uses static defaults")
        self.assertEqual(section.key, "jump_params")
        self.assertEqual(section.status, "assumption")
        self.assertEqual(section.source, "static_config")
        self.assertEqual(section.assumption_count, 1)
        self.assertIn("uses static defaults", section.warnings)


class FindSectionTest(unittest.TestCase):
    def test_finds_by_key(self):
        sections = [
            CalibrationSectionItem(key="equilibrium_returns", status="real", source="hist"),
            CalibrationSectionItem(key="equilibrium_vols", status="real", source="hist"),
            CalibrationSectionItem(key="jump_params", status="assumption", source="static"),
        ]
        found = _find_section(sections, "jump_params")
        self.assertIsNotNone(found)
        self.assertEqual(found.key, "jump_params")
        self.assertEqual(found.status, "assumption")

    def test_returns_none_for_unknown_key(self):
        sections = [
            CalibrationSectionItem(key="equilibrium_returns", status="real", source="hist"),
        ]
        found = _find_section(sections, "nonexistent")
        self.assertIsNone(found)


class NumericDriftTest(unittest.TestCase):
    def test_return_drift_warns_on_large_deviation(self):
        calibrated = {"values": {"a_share_large": 15.0}}
        static = {"a_share_large": 8.0}
        warnings = _check_numeric_drift(calibrated, static, 3.0, "return")
        self.assertTrue(len(warnings) > 0)
        self.assertIn("a_share_large", warnings[0])
        self.assertIn("delta=", warnings[0])

    def test_return_drift_silent_on_small_deviation(self):
        calibrated = {"values": {"a_share_large": 9.0}}
        static = {"a_share_large": 8.0}
        warnings = _check_numeric_drift(calibrated, static, 3.0, "return")
        self.assertEqual(warnings, [])

    def test_vol_drift_warns_on_large_deviation(self):
        calibrated = {"values": {"a_share_large": 30.0}}
        static = {"a_share_large": 20.0}
        warnings = _check_numeric_drift(calibrated, static, 5.0, "vol")
        self.assertTrue(len(warnings) > 0)
        self.assertIn("a_share_large", warnings[0])

    def test_handles_none_calibrated(self):
        warnings = _check_numeric_drift(None, EQUILIBRIUM_RETURNS, 3.0, "return")
        self.assertEqual(warnings, [])

    def test_handles_empty_values(self):
        warnings = _check_numeric_drift({"values": {}}, EQUILIBRIUM_RETURNS, 3.0, "return")
        self.assertEqual(warnings, [])

    def test_handles_non_numeric_values(self):
        calibrated = {"values": {"a_share_large": "n/a"}}
        warnings = _check_numeric_drift(calibrated, EQUILIBRIUM_RETURNS, 3.0, "return")
        self.assertEqual(warnings, [])

    def test_custom_threshold_changes_warning_behaviour(self):
        """Deviation of 4.0 warns at threshold 3.0 but not at threshold 5.0."""
        calibrated = {"values": {"a_share_large": 12.0}}
        static = {"a_share_large": 8.0}
        warnings_strict = _check_numeric_drift(calibrated, static, 3.0, "return")
        self.assertTrue(len(warnings_strict) > 0)
        warnings_loose = _check_numeric_drift(calibrated, static, 5.0, "return")
        self.assertEqual(warnings_loose, [])


class JumpDriftTest(unittest.TestCase):
    def test_warns_when_jump_prob_out_of_range(self):
        params = {"params": {"jump_probability": 0.15}}
        warnings = _check_jump_drift(params)
        self.assertTrue(len(warnings) > 0)
        self.assertIn("jump_probability", warnings[0])

    def test_silent_when_jump_prob_in_range(self):
        params = {"params": {"jump_probability": 0.03}}
        warnings = _check_jump_drift(params)
        self.assertEqual(warnings, [])

    def test_handles_none_params(self):
        warnings = _check_jump_drift(None)
        self.assertEqual(warnings, [])

    def test_missing_jump_prob_reports_missing_without_default(self):
        params = {"params": {"jump_mean": -0.04, "jump_vol": 0.08}}
        warnings = _check_jump_drift(params)
        self.assertEqual(warnings, ["jump_params/jump_probability: missing"])

    def test_handles_unreadable_jump_prob(self):
        params = {"params": {"jump_probability": "unknown"}}
        warnings = _check_jump_drift(params)
        self.assertTrue(len(warnings) > 0)
        self.assertIn("unreadable", warnings[0])

    def test_custom_jump_range_changes_warning_behaviour(self):
        """jump_prob=0.12 warns at default range [0.0, 0.10] but not at [0.0, 0.15]."""
        params = {"params": {"jump_probability": 0.12}}
        warnings_default = _check_jump_drift(params)
        self.assertTrue(len(warnings_default) > 0)
        warnings_custom = _check_jump_drift(params, jump_prob_range=(0.0, 0.15))
        self.assertEqual(warnings_custom, [])

    def test_custom_jump_min_triggers_warning(self):
        """jump_prob=0.005 is fine at default min 0.0 but warns at custom min 0.01."""
        params = {"params": {"jump_probability": 0.005}}
        warnings_default = _check_jump_drift(params)
        self.assertEqual(warnings_default, [])
        warnings_custom = _check_jump_drift(params, jump_prob_range=(0.01, 0.10))
        self.assertTrue(len(warnings_custom) > 0)


class AuditCalibrationTest(unittest.TestCase):
    def test_missing_cache_returns_unknown(self):
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = None
            result = audit_calibration()
        self.assertEqual(result["health"], "unknown")
        self.assertEqual(result["missing_count"], 9)
        self.assertEqual(len(result["sections"]), 9)
        for s in result["sections"]:
            self.assertIn("key", s)
            self.assertEqual(s["status"], "missing")
        # Policy is present even when cache is missing
        self.assertIn("policy", result)
        self.assertEqual(result["policy"]["policy_source"], "static_defaults")

    def test_cache_exception_returns_unknown(self):
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.side_effect = RuntimeError("db connection lost")
            result = audit_calibration()
        self.assertEqual(result["health"], "unknown")
        self.assertEqual(result["missing_count"], 9)
        self.assertIn("policy", result)

    def test_malformed_section_returns_missing_item(self):
        cache = {"equilibrium_returns": None, "equilibrium_vols": "not_a_dict"}
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        # All 9 sections should exist; the two above are missing
        sections_by_key = {s["key"]: s for s in result["sections"]}
        self.assertEqual(sections_by_key["equilibrium_returns"]["status"], "missing")
        self.assertEqual(sections_by_key["equilibrium_vols"]["status"], "missing")

    def test_historical_section_fields_flow_through(self):
        cache = {
            "equilibrium_returns": {
                "values": {"a_share_large": 8.5},
                "source": "historical_market_data",
                "as_of": "2026-06-10",
                "calibration_version": "historical-calibrator-v1",
                "coverage": 0.95,
                "valid_assets": ["a_share_large"],
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        sections_by_key = {s["key"]: s for s in result["sections"]}
        eq = sections_by_key["equilibrium_returns"]
        self.assertEqual(eq["status"], "real")
        self.assertEqual(eq["source"], "historical_market_data")
        self.assertEqual(eq["as_of"], "2026-06-10")
        self.assertEqual(eq["calibration_version"], "historical-calibrator-v1")
        self.assertEqual(eq["coverage"], 0.95)

    def test_static_assumption_section_reports_assumption(self):
        cache = {
            "equilibrium_returns": {
                "values": {"a_share_large": 8.5},
                "source": "static_assumption",
                "coverage": 0.0,
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        sections_by_key = {s["key"]: s for s in result["sections"]}
        eq = sections_by_key["equilibrium_returns"]
        self.assertEqual(eq["status"], "assumption")

    def test_static_jump_params_do_not_use_default_probability(self):
        cache = {
            "jump_params": {
                "params": {"jump_mean": -0.04, "jump_vol": 0.08},
                "source": "static_assumption",
                "coverage": 0.0,
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        sections_by_key = {s["key"]: s for s in result["sections"]}
        jp = sections_by_key["jump_params"]
        self.assertEqual(jp["status"], "assumption")
        self.assertEqual(jp["warnings"], [])

    def test_real_jump_params_missing_probability_warns_missing(self):
        cache = {
            "jump_params": {
                "params": {"jump_mean": -0.04, "jump_vol": 0.08},
                "source": "historical_market_data",
                "coverage": 1.0,
                "valid_assets": ["a_share_large"],
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        sections_by_key = {s["key"]: s for s in result["sections"]}
        jp = sections_by_key["jump_params"]
        self.assertEqual(jp["status"], "real")
        self.assertIn("jump_params/jump_probability: missing", jp["warnings"])

    def test_drift_warning_on_large_return_deviation(self):
        cache = {
            "equilibrium_returns": {
                "values": {k: v + 10.0 for k, v in EQUILIBRIUM_RETURNS.items()},
                "source": "historical_market_data",
                "coverage": 1.0,
                "valid_assets": list(EQUILIBRIUM_RETURNS.keys()),
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        sections_by_key = {s["key"]: s for s in result["sections"]}
        eq = sections_by_key["equilibrium_returns"]
        drift_warnings = [w for w in eq["warnings"] if "delta=" in w]
        self.assertTrue(len(drift_warnings) > 0)

    def test_drift_warning_on_large_vol_deviation(self):
        cache = {
            "equilibrium_vols": {
                "values": {k: v + 15.0 for k, v in EQUILIBRIUM_VOLS.items()},
                "source": "historical_market_data",
                "coverage": 1.0,
                "valid_assets": list(EQUILIBRIUM_VOLS.keys()),
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        sections_by_key = {s["key"]: s for s in result["sections"]}
        eq = sections_by_key["equilibrium_vols"]
        drift_warnings = [w for w in eq["warnings"] if "delta=" in w]
        self.assertTrue(len(drift_warnings) > 0)

    def test_all_real_sections_no_warnings_is_healthy(self):
        def _make_real_section(values=None):
            return {
                "values": values or {"a_share_large": 8.5},
                "source": "historical_market_data",
                "coverage": 1.0,
                "valid_assets": ["a_share_large"],
                "invalid_assets": {},
                "assumptions_used": [],
            }

        cache = {}
        # equilibrium_returns: use values close to static to avoid drift
        cache["equilibrium_returns"] = _make_real_section({"a_share_large": 8.5})
        cache["equilibrium_vols"] = _make_real_section({"a_share_large": 22.0})
        cache["correlation_matrix"] = {
            "matrix": [[1.0]],
            "source": "historical_market_data",
            "coverage": 1.0,
            "valid_assets": ["a_share_large"],
            "invalid_assets": {},
            "assumptions_used": [],
        }
        # Other sections -- no values key needed, just source/coverage/vars
        for key in [
            "stress_scenarios", "regime_thresholds",
            "circuit_breaker_destination", "scenario_analysis", "risk_questionnaire",
        ]:
            cache[key] = {
                "values": {"a_share_large": 1.0},
                "source": "historical_market_data",
                "coverage": 1.0,
                "valid_assets": ["a_share_large"],
                "invalid_assets": {},
                "assumptions_used": [],
            }
        cache["jump_params"] = {
            "params": {"jump_probability": 0.03},
            "source": "historical_market_data",
            "coverage": 1.0,
            "valid_assets": ["a_share_large"],
            "invalid_assets": {},
            "assumptions_used": [],
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        self.assertEqual(result["health"], "healthy")
        self.assertEqual(result["warning_count"], 0)
        self.assertEqual(result["missing_count"], 0)

    # --- Policy integration tests ---

    def test_default_policy_exposed_in_result(self):
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = None
            result = audit_calibration()
        self.assertIn("policy", result)
        policy = result["policy"]
        self.assertEqual(policy["return_drift_threshold"], 3.0)
        self.assertEqual(policy["vol_drift_threshold"], 5.0)
        self.assertEqual(policy["jump_probability_min"], 0.0)
        self.assertEqual(policy["jump_probability_max"], 0.10)
        self.assertEqual(policy["coverage_threshold"], 0.7)
        self.assertEqual(policy["policy_source"], "static_defaults")

    def test_cache_policy_overrides_thresholds_in_result(self):
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": 5.0,
                "vol_drift_threshold": 10.0,
                "policy_version": "v2",
            },
            "equilibrium_returns": {
                "values": {"a_share_large": 12.0},
                "source": "historical_market_data",
                "coverage": 1.0,
                "valid_assets": ["a_share_large"],
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        policy = result["policy"]
        self.assertEqual(policy["return_drift_threshold"], 5.0)
        self.assertEqual(policy["vol_drift_threshold"], 10.0)
        self.assertEqual(policy["policy_version"], "v2")
        self.assertEqual(policy["policy_source"], "cache_override")

    def test_custom_coverage_threshold_changes_section_classification(self):
        """Coverage 0.6 is partial under default 0.7 but real under custom 0.5."""
        cache = {
            "calibration_audit_policy": {
                "coverage_threshold": 0.5,
            },
            "equilibrium_returns": {
                "values": {"a_share_large": 8.5},
                "source": "historical_market_data",
                "coverage": 0.6,
                "valid_assets": ["a_share_large"],
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        sections_by_key = {s["key"]: s for s in result["sections"]}
        eq = sections_by_key["equilibrium_returns"]
        self.assertEqual(eq["status"], "real")

    def test_custom_return_drift_threshold_changes_warning_behaviour(self):
        """Deviation of 4.0 warns at default 3.0 but not at custom 5.0."""
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": 5.0,
            },
            "equilibrium_returns": {
                "values": {k: v + 4.0 for k, v in EQUILIBRIUM_RETURNS.items()},
                "source": "historical_market_data",
                "coverage": 1.0,
                "valid_assets": list(EQUILIBRIUM_RETURNS.keys()),
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        sections_by_key = {s["key"]: s for s in result["sections"]}
        eq = sections_by_key["equilibrium_returns"]
        drift_warnings = [w for w in eq["warnings"] if "delta=" in w]
        self.assertEqual(drift_warnings, [])

    def test_custom_jump_range_changes_warning_behaviour(self):
        """jump_prob=0.12 warns at default [0.0,0.10] but not at custom [0.0,0.15]."""
        cache = {
            "calibration_audit_policy": {
                "jump_probability_max": 0.15,
            },
            "jump_params": {
                "params": {"jump_probability": 0.12},
                "source": "historical_market_data",
                "coverage": 1.0,
                "valid_assets": ["a_share_large"],
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        sections_by_key = {s["key"]: s for s in result["sections"]}
        jp = sections_by_key["jump_params"]
        jump_warnings = [w for w in jp["warnings"] if "jump_probability" in w]
        self.assertEqual(jump_warnings, [])

    def test_malformed_policy_does_not_break_audit(self):
        cache = {
            "calibration_audit_policy": {
                "return_drift_threshold": float("nan"),
                "coverage_threshold": "bad",
                "jump_probability_min": -1.0,
            },
            "equilibrium_returns": {
                "values": {"a_share_large": 8.5},
                "source": "historical_market_data",
                "coverage": 0.95,
                "valid_assets": ["a_share_large"],
                "invalid_assets": {},
                "assumptions_used": [],
            },
        }
        with patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_cache.get.return_value = cache
            result = audit_calibration()
        # Should still produce a valid result with default policy
        self.assertIn("policy", result)
        self.assertEqual(result["policy"]["policy_source"], "static_defaults")
        self.assertIn("health", result)
        self.assertIn("sections", result)


class PipelineHealthIncludesCalibrationTest(unittest.TestCase):
    def test_get_pipeline_health_includes_calibration_key(self):
        from app.allocation.orchestrator import get_pipeline_health

        with patch("app.allocation.orchestrator.get_regime_status") as mock_regime, \
             patch("app.allocation.orchestrator.get_breaker_status") as mock_breaker, \
             patch("app.storage.database.StatsSnapshotCache") as mock_cache:
            mock_regime.return_value = {
                "confirmed_regime": "baseline", "confirmed_label": "base",
                "pending_regime": None, "pending_label": None,
                "pending_count": 0, "is_stable": True,
            }
            mock_breaker.return_value = {
                "confirmed_level": 0, "confirmed_name": "normal",
                "reduction_pct": 0, "pending_downgrade": None,
                "pending_name": None, "downgrade_confirm_count": 0, "is_stable": True,
            }
            mock_cache.get.return_value = None

            result = get_pipeline_health()

        self.assertIn("calibration", result)
        self.assertIsInstance(result["calibration"], dict)
        self.assertIn("health", result["calibration"])
        self.assertIn("sections", result["calibration"])
        self.assertIn("policy", result["calibration"])

    def test_get_pipeline_health_calibration_exception_is_graceful(self):
        from app.allocation.orchestrator import get_pipeline_health

        with patch("app.allocation.orchestrator.get_regime_status") as mock_regime, \
             patch("app.allocation.orchestrator.get_breaker_status") as mock_breaker, \
             patch("app.allocation.calibration_audit.audit_calibration", side_effect=RuntimeError("boom")):
            mock_regime.return_value = {
                "confirmed_regime": "baseline", "confirmed_label": "base",
                "pending_regime": None, "pending_label": None,
                "pending_count": 0, "is_stable": True,
            }
            mock_breaker.return_value = {
                "confirmed_level": 0, "confirmed_name": "normal",
                "reduction_pct": 0, "pending_downgrade": None,
                "pending_name": None, "downgrade_confirm_count": 0, "is_stable": True,
            }

            result = get_pipeline_health()

        self.assertIn("calibration", result)
        self.assertEqual(result["calibration"]["health"], "unknown")
        self.assertEqual(result["calibration"]["sections"], [])
        self.assertIn("policy", result["calibration"])
        self.assertEqual(result["calibration"]["policy"]["policy_source"], "static_defaults")


if __name__ == "__main__":
    unittest.main()
