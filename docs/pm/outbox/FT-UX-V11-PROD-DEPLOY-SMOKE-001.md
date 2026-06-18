# FT-UX-V11-PROD-DEPLOY-SMOKE-001 - FundTrader production deploy and smoke

Created: 2026-06-17T23:50:00+08:00
PM: Codex
Status: planned, do not execute without explicit user approval phrase `Approve FundTrader Option B`

## Goal

Deploy the accepted FundTrader UX V11 release commit after preserving known
production-local files, then verify the Singapore production site.

## Allowed Files

- `docs/pm/reports/FT-UX-V11-PROD-DEPLOY-SMOKE-001.md`
- `docs/pm/reviews/FT-UX-V11-PROD-DEPLOY-SMOKE-001.review.md`
- `docs/ux-v11-deploy-runbook-20260617.md`
## Preconditions

- Local commit: `bf2c4d2 feat: refine FundTrader UX v11 decision flow`.
- Local `master` is ahead of `gitee/master` by 1.
- Production `/opt/fundtrader` is currently expected at `3c9b98d`.
- Production services `fundtrader` and `fundtrader-frontend` are expected active.
- Production dirty files are known and must be preserved before deploy:
  - `backend/.env`
  - `backend/.env.bak.20260613203152`
  - `frontend/package-lock.json`
  - `frontend/dist.prev/`
  - `scripts/check_cache.py`
  - `scripts/rebuild_cache.py`
- User explicitly approves deploy with `Approve FundTrader Option B`.

## Required production preservation

Create a timestamped backup under `/opt/fundtrader/deploy/backups/ux-v11-*`
before changing the production checkout.

Restore `frontend/package-lock.json` to tracked state before `npm ci`. Keep the
dirty copy only in the timestamped backup.

## Planned validation

- Push local `master` to Gitee.
- On production, backup known local files.
- Fetch Gitee and fast-forward with `git merge --ff-only gitee/master`.
- Run `npm ci` and `npm run build` in `frontend`.
- Restart backend and frontend services.
- Verify API health and `/fund/` HTTP 200.
- Browser smoke:
  - Home shows market status, macro/data freshness, portfolio risks, and next actions.
  - Fund Detail Overview shows conclusion, risk level, metrics, completeness, and next actions.
  - Backtest demo mode shows disabled controls with explicit reason.

## Stop conditions

- No explicit user approval.
- Backup cannot be created.
- Remote branch has moved unexpectedly.
- Production has unexpected modified tracked files beyond the known preserved set.
- `git merge --ff-only` fails.
- `npm ci` or build fails.
- Either service fails to become active after restart.

## Required runbook

Use the exact Option B sequence in:

- `D:\Workspace\docs\ux-v11-deploy-runbook-20260617.md`

## Validation

```powershell
cd "D:\Workspace\Fundtrader"
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
Test-Path "D:\Workspace\docs\ux-v11-deploy-runbook-20260617.md" | Out-Null
```

