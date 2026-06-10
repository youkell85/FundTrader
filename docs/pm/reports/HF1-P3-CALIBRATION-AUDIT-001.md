# HF1-P3-CALIBRATION-AUDIT-001 — Hotfix Report

**Date:** 2026-06-10
**PM:** Codex
**Executor:** Claude Code
**Parent Task:** P3-CALIBRATION-AUDIT-001

---

## 1. Summary

The original P3-CALIBRATION-AUDIT-001 session was interrupted by a Claude gateway malformed-response failure. This hotfix completed the remaining implementation and produced both the original P3 report and this hotfix report.

### Root Cause

- All `CalibrationSectionItem` constructors in `calibration_audit.py` omitted the required `key` field, causing runtime failures.
- `_find_section()` used fragile positional-index fallback instead of matching `section.key`.
- Frontend `PipelineHealthPanel` inferred labels from `s.source` (which maps differently) instead of `s.key`, and used an unstable, broken label-resolution expression.
- Frontend `CalibrationSectionItem` type was missing `key`.
- No tests existed.

### Completed Changes

1. **`calibration_audit.py`**: Added `key=name` to all `CalibrationSectionItem` constructors (`_build_section`, `_summarize_static_section`, malformed-cache fallback).
2. **`calibration_audit.py`**: Rewrote `_find_section()` to use `section.key == key` instead of positional index.
3. **`allocation.ts`**: Added `key: string` to `CalibrationSectionItem` interface.
4. **`PipelineHealthPanel.tsx`**: Replaced broken label inference with direct `CALIBRATION_SECTION_LABELS[s.key]`; used `s.key` as stable React key; removed never-reached `'healthy'` filter case.
5. **`test_calibration_audit.py`**: Created 35 focused tests.

## 2. Files Changed

| File | Status | Description |
|------|--------|-------------|
| `backend/app/allocation/calibration_audit.py` | Modified (was untracked, now complete) | Fixed key on all constructors, simplified `_find_section` |
| `backend/app/allocation/orchestrator.py` | Unchanged from parent task | Already had calibration integration (unchanged) |
| `backend/tests/test_calibration_audit.py` | Created | 35 tests |
| `frontend/src/types/allocation.ts` | Modified | Added `key` field |
| `frontend/src/components/allocation/PipelineHealthPanel.tsx` | Modified | Fixed label/React-key resolution |

## 3. Validation Commands and Results

### Backend

```
cd backend
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q -v
→ 35 passed in 1.32s
```

```
python -m pytest -q
→ 282 passed in 131.74s
```

### Frontend

```
cd frontend
npm run check → clean (tsc -b, no errors)
npm run build → success
```

## 4. Open Risks or PM Decisions Needed

1. **Same as P3 report** — drift thresholds are hardcoded, static priors may drift relative to updated config.
2. **No additional risks** introduced by the hotfix changes themselves.
3. **No files outside approved scope** were touched.
4. **No allocation behavior** was changed.
