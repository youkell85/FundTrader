# FT-UX-V11-FUND-BASEPATH-ROUTE-001 - Add FundTrader /fund non-slash redirect and improve route resilience

Created: 2026-06-17T03:38:40+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Fix FundTrader SPA entry stability for the production-like base path `/fund`.

Expected behavior: visiting `/fund` (without trailing slash) should not 404 and should land on the same home shell as `/fund/`. This should be deterministic in local dev smoke and production Nginx/entry deployments.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `frontend/src/App.tsx` (if needed for route fallback)
- `frontend/vite.config.ts` (if needed for local dev base path redirect)
- `frontend/main.tsx` (if needed for base-path edge handling)
- `docs/pm/reports/FT-UX-V11-FUND-BASEPATH-ROUTE-001.md` (PM report artifact)

Files or areas the coding agent must not edit:

- Unrelated generated assets
- Deployment output unless explicitly requested
- Git history, branches, tags, or remotes
- Anything outside this handoff without PM approval

## Allowed Files

- `frontend/vite.config.ts`
- `docs/pm/reports/FT-UX-V11-FUND-BASEPATH-ROUTE-001.md`

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

1. Add a hardening path for `/fund` base URL so it resolves to app home instead of 404.
2. Keep existing route contracts intact (`/`, `/fund/`, `/allocation/*`, and `/:code` flows).
3. Keep changes scoped to routing/configuration only and preserve all unrelated dirty files.

Acceptance target:
- `http://127.0.0.1:3000/fund` and `http://127.0.0.1:3000/fund/` both render home.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- `frontend/src/App.tsx` public routes and `react-router` nesting.
- Browser router basename in `frontend/main.tsx`.
- No API contracts or backend flows should be changed.

## Validation

Commands or checks the coding agent must run:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
cd frontend
npm.cmd run check
npm.cmd run build
cd ..
```

Expected result:

- `/fund` and `/fund/` both render the home page (manual smoke confirmation) and no route 404 regressions.
- `npm.cmd run build` passes.
- Existing unrelated worktree changes are preserved.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/FT-UX-V11-FUND-BASEPATH-ROUTE-001.md` with:

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
