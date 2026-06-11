## PM Digest

Status: complete
Changed: backend/app/allocation/data/historical_calibrator.py, backend/tests/test_historical_calibrator.py, docs/pm/reports/P4-CMA-EQUILIBRIUM-V2.md
Validation: passed - py_compile, test_historical_calibrator, test_calibration_audit, test_allocation_api_contract, diff-check, gitnexus-detect-changes
Risk: scoped code impact LOW; gitnexus-detect-changes reports HIGH because unrelated AGENTS.md/CLAUDE.md are dirty
Decision: none
Next: accept

## Status

Complete. Claude implemented the code and tests but did not write the final report
because its test command required approval in its environment. PM ran validation,
made small corrective edits, and wrote this report.

## Summary

P4-CMA-EQUILIBRIUM-V2 adds a cache-only long-window path to
`HistoricalCalibrator` without adding network calls or changing storage schema.
The calibrator now checks `long_window_stats` cache data, supports nested
`long_window` blocks, supports flat `returns_long` / `vols_long` inputs, and
adds optional metadata fields to calibration results:

- `window_start`
- `window_end`
- `n_observations`
- `confidence_score`

The value preference is now:

1. nested `long_window` values
2. flat `returns_long` / `vols_long`
3. short-window `returns` / `vols`
4. static assumptions when coverage is insufficient or data is invalid

Injected long-window snapshots now get a distinct `long_window_snapshot` source.
Cached long-window data gets `long_window_cache`. Short-window live rolling stats
remain `historical_market_data`; old rolling cache remains `sqlite_cache`.

## Files Changed

- `backend/app/allocation/data/historical_calibrator.py`
  - Added optional long-window metadata to `CalibrationResult`.
  - Added `long_window_stats` cache loading.
  - Added normalized long-window extraction helper.
  - Preserved finite-value fallback and static-assumption behavior.
- `backend/tests/test_historical_calibrator.py`
  - Expanded coverage from 3 to 12 tests.
  - Covered nested long-window preference, flat long-window keys, metadata,
    injected snapshot source, insufficient coverage fallback, and correlation
    matrix sanitization.
- `docs/pm/reports/P4-CMA-EQUILIBRIUM-V2.md`
  - PM completion report.

## Validation Commands and Results

```powershell
cd backend
python -m py_compile app\allocation\data\historical_calibrator.py tests\test_historical_calibrator.py
```

Result: passed.

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
git diff --check -- backend\app\allocation\data\historical_calibrator.py backend\tests\test_historical_calibrator.py
```

Result: passed; only CRLF normalization warnings.

```powershell
npx gitnexus detect-changes --repo FundTrader
```

Result: completed. Reported HIGH because unrelated local `AGENTS.md` and
`CLAUDE.md` are dirty and included in GitNexus detection. PM-scoped pre-edit
impact checks for `calibrate_equilibrium_returns`, `calibrate_equilibrium_vols`,
`calibrate_correlation_matrix`, and `calibrate_all` were LOW. `StatsSnapshotCache`
was HIGH and was not edited.

## Scope / Safety

- No frontend changes.
- No production server access.
- No commit, push, or deployment.
- `StatsSnapshotCache` and `config.py` were not edited.
- Unrelated local files were preserved.
- New code is backward-compatible with existing calibration result shape.

## Open Risks or PM Decisions Needed

None for this slice.

Deferred work remains:

- P4 Bayesian shrinkage prior decision: DMS global priors vs China-local priors.
- P5 deeper correlation matrix calibration and positive-definite shrinkage.
- Real long-window cache producer is still a follow-up; this slice only consumes
  cache/injected long-window data when available.

## Recommended Next Action

Accept P4-CMA-EQUILIBRIUM-V2, then continue with a follow-up producer task that
populates `long_window_stats` from existing local price history without live
network calls.
