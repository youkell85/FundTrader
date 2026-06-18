# FT-P0-3 - Backend Fund Research Report V2

Created: 2026-06-18T14:00:00+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Implement the next FundTrader DSA/GPT P0 slice: move single-fund research report generation from frontend-only ad hoc Markdown toward a backend reproducible Markdown report service. The report must be generated from the same fund detail, market context, risk, and source-coverage evidence exposed by the application, and must clearly state missing fields and data-source limitations.

## Context

- Source plan: `D:\Workspace\docs\0615\gpt\FundTrader_2026-06-15.md`
- Prior accepted slices:
  - `FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001`
  - `FT-P0-2`
- Product boundary: FundTrader remains a fund research/allocation product, not a stock trading agent.
- Route boundary: preserve `/fund/` and `/fund/api/*`.
- Report boundary: Markdown first. Do not add Word/PDF export in this task.

## Approved Scope

Allowed implementation areas:

- `backend/app/reports/`
- `backend/app/api/`
- `backend/app/models/`
- `backend/app/data/`
- `backend/app/allocation/`
- `backend/tests/`
- `frontend/api/fund-router.ts`
- `frontend/src/components/allocation/ResearchReportExportPanel.tsx`
- `frontend/src/pages/FundDetail/`
- `frontend/src/components/fund-detail/`
- `docs/pm/reports/FT-P0-3.md`
- `docs/pm/reviews/FT-P0-3.review.md`
- `docs/pm/reviews/FT-P0-3.review.json`

Do not edit:

- `.env` or secrets
- `backend/data/fundtrader.db`
- deployment scripts or production process config
- `docs/pm/outbox`, `docs/pm/running`, `docs/pm/logs`
- git history, branches, remotes

## Allowed Files

- `backend/app/reports/`
- `backend/app/api/`
- `backend/app/models/`
- `backend/app/data/`
- `backend/app/allocation/`
- `backend/tests/`
- `frontend/api/fund-router.ts`
- `frontend/src/components/allocation/ResearchReportExportPanel.tsx`
- `frontend/src/pages/FundDetail/`
- `frontend/src/components/fund-detail/`
- `docs/pm/reports/FT-P0-3.md`
- `docs/pm/reviews/FT-P0-3.review.md`
- `docs/pm/reviews/FT-P0-3.review.json`

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

Preserve unrelated dirty worktree changes.

## Implementation Tasks

1. Add a backend report renderer
   - Prefer `backend/app/reports/fund_research_report.py` and `backend/app/reports/markdown_renderer.py`, unless an equivalent report module already exists.
   - Build deterministic Markdown from explicit input data.
   - Include fund identity, detail coverage, data-source coverage, key risks, missing fields, and follow-up observations.

2. Expose a safe report API
   - Add or reuse a `/fund/api/*` endpoint/procedure that returns Markdown and metadata.
   - Keep route compatibility and existing frontend behavior.
   - Do not call LLMs unless an existing local contract already does so safely; this task is deterministic report generation.

3. Wire frontend export panel when appropriate
   - If `ResearchReportExportPanel` already supports backend Markdown, verify and document it.
   - Otherwise route single-fund Markdown generation through the backend report endpoint.
   - Keep frontend fallback if backend report is unavailable.

4. Add tests
   - Unit test deterministic Markdown generation.
   - Test missing-field and partial-source sections.
   - Test API response shape if a new route is added.

## Contracts And Design Decisions

- Reports must not cite data that is absent from the evidence or API response.
- Missing fields must appear in a risk/limitations section, not be silently ignored.
- Markdown output must be stable enough for snapshot or exact-string tests.
- Initial scope is single-fund research report; allocation/DCA report expansion is later.

## Validation

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest -q
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

Expected:

- Backend tests pass.
- Frontend typecheck and production build pass.
- Report generation is deterministic for the same input.

## Acceptance Criteria

- Backend can generate a single-fund Markdown research report.
- Report includes data-source coverage and missing-field limitations.
- Frontend can consume the backend report or gracefully fallback.
- `/fund/` and `/fund/api/*` compatibility is preserved.

## Stop Conditions

- Existing frontend report flow is tightly coupled to browser-only state and cannot be safely moved in one bounded pass.
- Backend lacks a stable fund-detail evidence contract and implementing one would exceed this task.
- Any change would require DB mutation, secret edits, deployment, or production state changes.

## Final Report Required

Write `docs/pm/reports/FT-P0-3.md` with:

1. PM Digest: Status, Changed, Validation, Risk, Decision, Next
2. Status
3. Summary
4. Files changed
5. Validation commands and results
6. Scope / safety
7. Open risks or PM decisions needed
