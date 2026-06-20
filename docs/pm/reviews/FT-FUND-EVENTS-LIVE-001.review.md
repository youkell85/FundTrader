# Review: FT-FUND-EVENTS-LIVE-001

**Status:** $status
**Reviewed:** 2026-06-21T00:58:59.7375638+08:00

## Paths

| Artifact | Path |
|----------|------|
| Task     | docs\pm\outbox\FT-FUND-EVENTS-LIVE-001.md |
| Report   | docs\pm\reports\FT-FUND-EVENTS-LIVE-001.md |
| Log      | FT-FUND-EVENTS-LIVE-001.jsonl (not found) |
| Lock     | FT-FUND-EVENTS-LIVE-001.lock.json (not found) |

## Git Diff Check

**Passed:** True

`
warning: in the working copy of 'backend/app/agents/fund_agent.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/app/data/fund_events.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/app/reports/fund_research_report.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/tests/test_fund_agent.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/tests/test_fund_events.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/tests/test_fund_research_report.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'frontend/api/fund-router.contract.test.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'frontend/src/components/allocation/ResearchReportExportPanel.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx', LF will be replaced by CRLF the next time Git touches it
`

## PM Digest

Found: True

Status: complete
Changed: backend/app/data/fund_events.py, backend/tests/test_fund_events.py, frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx, docs/pm/reports/FT-FUND-EVENTS-LIVE-001.md
Validation: passed - pytest test_fund_events.py test_fund_research_report.py; npm run check; npm run build; gitnexus detect-changes; git diff --check
Risk: high detect-changes cumulative impact, event changes contained to approved provider/evidence/diagnosis surfaces
Decision: none
Next: accept
# FT-FUND-EVENTS-LIVE-001 Report

## Allowed Files (parsed from task)

backend/app/data/fund_events.py
backend/app/data/data_gateway.py
backend/app/services/fund_service.py
backend/app/reports/fund_research_report.py
backend/app/api/fund.py
backend/tests/test_fund_events.py
backend/tests/test_fund_research_report.py
frontend/api/fund-router.ts
frontend/src/pages/FundDetail/useFundDetailData.ts
frontend/src/pages/FundDetail/tabs/HoldingsTab.tsx
frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx
frontend/src/pages/FundDetail/components/*
docs/pm/reports/FT-FUND-EVENTS-LIVE-001.md
docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.review.md
docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.review.json
docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.acceptance.md
docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.acceptance.json

## Newly Changed Files (vs baseline)



## Issues



## Recommended Next Action

Ready for next task or archive.

---

Log: not found