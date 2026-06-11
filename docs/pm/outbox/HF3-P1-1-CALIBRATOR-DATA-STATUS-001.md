# HF3-P1-1-CALIBRATOR-DATA-STATUS-001 - P1-1 historical calibrator data_status hotfix

Created: 2026-06-11T00:57:53+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Add explicit `data_status` metadata to `HistoricalCalibrator` results so P1-1
long-window calibration aligns with `docs/0610/integrated-plan.md`: key
calibration numbers must expose source, coverage, and data status.

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
- `docs/pm/outbox/HF3-P1-1-CALIBRATOR-DATA-STATUS-001.md`
- `docs/pm/reports/HF3-P1-1-CALIBRATOR-DATA-STATUS-001.md`

Files or areas the coding agent must not edit:

- Other backend/frontend source
- Scripts
- Database schema
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

1. Add `data_status` to `CalibrationResult.to_dict()`.
2. Mark static fallback results as `assumption`.
3. Mark fully covered non-static calibration as `real`; mark threshold-passing
   but incomplete/assumption-containing calibration as `partial`.
4. Add/adjust tests for static, historical, long-window cache, injected
   long-window snapshot, and insufficient coverage paths.
5. Verify real local cache readback shows `long_window_cache` + `partial`.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- GitNexus impact for `HistoricalCalibrator`: LOW.
- Do not change output shape except adding backward-compatible `data_status`.
- Do not change calibration values.
- Do not change database writes or scripts.
- Do not commit, push, or deploy.

## Validation

Commands or checks the coding agent must run:

```powershell
Push-Location backend; python -m pytest tests/test_historical_calibrator.py tests/test_long_window_producer.py tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q; $testExit=$LASTEXITCODE; Pop-Location; if ($testExit -ne 0) { exit $testExit }
git diff --check -- backend\app\allocation\data\historical_calibrator.py backend\tests\test_historical_calibrator.py 2>$null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Expected result:

- Tests pass.
- Long-window cache readback returns `source=long_window_cache` and
  `data_status=partial` for returns/vols/correlation when REITs remains
  missing.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/HF3-P1-1-CALIBRATOR-DATA-STATUS-001.md` with:

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
