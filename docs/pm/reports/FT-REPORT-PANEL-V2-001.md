## PM Digest

Status: complete
Changed: frontend/src/components/allocation/ResearchReportExportPanel.tsx, frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx, docs/pm/reports/FT-REPORT-PANEL-V2-001.md
Validation: passed - npm run check; npm test -- fund-router.contract; npm run build; gitnexus detect-changes; git diff --check
Risk: high detect-changes impact across DiagnosisTab/report panel flows, contained to approved frontend surfaces
Decision: none
Next: accept

# FT-REPORT-PANEL-V2-001 Report

## 1. Status

Complete. The report UI now exposes backend evidence readiness, coverage,
critical missing evidence, and disabled export states instead of presenting
exports as unconditional utility buttons.

## 2. Summary

- Added a compact Evidence readiness panel to Fund Detail Diagnosis.
- Added readiness, coverage, and critical gap status metrics to
  `ResearchReportExportPanel`.
- Added backend Markdown, DOCX, and PDF export links when backend report
  evidence is available.
- Disabled backend exports when report evidence is loading, missing, or
  insufficient.
- Preserved the existing copy/download Markdown snapshot fallback.

## 3. Files Changed

- `frontend/src/components/allocation/ResearchReportExportPanel.tsx`
- `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`
- `docs/pm/reports/FT-REPORT-PANEL-V2-001.md`

No backend route shape or evidence-pack internals were changed in this task.

## 4. UI States Implemented

| State | Behavior |
| --- | --- |
| `ready` | Shows good readiness, enables backend MD/DOCX/PDF exports. |
| `partial` | Shows warning readiness, keeps exports enabled with visible caveat. |
| `insufficient_data` | Shows blocking critical gaps and disables backend exports. |
| `missing` | Shows missing/disabled state and keeps fallback snapshot behavior. |
| loading | Disables export actions until backend status resolves. |

## 5. Validation Commands And Results

```powershell
npx gitnexus impact ResearchReportExportPanel --repo FundTrader --direction upstream
npx gitnexus impact "Function:frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx:DiagnosisTab" --repo FundTrader --direction upstream
```

Result: both LOW. `fundResearchReport` is not indexed as an independent symbol,
and no BFF handler edit was made.

```powershell
cd frontend
npm.cmd run check
npm.cmd test -- fund-router.contract
npm.cmd run build
```

Result: passed. TypeScript check passed; `fund-router.contract` passed with
`34 passed`; production build completed.

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

Result: completed with HIGH risk because the cumulative work now touches
DiagnosisTab/report/evidence flows. The changed scope remains within approved
surfaces.

```powershell
git diff --check -- frontend\src\components\allocation\ResearchReportExportPanel.tsx frontend\src\pages\FundDetail\tabs\DiagnosisTab.tsx
```

Result: passed. Git emitted CRLF working-copy warnings only.

## 6. GitNexus Impact / Detect-Changes Summary

Pre-edit impact:

- `ResearchReportExportPanel`: LOW, no upstream callers reported.
- `DiagnosisTab` in `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`: LOW,
  no upstream callers reported.
- `fundResearchReport`: not found as an index symbol; BFF route was not edited.

Post-edit detect-changes:

- Risk: HIGH.
- Affected processes: 8 DiagnosisTab/report-panel related flows.
- PM assessment: acceptable because this task explicitly targets this UI surface
  and validation passed.

## 7. Scope / Safety

- No allocation generation, optimizer, execution-plan, theme-token, database, or
  deployment files were edited.
- Exports still use existing `/fund/api/fund/{code}/research-report?format=...`
  endpoints.
- Missing evidence is shown as a disabled/export-limited state instead of being
  hidden.

## 8. Open Risks

- Visual QA in a browser is still recommended before production deployment,
  especially on narrow mobile widths.

## 9. Recommended Next Action

Accept `FT-REPORT-PANEL-V2-001`, then continue to provider/event and market
context follow-up tasks.
