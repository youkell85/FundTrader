# Acceptance: FT-UX-V11-BFF-STARTUP-ORDER-001

**Mode:** run
**Generated:** 2026-06-18T13:09:23.2324244+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 1 |
| Safe | 1 |
| Skipped (unsafe) | 0 |
| Unsupported | 0 |
| Passed | 1 |
| Failed | 0 |

## Blocks

### Block 1

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
cd "D:\Workspace\Fundtrader"
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

- **Exit Code:** 0

```
bf2c4d2 feat: refine FundTrader UX v11 decision flow
3c9b98d Load service credentials from backend env
c310134 Pass TickFlow API base URL
85557e1 Configure TickFlow SDK dependency
223b052 Add fixed fund agent prompt plans
bf2c4d2
 M backend/.env
 M backend/app/data/data_gateway.py
 M backend/app/data/providers/fusion.py
 M backend/app/main.py
 M backend/app/models/fund.py
 M backend/tests/test_etf_cache_population_script.py
 M deploy/deploy.sh
 M deploy/fundtrader-frontend.service
 M docs/pm/STATUS.md
 M docs/pm/outbox/FT-UX-V11-RELEASE-SPLIT-AUDIT-001.md
 M docs/pm/outbox/HF1-P1-1-ETF-CACHE-POPULATION-001.md
 M docs/pm/outbox/P1-STRESS-MC-PROVENANCE-001.md
 M docs/pm/outbox/TASK-PM-SMOKE-001.md
 M docs/pm/reports/HF1-P1-1-ETF-CACHE-POPULATION-001.md
 M docs/pm/reviews/HF1-P1-1-ETF-CACHE-POPULATION-001.acceptance.json
 M docs/pm/reviews/HF1-P1-1-ETF-CACHE-POPULATION-001.acceptance.md
 M frontend/api/fund-router.ts
 M frontend/src/components/fund-detail/DetailStatusPanels.tsx
 M frontend/src/pages/FundDetail/components/FieldSourceTip.tsx
 M frontend/src/pages/FundDetail/tabs/OverviewTab.tsx
 M scripts/populate-etf-cache.ps1
?? backend/app/api/health.py
?? backend/tests/test_dsa_p0_fields_provider_health.py
?? docs/pm/outbox/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.md
?? docs/pm/outbox/FT-P0-2.md
?? docs/pm/outbox/FT-UX-V11-BFF-STARTUP-ORDER-001.md
?? docs/pm/outbox/FT-UX-V11-PROD-DEPLOY-SMOKE-001.md
?? docs/pm/reviews/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.acceptance.json
?? docs/pm/reviews/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.acceptance.md
?? docs/pm/reviews/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.baseline.status.txt
?? docs/pm/reviews/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.review.json
?? docs/pm/reviews/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.review.md
?? docs/pm/reviews/FT-P0-2.acceptance.json
?? docs/pm/reviews/FT-P0-2.acceptance.md
?? docs/pm/reviews/FT-P0-2.review.json
?? docs/pm/reviews/FT-P0-2.review.md
?? docs/pm/reviews/FT-UX-V11-BFF-STARTUP-ORDER-001.review.json
?? docs/pm/reviews/FT-UX-V11-BFF-STARTUP-ORDER-001.review.md
?? docs/pm/reviews/FT-UX-V11-DETAIL-IA-LIGHTEN-001.acceptance.json
?? docs/pm/reviews/FT-UX-V11-DETAIL-IA-LIGHTEN-001.acceptance.md
?? docs/pm/reviews/FT-UX-V11-PROD-DEPLOY-SMOKE-001.acceptance.json
?? docs/pm/reviews/FT-UX-V11-PROD-DEPLOY-SMOKE-001.acceptance.md
?? docs/pm/reviews/FT-UX-V11-PROD-DEPLOY-SMOKE-001.baseline.status.txt
?? docs/pm/reviews/FT-UX-V11-PROD-DEPLOY-SMOKE-001.review.json
?? docs/pm/reviews/FT-UX-V11-PROD-DEPLOY-SMOKE-001.review.md
?? docs/pm/reviews/FT-UX-V11-RELEASE-SPLIT-AUDIT-001.review.json
?? docs/pm/reviews/FT-UX-V11-RELEASE-SPLIT-AUDIT-001.review.md
?? docs/pm/reviews/HF1-P1-1-ETF-CACHE-POPULATION-001.review.json
?? docs/pm/reviews/HF1-P1-1-ETF-CACHE-POPULATION-001.review.md
?? docs/pm/reviews/P1-STRESS-MC-PROVENANCE-001.review.json
?? docs/pm/reviews/P1-STRESS-MC-PROVENANCE-001.review.md
?? docs/pm/reviews/TASK-PM-SMOKE-001.review.json
?? docs/pm/reviews/TASK-PM-SMOKE-001.review.md
?? docs/pm/reviews/UNKNOWN.review.json
?? docs/pm/reviews/UNKNOWN.review.md
?? frontend/api/fund-router.startup.test.ts
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.