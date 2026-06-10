# P2-CIRCUIT-DESTINATION-001 - P2 circuit breaker destination policy

Created: 2026-06-10T19:23:39+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Make circuit-breaker de-risking destination policy configurable and testable, while preserving current allocation behavior by default.

Today `_reduce_equity()` cuts equity and distributes the cut to `cash_equiv` in proportion to existing cash-equivalent weights. P2 acceptance needs a policy layer so calibrated or PM-approved destination weights can be applied later without changing circuit-breaker state logic. Do not change default product behavior in this task.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/circuit_breaker.py`
- `backend/app/allocation/backtest/engine.py` only if needed to share the destination policy helper
- `backend/tests/test_circuit_breaker_destination.py`
- Existing allocation tests only if narrow compatibility updates are needed

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
- Frontend files
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

Run GitNexus impact analysis before editing these symbols and summarize the result in the report:

```powershell
npx gitnexus impact evaluate_breaker --repo FundTrader
npx gitnexus impact _reduce_equity --repo FundTrader
```

If CLI syntax differs, use the closest available GitNexus command and report the limitation.

## Implementation Tasks

1. Inspect `circuit_breaker.evaluate_breaker`, `_reduce_equity`, `get_breaker_status`, and backtest breaker application.
2. Add a small destination policy loader with safe defaults:
   - Default must preserve current proportional distribution to `GROUP_MAP["cash_equiv"]`.
   - Optional override may come from `StatsSnapshotCache.get("historical_calibration")`, nested `circuit_breaker_destination.params`.
   - Override should accept per-asset weights only for valid cash-equivalent assets; invalid/missing/non-positive weights must fall back to default.
3. Apply destination policy in live `_reduce_equity()`.
4. If backtest has duplicated breaker application, either reuse the same helper or explicitly preserve current behavior and add a note in report. Prefer reuse if low risk.
5. Do not change `_breaker_lock`, asymmetric recovery state, level thresholds, or equity reduction factors.
6. Add tests covering:
   - default proportional behavior is unchanged;
   - configured destination weights route cut to specified cash-equivalent assets;
   - invalid policy falls back to default;
   - non-cash-equivalent destination assets are ignored.
7. Do not commit, push, deploy, stage files, or modify git remotes.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Existing `evaluate_breaker(...) -> (allocations, triggered)` contract must not change.
- Default output must match current proportional distribution.
- No product-default destination change in this task.
- Runtime reads must be local/cache-only; no network calls.
- Preserve existing locks and asymmetric recovery semantics.
- Do not clean unrelated encoding/text issues.

## Validation

Commands or checks the coding agent must run:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_circuit_breaker_destination.py tests/test_allocation_api_contract.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader
git diff --check
git status --short --untracked-files=all
```

Expected result:

- New circuit-breaker destination tests pass.
- Full backend suite passes or unrelated failures are clearly explained.
- `git diff --check` has no errors other than known CRLF warnings if present.
- No unexpected edits outside approved files, PM workflow artifacts, and pre-existing unrelated dirty files.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P2-CIRCUIT-DESTINATION-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
