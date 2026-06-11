# P4-SCOPE-AUDIT-001 - P4 scope audit for calibrated equilibrium parameters

Created: 2026-06-10T22:58:18+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Produce a low-token PM scope audit for the next post-P3 work item. The user asked
to keep advancing with the PM -> Claude workflow; P1, P2, and P3 are closed, so
this task determines whether the next actionable slice should be P4 calibrated
equilibrium parameters or whether a product/architecture decision is required
before coding.

This is a read-only audit task. Do not implement code changes. The outcome should
be a concise report that maps the P4 issue(s) from `docs/0610/*.md` to the
current codebase, identifies what has already been covered by P1/P2/P3, and
proposes one bounded follow-up implementation handoff if safe.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- Only `docs/pm/reports/P4-SCOPE-AUDIT-001.md`.
- Read-only inspection is allowed for:
  - `docs/0610/*.md`
  - `docs/pm/STATUS.md`
  - `docs/pm/reports/P1*.md`, `docs/pm/reports/P2*.md`, `docs/pm/reports/P3*.md`
  - `backend/app/allocation/config.py`
  - `backend/app/allocation/cma_manager.py`
  - `backend/app/allocation/data/market_data_service.py`
  - `backend/app/allocation/orchestrator.py`
  - relevant backend tests under `backend/tests/`

Files or areas the coding agent must not edit:

- Unrelated generated assets
- Deployment output unless explicitly requested
- Git history, branches, tags, or remotes
- Production server or SSH commands
- Application source edits
- Test source edits
- PM status edits
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

1. Read `docs/pm/STATUS.md` and confirm the current PM state is P1/P2/P3 closed
   with no active running PM task.
2. Read only the relevant P4 planning lines in `docs/0610/opus.md`,
   `docs/0610/qwen.md`, and `docs/0610/integrated-plan.md`. Focus on P4
   calibrated equilibrium returns / anchor parameters and any directly coupled
   P5 correlation-matrix item.
3. Inspect the current code paths for equilibrium returns, default correlation,
   CMA anchor blending, and market data status. Use `rg` before opening full
   files.
4. Determine whether P4 is already materially solved by P1/P2/P3. If not,
   propose the smallest safe implementation slice, including:
   - task id suggestion,
   - allowed edit files,
   - GitNexus impact targets that PM must run before editing,
   - validation commands,
   - acceptance criteria,
   - stop conditions.
5. Do not create the follow-up task file. Only write the audit report.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Existing allocation API response contracts must remain backward-compatible.
- Existing P3 calibration audit health shape must remain intact.
- Static assumptions may remain only as explicit fallback / assumption sources,
  never silently promoted to real calibrated data.
- Any future implementation must preserve unrelated dirty files:
  `AGENTS.md`, `CLAUDE.md`, `.codegraph/**`, `.mavis/**`, `.reasonix/**`,
  `docs/0610/**`, and `nul`.
- No commit, push, deployment, or production verification in this task.

## Validation

Commands or checks the coding agent must run:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
rg -n "EQUILIBRIUM_RETURNS|DEFAULT_CORR|DEFAULT_CORRELATION|anchor|calibrat|historical|blend_lambda|quality" backend/app/allocation docs/0610 docs/pm/STATUS.md
```

Expected result:

- Report written to `docs/pm/reports/P4-SCOPE-AUDIT-001.md`.
- No source code changes.
- No test changes.
- No deployment.
- Report digest status is `complete` if a safe next slice is identified,
  `decision_needed` if PM/user must choose among incompatible product or
  architecture options, or `blocked` if repo state prevents a reliable audit.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P4-SCOPE-AUDIT-001.md` with:

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
