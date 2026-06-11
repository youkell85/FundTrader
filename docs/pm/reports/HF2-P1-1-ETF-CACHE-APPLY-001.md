## PM Digest

Status: complete
Changed: docs/pm/outbox/HF2-P1-1-ETF-CACHE-APPLY-001.md, docs/pm/reports/HF2-P1-1-ETF-CACHE-APPLY-001.md, backend/data/fundtrader.db (local runtime data)
Validation: passed - populate-apply, cache-coverage, long-window-persist, consumer-tests, cache-readback
Risk: low; local ETFPriceCache and long_window_stats were populated, no code/runtime/deploy changes
Decision: none
Next: accept

## Status

Complete.

Claude dispatch reached the operation step but stopped on its own approval gate
for the live/write command. The PM handoff already authorized the operation, and
the user had said to continue, so PM executed the same approved commands locally
and completed the report.

## Summary

Executed:

```powershell
.\scripts\populate-etf-cache.ps1 -StartDate 2023-06-11 -EndDate 2026-06-10 -Apply -Json
```

Result:

- `mode=apply`
- `wrote_cache=true`
- `rows_added=8677`
- `selected_count=13`
- `load_etf_history` populated 12 of 13 representative ETFs.
- `reits` / `508000` failed all provider fallbacks and remains missing.

Then coverage was rechecked:

- `status=ok`
- `coverage=0.9286`
- `min_coverage=0.7`
- `available_count=12`
- `missing_count=1`
- `synthesized_count=1`

Because coverage passed, persisted:

```powershell
.\scripts\build-long-window-stats.ps1 -AsOfDate 2026-06-10 -Persist -Json
```

Result:

- `status=ok`
- `persisted=true`
- `coverage=0.9286`
- `confidence_score=0.8786`
- `n_observations=726`
- `window_start=2023-06-12`
- `window_end=2026-06-10`
- missing: `reits=insufficient_cache_data:0`

## Files / State Changed

- `backend/data/fundtrader.db`
  - Local `ETFPriceCache` populated for 12 representative ETF codes.
  - `StatsSnapshotCache("long_window_stats")` persisted.
- `docs/pm/outbox/HF2-P1-1-ETF-CACHE-APPLY-001.md`
  - Validation block updated to avoid re-running the live/write apply command
    during acceptance.
- `docs/pm/reports/HF2-P1-1-ETF-CACHE-APPLY-001.md`
  - This report.

No backend/frontend source code, tests, scripts, commits, pushes, or deployment
actions were performed in this HF2 task.

## Validation Commands and Results

```powershell
.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json
```

Result: passed, `status=ok`, `coverage=0.9286`.

```powershell
.\scripts\build-long-window-stats.ps1 -AsOfDate 2026-06-10 -Persist -Json
```

Result: passed, `persisted=true`, `confidence_score=0.8786`.

The persist command emitted NumPy runtime warnings for constant-series
correlation division. The producer already normalizes non-finite correlation
values with `nan_to_num`; output status was `ok` and tests passed.

```powershell
cd backend
python -m pytest tests/test_historical_calibrator.py tests/test_long_window_producer.py tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

Result: `91 passed`.

Cache readback:

```text
has_snapshot=True
coverage=0.9286
confidence_score=0.8786
window_start=2023-06-12
window_end=2026-06-10
n_observations=726
missing={'reits': 'insufficient_cache_data:0'}
```

## Scope / Safety

- Used only the previously accepted `populate-etf-cache.ps1 -Apply` path.
- No direct SQLite mutation via ad hoc SQL.
- Persisted `long_window_stats` only after coverage passed the threshold.
- No commit, push, or deployment.
- Unrelated dirty worktree changes were preserved.

## Open Risks or PM Decisions Needed

`reits` remains missing because representative ETF `508000` failed all provider
fallbacks. This is not blocking P1-1 because coverage is above threshold, but it
should become a follow-up if REITs quality matters for production confidence.

## Recommended Next Action

Accept HF2. Then run a final P1-1 acceptance task to confirm
`HistoricalCalibrator` now consumes `long_window_cache` instead of falling back
to static assumptions.
