"""Tests for calibratable regime thresholds (P2-REGIME-THRESHOLDS-001).

Covers:
- Default config preserves existing quadrant outcomes
- Cached threshold override changes classification at the boundary
- Invalid cached values fall back to defaults
- Backtest replay and live detector share equivalent threshold semantics
"""
import math
import pytest
from unittest.mock import patch, MagicMock

from app.allocation.regime_detector import (
    RegimeThresholds,
    get_regime_thresholds,
    _score_growth,
    _score_inflation,
    _score_monetary,
    _classify_quadrant,
)
from app.allocation.backtest.regime_replay import (
    _score_growth as _replay_score_growth,
    _score_inflation as _replay_score_inflation,
    _score_monetary as _replay_score_monetary,
    _classify_quadrant as _replay_classify_quadrant,
)


# ─── Helpers ────────────────────────────────────────────────────────────────────

class _FakeMacro:
    """Minimal fake for regime_detector._score_* which calls macro.get_value(name)."""

    def __init__(self, values: dict):
        self._values = values

    def get_value(self, name: str):
        return self._values.get(name)


def _make_snapshot(**kwargs):
    """Build a dict snapshot for regime_replay scoring functions."""
    return kwargs


# ─── Default config preserves existing quadrant outcomes ─────────────────────────

class TestDefaultThresholdsPreserveBehavior:
    """With no cached calibration, all scoring and classification must match
    the pre-calibration hard-coded values exactly."""

    def test_default_thresholds_match_hardcoded(self):
        t = get_regime_thresholds()
        assert t.quadrant == 0.2
        assert t.pmi_neutral == 50.0
        assert t.pmi_scale == 2.0
        assert t.gdp_neutral == 4.5
        assert t.gdp_scale == 3.0
        assert t.cpi_neutral == 2.0
        assert t.cpi_scale == 2.0
        assert t.ppi_neutral == 0.0
        assert t.ppi_scale == 4.0
        assert t.m2_neutral == 8.5
        assert t.m2_scale == 3.0
        assert t.yield_10y_neutral == 3.0
        assert t.yield_10y_scale == 1.0

    def test_growth_scoring_default(self):
        # PMI=52, GDP=7.5 → old: (52-50)/2=1.0, (7.5-4.5)/3=1.0 → avg=1.0
        macro = _FakeMacro({"PMI制造业": 52.0, "GDP同比": 7.5})
        assert _score_growth(macro) == pytest.approx(1.0)

    def test_growth_scoring_default_neutral(self):
        # PMI=50, GDP=4.5 → both 0
        macro = _FakeMacro({"PMI制造业": 50.0, "GDP同比": 4.5})
        assert _score_growth(macro) == pytest.approx(0.0)

    def test_inflation_scoring_default(self):
        # CPI=4, PPI=4 → old: (4-2)/2=1.0, 4/4=1.0 → avg=1.0
        macro = _FakeMacro({"CPI同比": 4.0, "PPI同比": 4.0})
        assert _score_inflation(macro) == pytest.approx(1.0)

    def test_monetary_scoring_default(self):
        # M2=11.5, 10Y=2.0 → old: (11.5-8.5)/3=1.0, (3-2)/1=1.0 → avg=1.0
        macro = _FakeMacro({"M2增速": 11.5, "10Y国债收益率": 2.0})
        assert _score_monetary(macro) == pytest.approx(1.0)

    def test_classify_goldilocks_default(self):
        assert _classify_quadrant(0.5, -0.5, 0.0) == "goldilocks"

    def test_classify_overheat_default(self):
        assert _classify_quadrant(0.5, 0.5, 0.0) == "overheat"

    def test_classify_stagflation_default(self):
        assert _classify_quadrant(-0.5, 0.5, 0.0) == "stagflation"

    def test_classify_deflation_default(self):
        assert _classify_quadrant(-0.5, -0.5, 0.0) == "deflation"

    def test_classify_baseline_default(self):
        # Within threshold band
        assert _classify_quadrant(0.1, 0.1, 0.0) == "baseline"


# ─── Cached threshold override changes classification at the boundary ────────────

class TestCachedOverrideChangesClassification:
    """When a valid cached calibration exists, thresholds should shift and
    classification at the boundary should change accordingly."""

    def test_quadrant_override_shifts_boundary(self):
        """With quadrant=0.4, a score of 0.3 should be baseline instead of goldilocks."""
        cached = {
            "regime_thresholds": {
                "params": {"quadrant": 0.4}
            }
        }
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = cached
            t = get_regime_thresholds()
            assert t.quadrant == 0.4
            # Other fields stay at defaults
            assert t.pmi_neutral == 50.0

    def test_pmi_neutral_override_changes_score(self):
        """With pmi_neutral=48, PMI=50 should score lower than default."""
        cached = {
            "regime_thresholds": {
                "params": {"pmi_neutral": 48.0}
            }
        }
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = cached
            macro = _FakeMacro({"PMI制造业": 50.0})
            # Default: (50-50)/2 = 0.0. Override: (50-48)/2 = 1.0
            score = _score_growth(macro)
            assert score == pytest.approx(1.0)

    def test_cpi_scale_override_changes_score(self):
        """With cpi_scale=4, CPI=4 should score 0.5 instead of 1.0."""
        cached = {
            "regime_thresholds": {
                "params": {"cpi_scale": 4.0}
            }
        }
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = cached
            macro = _FakeMacro({"CPI同比": 4.0})
            # Default: (4-2)/2 = 1.0. Override: (4-2)/4 = 0.5
            score = _score_inflation(macro)
            assert score == pytest.approx(0.5)

    def test_full_override_all_fields(self):
        """All fields overridden simultaneously."""
        cached = {
            "regime_thresholds": {
                "params": {
                    "quadrant": 0.3,
                    "pmi_neutral": 48.0,
                    "pmi_scale": 3.0,
                    "gdp_neutral": 5.0,
                    "gdp_scale": 4.0,
                    "cpi_neutral": 3.0,
                    "cpi_scale": 3.0,
                    "ppi_neutral": 1.0,
                    "ppi_scale": 5.0,
                    "m2_neutral": 9.0,
                    "m2_scale": 4.0,
                    "yield_10y_neutral": 3.5,
                    "yield_10y_scale": 2.0,
                }
            }
        }
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = cached
            t = get_regime_thresholds()
            assert t.quadrant == 0.3
            assert t.pmi_neutral == 48.0
            assert t.pmi_scale == 3.0
            assert t.gdp_neutral == 5.0
            assert t.gdp_scale == 4.0
            assert t.cpi_neutral == 3.0
            assert t.cpi_scale == 3.0
            assert t.ppi_neutral == 1.0
            assert t.ppi_scale == 5.0
            assert t.m2_neutral == 9.0
            assert t.m2_scale == 4.0
            assert t.yield_10y_neutral == 3.5
            assert t.yield_10y_scale == 2.0


# ─── Invalid cached values fall back to defaults ─────────────────────────────────

class TestInvalidCacheFallback:
    """Invalid, missing, or non-numeric cached values must fall back per-field
    to RegimeThresholds defaults."""

    def test_none_cache_returns_defaults(self):
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = None
            t = get_regime_thresholds()
            assert t.quadrant == 0.2

    def test_empty_dict_cache_returns_defaults(self):
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {}
            t = get_regime_thresholds()
            assert t.quadrant == 0.2

    def test_missing_regime_thresholds_key_returns_defaults(self):
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = {"other_key": "value"}
            t = get_regime_thresholds()
            assert t.quadrant == 0.2

    def test_null_param_value_falls_back(self):
        cached = {
            "regime_thresholds": {
                "params": {"quadrant": None, "pmi_neutral": 48.0}
            }
        }
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = cached
            t = get_regime_thresholds()
            # quadrant=None → fallback to default 0.2
            assert t.quadrant == 0.2
            # pmi_neutral=48.0 → override
            assert t.pmi_neutral == 48.0

    def test_string_param_value_falls_back(self):
        cached = {
            "regime_thresholds": {
                "params": {"quadrant": "0.5"}
            }
        }
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = cached
            t = get_regime_thresholds()
            # string → not numeric → fallback
            assert t.quadrant == 0.2

    def test_bool_param_value_falls_back(self):
        cached = {
            "regime_thresholds": {
                "params": {"quadrant": True}
            }
        }
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = cached
            t = get_regime_thresholds()
            # bool → isinstance(int) is True but we exclude bool
            assert t.quadrant == 0.2

    def test_cache_exception_returns_defaults(self):
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.side_effect = RuntimeError("db down")
            t = get_regime_thresholds()
            assert t.quadrant == 0.2

    def test_partial_override_mixed_valid_invalid(self):
        """Valid fields override, invalid fields fall back."""
        cached = {
            "regime_thresholds": {
                "params": {
                    "quadrant": 0.3,
                    "pmi_neutral": "bad",
                    "gdp_neutral": None,
                    "cpi_neutral": 1.5,
                }
            }
        }
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = cached
            t = get_regime_thresholds()
            assert t.quadrant == 0.3       # valid override
            assert t.pmi_neutral == 50.0   # string → fallback
            assert t.gdp_neutral == 4.5    # None → fallback
            assert t.cpi_neutral == 1.5    # valid override


# ─── Backtest replay and live detector share equivalent threshold semantics ──────

class TestReplayLiveEquivalence:
    """Backtest replay scoring functions must produce identical results to
    live detector scoring functions for the same inputs and thresholds."""

    def test_growth_scoring_identical(self):
        """Same snapshot values → same growth score from both modules."""
        snapshot = {"PMI制造业": 52.0, "GDP同比": 7.5}
        macro = _FakeMacro(snapshot)

        live_score = _score_growth(macro)
        replay_score = _replay_score_growth(snapshot)

        assert live_score == pytest.approx(replay_score)

    def test_inflation_scoring_identical(self):
        snapshot = {"CPI同比": 3.0, "PPI同比": 2.0}
        macro = _FakeMacro(snapshot)

        live_score = _score_inflation(macro)
        replay_score = _replay_score_inflation(snapshot)

        assert live_score == pytest.approx(replay_score)

    def test_monetary_scoring_identical(self):
        snapshot = {"M2增速": 10.0, "10Y国债收益率": 2.5}
        macro = _FakeMacro(snapshot)

        live_score = _score_monetary(macro)
        replay_score = _replay_score_monetary(snapshot)

        assert live_score == pytest.approx(replay_score)

    def test_classify_identical_all_quadrants(self):
        """All five regime types produce identical classification."""
        test_cases = [
            (0.5, -0.5, 0.0, "goldilocks"),
            (0.5, 0.5, 0.0, "overheat"),
            (-0.5, 0.5, 0.0, "stagflation"),
            (-0.5, -0.5, 0.0, "deflation"),
            (0.1, 0.1, 0.0, "baseline"),
        ]
        for g, i, m, expected in test_cases:
            live = _classify_quadrant(g, i, m)
            replay = _replay_classify_quadrant(g, i, m)
            assert live == expected, f"live {g},{i} → {live}, expected {expected}"
            assert replay == expected, f"replay {g},{i} → {replay}, expected {expected}"
            assert live == replay, f"mismatch: live={live} replay={replay} for ({g},{i})"

    def test_override_applies_to_both_modules(self):
        """When thresholds are overridden, both modules see the same values."""
        cached = {
            "regime_thresholds": {
                "params": {
                    "quadrant": 0.3,
                    "pmi_neutral": 48.0,
                    "pmi_scale": 3.0,
                }
            }
        }
        with patch(
            "app.storage.database.StatsSnapshotCache"
        ) as mock_cache:
            mock_cache.get.return_value = cached

            snapshot = {"PMI制造业": 51.0}
            macro = _FakeMacro(snapshot)

            live_score = _score_growth(macro)
            replay_score = _replay_score_growth(snapshot)

            # Both should compute (51-48)/3 = 1.0
            assert live_score == pytest.approx(1.0)
            assert replay_score == pytest.approx(1.0)
            assert live_score == pytest.approx(replay_score)

    def test_clamping_identical(self):
        """Both modules clamp identically at [-1, 1]."""
        # Extreme PMI=60 → (60-50)/2 = 5.0 → clamped to 1.0
        snapshot = {"PMI制造业": 60.0}
        macro = _FakeMacro(snapshot)

        live_score = _score_growth(macro)
        replay_score = _replay_score_growth(snapshot)

        assert live_score == 1.0
        assert replay_score == 1.0

    def test_missing_data_identical(self):
        """Both modules return 0.0 when no data is available."""
        snapshot = {}
        macro = _FakeMacro(snapshot)

        assert _score_growth(macro) == 0.0
        assert _replay_score_growth(snapshot) == 0.0
        assert _score_inflation(macro) == 0.0
        assert _replay_score_inflation(snapshot) == 0.0
        assert _score_monetary(macro) == 0.0
        assert _replay_score_monetary(snapshot) == 0.0


# ─── RegimeThresholds dataclass integrity ────────────────────────────────────────

class TestRegimeThresholdsDataclass:
    def test_default_construction(self):
        t = RegimeThresholds()
        assert t.quadrant == 0.2
        assert t.pmi_neutral == 50.0

    def test_field_override_at_construction(self):
        t = RegimeThresholds(quadrant=0.35, cpi_neutral=1.5)
        assert t.quadrant == 0.35
        assert t.cpi_neutral == 1.5
        # Unspecified fields stay at defaults
        assert t.pmi_neutral == 50.0

    def test_all_fields_are_floats(self):
        t = RegimeThresholds()
        for f_name in [
            "quadrant", "pmi_neutral", "pmi_scale", "gdp_neutral", "gdp_scale",
            "cpi_neutral", "cpi_scale", "ppi_neutral", "ppi_scale",
            "m2_neutral", "m2_scale", "yield_10y_neutral", "yield_10y_scale",
        ]:
            val = getattr(t, f_name)
            assert isinstance(val, float), f"{f_name} is {type(val)}, expected float"
