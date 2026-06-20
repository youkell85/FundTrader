# FT-REPORT-PANEL-V2-001 - Report Readiness And Export Panel V2

Created: 2026-06-21
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Upgrade the current research report export UI from a button-oriented utility
into a report readiness panel that tells users whether the backend report is
ready, partial, or blocked, and why.

The user-facing outcome is a clear diagnosis/report area in Fund Detail that
shows evidence coverage, missing evidence, backend report status, and safe export
actions for Markdown, DOCX, and PDF.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - `ResearchReportExportPanel` already prefers backend Markdown and falls back
    to context snapshots only with partial/missing labels.
  - `FT-EVIDENCE-PACK-V2-001` should land before this task. If it has not landed,
    implement only against existing evidence/report fields and mark v2-dependent
    UI as blocked in the report.
  - Fund Detail uses tab modules under `frontend/src/pages/FundDetail/`.
  - Do not introduce marketing-style layout; this is a dense operational H5
    analysis product.

## Approved Scope

Files or areas the coding agent may edit:

- `frontend/src/components/allocation/ResearchReportExportPanel.tsx`
- `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`
- `frontend/src/pages/FundDetail/useFundDetailData.ts`
- `frontend/src/pages/FundDetail/components/*`
- `frontend/src/components/fund-detail/DetailStatusPanels.tsx`
- `frontend/src/lib/fund-research.ts`
- `frontend/api/fund-router.ts`
- `frontend/api/fund-router.contract.test.ts`
- `backend/app/api/fund.py` only if export format metadata is missing
- `backend/tests/test_fund_research_report.py` only if backend metadata is added
- `docs/pm/reports/FT-REPORT-PANEL-V2-001.md`
- `docs/pm/reviews/FT-REPORT-PANEL-V2-001.review.md`
- `docs/pm/reviews/FT-REPORT-PANEL-V2-001.review.json`
- `docs/pm/reviews/FT-REPORT-PANEL-V2-001.acceptance.md`
- `docs/pm/reviews/FT-REPORT-PANEL-V2-001.acceptance.json`

Files or areas the coding agent must not edit:

- Allocation generation flow
- `frontend/src/hooks/useAllocationData.ts`
- `frontend/src/lib/execution-plan.ts`
- Global theme tokens except for using existing semantic classes
- Backend evidence-pack internals unless already approved by
  `FT-EVIDENCE-PACK-V2-001`
- Database files
- Deployment files
- Git history, branches, tags, or remotes

## Allowed Files

- `frontend/src/components/allocation/ResearchReportExportPanel.tsx`
- `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`
- `frontend/src/pages/FundDetail/useFundDetailData.ts`
- `frontend/src/pages/FundDetail/components/*`
- `frontend/src/components/fund-detail/DetailStatusPanels.tsx`
- `frontend/src/lib/fund-research.ts`
- `frontend/api/fund-router.ts`
- `frontend/api/fund-router.contract.test.ts`
- `backend/app/api/fund.py`
- `backend/tests/test_fund_research_report.py`
- `docs/pm/reports/FT-REPORT-PANEL-V2-001.md`
- `docs/pm/reviews/FT-REPORT-PANEL-V2-001.review.md`
- `docs/pm/reviews/FT-REPORT-PANEL-V2-001.review.json`
- `docs/pm/reviews/FT-REPORT-PANEL-V2-001.acceptance.md`
- `docs/pm/reviews/FT-REPORT-PANEL-V2-001.acceptance.json`

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

If the status contains unrelated changes, preserve them and continue only inside
the approved scope.

## Required GitNexus Impact Before Editing

Run and summarize upstream blast radius before touching symbols:

```powershell
npx gitnexus impact ResearchReportExportPanel --repo FundTrader --direction upstream
npx gitnexus impact fundResearchReport --repo FundTrader --direction upstream
npx gitnexus impact DiagnosisTab --repo FundTrader --direction upstream
```

If any result is HIGH or CRITICAL, stop and report the blast radius before
editing.

## Implementation Tasks

1. Inspect the current Diagnosis tab and report export panel behavior.
2. Design the panel as a compact operational surface:
   - report readiness status
   - evidence coverage percentage
   - critical missing evidence list
   - backend report source / generated time / schema version if available
   - export buttons for Markdown, DOCX, PDF
   - fallback status when backend report is unavailable
3. Button behavior:
   - `available`: enable exports normally
   - `partial`: enable exports with a visible partial-data warning
   - `missing`: disable exports and show missing reason
   - loading: disable exports and show current status
4. Ensure text fits within mobile and desktop layouts without overlap.
5. Add or update frontend contract/type tests where practical.
6. Write the final implementation report.

## Frontend Design Rules

- Use existing semantic theme classes and shadcn/Radix patterns.
- Do not add decorative cards inside cards.
- Avoid large hero-style headings; this is a compact diagnosis panel.
- Use status chips, compact metric rows, and clear disabled states.
- Do not hide data quality warnings behind hover-only UI.
- Preserve explicit `available` / `partial` / `missing` language.

## Validation

Run:

```powershell
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd test -- fund-router.contract
npm.cmd run build
```

If backend metadata changed:

```powershell
cd D:\Workspace\Fundtrader\backend
$env:PYTHONPATH = (Get-Location).Path
python -m pytest tests\test_fund_research_report.py -q
```

Before any commit, run:

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

Expected result:

- TypeScript check and production build pass.
- Report panel handles backend available, partial, loading, and missing states.
- No route shape changes.

## Stop Conditions

Stop and write a report instead of guessing when:

- Evidence pack v2 is required but not implemented.
- Implementing the UI requires broad FundDetail restructuring.
- Backend report exports do not expose enough status to distinguish partial from
  missing and adding it would exceed the approved scope.
- Validation fails for unrelated repo state.

## Final Report Required

Write `docs/pm/reports/FT-REPORT-PANEL-V2-001.md` with:

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
4. UI states implemented
5. Validation commands and results
6. GitNexus impact / detect-changes summary
7. Scope / safety
8. Open risks
9. Recommended next action
