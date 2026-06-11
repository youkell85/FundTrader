# HF2-P1-1-ETF-CACHE-APPLY-001 - P1-1 ETF cache apply and long-window persist

Created: 2026-06-11T00:51:06+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Run the explicit apply step for P1-1 ETF cache population, then verify whether
local ETFPriceCache coverage is sufficient to persist `long_window_stats`.

This is an operations task. It may make live provider calls and write local
`backend/data/fundtrader.db` through the approved
`scripts/populate-etf-cache.ps1 -Apply` path. It must not commit, push, or
deploy.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `docs/pm/outbox/HF2-P1-1-ETF-CACHE-APPLY-001.md`
- `docs/pm/reports/HF2-P1-1-ETF-CACHE-APPLY-001.md`

Files or areas the coding agent must not edit:

- Backend/frontend source code
- Tests
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

1. Run the approved apply command:
   `.\scripts\populate-etf-cache.ps1 -StartDate 2023-06-11 -EndDate 2026-06-10 -Apply -Json`
2. Run cache coverage:
   `.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json`
3. If coverage is sufficient, run:
   `.\scripts\build-long-window-stats.ps1 -AsOfDate 2026-06-10 -Persist -Json`
4. If coverage is insufficient or apply fails, do not persist stats. Write the
   report with the exact blocker and recommended hotfix.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Use only the previously accepted script path for write behavior.
- Do not directly edit SQLite with ad hoc SQL.
- Do not persist `long_window_stats` unless coverage reaches the producer
  threshold.
- Do not commit, push, or deploy.
- Preserve unrelated dirty worktree changes.

## Validation

Commands or checks the coding agent must run:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json
cd backend; python -m pytest tests/test_historical_calibrator.py tests/test_long_window_producer.py tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

Expected result:

- Cache coverage is `ok`.
- Long-window stats have already been persisted by this task.
- Consumer/contract tests pass.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/HF2-P1-1-ETF-CACHE-APPLY-001.md` with:

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
