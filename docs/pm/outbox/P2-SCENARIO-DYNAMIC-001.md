# P2-SCENARIO-DYNAMIC-001 - P2 dynamic scenario baseline probabilities

Created: 2026-06-10T19:44:44+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Make scenario analysis baseline returns and scenario probabilities configurable from local calibration cache, while preserving current static behavior by default.

Scenario analysis currently uses hard-coded probabilities and `EQUILIBRIUM_RETURNS`. P2 acceptance needs a cache-backed dynamic path with explicit provenance, so consumers can tell whether results use calibrated scenario inputs or static defaults.

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
- `backend/app/allocation/scenario_analysis.py`
- `backend/tests/test_scenario_analysis_dynamic.py`
- `frontend/src/types/allocation.ts`
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

Run GitNexus impact analysis before editing these symbols and summarize in the report:

```powershell
npx gitnexus impact analyze_scenarios --repo FundTrader
npx gitnexus impact ScenarioAnalysis --repo FundTrader
```

If CLI syntax differs, use the closest available GitNexus command and report the limitation.

## Implementation Tasks

1. Inspect `scenario_analysis.py`, `ScenarioItem`, `ScenarioAnalysis`, orchestrator percentage conversion, and frontend allocation types.
2. Add optional provenance fields to scenario response models/types, for example source, calibration_version, as_of_date, probability_source, baseline_source.
3. Implement a local cache loader using `StatsSnapshotCache.get("historical_calibration")`, nested section such as `scenario_analysis.params`, supporting:
   - optional per-asset baseline returns overriding `EQUILIBRIUM_RETURNS`;
   - optional scenario probabilities for optimistic/baseline/pessimistic;
   - optional multiplier overrides by scenario/group if low risk.
4. Validate cached values:
   - probabilities must be positive and normalize to 1;
   - baseline returns must be numeric per known asset;
   - invalid or missing values fall back per-field to defaults.
5. Default behavior must match current static probabilities and equilibrium returns when no cache exists.
6. Add focused tests covering default behavior, calibrated baseline returns, calibrated probabilities, invalid cache fallback, and optional provenance fields.
7. Run frontend type check/build if `frontend/src/types/allocation.ts` changes.
8. Do not commit, push, deploy, stage files, or modify git remotes.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Existing `ScenarioAnalysis` and `ScenarioItem` fields must remain backward-compatible.
- New fields must be optional/nullable.
- Orchestrator percentage conversion must remain correct.
- Runtime reads must be local/cache-only; no network calls.
- Static fallback must be explicit in provenance metadata.
- Do not change scenario labels unless required by existing tests.

## Validation

Commands or checks the coding agent must run:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_scenario_analysis_dynamic.py tests/test_allocation_api_contract.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build

cd D:\Workspace\Fundtrader
git diff --check
git status --short --untracked-files=all
```

Expected result:

- New scenario dynamic tests pass.
- Full backend suite passes or unrelated failures are clearly explained.
- Frontend type check/build pass if frontend type file changed.
- `git diff --check` has no errors other than known CRLF warnings if present.
- No unexpected edits outside approved files, PM workflow artifacts, and pre-existing unrelated dirty files.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P2-SCENARIO-DYNAMIC-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
