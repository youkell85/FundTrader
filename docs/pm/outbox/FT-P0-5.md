# FT-P0-5 - Data Source Health And Circuit Breaker Surface

Created: 2026-06-18T14:30:00+08:00
PM: Codex
Executor: Codex PM fallback while Claude Code gateway is unavailable

## Goal

Expose a unified FundTrader data-source health surface for iFinD, Tushare, TickFlow, AkShare, Eastmoney, efinance, and local cache/fallback providers.

## Context

- Source plan: `D:\Workspace\docs\0615\gpt\FundTrader_2026-06-15.md`
- Prior accepted slices:
  - `FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001`
  - `FT-P0-2`
  - `FT-P0-3`
  - `FT-P0-4`
- Route boundary: preserve `/fund/` and `/fund/api/*`.
- Product boundary: provider health informs data confidence; it must not become trading advice.

## Approved Scope

Allowed implementation areas:

- `backend/app/data/`
- `backend/app/api/`
- `backend/app/services/`
- `backend/tests/`
- `frontend/api/fund-router.ts`
- `frontend/src/`
- `docs/pm/reports/FT-P0-5.md`
- `docs/pm/reviews/FT-P0-5.review.md`
- `docs/pm/reviews/FT-P0-5.review.json`

Do not edit:

- `.env` or secrets
- `backend/data/fundtrader.db`
- deployment scripts or production process config
- `docs/pm/outbox`, `docs/pm/running`, `docs/pm/logs`
- git history, branches, remotes

## Allowed Files

- `backend/app/data/`
- `backend/app/api/`
- `backend/app/services/`
- `backend/tests/`
- `frontend/api/fund-router.ts`
- `frontend/src/`
- `docs/pm/reports/FT-P0-5.md`
- `docs/pm/reviews/FT-P0-5.review.md`
- `docs/pm/reviews/FT-P0-5.review.json`

## Implementation Tasks

1. Add or normalize `/fund/api/data-sources/status`.
2. Return provider records with `name`, `enabled`, `status`, `last_success_at`, `last_error`, `cooldown_until`, `capabilities`, and `data_quality`.
3. Preserve any existing provider-health contract from earlier P0 work.
4. Add deterministic tests that do not require live external credentials.
5. Expose the route through BFF/frontend only if current route wiring requires it.

## Validation

```powershell
cd D:\Workspace\Fundtrader
python -m pytest backend\tests -q
cd frontend
npm.cmd run check
npm.cmd run build
```

Expected:

- Backend tests pass.
- Frontend check/build remain green.
- Provider health contract is route-safe under `/fund/api`.

## Acceptance Criteria

- Provider status is visible with capability and failure/cooldown metadata.
- Missing credentials or provider failure do not crash the endpoint.
- Existing fund detail/report routes remain compatible.

## Final Report Required

Write `docs/pm/reports/FT-P0-5.md` with status, summary, files changed, validation commands/results, safety notes, and open risks.
