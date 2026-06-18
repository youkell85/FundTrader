# HF1-P1-1-ETF-CACHE-POPULATION-001 - P1-1 ETF cache population dry-run command

Created: 2026-06-11T00:43:57+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Implement a safe, dry-run-first maintenance command to populate local
`ETFPriceCache` coverage for the representative ETFs required by P1-1
long-window CMA anchor calibration.

The previous coverage audit proved that all 13 representative ETF codes have
0 local rows, so `long_window_stats` cannot be safely persisted. This task adds
the command and tests needed to fetch and write ETF price history only when an
explicit write/network flag is supplied.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `scripts/populate-etf-cache.ps1`
- `backend/tests/test_etf_cache_population_script.py`
- `docs/pm/outbox/HF1-P1-1-ETF-CACHE-POPULATION-001.md`
- `docs/pm/reports/HF1-P1-1-ETF-CACHE-POPULATION-001.md`

## Allowed Files

- `scripts/`
- `backend/tests/`
- `docs/pm/outbox/`
- `docs/pm/reports/`

Files or areas the coding agent must not edit:

- `backend/app/allocation/backtest/historical_data.py`
- `backend/app/storage/database.py`
- `backend/app/allocation/data/long_window_producer.py`
- `scripts/check-etf-cache-coverage.ps1`
- `scripts/build-long-window-stats.ps1`
- Unrelated generated assets
- Deployment output unless explicitly requested
- Git history, branches, tags, or remotes
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

1. Add `scripts/populate-etf-cache.ps1`.
   - Default mode must be dry-run and read-only.
   - Use an explicit `-Apply` switch for live fetch/write behavior.
   - Support `-StartDate`, `-EndDate`, `-Json`, and optional `-Codes`.
   - Use existing `backend.app.allocation.backtest.historical_data.load_etf_history`
     for live fetch/write because it already uses the cache/provider fallback.
   - After any run, report per ETF current local row counts using
     `ETFPriceCache.get_range`.
2. The dry-run path must not import or call live providers.
3. The apply path may make network calls and write `ETFPriceCache`; it must not
   persist `long_window_stats`.
4. Add tests that validate:
   - The script file exists and exposes `-Apply`.
   - Default dry-run path is documented as read-only.
   - The script references `load_etf_history` and does not reference
     `StatsSnapshotCache.save`.
5. Write the final report.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- GitNexus impact:
  - `load_etf_history`: LOW; call only, do not edit.
  - `ETFPriceCache.save_batch`: LOW; may be reached indirectly through
    `load_etf_history`, do not edit.
- Do not change database schema.
- Do not write `StatsSnapshotCache("long_window_stats")` in this task.
- Do not change allocation runtime behavior.
- Do not commit, push, or deploy.
- Preserve unrelated dirty worktree changes.

## Validation

Commands or checks the coding agent must run:

```powershell
python -m py_compile backend\app\allocation\data\long_window_producer.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Push-Location backend; python -m pytest tests/test_etf_cache_population_script.py tests/test_long_window_producer.py -q; $testExit=$LASTEXITCODE; Pop-Location; if ($testExit -ne 0) { exit $testExit }
.\scripts\populate-etf-cache.ps1 -StartDate 2023-06-11 -EndDate 2026-06-10 -Json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git diff --check -- scripts\populate-etf-cache.ps1 backend\tests\test_etf_cache_population_script.py docs\pm\outbox\HF1-P1-1-ETF-CACHE-POPULATION-001.md
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Expected result:

- Tests pass.
- Dry-run reports no writes and no persistence.
- No live fetch/write command is executed during validation unless PM
  explicitly chooses to run `-Apply` after reviewing the dry-run.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/HF1-P1-1-ETF-CACHE-POPULATION-001.md` with:

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
