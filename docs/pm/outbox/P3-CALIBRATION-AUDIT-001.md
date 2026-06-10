# P3-CALIBRATION-AUDIT-001 - P3 calibration audit and drift health

Created: 2026-06-10T21:02:30+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Start P3 by making calibration state auditable in production health views. The system already writes and consumes `StatsSnapshotCache("historical_calibration")` sections for CMA, stress/Monte Carlo, regime, circuit breaker, scenario analysis, and risk questionnaire. This task should expose a compact calibration audit summary with version/as-of/source/coverage/fallback counts and drift warnings through `/allocation/pipeline-health`.

The user-facing outcome is that the ops/pipeline health panel can show whether allocation parameters are backed by historical calibration, static assumptions, stale/missing snapshots, or large drift from static priors. This is a monitoring/audit task, not a new calibration algorithm.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/calibration_audit.py` or a similarly focused new backend helper
- `backend/app/allocation/orchestrator.py`
- `backend/tests/test_calibration_audit.py` or another focused backend test file
- `frontend/src/types/allocation.ts`
- `frontend/src/components/allocation/PipelineHealthPanel.tsx`

Files or areas the coding agent must not edit:

- Calibration algorithms themselves unless strictly needed for read-only audit shape compatibility
- `backend/data/**` or SQLite database files
- Deployment scripts and service files
- `docs/0610/**`, `.codegraph/**`, `.mavis/**`, `.reasonix/**`, `nul`
- `AGENTS.md` and `CLAUDE.md` unless PM explicitly approves metadata cleanup
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

Expected unrelated current working-tree residue at handoff time:

- Modified but not part of this task: `AGENTS.md`, `CLAUDE.md`
- Untracked and not part of this task: `.codegraph/**`, `.mavis/**`, `.reasonix/**`, `docs/0610/**`, `nul`

Also follow the repo GitNexus rule before editing symbols:

```powershell
npx gitnexus impact get_pipeline_health --repo FundTrader --direction upstream
npx gitnexus impact PipelineHealthPanel --repo FundTrader --direction upstream
```

If the exact CLI syntax differs, run the equivalent GitNexus impact command and report the direct callers, affected flows, and risk level. If any impact result is HIGH or CRITICAL, stop and report instead of editing.

## Implementation Tasks

1. Add a read-only calibration audit helper that loads `StatsSnapshotCache("historical_calibration")` safely and returns a stable dict even when the cache is missing or malformed.
2. Summarize known calibration sections, at minimum:
   - `equilibrium_returns`
   - `equilibrium_vols`
   - `correlation_matrix`
   - `jump_params`
   - `stress_scenarios`
   - `regime_thresholds`
   - `circuit_breaker_destination`
   - `scenario_analysis`
   - `risk_questionnaire`
3. For each section return a compact audit item:
   - `status`: `real | partial | assumption | stale | missing | rejected`
   - `source`
   - `as_of`
   - `calibration_version`
   - `coverage`
   - `invalid_count`
   - `assumption_count`
   - `warnings: string[]`
4. Add a lightweight drift check for sections with numeric values/params where a static prior exists:
   - equilibrium returns vs `EQUILIBRIUM_RETURNS`
   - equilibrium vols vs `EQUILIBRIUM_VOLS`
   - jump params vs current static jump defaults if available
   Use conservative thresholds and report warnings only; do not fail allocation or mutate calibration data.
5. Add the audit object to `get_pipeline_health()` as `calibration` without changing existing keys:
   - `calibration.health`: `healthy | degraded | critical | unknown`
   - `calibration.sections`
   - `calibration.warning_count`
   - `calibration.missing_count`
6. Update frontend types and add a compact calibration status block in `PipelineHealthPanel`:
   - show overall calibration health
   - show missing/degraded warning counts
   - list only the first few non-healthy sections to avoid UI clutter
   - preserve existing panel layout and behavior
7. Add focused tests covering:
   - no cache returns `unknown`/missing but does not crash
   - static assumption sections are reported as assumption/degraded
   - historical sections with version/as_of/coverage flow through
   - large numeric drift produces warnings
   - `/allocation/pipeline-health` shape remains backward-compatible

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- This task is read-only audit/monitoring. Do not change allocation behavior.
- No commit, no push, no deployment.
- No database migration.
- No external network/data refresh calls.
- Backward compatibility: existing `/allocation/pipeline-health` keys and frontend rendering must keep working if `calibration` is absent or partial.
- Missing calibration must be explicit, not silently reported as healthy.
- Static fallback is acceptable but must be labeled `assumption`/`degraded`.
- Keep frontend changes small and consistent with the existing ops panel.

## Validation

Commands or checks the coding agent must run:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

Expected result:

- All listed commands pass.
- Report GitNexus impact, changed files, validation results, and any open PM decisions.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P3-CALIBRATION-AUDIT-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
