## PM Digest

Status: complete
Changed: scripts/build-long-window-stats.ps1, docs/pm/outbox/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.md, docs/pm/reports/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.md
Validation: passed - py_compile, dry-run, producer-consumer-tests, diff-check, ascii-check
Risk: low; default dry-run does not write database, Persist is explicit
Decision: none
Next: accept

## Status

Complete.

## Summary

Added a manual maintenance command:

```powershell
.\scripts\build-long-window-stats.ps1 -AsOfDate 2026-06-10 -Json
```

Default mode is dry-run. It builds a long-window stats snapshot from local
`ETFPriceCache` through the P4 producer and prints a summary. It only writes
`StatsSnapshotCache("long_window_stats")` when `-Persist` is explicitly supplied.

Useful options:

- `-AsOfDate YYYY-MM-DD`
- `-Years 3`
- `-Json`
- `-Persist`

## Files Changed

- `scripts/build-long-window-stats.ps1`
  - New dry-run-first manual trigger.
  - Uses a temporary Python helper in `%TEMP%` to avoid PowerShell quoting issues.
  - Restores `PYTHONPATH` after execution.
- `docs/pm/outbox/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.md`
  - Handoff filled with scope and validation.
- `docs/pm/reports/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.md`
  - This report.

## Validation Commands and Results

```powershell
python -m py_compile backend\app\allocation\data\long_window_producer.py
```

Result: passed.

```powershell
.\scripts\build-long-window-stats.ps1 -AsOfDate 2026-06-10 -Json
```

Result: dry-run executed without persisting. Current local ETF cache coverage is
insufficient, so the command returned:

```json
{"status":"unavailable","reason":"insufficient_long_window_cache_coverage","persisted":false}
```

This is the expected safe diagnostic state when local long-window ETF cache is
not populated enough.

```powershell
cd backend
python -m pytest tests/test_long_window_producer.py tests/test_historical_calibrator.py -q
```

Result: `19 passed`.

```powershell
git diff --check -- scripts\build-long-window-stats.ps1 docs\pm\outbox\P4-LONG-WINDOW-MANUAL-TRIGGER-V1.md
```

Result: passed.

ASCII scan for the script and handoff: passed, 0 non-ASCII characters.

## Scope / Safety

- No runtime refresh wiring.
- No live network calls.
- No database writes during validation.
- No frontend changes.
- No commit, push, or deployment.
- `-Persist` is required for any cache write.

## Open Risks or PM Decisions Needed

None for the manual trigger itself.

The local long-window ETF cache is currently insufficient. To make `-Persist`
produce a usable snapshot, the next task should populate or refresh local
`ETFPriceCache` coverage first, then rerun this command.

## Recommended Next Action

Accept this task. Next PM task should be a cache-coverage audit or cache
population task for representative ETFs.
