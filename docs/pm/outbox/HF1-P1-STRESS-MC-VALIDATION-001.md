# HF1-P1-STRESS-MC-VALIDATION-001 - HF1 complete P1 stress MC validation report

Created: 2026-06-10T18:28:02+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Hotfix the failed P1 Stress Test / Monte Carlo provenance handoff by completing validation and writing the required report.

The previous dispatch for `P1-STRESS-MC-PROVENANCE-001` failed before validation because shell commands required approval and no report was written. Do not broaden product scope. Confirm the current implementation is acceptance-ready, fix only in-scope defects if found, run validation, and write a concise report.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/models.py`
- `backend/app/allocation/monte_carlo.py`
- `backend/app/allocation/stress_test.py`
- `backend/tests/test_allocation_monte_carlo.py`
- `backend/tests/test_stress_monte_carlo_calibration.py`
- `frontend/src/types/allocation.ts`
- `docs/pm/reports/HF1-P1-STRESS-MC-VALIDATION-001.md`

Files or areas the coding agent must not edit:

- `AGENTS.md`
- `CLAUDE.md`
- `.codegraph/**`
- `.mavis/**`
- `.reasonix/**`
- `docs/0610/**`
- `docs/pm/outbox/**`
- `docs/pm/running/**`
- `docs/pm/logs/**`
- `nul`
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

1. Inspect the current approved-file diffs from the prior P1 attempt.
2. If the implementation is incomplete or broken, fix only within the approved files.
3. Verify provenance fields are optional/backward-compatible in backend models and frontend types.
4. Verify stress test and Monte Carlo use cached historical calibration when available and explicit static fallback metadata otherwise.
5. Run the validation commands below.
6. Write `docs/pm/reports/HF1-P1-STRESS-MC-VALIDATION-001.md` with the required report.
7. Do not commit, push, deploy, stage files, or modify git remotes.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Existing allocation API response fields must remain backward-compatible.
- New provenance fields must be optional and nullable where appropriate.
- Runtime request paths must not make external network calls for calibration.
- Static fallback must be explicit in metadata.
- Preserve unrelated dirty worktree changes.
- No product decision is required; stop and report if a broader modeling change is needed.

## Validation

Commands or checks the coding agent must run:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_stress_monte_carlo_calibration.py tests/test_allocation_monte_carlo.py tests/test_allocation_api_contract.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build

cd D:\Workspace\Fundtrader
git diff --check
git status --short --untracked-files=all
```

Expected result:

- Targeted backend tests pass.
- Full backend test suite passes or unrelated failures are clearly explained.
- Frontend type check and build pass.
- `git diff --check` has no errors other than known CRLF warnings if present.
- `git status` includes no unexpected edits outside approved files, PM workflow artifacts, and pre-existing unrelated dirty files.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/HF1-P1-STRESS-MC-VALIDATION-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
