## PM Digest

Status: complete
Changed: docs/pm/outbox/P1-1-LONG-WINDOW-FINAL-ACCEPT-001.md, docs/pm/reports/P1-1-LONG-WINDOW-FINAL-ACCEPT-001.md
Validation: passed - hf2-brief, hf3-brief, cache-coverage, historical-calibrator-readback, consumer-tests
Risk: low; report-only final acceptance, REITs remains partial-quality caveat
Decision: none
Next: accept

## Status

Complete.

## Summary

P1-1 long-window CMA anchor calibration is now acceptance-ready against
`docs/0610/integrated-plan.md`.

The work originally labeled `P4-*` has been reconciled as a P1-1 follow-up:

- Long-window producer exists and is cache-only.
- Manual trigger exists and is dry-run-first.
- ETFPriceCache was populated through the approved `-Apply` path.
- Cache coverage is now above threshold.
- `long_window_stats` was persisted.
- `HistoricalCalibrator` now consumes `long_window_cache`.
- Direct calibrator outputs expose `data_status=partial`.

The status is `partial`, not `real`, because `reits` / ETF `508000` remains
missing. This is the correct representation: usable above-threshold coverage
without pretending every asset has real long-window data.

## Acceptance Evidence

HF2 brief:

- `Status: complete`
- `Validation: passed - populate-apply, cache-coverage, long-window-persist, consumer-tests, cache-readback`
- `Next: accept`

HF3 brief:

- `Status: complete`
- `Validation: passed - historical-calibrator-tests, long-window-tests, calibration-audit-tests, allocation-contract-tests, cache-readback, diff-check`
- `Next: accept`

Coverage:

- `status=ok`
- `coverage=0.9286`
- `min_coverage=0.7`
- `available_count=12`
- `missing_count=1`
- `missing=reits`

Persisted snapshot:

- `persisted=true`
- `confidence_score=0.8786`
- `n_observations=726`
- `window_start=2023-06-12`
- `window_end=2026-06-10`

HistoricalCalibrator readback:

```text
returns_source=long_window_cache
vols_source=long_window_cache
corr_source=long_window_cache
returns_status=partial
vols_status=partial
corr_status=partial
confidence_score=0.8786
```

## Validation Commands and Results

```powershell
.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json
```

Result: passed, `status=ok`, `coverage=0.9286`.

```powershell
cd backend
python -m pytest tests/test_historical_calibrator.py tests/test_long_window_producer.py tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

Result: `91 passed`.

## Scope / Safety

- Report-only final acceptance.
- No code changes in this acceptance task.
- No database writes in this acceptance task.
- No live network calls in this acceptance task.
- No commit, push, or deployment.

## Open Risks or PM Decisions Needed

None blocking.

Known caveat: `reits` remains missing from the representative ETF cache because
`508000` failed provider fetches. This is accurately surfaced as
`data_status=partial`.

## Recommended Next Action

Accept P1-1 long-window calibration. Continue the integrated plan from the next
remaining P1 gap, likely macro source governance or formal P0 retrospective
acceptance, depending on PM priority.
