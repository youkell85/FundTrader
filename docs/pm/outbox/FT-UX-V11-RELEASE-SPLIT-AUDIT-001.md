# FT-UX-V11-RELEASE-SPLIT-AUDIT-001 - FundTrader release split audit

Created: 2026-06-17T11:55:00+08:00
PM: Codex
Status: planned

## Goal

Prepare FundTrader UX V11 local changes for an intentional commit/release
decision without changing business behavior.

## Required checks

- `git status --short --untracked-files=all`
- Exclude `backend/.env`.
- Classify source changes, tests, PM docs, and runtime/env files.
- Run frontend check/build.
- Run relevant backend tests if touched backend files require it.
- Run a longer allocation stream smoke if local backend/data service is
  available.

## Allowed Files

- `backend/app/data/data_gateway.py`
- `backend/app/main.py`
- `backend/app/models/fund.py`
- `backend/tests/test_dsa_p0_fields_provider_health.py`
- `docs/pm/STATUS.md`
- `docs/pm/outbox/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.md`
- `docs/pm/outbox/FT-UX-V11-BFF-STARTUP-ORDER-001.md`
- `docs/pm/outbox/FT-UX-V11-PROD-DEPLOY-SMOKE-001.md`
- `docs/pm/reports/FT-UX-V11-RELEASE-SPLIT-AUDIT-001.md`
- `docs/pm/reports/FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001.md`
- `docs/pm/reports/FT-UX-V11-DETAIL-IA-LIGHTEN-001.md`

## Not Allowed

- `backend/.env` (always)
- `docs/pm/reviews/*` (workflow generated)

## Acceptance

- Exact commit groups are listed.
- `backend/.env` is excluded.
- Validation evidence is current.
- No commit/push/deploy happens in this audit task.

## Validation

```powershell
cd "D:\Workspace\Fundtrader"
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```
