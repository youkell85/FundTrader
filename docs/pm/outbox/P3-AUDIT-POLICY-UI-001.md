# P3-AUDIT-POLICY-UI-001 - P3 calibration audit policy UI

Created: 2026-06-10T22:11:01+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Expose the new calibration audit policy metadata in the existing pipeline health
panel so P3 calibration monitoring is visible end to end. Users should be able
to see whether calibration audit thresholds came from static defaults or cache
override, plus the compact threshold values used by the audit.

This is a small observability UI/type task only. Do not change backend
allocation behaviour, API routes, auth, production smoke semantics, commit,
push, or deployment.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.
  - Backend now returns `calibration.policy` from `audit_calibration()` with:
    `return_drift_threshold`, `vol_drift_threshold`,
    `jump_probability_min`, `jump_probability_max`, `coverage_threshold`,
    `policy_source`, and optional `policy_version`.
  - Existing frontend files contain mojibake/encoding artifacts. Do not attempt
    broad copy or encoding cleanup in this task.
  - Keep new UI copy ASCII-only where practical to avoid widening encoding
    churn.

## Approved Scope

Files or areas the coding agent may edit:

- `frontend/src/types/allocation.ts`
- `frontend/src/components/allocation/PipelineHealthPanel.tsx`
- `docs/pm/reports/P3-AUDIT-POLICY-UI-001.md`

Files or areas the coding agent must not edit:

- Backend files
- `AGENTS.md`
- `CLAUDE.md`
- `.codegraph/**`
- `.mavis/**`
- `.reasonix/**`
- `docs/0610/**`
- `scripts/**`
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

1. Update frontend allocation types:
   - Add a `CalibrationAuditPolicy` interface with the fields listed in
     Context.
   - Add optional `policy?: CalibrationAuditPolicy | null` to
     `CalibrationAudit`.
   - Preserve all existing interfaces and enum-like string unions.
2. Update `PipelineHealthPanel.tsx` inside the existing Calibration Audit block:
   - If `data.calibration.policy` exists, render a compact policy summary.
   - Show source and optional version.
   - Show thresholds compactly, for example:
     `ret 3.0 | vol 5.0 | jump 0.00-0.10 | cov 0.70`.
   - Keep layout stable, dense, and consistent with existing panel style.
   - Do not create cards inside cards or add new large UI sections.
3. Preserve resilience:
   - Panel must work when `calibration` is null/undefined.
   - Panel must work when `calibration.policy` is missing.
   - Avoid formatting crashes if numeric fields are missing or non-number.
4. Write the final report.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- This task is additive and frontend-only.
- Do not change API clients, fetch timeouts, backend payload generation, auth,
  production smoke script semantics, commit, push, or deployment.
- Keep the existing pipeline health panel behaviour and calibration section list.
- Keep TypeScript strict check and production build green.

## Validation

Commands or checks the coding agent must run:

```powershell
cd frontend
npm.cmd run check
npm.cmd run build
```

Expected result:

- TypeScript check passes.
- Vite/esbuild production build passes.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P3-AUDIT-POLICY-UI-001.md` with:

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
