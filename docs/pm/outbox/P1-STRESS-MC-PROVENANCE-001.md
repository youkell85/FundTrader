# P1-STRESS-MC-PROVENANCE-001 - P1 stress Monte Carlo provenance acceptance

Created: 2026-06-10T18:18:58+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Bring the current P1 Stress Test and Monte Carlo provenance work to acceptance-ready state.

Allocation API consumers should be able to see whether stress scenarios and jump parameters came from cached historical calibration or static fallback assumptions. The change must preserve existing response compatibility and must not require any commit, push, or deployment.

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

Files or areas the coding agent must not edit:

- `AGENTS.md`
- `CLAUDE.md`
- `.codegraph/**`
- `.mavis/**`
- `.reasonix/**`
- `docs/0610/**`
- `docs/pm/outbox/**` except this task file if a stop-condition note is unavoidable
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

1. Inspect the existing uncommitted WIP in the approved files and complete it if needed.
2. Ensure `StressScenarioItem` exposes optional provenance fields for scenario source, calibration/source window, and calibration version.
3. Ensure `MonteCarloResult` exposes optional provenance fields for jump parameter source, as-of date, sample size, and calibration version.
4. Ensure `stress_test.py` prefers cached historical calibration from `StatsSnapshotCache.get("historical_calibration")` when available and falls back explicitly to static assumptions with metadata.
5. Ensure `monte_carlo.py` prefers cached jump parameters from `StatsSnapshotCache.get("historical_calibration")` when available and falls back explicitly to `_JUMP_PARAMS` with metadata.
6. Ensure the frontend allocation types match the backend response shape.
7. Keep all new fields optional/backward-compatible.
8. Do not commit, push, deploy, stage files, or modify git remotes.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Existing allocation API fields must remain backward-compatible.
- New provenance fields must be optional and nullable where appropriate.
- Runtime request paths must not make external network calls for calibration.
- Static fallback must be explicit in metadata, not silent.
- Keep unrelated dirty changes untouched.
- No product decision is needed for this task; if a broader modeling change is required, stop and report it.

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
- Full backend test suite passes or any failure is clearly unrelated and explained.
- Frontend type check and build pass.
- `git diff --check` has no errors other than known CRLF warnings if present.
- `git status` shows only expected approved-file changes plus pre-existing unrelated dirty files.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P1-STRESS-MC-PROVENANCE-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
