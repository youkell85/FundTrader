# FT-P2-3 - Long Task Realtime Progress Stream Contract

## Goal

Ensure FundTrader long-running workflows have a safe realtime progress stream contract using existing SSE/WebSocket-style infrastructure where present.

## Context

`docs\0615\gpt` lists SSE/WebSocket realtime task push as an optional P2 after job status. FundTrader already has long task status and allocation SSE paths; this task should verify/harden the contract without adding a new runtime stack unless necessary.

Claude coding agent execution is currently unavailable in this environment because CC Switch returns `AppIdNoAuthError`; Codex PM fallback may execute the scoped implementation and must report that fallback explicitly.

## Approved Scope

- Use existing allocation/job progress endpoints if present.
- Add a pure formatter/helper if needed for stable SSE progress events.
- Ensure event payloads include job_id, step, progress, status, source, error, and data_quality or missing reason.
- Do not add Redis, WebSocket server infrastructure, or production deployment changes.
- Do not start background services in tests.

## Allowed Files

- `backend\app\api\allocation.py`
- `backend\app\api\jobs.py`
- `backend\app\storage\database.py`
- `backend\app\jobs\progress_stream.py`
- `backend\tests\test_progress_stream_contract.py`
- `backend\tests\test_fund_job_status.py`
- `docs\pm\reports\FT-P2-3.md`

If equivalent behavior already exists, add tests/report instead of duplicating code.

## Implementation Tasks

1. Inspect existing SSE/job progress code.
2. Add or harden a stable progress event formatter.
3. Add focused tests for running, failed, and missing job stream payloads.
4. Write the final implementation report to `docs\pm\reports\FT-P2-3.md`.

## Validation

Run only this safe validation block:

```powershell
cd backend
$env:PYTHONPATH = (Get-Location).Path
pytest tests\test_progress_stream_contract.py tests\test_fund_job_status.py -q
```

## Acceptance Criteria

- Realtime progress event payload shape is stable and test-covered.
- Missing/failed jobs carry explicit data quality or missing reason.
- No new always-on infrastructure is introduced.
- Tests pass without background services.

## Final Report Required

Write `docs\pm\reports\FT-P2-3.md` with implementation summary, files changed, validation result, PM fallback note, and residual risks.
