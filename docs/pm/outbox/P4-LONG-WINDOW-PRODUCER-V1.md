# P4-LONG-WINDOW-PRODUCER-V1 - P4 cache-only long-window stats producer

Created: 2026-06-10T23:30:03+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Implement the cache-only producer for P4 long-window equilibrium calibration.
`P4-CMA-EQUILIBRIUM-V2` already made `HistoricalCalibrator` consume
`long_window_stats`; this task adds a producer that can build that snapshot from
existing local `ETFPriceCache` data without live network calls.

This V1 must not change runtime refresh behavior. Do not wire it into
`MarketDataService.refresh()` yet; produce a tested module that returns the
snapshot and optionally persists it through the existing cache API.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/data/long_window_producer.py`
- `backend/tests/test_long_window_producer.py`
- `docs/pm/reports/P4-LONG-WINDOW-PRODUCER-V1.md`

Files or areas the coding agent must not edit:

- Unrelated generated assets
- Deployment output unless explicitly requested
- Git history, branches, tags, or remotes
- Production server or SSH commands
- Database file edits
- Database schema edits
- `backend/app/storage/database.py`
- `backend/app/allocation/data/market_data_service.py`
- `backend/app/allocation/data/historical_calibrator.py`
- Frontend files
- PM outbox/running/log files
- Anything outside this handoff without PM approval

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

If the status contains unrelated changes, preserve them and continue only inside
the approved scope.

## Implementation Tasks

1. Add `backend/app/allocation/data/long_window_producer.py`.
2. The module must read ETF prices only from `ETFPriceCache.get_range`; do not
   import or call efinance, tushare, akshare, `load_etf_history`, or any live
   fetcher.
3. Use the representative ETF mapping from
   `backend.app.allocation.backtest.historical_data.REPRESENTATIVE_ETFS` if it
   can be imported without triggering network calls. If that import is risky,
   duplicate the constant locally with a comment explaining why.
4. Provide a pure function, suggested signature:
   `build_long_window_stats(as_of_date: str | None = None, years: int = 3) -> dict | None`
   It should:
   - read local ETF price ranges for each mapped asset,
   - compute annualized log-return means and vols,
   - compute a 14x14 finite correlation matrix,
   - synthesize `cash` and `money_fund` if needed,
   - return `None` when coverage is below 0.7,
   - include `quality`, `returns_long`, `vols_long`, `correlation_matrix`, and a
     nested `long_window` block matching the consumer contract.
5. Provide a small optional persistence wrapper:
   `persist_long_window_stats(snapshot: dict) -> None`
   This may call `StatsSnapshotCache.save("long_window_stats", snapshot)`.
   Do not change `StatsSnapshotCache`.
6. Add focused tests in `backend/tests/test_long_window_producer.py` covering:
   - no network imports/calls required,
   - successful local-cache computation,
   - insufficient coverage returns `None`,
   - output is finite and matches `HistoricalCalibrator` consumer expectations,
   - persistence wrapper calls `StatsSnapshotCache.save` with key
     `long_window_stats`.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- No live network calls.
- No runtime wiring in this task.
- No changes to `ETFPriceCache`, `StatsSnapshotCache`, or database schema.
- PM ran GitNexus impact before this handoff:
  - `MarketDataService.refresh`: LOW, but not edited in this task.
  - `ETFPriceCache.get_range`: HIGH shared reader; do not edit it, only call it.
  - `StatsSnapshotCache.save`: HIGH shared writer; do not edit it, only call it
    inside the optional persistence wrapper.
- Preserve unrelated dirty files.
- Keep output compatible with
  `HistoricalCalibrator._load_long_window_cache()`.

## Validation

Commands or checks the coding agent must run:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
cd backend; python -m py_compile app/allocation/data/long_window_producer.py tests/test_long_window_producer.py
cd backend; python -m pytest tests/test_long_window_producer.py -q
cd backend; python -m pytest tests/test_historical_calibrator.py -q
```

Expected result:

- Targeted tests pass.
- No frontend changes.
- No database writes during tests except mocked `StatsSnapshotCache.save`.
- No commit, push, or deployment.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P4-LONG-WINDOW-PRODUCER-V1.md` with:

Start the report with this short machine-readable digest:

```markdown
## PM Digest

Status: complete | needs_fix | blocked | decision_needed
Changed: file1, file2
Validation: passed | failed | skipped - command names only
Risk: none | brief risk
Decision: none | exact PM/user question
Next: accept | create_hotfix | run_followup | ask_user
```

Then include:

1. Status
2. Summary
3. Files changed
4. Validation commands and results
5. Scope / safety
6. Open risks or PM decisions needed
7. Recommended next action

Do not include hidden chain-of-thought or `<think>` blocks.
Keep successful command output summarized. Include full output only for failures.
