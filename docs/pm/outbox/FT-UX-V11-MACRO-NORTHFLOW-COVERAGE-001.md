# FT-UX-V11-MACRO-NORTHFLOW-COVERAGE-001

## Role
You are the coding agent for FundTrader. Codex PM has already inspected the current code boundary. Implement only the scoped change below, then write a concise implementation report.

## Objective
Fund detail `marketContext.sections.northFlow` is currently a fixed placeholder (`coverage=0.35`, `netInflow=None`) even though the allocation data layer already persists `北向资金净流入` in `MacroSnapshot` / `MacroCache`.

Upgrade this section so the detail endpoint uses cached macro data when available, without triggering external network calls from the fund detail request path.

## Evidence From PM Baseline
- `backend/app/data/market_context_fetcher.py` builds `northFlow` as a hardcoded partial placeholder.
- `backend/app/allocation/data/models.py` defines `MacroSnapshot` / `MacroIndicator`.
- `backend/app/allocation/data/market_data_service.py` exposes `market_data_service.get_macro_snapshot()` and falls back to SQLite via `_load_macro_from_db()`.
- `backend/app/storage/database.py::MacroCache` includes `"北向资金净流入": "daily"` and exposes `get`, `get_all`, and `get_history`.
- `backend/app/allocation/data/macro_fetcher.py` fetches northbound data, but this task must not call it from the detail request path.

## Scope
Allowed code files:
- `backend/app/data/market_context_fetcher.py`
- `backend/tests/test_fund_research_report.py` or a focused new backend test file

Allowed report file:
- `docs/pm/reports/FT-UX-V11-MACRO-NORTHFLOW-COVERAGE-001.md`

Do not edit frontend files for this task.
Do not edit allocation generation, stream handling, macro fetcher, storage schema, `.env`, or runtime data.

## Allowed Files
- `backend/app/data/market_context_fetcher.py`
- `backend/tests/test_fund_research_report.py`
- `docs/pm/reports/FT-UX-V11-MACRO-NORTHFLOW-COVERAGE-001.md`

## Required Behavior
1. `get_fund_market_context(code)` must keep the existing response shape:
   - top-level `fundCode/asOf/status/dataStatus/coverage/sections/warnings`
   - `sections.northFlow.status/dataStatus/source/asOf/coverage/missingReason/data`
2. If cached `北向资金净流入` exists in the in-memory `market_data_service.get_macro_snapshot()`:
   - populate `sections.northFlow.data.netInflow` with the numeric value
   - include a simple `trend` string derived from the value, such as `inflow`, `outflow`, or `flat`
   - use the indicator source and fetch time when available
   - upgrade status/coverage from fixed placeholder to a real cached-data status
3. If in-memory macro snapshot is unavailable, optionally use SQLite `MacroCache.get_history("北向资金净流入", limit=1)` or `MacroCache.get("北向资金净流入")`.
   - This fallback must be best-effort and non-fatal.
   - Prefer `get_history` when you need `date/source`.
4. If no cached northbound value exists, preserve the current partial placeholder semantics and missing reason.
5. The fund detail request path must not import or call `macro_fetcher.fetch_all()` or any external provider.
6. Keep failures isolated. A macro cache exception must not break `get_fund_market_context`.

## Test Requirements
Add or update backend tests with no external network:
1. Cached macro snapshot path:
   - mock `_snapshot_basic` and `_top_industries`
   - mock `market_data_service.get_macro_snapshot()` to return a `MacroSnapshot` with `北向资金净流入`
   - assert `northFlow.dataStatus` is not the old placeholder-only state, `data.netInflow` is populated, and `missingReason` is absent.
2. Cache-missing fallback path:
   - mock macro snapshot/cache as missing
   - assert the current placeholder behavior remains structured and non-blocking.

## Validation Commands
Run these and include results in your report:
```powershell
cd D:\Workspace\Fundtrader\backend
python -m py_compile app/data/market_context_fetcher.py
python -m pytest tests/test_fund_research_report.py -q
```

If pytest cannot run due environment issues, report the exact error and still run `py_compile`.

## Report Requirements
Write `docs/pm/reports/FT-UX-V11-MACRO-NORTHFLOW-COVERAGE-001.md` with:
- files changed
- implementation summary
- exact validation commands and results
- any risk or follow-up
