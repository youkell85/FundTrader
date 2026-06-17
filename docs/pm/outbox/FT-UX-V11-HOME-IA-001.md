# FT-UX-V11-HOME-IA-001 - FundTrader Home Decision Desk Refresh

Created: 2026-06-16T00:00:00+08:00
PM: Codex
Executor: Claude Code via local `scripts/pm-dispatch.ps1`

## Goal

Refresh FundTrader's home page from a dense "cockpit" into a clearer decision desk for fund investors.

The user-facing outcome is not a marketing landing page. It should help a returning investor answer, in order:

1. What is today's market/fund-data state?
2. Which portfolio/fund metrics need attention?
3. What should I open next: allocation, analysis, recommendations, or a specific fund?

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Current baseline:
  - `frontend/src/pages/Home.tsx` loads market overview/status and fund list, then renders `CockpitDashboard`.
  - `frontend/src/components/dashboard/CockpitDashboard.tsx` is the current dense home UI.
  - The repo currently has an unrelated dirty file: `backend/.env`. Do not touch it.
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Allowed Files

- `frontend/src/pages/Home.tsx`
- `frontend/src/components/dashboard/CockpitDashboard.tsx`
- `docs/pm/reports/FT-UX-V11-HOME-IA-001.md`

## Approved Scope

You may edit only:

- `frontend/src/pages/Home.tsx`
- `frontend/src/components/dashboard/CockpitDashboard.tsx`
- `docs/pm/reports/FT-UX-V11-HOME-IA-001.md`

You must not edit:

- Any backend files
- `.env` or credential files
- Fund detail pages
- Allocation/backtest pages
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

1. Preserve the existing data flow in `Home.tsx`.
   - Keep the existing market overview/status calls.
   - Keep the existing fund list query.
   - Keep the existing `funds`, `mode`, `userName`, loading, and error props contract into `CockpitDashboard`.
   - Do not add new APIs or change backend contracts.

2. Rework `CockpitDashboard` hierarchy into a decision desk.
   - Replace the current visually noisy cockpit framing with a calmer full-width workspace.
   - Put a compact top bar first: product/page identity, source/mode label, data freshness, and user identity.
   - Put the main decision row next: market state, portfolio health, and next actions.
   - Keep market overview and fund list visible, but reduce competing widgets and visual clutter.
   - Keep search and type filtering.

3. Improve information priority and empty/error states.
   - Show real data availability honestly. Do not invent market or fund data.
   - If market data is loading, empty, or degraded, show a concise status panel with a next best action.
   - If fund data is loading or failed, keep the page readable and actionable.
   - Keep all user-facing copy readable in Chinese where you touch the text. Fix visible mojibake in the touched home component only; do not perform a broad encoding rewrite outside the approved files.

4. Adjust the visual direction.
   - Keep the app feeling like a serious investment tool: restrained, scannable, high signal.
   - Avoid the current dominant black/green cockpit look.
   - Avoid a one-note palette, oversized hero marketing treatment, decorative cards inside cards, gradient-orb decoration, or explanatory "how to use this app" prose.
   - Use existing dependencies only. `lucide-react` icons are available.
   - Ensure mobile and desktop layouts do not overlap and text fits within controls.

5. Keep the task bounded.
   - Do not split `FundDetail.tsx`.
   - Do not fix allocation generation or macro-data coverage in this task.
   - Do not introduce a new design system or global theme migration.

## Contracts And Design Decisions

- `CockpitDashboard` props remain source-compatible for existing imports.
- `DashboardMode`, `FundLike`, and `MarketOverviewPayload` exports must remain available from `CockpitDashboard.tsx`.
- Existing routes must continue to work:
  - `/analysis`
  - `/recommend`
  - fund detail links built from fund code
- No API response shape may be changed.
- User-facing Chinese text in touched UI should be valid UTF-8 and not mojibake.

## Validation

Run:

```powershell
cd frontend
npm.cmd run check
npm.cmd run build
```

Also do a lightweight visual sanity check:

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5177
```

Open the local page if practical and inspect at desktop and mobile widths. If you cannot run a browser check in this environment, state that explicitly in the report and include the reason.

Expected result:

- TypeScript check passes.
- Production build passes.
- Home page has a clearer top-down decision hierarchy.
- Search/filter still works from state updates.
- Loading/error/empty states are readable.
- No files outside the allowed scope are modified.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.
- Fixing visible mojibake requires a broader encoding migration outside the allowed files.

## Final Report Required

Write `docs/pm/reports/FT-UX-V11-HOME-IA-001.md`.

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
