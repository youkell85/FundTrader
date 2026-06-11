## PM Digest

Status: complete
Changed: backend/app/allocation/data/historical_calibrator.py, backend/tests/test_historical_calibrator.py, docs/pm/outbox/HF3-P1-1-CALIBRATOR-DATA-STATUS-001.md, docs/pm/reports/HF3-P1-1-CALIBRATOR-DATA-STATUS-001.md
Validation: passed - historical-calibrator-tests, long-window-tests, calibration-audit-tests, allocation-contract-tests, cache-readback, diff-check
Risk: low; backward-compatible metadata field only
Decision: none
Next: accept

## Status

Complete.

## Summary

Added explicit `data_status` to historical calibration outputs:

- `static_assumption` -> `assumption`
- full non-static coverage with no invalid/assumption assets -> `real`
- threshold-passing non-static coverage with missing/assumption assets ->
  `partial`

With the newly persisted `long_window_stats`, direct readback now reports:

```text
returns_source=long_window_cache
vols_source=long_window_cache
corr_source=long_window_cache
returns_status=partial
vols_status=partial
corr_status=partial
confidence_score=0.8786
```

`partial` is correct because REITs remains missing while overall coverage is
above threshold.

## Files Changed

- `backend/app/allocation/data/historical_calibrator.py`
  - Added `data_status` to `CalibrationResult`.
  - Added `_calibration_data_status`.
  - Populated status for series, matrix, static matrix, and static params
    results.
- `backend/tests/test_historical_calibrator.py`
  - Added assertions for static, historical, long-window cache, injected
    snapshot, and partial/full status behavior.
- `docs/pm/outbox/HF3-P1-1-CALIBRATOR-DATA-STATUS-001.md`
  - Filled handoff.
- `docs/pm/reports/HF3-P1-1-CALIBRATOR-DATA-STATUS-001.md`
  - This report.

## Validation Commands and Results

```powershell
cd backend
python -m pytest tests/test_historical_calibrator.py tests/test_long_window_producer.py tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

Result: `91 passed`.

```powershell
git diff --check -- backend\app\allocation\data\historical_calibrator.py backend\tests\test_historical_calibrator.py
```

Result: passed; local Git emits CRLF normalization warnings on stderr for these
tracked files, so PM acceptance silences stderr while preserving the exit-code
check.

Cache readback result:

```text
source=long_window_cache
data_status=partial
confidence_score=0.8786
```

## Scope / Safety

- Backward-compatible metadata addition.
- No calibration values changed intentionally.
- No scripts changed.
- No database schema changes.
- No commit, push, or deployment.

## Open Risks or PM Decisions Needed

None. REITs still lacks cache data, but this is now represented as `partial`
rather than an unstated status.

## Recommended Next Action

Accept HF3, then complete final P1-1 long-window acceptance.
