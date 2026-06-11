"""Tests for risk questionnaire calibration metadata (P2-RISK-QUESTIONNAIRE-001).

Covers:
- Default static behavior is unchanged
- Cache-backed weights/thresholds can shift risk differently
- Invalid cache data falls back to static behavior
- Unknown answers are ignored
- Provenance fields appear in profile/summary where appropriate
"""
import pytest
from unittest.mock import patch

from app.allocation.models import AllocationRequest, RiskProfile, UserProfileSummary
from app.allocation.risk_profiler import (
    _BEHAVIOR_ADJUSTMENTS,
    _DEFAULT_SHIFT_DOWN_THRESHOLD,
    _DEFAULT_SHIFT_UP_THRESHOLD,
    _load_calibration,
    profile_user,
)


# ─── Helpers ────────────────────────────────────────────────────────────────────

def _make_request(answers=None, risk_tolerance="balanced", age=35):
    return AllocationRequest(
        age=age,
        goal_type="wealth",
        investment_horizon="medium",
        amount=500000,
        risk_tolerance=risk_tolerance,
        behavior_answers=answers or {},
        preferred_tags=[],
    )


def _make_cache_section(**kwargs):
    """Build a valid risk_questionnaire cache section."""
    return {"risk_questionnaire": kwargs}


# ─── Default static behavior is unchanged ───────────────────────────────────────

class TestDefaultStaticBehavior:
    """Without any cache, behavior must match pre-calibration hard-coded values."""

    @patch("app.allocation.risk_profiler._load_calibration", return_value=(None, None))
    def test_no_answers_returns_base_risk(self, _mock_cal):
        profile = profile_user(_make_request())
        assert profile.risk_tolerance == "balanced"
        assert profile.effective_risk == "balanced"
        assert profile.behavior_adjusted is False
        assert profile.behavior_score is None
        assert profile.behavior_question_count is None
        assert profile.behavior_source == "static_defaults"

    def test_conservative_answers_shift_down(self):
        """q1=sell(-2), q2=all_out(-1), q3=none(-2) → avg=-1.67 < -0.5 → shift down"""
        answers = {"q1_drawdown": "sell", "q2_rally": "all_out", "q3_volatility": "none"}
        profile = profile_user(_make_request(answers, risk_tolerance="balanced"))
        assert profile.effective_risk == "moderate"
        assert profile.behavior_adjusted is True
        assert profile.behavior_score == pytest.approx(-1.6667, abs=0.001)
        assert profile.behavior_question_count == 3

    def test_aggressive_answers_shift_up(self):
        """q1=add(1), q2=hold(1), q3=high(2) → avg=1.33 > 1.5? No, stays balanced.
        Let's use q1=add(1), q2=hold(1), q3=high(2) → avg=1.33, not > 1.5.
        Need q1=add(1), q3=high(2) → avg=1.5, not > 1.5.
        Need q3=high(2) alone → avg=2.0 > 1.5 → shift up."""
        answers = {"q3_volatility": "high"}
        profile = profile_user(_make_request(answers, risk_tolerance="balanced"))
        assert profile.effective_risk == "aggressive"
        assert profile.behavior_adjusted is True
        assert profile.behavior_score == 2.0

    def test_neutral_answers_no_shift(self):
        """q1=hold(0), q2=partial(0), q3=medium(0) → avg=0.0, no shift"""
        answers = {"q1_drawdown": "hold", "q2_rally": "partial", "q3_volatility": "medium"}
        profile = profile_user(_make_request(answers, risk_tolerance="balanced"))
        assert profile.effective_risk == "balanced"
        assert profile.behavior_adjusted is False
        assert profile.behavior_score == 0.0

    def test_unknown_answers_ignored(self):
        """Unknown qid and unknown answer values are silently ignored."""
        answers = {
            "q1_drawdown": "hold",  # valid: 0
            "q_unknown": "something",  # unknown qid → ignored
            "q2_rally": "nonexistent",  # unknown answer → ignored
        }
        profile = profile_user(_make_request(answers, risk_tolerance="balanced"))
        # Only q1_drawdown=hold counted → avg=0.0, no shift
        assert profile.effective_risk == "balanced"
        assert profile.behavior_adjusted is False
        assert profile.behavior_score == 0.0
        assert profile.behavior_question_count == 1

    def test_empty_answers_no_shift(self):
        profile = profile_user(_make_request({}, risk_tolerance="aggressive"))
        assert profile.effective_risk == "aggressive"
        assert profile.behavior_adjusted is False

    def test_boundary_at_conservative_no_underflow(self):
        """Already conservative, shift down stays conservative."""
        answers = {"q1_drawdown": "sell", "q2_rally": "all_out", "q3_volatility": "none"}
        profile = profile_user(_make_request(answers, risk_tolerance="conservative"))
        assert profile.effective_risk == "conservative"

    def test_boundary_at_radical_no_overflow(self):
        """Already radical, shift up stays radical."""
        answers = {"q3_volatility": "high"}
        profile = profile_user(_make_request(answers, risk_tolerance="radical"))
        assert profile.effective_risk == "radical"


# ─── Cache-backed calibration ──────────────────────────────────────────────────

class TestCacheBackedCalibration:
    """When a valid cache exists, weights and thresholds come from the cache."""

    def test_custom_weights_shift_differently(self):
        """Custom weights make 'hold' worth +3, shifting up where static wouldn't."""
        custom_weights = {
            "q1_drawdown": {"add": 1, "hold": 3, "reduce": -1, "sell": -2},
            "q2_rally": {"chase": 0, "hold": 3, "partial": 0, "all_out": -1},
            "q3_volatility": {"high": 2, "medium": 0, "low": -1, "none": -2},
        }
        cache = _make_cache_section(weights=custom_weights)
        with patch(
            "app.allocation.risk_profiler._load_calibration",
            return_value=(custom_weights, {"source": "sqlite_cache"}),
        ):
            # Static: hold(0)+hold(1)+medium(0) → avg=0.33, no shift
            # Custom: hold(3)+hold(3)+medium(0) → avg=2.0 > 1.5 → shift up
            answers = {"q1_drawdown": "hold", "q2_rally": "hold", "q3_volatility": "medium"}
            profile = profile_user(_make_request(answers, risk_tolerance="balanced"))
            assert profile.effective_risk == "aggressive"
            assert profile.behavior_adjusted is True
            assert profile.behavior_score == 2.0
            assert profile.behavior_source == "sqlite_cache"

    def test_custom_thresholds_change_shift_boundary(self):
        """Lower shift_up threshold to 0.5: avg=1.0 now shifts up."""
        cache = _make_cache_section(
            shift_down_threshold=-0.5,
            shift_up_threshold=0.5,
        )
        with patch(
            "app.allocation.risk_profiler._load_calibration",
            return_value=(None, {
                "source": "sqlite_cache",
                "calibration_version": "v2",
                "as_of": "2025-01-01",
                "shift_down_threshold": -0.5,
                "shift_up_threshold": 0.5,
            }),
        ):
            # q1=add(1), q2=hold(1), q3=medium(0) → avg=0.67 > 0.5 → shift up
            answers = {"q1_drawdown": "add", "q2_rally": "hold", "q3_volatility": "medium"}
            profile = profile_user(_make_request(answers, risk_tolerance="balanced"))
            assert profile.effective_risk == "aggressive"
            assert profile.behavior_adjusted is True
            assert profile.behavior_calibration_version == "v2"
            assert profile.behavior_as_of == "2025-01-01"

    def test_custom_weights_and_thresholds_combined(self):
        """Custom weights + custom thresholds work together."""
        custom_weights = {
            "q1_drawdown": {"add": 5, "hold": 0, "reduce": -1, "sell": -2},
        }
        cache = _make_cache_section(
            weights=custom_weights,
            shift_down_threshold=-2.0,
            shift_up_threshold=3.0,
        )
        with patch(
            "app.allocation.risk_profiler._load_calibration",
            return_value=(custom_weights, {
                "source": "sqlite_cache",
                "calibration_version": "v3",
                "as_of": "2025-06-01",
                "shift_down_threshold": -2.0,
                "shift_up_threshold": 3.0,
            }),
        ):
            # q1=add(5) → avg=5.0 > 3.0 → shift up
            answers = {"q1_drawdown": "add"}
            profile = profile_user(_make_request(answers, risk_tolerance="balanced"))
            assert profile.effective_risk == "aggressive"
            assert profile.behavior_score == 5.0
            assert profile.behavior_calibration_version == "v3"


# ─── Invalid cache data falls back to static ────────────────────────────────────

class TestInvalidCacheFallback:
    """Malformed, partial, or missing cache must degrade to static defaults."""

    def test_none_cache_returns_none(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=None):
            weights, meta = _load_calibration()
            assert weights is None
            assert meta is None

    def test_empty_dict_cache_returns_none(self):
        with patch("app.storage.database.StatsSnapshotCache.get", return_value={}):
            weights, meta = _load_calibration()
            assert weights is None
            assert meta is None

    def test_missing_risk_questionnaire_key(self):
        with patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value={"other_section": {}},
        ):
            weights, meta = _load_calibration()
            assert weights is None
            assert meta is None

    def test_weights_not_a_dict(self):
        with patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=_make_cache_section(weights="not_a_dict"),
        ):
            weights, meta = _load_calibration()
            assert weights is None
            assert meta is not None  # meta still returned for thresholds

    def test_weights_with_non_numeric_values_filtered(self):
        """Non-numeric weight values are filtered out."""
        bad_weights = {
            "q1_drawdown": {"add": "string_val", "hold": 0},
            "q2_rally": {"chase": True, "hold": 1},  # bool is not numeric
        }
        with patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=_make_cache_section(weights=bad_weights),
        ):
            weights, meta = _load_calibration()
            # q1: only "hold": 0 survives; q2: only "hold": 1 survives
            assert weights is not None
            assert weights["q1_drawdown"] == {"hold": 0.0}
            assert weights["q2_rally"] == {"hold": 1.0}

    def test_all_weights_invalid_falls_back(self):
        """If all weights are invalid, weights returns None."""
        bad_weights = {
            "q1_drawdown": {"add": "bad", "hold": "bad"},
        }
        with patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=_make_cache_section(weights=bad_weights),
        ):
            weights, meta = _load_calibration()
            assert weights is None

    def test_non_numeric_thresholds_use_defaults(self):
        """String/bool thresholds fall back to defaults."""
        with patch(
            "app.storage.database.StatsSnapshotCache.get",
            return_value=_make_cache_section(
                shift_down_threshold="bad",
                shift_up_threshold=True,
            ),
        ):
            weights, meta = _load_calibration()
            assert meta["shift_down_threshold"] == _DEFAULT_SHIFT_DOWN_THRESHOLD
            assert meta["shift_up_threshold"] == _DEFAULT_SHIFT_UP_THRESHOLD

    def test_exception_during_load_returns_none(self):
        with patch(
            "app.storage.database.StatsSnapshotCache.get",
            side_effect=RuntimeError("db down"),
        ):
            weights, meta = _load_calibration()
            assert weights is None
            assert meta is None

    def test_nested_params_structure_supported(self):
        """Both {"risk_questionnaire": {"params": {...}}} and flat work."""
        nested = {
            "risk_questionnaire": {
                "params": {
                    "weights": {"q1_drawdown": {"add": 5}},
                    "shift_up_threshold": 2.0,
                }
            }
        }
        with patch("app.storage.database.StatsSnapshotCache.get", return_value=nested):
            weights, meta = _load_calibration()
            assert weights is not None
            assert weights["q1_drawdown"]["add"] == 5.0
            assert meta["shift_up_threshold"] == 2.0


# ─── Provenance fields in profile/summary ──────────────────────────────────────

class TestProvenanceFields:
    """Provenance metadata flows from RiskProfile through to UserProfileSummary."""

    @patch("app.allocation.risk_profiler._load_calibration", return_value=(None, None))
    def test_static_defaults_provenance(self, _mock_cal):
        profile = profile_user(_make_request(
            {"q1_drawdown": "hold"}, risk_tolerance="balanced"
        ))
        assert profile.behavior_source == "static_defaults"
        assert profile.behavior_calibration_version is None
        assert profile.behavior_as_of is None
        assert profile.behavior_score == 0.0
        assert profile.behavior_question_count == 1

    def test_cache_provenance_flows_to_profile(self):
        custom_weights = {"q1_drawdown": {"add": 5}}
        cal_meta = {
            "source": "sqlite_cache",
            "calibration_version": "v4",
            "as_of": "2025-12-01",
            "shift_down_threshold": -0.5,
            "shift_up_threshold": 1.5,
        }
        with patch(
            "app.allocation.risk_profiler._load_calibration",
            return_value=(custom_weights, cal_meta),
        ):
            profile = profile_user(_make_request(
                {"q1_drawdown": "add"}, risk_tolerance="balanced"
            ))
            assert profile.behavior_source == "sqlite_cache"
            assert profile.behavior_calibration_version == "v4"
            assert profile.behavior_as_of == "2025-12-01"

    def test_user_profile_summary_accepts_provenance(self):
        """UserProfileSummary model accepts all provenance fields."""
        summary = UserProfileSummary(
            risk_tolerance="balanced",
            risk_label="平衡型",
            effective_risk="balanced",
            behavior_adjusted=False,
            age=35,
            amount=500000,
            horizon="medium",
            behavior_score=0.5,
            behavior_question_count=3,
            behavior_source="sqlite_cache",
            behavior_calibration_version="v1",
            behavior_as_of="2025-01-01",
        )
        assert summary.behavior_score == 0.5
        assert summary.behavior_question_count == 3
        assert summary.behavior_source == "sqlite_cache"
        assert summary.behavior_calibration_version == "v1"
        assert summary.behavior_as_of == "2025-01-01"

    def test_user_profile_summary_defaults_none(self):
        """Provenance fields default to None when not provided."""
        summary = UserProfileSummary(
            risk_tolerance="balanced",
            risk_label="平衡型",
            effective_risk="balanced",
            age=35,
            amount=500000,
            horizon="medium",
        )
        assert summary.behavior_score is None
        assert summary.behavior_question_count is None
        assert summary.behavior_source is None


# ─── Integration: full profile_user → UserProfileSummary wire ──────────────────

class TestIntegrationWire:
    """End-to-end: profile_user() output can construct UserProfileSummary."""

    @patch("app.allocation.risk_profiler._load_calibration", return_value=(None, None))
    def test_profile_to_summary_wire(self, _mock_cal):
        answers = {"q1_drawdown": "sell", "q2_rally": "all_out", "q3_volatility": "none"}
        profile = profile_user(_make_request(answers, risk_tolerance="balanced"))

        from app.allocation.risk_profiler import RISK_LABELS
        summary = UserProfileSummary(
            risk_tolerance=profile.risk_tolerance,
            risk_label=RISK_LABELS.get(profile.risk_tolerance, "平衡型"),
            effective_risk=profile.effective_risk,
            behavior_adjusted=profile.behavior_adjusted,
            age=profile.age,
            amount=profile.amount,
            horizon=profile.horizon,
            behavior_score=profile.behavior_score,
            behavior_question_count=profile.behavior_question_count,
            behavior_source=profile.behavior_source,
            behavior_calibration_version=profile.behavior_calibration_version,
            behavior_as_of=profile.behavior_as_of,
        )

        assert summary.effective_risk == "moderate"
        assert summary.behavior_adjusted is True
        assert summary.behavior_score == pytest.approx(-1.6667, abs=0.001)
        assert summary.behavior_question_count == 3
        assert summary.behavior_source == "static_defaults"
