# FT-P1-1 - Long Task Status For Fund Workflows

Created: 2026-06-18T15:00:00+08:00
PM: Codex
Executor: Codex PM fallback while Claude Code gateway is unavailable

## Goal

Expose persistent job status for long-running FundTrader workflows such as batch detail refresh, fund pool refresh, report generation, and backtest jobs.

## Context

- Source plan: `D:\Workspace\docs\0615\gpt\FundTrader_2026-06-15.md`
- Prior accepted slices: `FT-P0-1` through `FT-P0-5`
- Product boundary: long-task status improves observability; SSE/WebSocket remains P2.

## Approved Scope

Allowed implementation areas:

- `backend/app/api/`
- `backend/app/services/`
- `backend/app/storage/`
- `backend/tests/`
- `frontend/api/fund-router.ts`
- `frontend/src/`
- `docs/pm/reports/FT-P1-1.md`
- `docs/pm/reviews/FT-P1-1.review.md`
- `docs/pm/reviews/FT-P1-1.review.json`

Do not edit:

- `.env` or secrets
- `backend/data/fundtrader.db`
- deployment scripts or production process config
- `docs/pm/outbox`, `docs/pm/running`, `docs/pm/logs`
- git history, branches, remotes

## Allowed Files

- `backend/app/api/`
- `backend/app/services/`
- `backend/app/storage/`
- `backend/tests/`
- `frontend/api/fund-router.ts`
- `frontend/src/`
- `docs/pm/reports/FT-P1-1.md`
- `docs/pm/reviews/FT-P1-1.review.md`
- `docs/pm/reviews/FT-P1-1.review.json`

## Implementation Tasks

1. Add or normalize a job-status model with `job_id`, `status`, `step`, `progress`, `error`, `started_at`, `updated_at`.
2. Ensure status can be read after the initial request lifecycle.
3. Add route/BFF exposure if missing.
4. Add deterministic tests for running/succeeded/failed states.

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
- Job status tests do not require background workers or external services.

## Acceptance Criteria

- Long-running workflows can expose status without relying on frontend memory.
- Failed jobs expose source/step/error.
- Existing fund routes remain compatible.

## Final Report Required

Write `docs/pm/reports/FT-P1-1.md` with status, summary, files changed, validation commands/results, safety notes, and open risks.
