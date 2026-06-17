# FT-UX-V11-DETAIL-READABILITY-001 - FundTrader Detail Page Readability Pass

Created: 2026-06-16T00:00:00+08:00
PM: Codex
Executor: Claude Code via local `scripts/pm-dispatch.ps1`

## Goal

Improve the FundTrader fund detail page from a heavy data dump into a readable fund research page.

The user-facing outcome should help an investor answer, in order:

1. What is this fund's current decision snapshot?
2. Which data is reliable, missing, partial, or stale?
3. Which sections should I inspect next: performance, peer comparison, market context, risk, holdings, scale, manager, or raw metadata?

This is a bounded UX pass. Do not change data fetching, backend contracts, fund calculations, or allocation generation.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Current baseline:
  - `frontend/src/pages/FundDetail.tsx` is a large single-file page.
  - It already renders `ResearchHeader`, `KpiStrip`, `AnchorNav`, `CoverageSummary`, `PartialBanner`, and sections for performance, peer comparison, market context, risk, allocation/holdings, scale, manager, metadata, and data gaps.
  - `ANCHOR_ITEMS` currently lacks a `market-context` anchor even though the section exists.
  - `CoverageSummary` is currently prominent and detailed near the top, which contributes to the "data-heavy" feeling.
  - `DataGapsPanel` lists all issues directly when gaps exist.
  - The repo currently has unrelated dirty work from prior PM tasks plus `backend/.env`. Preserve all unrelated changes.
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Allowed Files

- `frontend/src/pages/FundDetail.tsx`
- `docs/pm/reports/FT-UX-V11-DETAIL-READABILITY-001.md`

## Approved Scope

You may edit only:

- `frontend/src/pages/FundDetail.tsx`
- `docs/pm/reports/FT-UX-V11-DETAIL-READABILITY-001.md`

You must not edit:

- Any backend files
- `.env` or credential files
- Home page files
- Allocation generation files
- API clients/contracts
- Generated build output
- Git history, branches, tags, remotes, or deployment files

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

If the status contains unrelated changes, preserve them and continue only inside the approved scope.

## Implementation Tasks

1. Preserve the existing data flow and page contract.
   - Keep the current route and all existing queries.
   - Do not add new backend calls.
   - Do not change API response shapes, calculation logic, chart data, or retry/refetch behavior.
   - Preserve delayed LLM/query behavior already in the file.

2. Add a compact decision snapshot near the top of the page.
   - Place it after `ResearchHeader` and before or around the current KPI/coverage area.
   - Summarize only from data already available in `FundDetail.tsx`.
   - Include concise signals such as performance condition, peer/risk posture, data health, and next recommended section.
   - Represent unknown or missing data honestly; do not invent values.
   - Keep user-facing copy readable Chinese where you touch text.

3. Reduce the "large missing-data block" feeling.
   - Make the top-level data health presentation compact.
   - Keep detailed source/gap information available lower on the page.
   - `DataGapsPanel` should show the highest-priority few issues first, with remaining issues behind a native `<details>` disclosure or equivalent lightweight progressive disclosure.
   - Do not delete gap data or hide it permanently.

4. Fix section navigation and hierarchy.
   - Add the existing `market-context` section to `ANCHOR_ITEMS`, or otherwise make anchor navigation match actual rendered sections.
   - Keep performance, peer comparison, market context, and risk easy to reach.
   - Move or visually soften secondary/heavy sections such as metadata and full data health details so they do not dominate the first screen.

5. Make heavy detail sections more scannable without changing data.
   - Keep tables and charts available.
   - For long table-like detail lists, use existing row limits where present or add a small native disclosure only when it is clearly local and low risk.
   - Avoid large new abstractions or file extraction in this task.
   - Do not introduce a new design system or global theme migration.

6. Keep styling restrained and production-grade.
   - The page should feel like a serious investment research tool: dense enough for analysis, but not visually noisy.
   - Avoid oversized marketing hero treatment, decorative gradient/orb elements, nested cards, and explanatory "how to use this app" prose.
   - Use existing dependencies only.
   - Ensure mobile and desktop layouts do not overlap and text fits within controls.

## Contracts And Design Decisions

- `FundDetail` remains the page component for `/:code`.
- Existing section IDs must continue to work; adding `market-context` to anchors is allowed.
- Existing business calculations, query keys, API clients, and data model handling must remain behaviorally compatible.
- `detailQuery.refetch`, `PartialBanner`, `CoverageSummary`, and `DataGapsPanel` behavior must remain available.
- Do not use fake data to fill missing product details.
- User-facing Chinese text in touched UI should be valid UTF-8 and not mojibake.

## Validation

Run:

```powershell
cd frontend
npm.cmd run check
npm.cmd run build
```

Also do a lightweight visual sanity check if practical:

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5177
```

Open a fund detail route such as `http://127.0.0.1:5177/fund/000001` at desktop and mobile widths. If local backend data is unavailable, verify that loading/error/empty states remain readable and state the limitation in the report.

Expected result:

- TypeScript check passes.
- Production build passes.
- Fund detail page has a clearer top-down research hierarchy.
- Existing data remains accessible.
- Anchor navigation matches rendered sections.
- Missing/partial/stale data is visible but no longer dominates the first screen.
- No files outside the allowed scope are modified.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.
- Fixing visible mojibake requires a broader encoding migration outside the allowed files.

## Final Report Required

Write `docs/pm/reports/FT-UX-V11-DETAIL-READABILITY-001.md`.

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
