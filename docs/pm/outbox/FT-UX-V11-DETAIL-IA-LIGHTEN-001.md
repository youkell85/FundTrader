# FT-UX-V11-DETAIL-IA-LIGHTEN-001 - Fund detail information architecture and page weight reduction

Created: 2026-06-17T00:00:00+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Make FundTrader's fund detail page feel lighter, more decision-oriented, and easier to scan without removing existing data or changing backend contracts.

The user-facing outcome is a detail page that starts with a clear decision summary and progressively reveals heavy data. The task should reduce cognitive load and visual clutter, not add more tables or new data providers.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Current UX wave already improved home IA, allocation stream resilience, macro/north-flow coverage, and first detail component extraction.
- `FundDetail.tsx` remains a large page and still feels heavy.
- Existing `frontend/src/components/fund-detail/DetailStatusPanels.tsx` and `frontend/src/components/fund-detail/types.ts` can be reused.
- Preserve unrelated dirty worktree changes, especially `backend/.env`.

## Approved Scope

Files or areas the coding agent may edit:

- `frontend/src/pages/FundDetail.tsx`
- `frontend/src/components/fund-detail/DetailStatusPanels.tsx`
- `frontend/src/components/fund-detail/types.ts`
- New files under `frontend/src/components/fund-detail/` only if they are small presentational components extracted from `FundDetail.tsx`
- `docs/pm/reports/FT-UX-V11-DETAIL-IA-LIGHTEN-001.md`

Files or areas the coding agent must not edit:

- `backend/.env`
- Backend API/data provider files
- Allocation generation logic
- Home/dashboard pages
- Generated build output
- Git history, branches, tags, remotes
- Deployment files

## Allowed Files

- `frontend/src/pages/FundDetail.tsx`
- `frontend/src/components/fund-detail/DetailStatusPanels.tsx`
- `frontend/src/components/fund-detail/types.ts`
- `frontend/src/components/fund-detail/*.tsx`
- `frontend/src/components/fund-detail/*.ts`
- `docs/pm/reports/FT-UX-V11-DETAIL-IA-LIGHTEN-001.md`

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

If the status contains unrelated changes, preserve them and continue only inside the approved scope.

## Implementation Tasks

### 1. Add a compact above-the-fold decision hierarchy

In `FundDetail.tsx` and/or a small extracted component:

- Put the top summary into a clear scan order:
  - fund identity
  - decision snapshot
  - data coverage / missing-data warning
  - key risk/return indicators
- Avoid another large card grid above the fold.
- Keep wording informational; do not add investment-advice language.

### 2. Reduce heavy table exposure

- Keep existing data available.
- Move secondary/heavy tables behind collapsible sections, tabs, or compact grouped panels.
- Make the default expanded state show only the sections needed for quick decision review.
- Do not delete existing metrics simply to make the page shorter.

### 3. Preserve and improve data-gap clarity

- Reuse or refine `MarketContextPanel`, `DataGapsPanel`, and `CoverageSummary`.
- Missing data should be visible and understandable, but not dominate the page.
- If a section has no usable data, show a compact unavailable state instead of an empty table.

### 4. Keep changes scoped and presentational

- Do not change fetch timing, API response contracts, backend routes, allocation logic, chart calculations, or data normalization.
- If the desired layout requires backend changes, stop and report the blocker instead of expanding scope.

## Contracts And Design Decisions

- This task is detail-page IA and readability only.
- No backend or data-source changes.
- Existing route shape under `/fund/` must continue to work.
- Existing detail data must remain reachable.
- Prefer small extracted presentational components over adding more logic to `FundDetail.tsx`.

## Validation

Run:

```powershell
cd "D:\Workspace\Fundtrader\frontend"
npm.cmd run check
npm.cmd run build
```

If practical, run a local browser smoke:

```powershell
cd "D:\Workspace\Fundtrader\frontend"
npm.cmd run dev -- --host 127.0.0.1 --port 5177
```

Capture or inspect:

- `/fund/`
- one representative fund detail route that currently loads locally

Expected result:

- Typecheck/check passes.
- Build passes.
- The detail page is visually lighter above the fold.
- Heavy data remains available through progressive disclosure.

## Stop Conditions

Stop and write a report instead of guessing when:

- You need to edit backend/data-provider code.
- The detail route cannot be found or loaded from the current local state.
- Existing dirty changes conflict with this task's files.
- Validation fails for reasons outside this task.

## Final Report Required

Write `docs/pm/reports/FT-UX-V11-DETAIL-IA-LIGHTEN-001.md` with:

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
