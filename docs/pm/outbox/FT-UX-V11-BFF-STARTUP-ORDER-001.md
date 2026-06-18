# FT-UX-V11-BFF-STARTUP-ORDER-001 - Harden frontend BFF startup after backend deploy

Created: 2026-06-18T00:20:00+08:00
PM: Codex
Status: planned

## Goal

Prevent production deploys from leaving the FundTrader homepage in a stale
loading state when `fundtrader-frontend` starts before the backend has finished
FastAPI startup.

## Context

During UX V11 production deploy, `fundtrader` took about 30 seconds to complete
startup:

- Backend initially logged `Waiting for application startup`.
- Port `8766` was not listening yet.
- `fundtrader-frontend` started immediately, exhausted startup cache retries,
  and logged `ECONNREFUSED 127.0.0.1:8766`.
- API became healthy after backend fallback loaded from SQLite cache.
- Restarting only `fundtrader-frontend` after backend readiness restored
  `trpc.fund.list` and production UI.

## Scope

Choose the smallest robust fix:

1. Deployment script/order fix: wait for backend health before restarting BFF.
2. BFF runtime fix: continue retrying startup homepage cache until backend health is available.
3. Systemd dependency/readiness fix if already consistent with repo deploy patterns.

Do not change unrelated dashboard behavior.

## Allowed Files

- `deploy/deploy.sh`
- `deploy/fundtrader-frontend.service`
- `frontend/api/fund-router.ts`
- `frontend/api/fund-router.startup.test.ts`
- `docs/pm/reports/FT-UX-V11-BFF-STARTUP-ORDER-001.md`
- `docs/pm/reviews/FT-UX-V11-BFF-STARTUP-ORDER-001.review.md`
- `docs/pm/reviews/FT-UX-V11-BFF-STARTUP-ORDER-001.review.json`

## Required Checks

- Inspect `deploy/` service files and current deployment scripts.
- Inspect BFF startup cache refresh logic in the frontend server bundle source.
- Add or update a focused test if the retry logic is changed.
- Validate local build.
- Provide a production-safe rollout note.

## Acceptance

- A backend startup delay cannot permanently leave homepage fund list/cache stale.
- Failure path still shows explicit loading or unavailable state.
- No secrets are printed.
- Final report includes exact files changed, validation commands, and deployment note.

## Final Report Required

Write `docs/pm/reports/FT-UX-V11-BFF-STARTUP-ORDER-001.md` with:

```markdown
## PM Digest

Status: complete | needs_fix | blocked | decision_needed
Changed: file1, file2
Validation: passed | failed | skipped - command names only
Risk: none | brief risk
Decision: none | exact PM/user question
Next: accept | create_hotfix | run_followup | ask_user
```

## Validation

```powershell
cd "D:\Workspace\Fundtrader"
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```
