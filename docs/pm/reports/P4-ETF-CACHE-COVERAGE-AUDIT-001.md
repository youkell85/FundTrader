## PM Digest

Status: complete
Changed: scripts/check-etf-cache-coverage.ps1, docs/pm/outbox/P4-ETF-CACHE-COVERAGE-AUDIT-001.md, docs/pm/reports/P4-ETF-CACHE-COVERAGE-AUDIT-001.md
Validation: passed - cache-coverage-audit, py_compile, producer-consumer-tests, diff-check, ascii-check
Risk: low; script is read-only and does not fetch, write cache, commit, push, or deploy
Decision: live ETF cache population needs approval of data source and network/write operation
Next: ask_user

## Status

Complete.

## Summary

Added a read-only ETF cache coverage audit command:

```powershell
.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json
```

The audit checks the representative ETF codes used by the P4 long-window
producer against local SQLite `etf_daily_prices`. It reports total row coverage,
window row coverage, min/max dates, and per-asset status.

Current local result for the 3-year window ending 2026-06-10:

- `status`: insufficient
- `coverage`: 0.1429
- `min_coverage`: 0.7
- `available_count`: 0
- `synthesized_count`: 2
- `missing_count`: 12

All 13 representative ETF codes currently have 0 local cache rows. The only
effective coverage comes from synthetic `cash` and the producer's missing
`money_fund` fallback.

## Files Changed

- `scripts/check-etf-cache-coverage.ps1`
  - New read-only coverage audit.
  - Supports `-AsOfDate`, `-Years`, `-MinObservations`,
    `-AllowInsufficient`, and `-Json`.
  - Returns 0 for sufficient coverage and 2 for insufficient coverage.
- `docs/pm/outbox/P4-ETF-CACHE-COVERAGE-AUDIT-001.md`
  - Filled handoff with scope, contracts, and validation.
- `docs/pm/reports/P4-ETF-CACHE-COVERAGE-AUDIT-001.md`
  - This report.

## Validation Commands and Results

```powershell
.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json -AllowInsufficient
```

Result: passed as diagnostic. The JSON reported `status=insufficient`. The
default command without `-AllowInsufficient` returns exit code 2 for this state;
the validation command uses the explicit switch so PM acceptance can treat the
known insufficiency as a successful audit result.

```powershell
python -m py_compile backend\app\allocation\data\long_window_producer.py
```

Result: passed.

```powershell
cd backend
python -m pytest tests/test_long_window_producer.py tests/test_historical_calibrator.py -q
```

Result: `19 passed`.

```powershell
git diff --check -- scripts\check-etf-cache-coverage.ps1 docs\pm\outbox\P4-ETF-CACHE-COVERAGE-AUDIT-001.md
```

Result: passed.

ASCII scan for the new script and handoff: passed, 0 non-ASCII characters.

## Scope / Safety

- No production runtime behavior changed.
- No database writes.
- No live network calls.
- No cache persistence.
- No frontend changes.
- No commit, push, or deployment.

## Open Risks or PM Decisions Needed

The blocker is now confirmed as local ETF cache absence, not producer logic.

Before implementing population, PM/user should approve:

- Which live provider to use for representative ETF daily prices.
- Whether local `backend/data/fundtrader.db` may be populated.
- Whether the population task may make network calls.

## Recommended Next Action

Create a follow-up P4 cache population task after approval. It should fetch and
save daily prices for the representative ETF map, rerun the coverage audit, then
rerun `build-long-window-stats.ps1 -Persist` only after coverage reaches the P4
threshold.
