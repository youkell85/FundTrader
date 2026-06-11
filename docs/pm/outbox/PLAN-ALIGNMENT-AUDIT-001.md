# PLAN-ALIGNMENT-AUDIT-001 - Integrated plan alignment audit

Created: 2026-06-11T00:37:20+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Re-align the current FundTrader implementation status with
`docs/0610/integrated-plan.md`. Produce a concise PM progress matrix that maps
the integrated plan's P0/P1/P2/P3 requirements to current PM reports,
acceptance artifacts, and visible code/test evidence.

This is an audit-only task. Do not implement product changes. The purpose is to
identify what is truly complete, what is partial, what is blocked, and what
should be the next PM-Claude task.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `docs/pm/reports/PLAN-ALIGNMENT-AUDIT-001.md`
- This handoff file only if needed to fix typos before dispatch.

Files or areas the coding agent must not edit:

- Backend or frontend source code
- Tests
- Scripts
- `docs/0610/*`
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

1. Read `docs/0610/integrated-plan.md` as the authoritative plan.
2. Read current PM reports and acceptance files under `docs/pm/reports` and
   `docs/pm/reviews`.
3. Inspect only the minimum code/test files needed to confirm obvious status
   claims. Prefer `rg` and short file reads.
4. Produce `docs/pm/reports/PLAN-ALIGNMENT-AUDIT-001.md` with:
   - A PM Digest.
   - Overall status versus integrated plan.
   - A P0/P1/P2/P3 matrix with `done`, `partial`, `missing`, or `blocked`.
   - Evidence references by report/test/code path.
   - Deviations from plan, especially the current `P4` work and whether it
     should be reclassified.
   - Recommended next PM-Claude task.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Treat `docs/0610/integrated-plan.md` as the implementation source of truth.
- Do not claim a phase is complete unless acceptance evidence exists and no
  known blocker contradicts it.
- Current P4 long-window work should be evaluated against the integrated plan,
  not treated as a new official phase unless the report explains why.
- Do not commit, push, deploy, write databases, or call live market data.

## Validation

Commands or checks the coding agent must run:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
rg -n "P0-|P1-|P2-|P3-|P4-|Status:|Validation:|Risk:|Decision:|Next:|blocked|decision_needed|needs_fix|passed|failed" docs\pm\reports docs\pm\reviews -S
rg -n "P0|P1|P2|P3|data_quality|NaN|Inf|511880|historical_calibrator|long_window|market-data/status|calibration.health" docs\0610\integrated-plan.md backend frontend scripts docs\pm\reports -S
```

Expected result:

- Report is created.
- Audit is read-only except for the report.
- Known dirty working tree is preserved.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/PLAN-ALIGNMENT-AUDIT-001.md` with:

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
