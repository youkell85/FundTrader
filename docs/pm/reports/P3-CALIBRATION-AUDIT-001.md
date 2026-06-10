# P3-CALIBRATION-AUDIT-001 — P3 Calibration Audit Implementation Report

**Date:** 2026-06-10
**Executor:** Claude Code via cc-switch (completed via HF1-P3-CALIBRATION-AUDIT-001 hotfix)
**Phase:** P3 — Monitoring & Operations

---

## 1. Summary

Implemented a read-only calibration audit/health feature that exposes the state of the `StatsSnapshotCache("historical_calibration")` through `/allocation/pipeline-health`. The feature adds a `calibration` object with per-section audit items (status, source, version, coverage, drift warnings) and renders them compactly in `PipelineHealthPanel`. No allocation behavior was changed.

The original task session was interrupted by a Claude gateway malformed-response failure. The implementation was completed in the hotfix follow-up session HF1-P3-CALIBRATION-AUDIT-001.

## 2. Files Changed

| File | Change | Reason |
|------|--------|--------|
| `backend/app/allocation/calibration_audit.py` | Created | Read-only audit helper: loads cache, builds per-section summary with status/warnings/drift checks |
| `backend/app/allocation/orchestrator.py` | Modified | Added `calibration` key to `get_pipeline_health()` response |
| `backend/tests/test_calibration_audit.py` | Created | 35 focused tests covering missing cache, malformed sections, historical flow-through, drift warnings, pipeline health integration |
| `frontend/src/types/allocation.ts` | Modified | Added `key: string` to `CalibrationSectionItem` interface |
| `frontend/src/components/allocation/PipelineHealthPanel.tsx` | Modified | Calibration audit block now uses `s.key` for labels and stable React keys; removed broken `source`-based label inference |

## 3. Validation Commands and Results

### Backend Tests

```
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q -v
→ 35 passed in 1.32s
```

```
python -m pytest -q
→ 282 passed in 131.74s
```

All 35 new calibration audit tests pass:
- `CalibrationSectionItemTest` — `to_dict()` includes `key`, omits `None` optionals
- `SectionStatusTest` — static assumption, unknown source, low coverage, invalid assets, assumptions used, clean real
- `BuildSectionTest` — None result is missing, valid result preserves key
- `SummarizeStaticSectionTest` — returns assumption with key
- `FindSectionTest` — finds by key, returns None for unknown
- `NumericDriftTest` — warns on large return/vol deviation, silent on small, handles None/empty/non-numeric
- `JumpDriftTest` — warns out of range, silent in range, handles None/unreadable
- `AuditCalibrationTest` — missing cache → unknown, exception → unknown, malformed → missing, historical flow-through, static assumption → assumption, return/vol drift warnings, all-real → healthy
- `PipelineHealthIncludesCalibrationTest` — includes calibration key, graceful on exception

### Frontend

```
npm run check → clean (tsc -b passes)
npm run build → success (vite build + esbuild)
```

## 4. Open Risks or PM Decisions Needed

1. **Drift thresholds are hardcoded** (`_RETURN_DRIFT_THRESHOLD = 3.0`, `_VOL_DRIFT_THRESHOLD = 5.0`). These may need tuning per asset class or per market regime.

2. **Static priors for drift comparison** use `EQUILIBRIUM_RETURNS` and `EQUILIBRIUM_VOLS` from config. If these config values are updated, drift warnings may trigger spuriously until cache catches up.

3. **Jump params drift check** only checks `jump_probability` against a hardcoded range `[0.0, 0.10]`. Other jump params (`jump_mean`, `jump_vol`) are not checked.

4. **No non-numeric section drift checks** — sections like `correlation_matrix` and `stress_scenarios` have no drift logic. A future task could add structure-aware checks.

5. **Cache key `historical_calibration`** is assumed to be a dict. If future code writes non-dict values, the audit will degrade gracefully to `unknown`.

---

## GitNexus Impact Summary

- `get_pipeline_health()` — called by `/allocation/pipeline-health` API endpoint and ops page. Risk: **LOW** (additive: new `calibration` key only).
- `PipelineHealthPanel` — renders ops page calibration block. Risk: **LOW** (surgical fix to label/key resolution, backward-compatible).
