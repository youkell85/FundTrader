# FT-UX-V11-DETAIL-COMPONENT-SPLIT-001

## Role
You are the coding agent for FundTrader. Codex PM has already inspected `FundDetail.tsx`. Implement only the scoped refactor below, then write a concise report.

## Objective
`frontend/src/pages/FundDetail.tsx` is still a giant page module. After the recent UX readability work, several pure display panels are now stable and can be extracted without changing behavior.

Reduce page weight by extracting detail-status display components into `frontend/src/components/fund-detail/`, while preserving the current UI and data contract.

## Current Extraction Candidates
The following functions are currently inline in `FundDetail.tsx` and are pure/presentational:
- `DecisionSnapshot`
- `MarketContextPanel`
- `DataGapsPanel`
- `CoverageSummary`

## Allowed Files
- `frontend/src/pages/FundDetail.tsx`
- `frontend/src/components/fund-detail/DetailStatusPanels.tsx`
- `docs/pm/reports/FT-UX-V11-DETAIL-COMPONENT-SPLIT-001.md`

If TypeScript needs a tiny colocated type helper, you may instead create:
- `frontend/src/components/fund-detail/types.ts`

Do not edit backend files, API clients, routing, CSS theme files, `.env`, runtime data, or unrelated frontend pages.

## Scope
Do:
- Move the four pure display components into `frontend/src/components/fund-detail/DetailStatusPanels.tsx`.
- Export and import them from `FundDetail.tsx`.
- Keep labels, status logic, classes, layout, and markup behavior equivalent unless a TypeScript boundary requires a harmless type-only adjustment.
- Keep `FundDetail.tsx` calculation/data-fetching logic in place.
- Preserve existing anchor IDs and usage sites.

Do not:
- Do not redesign the detail page.
- Do not change data fetching, tRPC calls, query stale times, coverage calculation, chart logic, or API response expectations.
- Do not move large chart sections in this task.
- Do not introduce a new state manager, context, or component library.

## Acceptance Criteria
1. `FundDetail.tsx` no longer defines `DecisionSnapshot`, `MarketContextPanel`, `DataGapsPanel`, or `CoverageSummary` inline.
2. The extracted component file imports only the minimal helpers it needs, such as `Panel`, `num`, and detail-status labels/tones/types.
3. Existing rendered UI for the decision snapshot, market context, coverage summary, and data gaps remains visually equivalent.
4. TypeScript check and production build pass.
5. No generated build output is committed or left dirty.

## Validation Commands
Run these and include exact results in the report:
```powershell
cd "D:\Workspace\Fundtrader\frontend"
npm.cmd run check
npm.cmd run build
```

## Report Requirements
Write `docs/pm/reports/FT-UX-V11-DETAIL-COMPONENT-SPLIT-001.md` with:
- files changed
- what was extracted
- validation commands and results
- any risk or follow-up
