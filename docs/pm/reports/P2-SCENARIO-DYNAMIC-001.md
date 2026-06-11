# P2-SCENARIO-DYNAMIC-001 — Implementation Report

**Date**: 2026-06-10
**Executor**: Claude Code
**Task**: P2 dynamic scenario baseline probabilities

---

## 1. Summary

Implemented cache-backed dynamic scenario analysis with explicit provenance. The `analyze_scenarios` function now loads optional calibrated baseline returns, scenario probabilities, and multiplier overrides from `StatsSnapshotCache("historical_calibration") -> scenario_analysis.params`. Invalid or missing values fall back per-field to static defaults. Default behavior is unchanged when no cache exists.

All 224 backend tests pass, frontend type check and build pass, and `git diff --check` shows only pre-existing CRLF warnings.

## 2. Files Changed

| File | Change |
|------|--------|
| `backend/app/allocation/models.py` | Added 5 optional provenance fields to `ScenarioAnalysis`: `source`, `calibration_version`, `as_of_date`, `probability_source`, `baseline_source` |
| `backend/app/allocation/scenario_analysis.py` | Extracted static defaults to module-level constants; added `_validate_probabilities()`, `_validate_baseline_returns()`, `_load_scenario_params()`; rewired `analyze_scenarios()` to use cache-backed params with per-field fallback |
| `frontend/src/types/allocation.ts` | Added 5 optional/nullable provenance fields to `ScenarioAnalysis` interface |
| `backend/tests/test_scenario_analysis_dynamic.py` | New file: 25 tests covering default behavior, calibrated baseline returns, calibrated probabilities, invalid cache fallback, multiplier overrides, and provenance fields |

## 3. Validation Results

### New scenario dynamic tests
```
cd backend && python -m pytest tests/test_scenario_analysis_dynamic.py -q
25 passed in 0.24s
```

### Allocation API contract tests
```
cd backend && python -m pytest tests/test_allocation_api_contract.py -q
2 passed in 1.32s
```

### Full backend suite
```
cd backend && python -m pytest -q
224 passed in 101.14s
```

### Frontend type check
```
cd frontend && npm run check
tsc -b  → no errors
```

### Frontend build
```
cd frontend && npm run build
vite build + esbuild → success (8.31s)
```

### Git diff check
```
git diff --check
→ Only pre-existing CRLF warnings (Windows platform), no whitespace errors
```

### Changed files (this session only)
```
backend/app/allocation/models.py
backend/app/allocation/scenario_analysis.py
frontend/src/types/allocation.ts
backend/tests/test_scenario_analysis_dynamic.py  (new)
```

Pre-existing dirty files (`AGENTS.md`, `CLAUDE.md`, `monte_carlo.py`, `stress_test.py`, `circuit_breaker.py`, `regime_detector.py`, `ic_decay.py`, `market_data_service.py`, `regime_replay.py`, `test_allocation_monte_carlo.py`) were preserved untouched.

## 4. Open Risks / PM Decisions Needed

- **None.** Implementation is self-contained within approved scope. All contracts preserved: existing `ScenarioAnalysis` and `ScenarioItem` fields are backward-compatible, new fields are optional/nullable, orchestrator percentage conversion is unchanged, and static fallback is explicit in provenance metadata.
