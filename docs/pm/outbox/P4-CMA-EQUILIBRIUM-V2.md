# P4-CMA-EQUILIBRIUM-V2 - P4 cache-only long-window equilibrium calibration

Created: 2026-06-10T23:04:39+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Implement the next post-P3 allocation reliability slice: make
`HistoricalCalibrator` distinguish true long-window equilibrium calibration from
short-window signal-layer rolling stats.

PM decision for this V2 slice:

- Proceed with P4 only; do not bundle P5 as a broad correlation-matrix project.
- Do not implement Bayesian shrinkage yet.
- Do not make live Tushare/network calls.
- Use cache-only or injected snapshot data. When long-window data is not
  available, fall back explicitly to the current short-window/static behavior
  with clear provenance.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/data/historical_calibrator.py`
- `backend/tests/test_historical_calibrator.py`
- `docs/pm/reports/P4-CMA-EQUILIBRIUM-V2.md`

Files or areas the coding agent must not edit:

- Unrelated generated assets
- Deployment output unless explicitly requested
- Git history, branches, tags, or remotes
- Production server or SSH commands
- Frontend files
- `backend/app/storage/database.py` / `StatsSnapshotCache`
- `backend/app/allocation/config.py`
- `backend/app/allocation/cma_manager.py`
- `backend/app/allocation/data/market_data_service.py`
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

1. Preserve current public return shape from all calibrator methods:
   `source`, `as_of`, `coverage`, `valid_assets`, `invalid_assets`,
   `assumptions_used`, `calibration_version`, plus `values` or `matrix`.
2. Add a small cache-only long-window path inside
   `HistoricalCalibrator._load_stats()` or nearby helpers. It must prefer data
   shaped as either:
   - `returns_long` / `vols_long` / `correlation_matrix`, or
   - a nested long-window block such as `long_window` containing those values.
   Keep compatibility with existing injected snapshots used by tests.
3. Add metadata to long-window results without breaking existing consumers.
   Suggested optional keys:
   - `window_start`
   - `window_end`
   - `n_observations`
   - `confidence_score`
   Only include keys when values are known.
4. Ensure the source/provenance is distinct:
   - long-window cache/snapshot results should not be labeled as the same
     short-window signal-layer source.
   - short-window `compute_rolling_stats_ex()` results remain fallback.
   - static config remains `static_assumption`.
5. Keep all numeric outputs finite. Invalid per-asset values must fall back to
   config assumptions and be listed in `invalid_assets` / `assumptions_used`.
6. Add/update tests for:
   - long-window returns/vols are preferred over short-window returns/vols,
   - long-window metadata is surfaced,
   - insufficient long-window coverage falls back explicitly,
   - existing static fallback still passes,
   - correlation matrix remains finite, square, symmetric, and unit-diagonal.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Existing allocation API response contracts must remain backward-compatible.
- Existing `CalibrationResult.to_dict()` fields must remain present.
- Do not rename existing calibrator methods.
- Do not change `StatsSnapshotCache`.
- Do not alter `config.py` constants.
- `HistoricalCalibrator.calibrate_*` must remain safe when external data is
  missing or malformed.
- PM already ran GitNexus impact:
  - `calibrate_equilibrium_returns`: LOW, direct caller `calibrate_all`, affects
    `MarketDataService.refresh` through `_calibrate_factors`.
  - `calibrate_equilibrium_vols`: LOW, same blast radius.
  - `calibrate_correlation_matrix`: LOW, same blast radius.
  - `calibrate_all`: LOW.
  - `StatsSnapshotCache`: HIGH, therefore do not edit it.

## Validation

Commands or checks the coding agent must run:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
cd backend; python -m pytest tests/test_historical_calibrator.py -q
cd backend; python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

Expected result:

- Targeted backend tests pass.
- No frontend changes.
- No commit, push, or deployment.
- Unrelated dirty files remain untouched:
  `AGENTS.md`, `CLAUDE.md`, `.codegraph/**`, `.mavis/**`, `.reasonix/**`,
  `docs/0610/**`, and `nul`.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P4-CMA-EQUILIBRIUM-V2.md` with:

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
