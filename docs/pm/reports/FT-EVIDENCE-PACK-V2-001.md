## PM Digest

Status: complete
Changed: backend/app/reports/fund_research_report.py, backend/app/agents/fund_agent.py, backend/tests/test_fund_research_report.py, backend/tests/test_fund_agent.py, frontend/api/fund-router.contract.test.ts, frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx, docs/pm/reports/FT-EVIDENCE-PACK-V2-001.md
Validation: passed - pytest test_fund_research_report.py test_fund_agent.py; npm run check; npm test -- fund-router.contract; gitnexus detect-changes; git diff --check
Risk: high detect-changes impact across evidence/report/DiagnosisTab flows, contained to approved surfaces
Decision: none
Next: accept

# FT-EVIDENCE-PACK-V2-001 Report

## 1. Status

Complete. Evidence pack v2 is implemented as an additive contract, preserving
existing top-level keys and adding readiness, coverage, critical missing
evidence, provider health, schema version, and generated-at metadata.

Claude Code dispatch was attempted first, but stopped on GitNexus permission
approval before editing. Codex PM ran the required impact analysis and completed
the implementation inside the approved scope.

## 2. Summary

- Added `schemaVersion: fund-evidence-pack.v2`.
- Added `generatedAt` while preserving existing `generated_at`.
- Added `coverageSummary` with field counts, coverage, status, and evidence
  categories.
- Added `criticalMissingEvidence` for missing required evidence only.
- Added `providerHealthSummary` derived from field, market, risk, manager, and
  event sources.
- Added `conclusionReadiness` with `ready`, `partial`, and `insufficient_data`
  states.
- Updated fixed-template Fund Agent plans to use readiness as the maximum
  conclusion strength.
- Added a compact Evidence readiness panel to Fund Detail Diagnosis.

## 3. Files Changed

- `backend/app/reports/fund_research_report.py`
- `backend/app/agents/fund_agent.py`
- `backend/tests/test_fund_research_report.py`
- `backend/tests/test_fund_agent.py`
- `frontend/api/fund-router.contract.test.ts`
- `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`
- `docs/pm/reports/FT-EVIDENCE-PACK-V2-001.md`

## 4. Evidence Pack V2 Field Summary

| Field | Contract |
| --- | --- |
| `schemaVersion` | Static version string for downstream contract checks. |
| `generatedAt` | Camel-case timestamp mirror for frontend/agent consumers. |
| `coverageSummary` | Field coverage, total/available/partial/missing counts, category status. |
| `criticalMissingEvidence` | Missing required evidence categories, including blocking NAV/risk gaps. |
| `providerHealthSummary` | Provider/source status summary derived from available evidence. |
| `conclusionReadiness` | Readiness status and allowed conclusion strength. |

Readiness rules:

- `ready`: no missing critical evidence, no category gaps, and overall coverage is available.
- `partial`: evidence is usable but contains partial or non-blocking gaps.
- `insufficient_data`: NAV or risk evidence is missing.

## 5. Validation Commands And Results

```powershell
npx gitnexus impact build_fund_evidence_pack --repo FundTrader --direction upstream
npx gitnexus impact render_fund_research_report --repo FundTrader --direction upstream
npx gitnexus impact build_fund_agent_plan --repo FundTrader --direction upstream
```

Result: all LOW before editing. `build_fund_evidence_pack` had two direct
callers: `build_fund_agent_plan` and `render_fund_research_report`.

```powershell
$env:PYTHONPATH=(Resolve-Path .\backend).Path
python -m pytest backend\tests\test_fund_research_report.py backend\tests\test_fund_agent.py -q
```

Result: passed, `20 passed`.

```powershell
cd frontend
npm.cmd run check
npm.cmd test -- fund-router.contract
```

Result: passed. TypeScript check passed; BFF contract test passed with
`34 passed`.

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

Result: completed. It reported HIGH risk because 6 files / 49 symbols affect 8
DiagnosisTab-related flows. This is contained to the approved report/evidence
and diagnosis surfaces.

```powershell
git diff --check -- <changed task files>
```

Result: passed. Git emitted CRLF working-copy warnings only.

## 6. GitNexus Impact / Detect-Changes Summary

Pre-edit impact:

- `build_fund_evidence_pack`: LOW, 2 direct callers.
- `render_fund_research_report`: LOW, no upstream callers reported.
- `build_fund_agent_plan`: LOW, no upstream callers reported.

Post-edit detect-changes:

- Risk: HIGH.
- Affected processes: 8, all centered on `DiagnosisTab` flow surfaces.
- PM assessment: acceptable for this task because the user-facing frontend
  change is explicitly in scope and tests/typecheck passed.

## 7. Scope / Safety

- All v2 fields are additive.
- Existing evidence-pack keys remain present.
- LLM/agent contract remains evidence-pack-only.
- No database, credential, deployment, allocation optimizer, or route-shape
  changes were made.

## 8. Open Risks

- Frontend display now depends on backend report query availability; fallback
  states show `loading`, `missing`, or `unknown` instead of inventing readiness.
- GitNexus classified the changed surface as HIGH due to DiagnosisTab process
  impact, so the next UI task should verify mobile/desktop rendering.

## 9. Recommended Next Action

Accept `FT-EVIDENCE-PACK-V2-001`, then continue to `FT-REPORT-PANEL-V2-001`.
