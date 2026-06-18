# FT-P1-2 - Backtest Diagnostics Enhancement

Created: 2026-06-18T15:30:00+08:00
PM: Codex
Executor: Codex PM fallback while Claude Code gateway is unavailable

## Goal

Enhance DCA/allocation/portfolio backtest diagnostics with professional metrics such as CAGR, drawdown duration, Sortino, benchmark excess, and best/worst month where the data is available.

## Context

- Source plan: `D:\Workspace\docs\0615\gpt\FundTrader_2026-06-15.md`
- Prior accepted slices: `FT-P0-1` through `FT-P0-5`, `FT-P1-1`
- Product boundary: metrics explain fund allocation/backtests; they are not stock-trading signals.

## Approved Scope

Allowed implementation areas:

- `backend/app/allocation/`
- `backend/app/services/dca_service.py`
- `backend/app/api/dca.py`
- `backend/tests/`
- `frontend/api/`
- `frontend/src/`
- `docs/pm/reports/FT-P1-2.md`
- `docs/pm/reviews/FT-P1-2.review.md`
- `docs/pm/reviews/FT-P1-2.review.json`

Do not edit:

- `.env` or secrets
- `backend/data/fundtrader.db`
- deployment scripts or production process config
- `docs/pm/outbox`, `docs/pm/running`, `docs/pm/logs`
- git history, branches, remotes

## Allowed Files

- `backend/app/allocation/`
- `backend/app/services/dca_service.py`
- `backend/app/api/dca.py`
- `backend/tests/`
- `frontend/api/`
- `frontend/src/`
- `docs/pm/reports/FT-P1-2.md`
- `docs/pm/reviews/FT-P1-2.review.md`
- `docs/pm/reviews/FT-P1-2.review.json`

## Implementation Tasks

1. Add or normalize extended backtest metrics.
2. Include explicit missing/partial state when metric inputs are unavailable.
3. Add deterministic tests for metric calculations and missing-data branches.

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
- Metrics do not fabricate values when inputs are unavailable.

## Acceptance Criteria

- Backtest outputs include professional diagnostic fields or explicit missing state.
- Existing backtest API contracts remain compatible.
- Reports can consume the new metrics safely.

## Final Report Required

Write `docs/pm/reports/FT-P1-2.md` with status, summary, files changed, validation commands/results, safety notes, and open risks.
