# P4-LONG-WINDOW-MANUAL-TRIGGER-V1 - P4 manual long-window stats trigger

Created: 2026-06-10T23:57:09+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Implement a manual maintenance trigger for P4 long-window stats. The command
must run the cache-only producer from `P4-LONG-WINDOW-PRODUCER-V1` without
wiring it into automatic refresh.

Default behavior must be dry-run/read-only. Only an explicit `-Persist` flag may
write `StatsSnapshotCache("long_window_stats")`.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `scripts/build-long-window-stats.ps1`
- `docs/pm/reports/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.md`

Files or areas the coding agent must not edit:

- Unrelated generated assets
- Deployment output unless explicitly requested
- Git history, branches, tags, or remotes
- Production server or SSH commands
- Backend source files
- Frontend files
- Database schema or database file
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

1. Add `scripts/build-long-window-stats.ps1`.
2. The script must call `app.allocation.data.long_window_producer.build_long_window_stats`.
3. The script must not persist by default.
4. Add `-Persist`, `-AsOfDate`, `-Years`, and `-Json` options.
5. Return non-zero when local cache coverage is insufficient.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- No automatic refresh wiring.
- No live network calls.
- No commit, push, or deployment.
- No database writes unless `-Persist` is explicitly supplied.

## Validation

Commands or checks the coding agent must run:

```powershell
python -m py_compile backend\app\allocation\data\long_window_producer.py
.\scripts\build-long-window-stats.ps1 -AsOfDate 2026-06-10 -Json
cd backend; python -m pytest tests/test_long_window_producer.py tests/test_historical_calibrator.py -q
```

Expected result:

- Script exists and default run is dry-run.
- Producer tests still pass.
- No deployment.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.md` with:

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
