# FT-P0-4 AI Fund Diagnosis Evidence Pack

## Objective

Unify fund detail, market context, risk metrics, backtest evidence, manager information, and report metadata into a single fund diagnosis evidence pack consumed by AI-facing diagnosis/report logic.

## Product boundary

- FundTrader remains a fund/ETF research, allocation, DCA, and portfolio explanation product.
- Do not import stock-trading agent behavior.
- LLM-facing code must explain structured evidence only; it must not invent unavailable fund facts.
- Missing P0 evidence must downgrade the diagnosis to `insufficient_data` or equivalent partial state.

## Approved Scope

Allowed implementation areas:

- `backend/app/reports/`
- `backend/app/api/fund.py`
- `backend/app/analysis.py`
- `backend/app/services/`
- `backend/tests/`
- `frontend/api/fund-router.ts`
- `frontend/api/*.test.ts`
- `docs/pm/reports/FT-P0-4.md`
- `docs/pm/reviews/FT-P0-4.review.md`
- `docs/pm/reviews/FT-P0-4.review.json`

Do not edit:

- `.env` or secrets
- `backend/data/fundtrader.db`
- deployment scripts or production process config
- `docs/pm/outbox`, `docs/pm/running`, `docs/pm/logs`
- git history, branches, remotes

## Allowed Files

- `backend/app/reports/`
- `backend/app/api/fund.py`
- `backend/app/analysis.py`
- `backend/app/services/`
- `backend/tests/`
- `frontend/api/fund-router.ts`
- `frontend/api/`
- `docs/pm/reports/FT-P0-4.md`
- `docs/pm/reviews/FT-P0-4.review.md`
- `docs/pm/reviews/FT-P0-4.review.json`

## Required implementation

- Add or extend a backend evidence-pack service for AI diagnosis.
- Ensure the pack can include:
  - fund identity and detail fields with provenance
  - market context
  - risk metrics / return metrics when available
  - DCA or allocation/backtest evidence when available
  - manager/company/holding information when available
  - data quality summary
  - missing evidence list
- Ensure AI/report-facing logic reads this evidence pack instead of rebuilding inconsistent Markdown in separate layers.
- Add deterministic tests for complete and missing-data branches.
- Keep `/fund/api/...` route compatibility.
- Do not add deployment, commit, push, or remote server steps.

## Suggested files

- `backend/app/reports/fund_research_report.py`
- `backend/app/api/fund.py`
- `backend/app/analysis.py` or equivalent existing diagnosis module
- `backend/tests/test_fund_diagnosis_evidence_pack.py`
- `frontend/api/fund-router.ts` only if a route contract needs exposure.

## Acceptance criteria

- Same input generates a stable evidence pack.
- Missing critical data is represented explicitly and downgrades conclusion strength.
- AI/report code consumes the evidence pack rather than a separate ad hoc payload.
- Backend tests cover both full and partial evidence.

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
- Evidence pack tests cover full and partial data branches.

## Final Report Required

Write `docs/pm/reports/FT-P0-4.md` with status, summary, files changed, validation commands/results, safety notes, and open risks.
