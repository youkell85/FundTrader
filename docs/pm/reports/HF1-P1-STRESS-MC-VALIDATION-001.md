# HF1-P1-STRESS-MC-VALIDATION-001 — Validation Report

**Date:** 2026-06-10
**Executor:** Claude Code
**PM:** Codex
**Repo:** FundTrader @ `9cbd267`

---

## 1. Summary

Validated the P1 Stress Test / Monte Carlo provenance handoff implementation. The prior dispatch (`P1-STRESS-MC-PROVENANCE-001`) left the implementation complete in the working tree but unvalidated. This pass confirmed the implementation is acceptance-ready: all provenance fields are backward-compatible, calibration loads from cache with explicit static fallback, and all test suites pass. No code changes were needed — the implementation was already correct.

## 2. Files Changed

No new changes were made. The existing working-tree diffs (from the prior P1 dispatch) are:

| File | Change |
|------|--------|
| `backend/app/allocation/models.py` | Added `source`, `source_window`, `calibration_version` to `StressScenarioItem`; added `jump_source`, `jump_as_of`, `jump_sample_size`, `calibration_version` to `MonteCarloResult` — all `Optional` |
| `backend/app/allocation/monte_carlo.py` | Added `_load_jump_params()` — loads from `StatsSnapshotCache` with `static_assumption` fallback; populates provenance fields on `MonteCarloResult` |
| `backend/app/allocation/stress_test.py` | Added `_load_stress_scenarios()` — loads from `StatsSnapshotCache` with `static_assumption` fallback; populates provenance fields on `StressScenarioItem` |
| `backend/tests/test_allocation_monte_carlo.py` | Fixed `isinstance` check for numeric finiteness (was incorrectly checking `None` values) |
| `backend/tests/test_stress_monte_carlo_calibration.py` | New file — tests static source metadata on stress results and cached jump metadata on MC results |
| `frontend/src/types/allocation.ts` | Added optional provenance fields to `StressScenarioItem`, `MonteCarloResult`, and `FundItem`; all nullable where appropriate |

## 3. Validation Commands and Results

### 3.1 Targeted Backend Tests

```
cd backend
python -m pytest tests/test_stress_monte_carlo_calibration.py tests/test_allocation_monte_carlo.py tests/test_allocation_api_contract.py -q
```

**Result:** 6 passed in 5.34s

### 3.2 Full Backend Test Suite

```
cd backend
python -m pytest -q
```

**Result:** 124 passed in 110.93s

### 3.3 Frontend Type Check

```
cd frontend
npm run check   # tsc -b
```

**Result:** No errors.

### 3.4 Frontend Build

```
cd frontend
npm run build   # vite build + esbuild api/boot.ts
```

**Result:** Build succeeded (2615 modules, 9.42s).

### 3.5 Git Diff Check

```
git diff --check
```

**Result:** Only CRLF warnings (expected on Windows). No whitespace errors.

### 3.6 Git Status

Modified files are all within approved scope:
- `AGENTS.md`, `CLAUDE.md` (pre-existing unrelated changes, preserved)
- `backend/app/allocation/models.py`
- `backend/app/allocation/monte_carlo.py`
- `backend/app/allocation/stress_test.py`
- `backend/tests/test_allocation_monte_carlo.py`
- `frontend/src/types/allocation.ts`

New untracked file within scope: `backend/tests/test_stress_monte_carlo_calibration.py`

No unexpected edits outside approved files.

## 4. Contract Verification

- **Backward compatibility:** All new provenance fields are `Optional` in Pydantic models and `?` (optional) in TypeScript. Existing API consumers see no breaking changes.
- **No external network calls:** `_load_jump_params()` and `_load_stress_scenarios()` read from `StatsSnapshotCache` (local SQLite). No HTTP or remote calls.
- **Explicit static fallback:** When cache is empty or unavailable, metadata explicitly reports `source: "static_assumption"` and `calibration_version: "static-jump-params"` / `"static-stress-scenarios"`.
- **Unrelated worktree changes preserved:** `AGENTS.md` and `CLAUDE.md` diffs were not touched.

## 5. Open Risks or PM Decisions Needed

None. The implementation is complete, validated, and acceptance-ready. No product, architecture, data-contract, or deployment decisions are outstanding for this scope.
