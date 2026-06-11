# P2-REGIME-THRESHOLDS-001 — Implementation Report

**Date:** 2026-06-10
**Executor:** Claude Code
**PM:** Codex

## 1. Summary

Introduced a calibratable `RegimeThresholds` dataclass with documented default values matching the previous hard-coded constants. Both `regime_detector.py` (live) and `regime_replay.py` (backtest) now read from the same `get_regime_thresholds()` function, which loads optional cached overrides from `StatsSnapshotCache("historical_calibration") -> regime_thresholds.params` with per-field fallback to defaults.

When no cached calibration exists, behavior is **byte-identical** to the pre-change implementation (same constants, same arithmetic).

### Impact Analysis Results

| Symbol | Risk | Affected Processes |
|---|---|---|
| `detect_regime` (regime_detector.py) | LOW | `run_dual_comparison` (dual_engine.py), `run` (orchestrator.py) |
| `_classify_quadrant` (both files) | LOW | Same callers as `detect_regime` + `detect_regime_at` |
| `detect_regime_at` (regime_replay.py) | LOW | `run_backtest` → `_simulate_allocation` (backtest/engine.py) |

All risks LOW. No interfaces changed. `RegimeState` fields unchanged. Persistence locks and `_PERSISTENCE_MIN_INTERVAL_S` untouched.

## 2. Files Changed

| File | Change | Lines |
|---|---|---|
| `backend/app/allocation/regime_detector.py` | Added `RegimeThresholds` dataclass + `get_regime_thresholds()`. Updated `_score_growth`, `_score_inflation`, `_score_monetary`, `_classify_quadrant` to read thresholds dynamically. | +94 |
| `backend/app/allocation/backtest/regime_replay.py` | Removed `QUADRANT_THRESHOLD` module constant. Imported `get_regime_thresholds` from `regime_detector`. Updated all scoring and classification functions to use it. | +28 |
| `backend/tests/test_regime_thresholds.py` | **New.** 34 tests across 5 test classes. | +407 |

**No unexpected edits:** The diff also includes pre-existing dirty changes to `AGENTS.md`, `CLAUDE.md`, `ic_decay.py`, `market_data_service.py`, `models.py`, `monte_carlo.py`, `stress_test.py`, `test_allocation_monte_carlo.py`, and `allocation.ts` — these were untouched by this task.

## 3. Validation Commands and Results

### Targeted Tests
```
cd backend
python -m pytest tests/test_regime_thresholds.py tests/test_allocation_api_contract.py -q
```
**Result: 34 passed** (no failures)

### Full Backend Suite
```
python -m pytest -q
```
**Result: 179 passed in 131.23s** (no failures, no regressions)

### Git diff --check
```
git diff --check
```
**Result:** Only pre-existing CRLF warnings from files not touched by this task. No whitespace errors in our changes.

### Git Status
Our two modified files (`regime_detector.py`, `regime_replay.py`) plus one new test file (`test_regime_thresholds.py`). All other dirty files are pre-existing and unchanged.

## 4. Open Risks or PM Decisions Needed

1. **Calibration pipeline integration** — The cache key `historical_calibration` and the nested path `regime_thresholds.params` are now contract surfaces. Any calibration pipeline that writes to this cache must populate all desired fields under `regime_thresholds.params`. Missing or invalid fields silently fall back to defaults, which is safe but may mask configuration errors.

2. **Calibration data shape** — The expected shape is:
   ```json
   {
     "regime_thresholds": {
       "params": {
         "quadrant": 0.2,
         "pmi_neutral": 50.0,
         "pmi_scale": 2.0,
         "gdp_neutral": 4.5,
         "gdp_scale": 3.0,
         "cpi_neutral": 2.0,
         "cpi_scale": 2.0,
         "ppi_neutral": 0.0,
         "ppi_scale": 4.0,
         "m2_neutral": 8.5,
         "m2_scale": 3.0,
         "yield_10y_neutral": 3.0,
         "yield_10y_scale": 1.0
       }
     }
   }
   ```
   This should be documented in the calibration tooling or a data contract doc.

3. **TTL coupling** — Threshold overrides share the same 24-hour TTL as all `StatsSnapshotCache` entries. If calibration runs less frequently than 24 hours, thresholds will revert to defaults silently. This may be desirable (stale calibration is dangerous) but should be a conscious decision.

4. **Future scaling** — The current `RegimeThresholds` covers growth/inflation/monetary scoring. If new indicators are added to regime detection, corresponding threshold fields should be added to the dataclass.