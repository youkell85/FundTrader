# P4-LONG-WINDOW-PRODUCER-AUDIT-001 - P4 long-window stats producer audit

Created: 2026-06-10T23:24:25+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Produce a read-only PM audit for the next P4 follow-up after
`P4-CMA-EQUILIBRIUM-V2`. The previous slice taught `HistoricalCalibrator` to
consume `long_window_stats`; this task determines the smallest safe way to
produce that cache entry from existing local ETF price history without live
network calls.

Do not implement. Write a concise report that maps current local-history
capabilities to a bounded implementation handoff.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- Only `docs/pm/reports/P4-LONG-WINDOW-PRODUCER-AUDIT-001.md`.
- Read-only inspection is allowed for:
  - `backend/app/storage/database.py`
  - `backend/app/allocation/backtest/historical_data.py`
  - `backend/app/allocation/data/market_data_service.py`
  - `backend/app/allocation/data/historical_calibrator.py`
  - relevant tests under `backend/tests/`
  - PM reports for `P4-SCOPE-AUDIT-001` and `P4-CMA-EQUILIBRIUM-V2`

Files or areas the coding agent must not edit:

- Unrelated generated assets
- Deployment output unless explicitly requested
- Git history, branches, tags, or remotes
- Production server or SSH commands
- Application source edits
- Test source edits
- Database file edits
- PM outbox/running/log edits
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

1. Confirm current PM state and summarize the P4 V2 result from
   `docs/pm/reports/P4-CMA-EQUILIBRIUM-V2.md`.
2. Inspect local history/storage capabilities:
   - `ETFPriceCache` table and methods,
   - `load_etf_history()` and representative ETF mapping,
   - `MarketDataService._calibrate_factors()` / `_save_stats_to_db()`,
   - current `HistoricalCalibrator._load_long_window_cache()` contract.
3. Identify whether a producer can be implemented without:
   - live network calls,
   - database schema changes,
   - changing `StatsSnapshotCache`,
   - changing API contracts.
4. Propose one bounded implementation task if safe, including:
   - task id,
   - allowed edit files,
   - GitNexus impact targets PM must run before editing,
   - algorithm outline,
   - validation commands,
   - acceptance criteria,
   - stop conditions.
5. If the implementation requires a product/data decision, report
   `decision_needed` and the exact question.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- No live network calls for the producer V1 unless PM explicitly approves.
- Prefer existing local `ETFPriceCache` / `load_etf_history` capabilities.
- Do not edit `StatsSnapshotCache` or database schema unless a separate PM
  decision approves it.
- The produced snapshot must match the consumer contract:
  `long_window_stats` containing nested `long_window` or flat `returns_long` /
  `vols_long` / `correlation_matrix`, plus quality and metadata when available.
- No commit, push, or deployment.

## Validation

Commands or checks the coding agent must run:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
rg -n "class ETFPriceCache|def save_batch|def get_range|load_etf_history|_fetch_etf_prices_with_dates|_calibrate_factors|_save_stats_to_db|long_window_stats" backend/app backend/tests docs/pm/reports
```

Expected result:

- Report written to `docs/pm/reports/P4-LONG-WINDOW-PRODUCER-AUDIT-001.md`.
- No source code changes.
- No test changes.
- No database writes.
- No deployment.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P4-LONG-WINDOW-PRODUCER-AUDIT-001.md` with:

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
