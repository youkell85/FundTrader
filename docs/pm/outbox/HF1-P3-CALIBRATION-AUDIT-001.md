# HF1-P3-CALIBRATION-AUDIT-001 - HF1 fix P3 calibration audit completion

Created: 2026-06-10T21:11:43+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Hotfix the interrupted `P3-CALIBRATION-AUDIT-001` implementation left by a Claude gateway malformed-response failure. The goal is to complete the read-only calibration audit feature, make the code compile/test, add focused tests, and write the missing PM report.

Do not redesign the feature. Keep the P3 scope exactly as the original handoff: expose calibration audit/drift health through `/allocation/pipeline-health` and show it compactly in `PipelineHealthPanel`.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/calibration_audit.py`
- `backend/app/allocation/orchestrator.py`
- `backend/tests/test_calibration_audit.py`
- `frontend/src/types/allocation.ts`
- `frontend/src/components/allocation/PipelineHealthPanel.tsx`
- `docs/pm/reports/P3-CALIBRATION-AUDIT-001.md`
- `docs/pm/reports/HF1-P3-CALIBRATION-AUDIT-001.md`

Files or areas the coding agent must not edit:

- Calibration algorithms themselves
- `backend/data/**` or SQLite database files
- Deployment scripts and service files
- `docs/0610/**`, `.codegraph/**`, `.mavis/**`, `.reasonix/**`, `nul`
- `AGENTS.md` and `CLAUDE.md`
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

Known current state from the failed parent task:

- `backend/app/allocation/calibration_audit.py` exists but is incomplete.
- `CalibrationSectionItem` has a required `key` field, but some constructors likely do not pass `key`.
- `_find_section()` uses positional fallback and should be simplified to use the explicit `key`.
- Frontend `PipelineHealthPanel` currently tries to infer labels from `source`; it should use `section.key`.
- `frontend/src/types/allocation.ts` likely needs `key` on `CalibrationSectionItem`.
- No focused `backend/tests/test_calibration_audit.py` exists yet.
- No `docs/pm/reports/P3-CALIBRATION-AUDIT-001.md` report exists yet.

Expected unrelated working-tree residue:

- Modified but not part of this task: `AGENTS.md`, `CLAUDE.md`
- Untracked and not part of this task: `.codegraph/**`, `.mavis/**`, `.reasonix/**`, `docs/0610/**`, `nul`

Follow the repo GitNexus rule before editing symbols if possible:

```powershell
npx gitnexus impact audit_calibration --repo FundTrader --direction upstream
npx gitnexus impact get_pipeline_health --repo FundTrader --direction upstream
npx gitnexus impact PipelineHealthPanel --repo FundTrader --direction upstream
```

If any result is HIGH or CRITICAL, report it and continue only if the affected surface is exactly the expected `/allocation/pipeline-health` and ops panel surface from the parent task. Stop on unexpected blast radius.

## Implementation Tasks

1. Finish `backend/app/allocation/calibration_audit.py`:
   - all `CalibrationSectionItem` constructors must pass `key`
   - `to_dict()` must include `key`
   - `_find_section()` should use `section.key == key`
   - no malformed/missing cache state may raise
   - no allocation behavior may change
2. Ensure `get_pipeline_health()` includes `calibration` while preserving all existing response keys.
3. Fix frontend typing and display:
   - `CalibrationSectionItem` includes `key`
   - `PipelineHealthPanel` uses `CALIBRATION_SECTION_LABELS[s.key]`
   - React keys must be stable (`s.key`)
   - rendering must tolerate missing/empty `calibration`
4. Add focused tests in `backend/tests/test_calibration_audit.py` covering:
   - missing cache -> stable unknown/missing summary
   - malformed section -> missing item, no crash
   - historical section fields flow through
   - static assumption section reports assumption/degraded
   - drift warning on large equilibrium return/vol deviation
   - `get_pipeline_health()` includes `calibration`
5. Write both reports:
   - `docs/pm/reports/P3-CALIBRATION-AUDIT-001.md`
   - `docs/pm/reports/HF1-P3-CALIBRATION-AUDIT-001.md`

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Read-only audit/monitoring only.
- No commit, no push, no deployment.
- No DB migration.
- No external network/data refresh calls.
- No edits to parent plan docs outside `docs/pm/reports`.
- Do not include hidden chain-of-thought or `<think>` blocks in reports.

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
- Report any remaining warnings or PM decisions explicitly.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/HF1-P3-CALIBRATION-AUDIT-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
