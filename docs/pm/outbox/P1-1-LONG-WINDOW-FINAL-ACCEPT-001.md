# P1-1-LONG-WINDOW-FINAL-ACCEPT-001 - P1-1 long-window calibration final acceptance

Created: 2026-06-11T00:57:21+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Formally accept the P1-1 long-window CMA anchor calibration follow-up against
`docs/0610/integrated-plan.md`.

This task verifies that ETF cache coverage has been populated, the
`long_window_stats` snapshot is persisted, and `HistoricalCalibrator` consumes
that snapshot with explicit `source`, `coverage`, `confidence_score`, and
`data_status`.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `docs/pm/outbox/P1-1-LONG-WINDOW-FINAL-ACCEPT-001.md`
- `docs/pm/reports/P1-1-LONG-WINDOW-FINAL-ACCEPT-001.md`

Files or areas the coding agent must not edit:

- Backend/frontend source code
- Tests
- Scripts
- Database schema/data
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

1. Confirm PM briefs for HF2 and HF3 are complete and accepted.
2. Verify `check-etf-cache-coverage.ps1` reports `status=ok`.
3. Verify `StatsSnapshotCache("long_window_stats")` exists.
4. Verify `HistoricalCalibrator` returns `long_window_cache` and
   `data_status=partial` for returns, vols, and correlation matrix.
5. Write the final acceptance report.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Do not rerun live ETF cache apply.
- Do not persist stats again.
- Do not commit, push, or deploy.
- Treat missing REITs as a known non-blocking partial-quality item.

## Validation

Commands or checks the coding agent must run:

```powershell
.\scripts\pm-brief.ps1 -Task docs\pm\outbox\HF2-P1-1-ETF-CACHE-APPLY-001.md
.\scripts\pm-brief.ps1 -Task docs\pm\outbox\HF3-P1-1-CALIBRATOR-DATA-STATUS-001.md
.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json
Push-Location backend; python -m pytest tests/test_historical_calibrator.py tests/test_long_window_producer.py tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q; $testExit=$LASTEXITCODE; Pop-Location; if ($testExit -ne 0) { exit $testExit }
```

Expected result:

- HF2 and HF3 are accepted.
- Coverage status is `ok`.
- Tests pass.
- Final report states P1-1 long-window calibration is acceptance-ready with
  known `reits` partial-quality caveat.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P1-1-LONG-WINDOW-FINAL-ACCEPT-001.md` with:

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
