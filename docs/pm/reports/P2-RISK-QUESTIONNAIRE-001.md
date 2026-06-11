# P2-RISK-QUESTIONNAIRE-001 — Implementation Report

## 1. Summary

Added cache-backed risk questionnaire calibration policy and provenance metadata to the allocation pipeline. The three-question behavior calibration (`q1_drawdown`, `q2_rally`, `q3_volatility`) with its existing weights and thresholds remains the **default** behavior. A new `_load_calibration()` function reads optional `risk_questionnaire.params` from `StatsSnapshotCache("historical_calibration")` — when valid, it overrides answer weights and shift thresholds; when missing or malformed, the system degrades safely to the existing static defaults.

Five optional provenance fields (`behavior_score`, `behavior_question_count`, `behavior_source`, `behavior_calibration_version`, `behavior_as_of`) flow from `RiskProfile` through `orchestrator.py` into `UserProfileSummary` in the API response. The frontend TypeScript types were updated with the same optional fields. No product copy, questionnaire options, or UX were changed.

## 2. Files Changed

| File | Change |
|------|--------|
| `backend/app/allocation/models.py` | Added 5 optional provenance fields to `RiskProfile` and `UserProfileSummary` (lines 42–50, 225–239) |
| `backend/app/allocation/risk_profiler.py` | Added `_load_calibration()` (68 lines) — loads and validates `risk_questionnaire.params` from cache with per-field numeric validation and graceful fallback. Updated `profile_user()` to use cache-backed weights/thresholds and emit provenance fields |
| `backend/app/allocation/orchestrator.py` | Wired `RiskProfile` provenance fields into `UserProfileSummary` construction in `run()` (lines 414–422) |
| `frontend/src/types/allocation.ts` | Added 5 optional fields to `UserProfileSummary` interface (lines 30–35) |
| `backend/tests/test_risk_profiler_questionnaire.py` | **New file** — 27 tests covering 4 test classes |

## 3. Validation Commands and Results

### Backend

```
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_risk_profiler_questionnaire.py tests/test_allocation_api_contract.py -q
```
**Result: 27 passed**

```
python -m pytest -q
```
**Result: 249 passed in 120.93s**

### Frontend

```
npm.cmd run check    # tsc -b
```
**Result: 0 errors**

```
npm.cmd run build    # vite build && esbuild api/boot.ts
```
**Result: Built successfully (9.48s)**

## 4. Test Coverage Summary

The new test file covers:

| Test class | Coverage |
|-----------|----------|
| `TestDefaultStaticBehavior` | 8 tests — no-cache behavior is unchanged; conservative/aggressive/neutral/unknown answers; boundary clamping at conservative/radical |
| `TestCacheBackedCalibration` | 3 tests — custom weights override static scoring; custom thresholds change shift boundary; combined weights+thresholds |
| `TestInvalidCacheFallback` | 7 tests — None/empty/missing/lint cache; non-dict weights; non-numeric values filtered; all-invalid weights → None; non-numeric thresholds → defaults; DB exception → None; nested `{"params": {...}}` support |
| `TestProvenanceFields` | 4 tests — static provenance marker; cache provenance flows to profile; `UserProfileSummary` accepts all fields; defaults are None |
| `TestIntegrationWire` | 1 test — end-to-end `profile_user()` → `UserProfileSummary` construction |

## 5. Open Risks or PM Decisions Needed

- **No open risks.** The implementation is backward-compatible: all existing API responses are unchanged when no cache exists. The new fields are optional and default to `None`.
- **Cache population:** The task does not include writing calibration data to the cache. A separate PM task or admin tooling is needed to populate `StatsSnapshotCache("historical_calibration")` → `risk_questionnaire.params` with calibrated weights and thresholds.
- **Calibration versioning:** The `calibration_version` and `as_of` provenance fields are populated from whatever the cache provides. If the PM wants a specific versioning scheme (e.g., semver, ISO timestamps), that should be defined in a separate spec.
