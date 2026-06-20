# FT-EVIDENCE-PACK-V2-001 - Evidence Pack V2 Contract

Created: 2026-06-21
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Deepen the existing fund evidence pack into a versioned, production-oriented
contract that downstream reports, fixed-template Fund Agent plans, and frontend
diagnosis UI can trust. The work should preserve existing consumers while adding
clear coverage and missing-evidence summaries.

The user-facing outcome is that FundTrader can explain whether a fund diagnosis
is strong, partial, or blocked, and exactly which evidence made it so.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - `backend/app/reports/fund_research_report.py` already builds evidence packs
    and deterministic reports.
  - `backend/app/agents/fund_agent.py` consumes evidence packs and must remain
    fixed-template / whitelist-only.
  - Detail pages must preserve explicit `available` / `partial` / `missing`
    display states.
  - Keep `/fund/api/*` route shape unchanged.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/reports/fund_research_report.py`
- `backend/app/agents/fund_agent.py`
- `backend/app/api/fund.py`
- `backend/tests/test_fund_research_report.py`
- `backend/tests/test_fund_agent.py`
- `frontend/api/fund-router.ts`
- `frontend/api/fund-router.contract.test.ts`
- `frontend/src/pages/FundDetail/useFundDetailData.ts`
- `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`
- `frontend/src/components/allocation/ResearchReportExportPanel.tsx`
- `docs/pm/reports/FT-EVIDENCE-PACK-V2-001.md`
- `docs/pm/reviews/FT-EVIDENCE-PACK-V2-001.review.md`
- `docs/pm/reviews/FT-EVIDENCE-PACK-V2-001.review.json`
- `docs/pm/reviews/FT-EVIDENCE-PACK-V2-001.acceptance.md`
- `docs/pm/reviews/FT-EVIDENCE-PACK-V2-001.acceptance.json`

Files or areas the coding agent must not edit:

- Unrelated allocation algorithm code
- `frontend/src/hooks/useAllocationData.ts`
- `frontend/src/lib/execution-plan.ts`
- Database files
- `.env` or credential files
- Deployment files
- Git history, branches, tags, or remotes
- Anything outside this handoff without PM approval

## Allowed Files

- `backend/app/reports/fund_research_report.py`
- `backend/app/agents/fund_agent.py`
- `backend/app/api/fund.py`
- `backend/tests/test_fund_research_report.py`
- `backend/tests/test_fund_agent.py`
- `frontend/api/fund-router.ts`
- `frontend/api/fund-router.contract.test.ts`
- `frontend/src/pages/FundDetail/useFundDetailData.ts`
- `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`
- `frontend/src/components/allocation/ResearchReportExportPanel.tsx`
- `docs/pm/reports/FT-EVIDENCE-PACK-V2-001.md`
- `docs/pm/reviews/FT-EVIDENCE-PACK-V2-001.review.md`
- `docs/pm/reviews/FT-EVIDENCE-PACK-V2-001.review.json`
- `docs/pm/reviews/FT-EVIDENCE-PACK-V2-001.acceptance.md`
- `docs/pm/reviews/FT-EVIDENCE-PACK-V2-001.acceptance.json`

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
npx gitnexus impact build_fund_evidence_pack --repo FundTrader --direction upstream
npx gitnexus impact render_fund_research_report --repo FundTrader --direction upstream
npx gitnexus impact build_fund_agent_plan --repo FundTrader --direction upstream
```

If any result is HIGH or CRITICAL, stop and report the blast radius before
editing.

## Implementation Tasks

1. Extend the evidence pack with additive fields only:
   - `schemaVersion`, for example `"fund-evidence-pack.v2"`
   - `generatedAt`
   - `coverageSummary`
   - `criticalMissingEvidence`
   - `providerHealthSummary`
   - `conclusionReadiness`
2. Preserve existing top-level keys consumed by reports and agents:
   - `subject`
   - `fund_detail`
   - `market_context`
   - `risk_metrics`
   - `manager_report`
   - `fund_events`
   - `field_sources`
   - `warnings`
   - `diagnosis`
3. Define critical evidence categories:
   - identity / basic profile
   - NAV or performance data
   - risk metrics
   - holdings or allocation evidence
   - market context
   - event context
4. Update diagnosis readiness rules:
   - no critical missing evidence -> `ready`
   - non-critical gaps only -> `partial`
   - missing NAV or risk evidence -> `insufficient_data`
5. Ensure fixed-template Fund Agent plans use the readiness summary and do not
   produce stronger conclusion strength than the evidence allows.
6. Update BFF contract tests and frontend usage so the diagnosis/report panel can
   display readiness and critical missing evidence.
7. Write the final implementation report.

## Contracts And Design Decisions

- All new fields must be additive and backward-compatible.
- LLM-facing logic must remain `evidence_pack_only`.
- Missing evidence must downgrade conclusion strength; it must not be filled
  with synthetic placeholders.
- Frontend must show `partial/missing` states plainly.
- No live LLM call should be added in this task.

## Validation

Run:

```powershell
cd D:\Workspace\Fundtrader\backend
$env:PYTHONPATH = (Get-Location).Path
python -m pytest tests\test_fund_research_report.py tests\test_fund_agent.py -q
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd test -- fund-router.contract
```

Before any commit, run:

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

Expected result:

- Existing report and agent tests pass.
- New tests cover full evidence, partial evidence, and critical missing evidence.
- Frontend typecheck passes.
- GitNexus affected scope is limited to report / evidence / diagnosis surfaces.

## Stop Conditions

Stop and write a report instead of guessing when:

- Evidence pack changes require breaking existing endpoint response shape.
- A high-risk allocation consumer is affected.
- Frontend needs broad layout refactoring outside the approved diagnosis/report
  surfaces.
- Validation fails for unrelated repo state.

## Final Report Required

Write `docs/pm/reports/FT-EVIDENCE-PACK-V2-001.md` with:

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
4. Evidence pack v2 field summary
5. Validation commands and results
6. GitNexus impact / detect-changes summary
7. Scope / safety
8. Open risks
9. Recommended next action
