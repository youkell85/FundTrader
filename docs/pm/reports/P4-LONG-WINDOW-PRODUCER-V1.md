## PM Digest

Status: complete
Changed: backend/app/allocation/data/long_window_producer.py, backend/tests/test_long_window_producer.py, docs/pm/reports/P4-LONG-WINDOW-PRODUCER-V1.md
Validation: passed - py_compile, test_long_window_producer, test_historical_calibrator, test_calibration_audit, test_allocation_api_contract, diff-check
Risk: scoped; no runtime wiring, no schema changes, no live network calls
Decision: none
Next: accept

## Status

Complete. Claude created the implementation and tests but could not run
validation or write the report because its command sandbox required approval.
PM validated, replaced the generated files with a smaller ASCII implementation,
and wrote this report.

## Summary

Added a cache-only long-window stats producer. It reads local ETF prices through
the existing `ETFPriceCache.get_range`, computes annualized log-return means,
annualized vols, and a finite 14x14 correlation matrix, then returns a snapshot
compatible with `HistoricalCalibrator._load_long_window_cache()`.

This task intentionally does not wire the producer into `MarketDataService`
refresh. Runtime behavior is unchanged until a later PM-approved wiring task.

## Files Changed

- `backend/app/allocation/data/long_window_producer.py`
  - New producer module.
  - No live market-data fetcher imports.
  - `build_long_window_stats(...) -> dict | None`.
  - `persist_long_window_stats(snapshot)` wrapper for the existing
    `StatsSnapshotCache.save("long_window_stats", snapshot)` key.
- `backend/tests/test_long_window_producer.py`
  - New focused tests for valid snapshot output, insufficient coverage,
    finite/symmetric matrix, consumer compatibility, persistence key, and no
    live-fetch imports.
- `docs/pm/reports/P4-LONG-WINDOW-PRODUCER-V1.md`
  - PM report.

## Validation Commands and Results

```powershell
cd backend
python -m py_compile app\allocation\data\long_window_producer.py tests\test_long_window_producer.py
```

Result: passed.

```powershell
cd backend
python -m pytest tests/test_long_window_producer.py -q
```

Result: `7 passed`.

```powershell
cd backend
python -m pytest tests/test_historical_calibrator.py -q
```

Result: `12 passed`.

```powershell
cd backend
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

Result: `72 passed`.

```powershell
git diff --check -- backend\app\allocation\data\long_window_producer.py backend\tests\test_long_window_producer.py backend\app\allocation\data\historical_calibrator.py backend\tests\test_historical_calibrator.py
```

Result: passed; only CRLF normalization warnings.

ASCII scan on the two new producer files: passed, 0 non-ASCII characters.

## Scope / Safety

- No frontend changes.
- No database schema changes.
- No database file edits.
- No production server access.
- No commit, push, or deployment.
- `ETFPriceCache.get_range` and `StatsSnapshotCache.save` were not modified.
- `MarketDataService.refresh` was not modified.

## Open Risks or PM Decisions Needed

None for this slice.

The next decision is implementation sequencing, not product behavior: whether to
wire this producer into `MarketDataService.refresh()` or expose it as a manual
maintenance command first. Given earlier GitNexus HIGH impact on shared cache
interfaces, PM recommendation is a separate wiring task with explicit impact
checks and production smoke.

## Recommended Next Action

Accept P4-LONG-WINDOW-PRODUCER-V1, then create a narrow follow-up task to wire or
manually trigger the producer.
