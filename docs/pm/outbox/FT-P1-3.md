# FT-P1-3 - Fund News And Announcement Aggregation

## Goal

Add a scoped FundTrader news/announcement aggregation layer that can enrich fund evidence and reports with fund events without relying on live external services during tests.

## Context

`docs\0615\gpt` lists FundTrader P1 news source / announcement aggregation as the next data enrichment after field provenance, market context, research reports, evidence packs, provider health, long task status, and backtest diagnostics. This task should borrow the DSA provider/fallback pattern, but remain fund-oriented and evidence-pack safe.

Claude coding agent execution is currently unavailable in this environment because CC Switch returns `AppIdNoAuthError`; Codex PM fallback may execute the scoped implementation and must report that fallback explicitly.

## Approved Scope

- Add a backend fund event/news aggregation service with provider-style inputs.
- Support deterministic local/static providers for tests.
- Normalize each event with:
  - `title`
  - `url`
  - `source`
  - `published_at`
  - `fund_code`
  - `event_type`
  - `summary`
  - `data_quality`
  - `field_sources`
- Include provider health and failure downgrade metadata.
- Expose the aggregation result to fund research evidence/report code only if there is an existing clean integration point.
- Do not add live credentials, scraping, browser automation, or production network dependency.
- Do not weaken existing `/fund/api/*` route contracts.

## Allowed Files

- `backend\app\data\fund_events.py`
- `backend\app\reports\fund_research_report.py`
- `backend\tests\test_fund_events.py`
- `backend\tests\test_fund_research_report.py`
- `docs\pm\reports\FT-P1-3.md`

If equivalent modules already exist, update them instead of creating duplicates.

## Implementation Tasks

1. Inspect existing fund report/evidence-pack code for the safest integration point.
2. Implement provider-style fund event aggregation with deterministic tests.
3. Add missing/partial/failure downgrade behavior and provider health.
4. Add or update focused tests.
5. Write the final implementation report to `docs\pm\reports\FT-P1-3.md`.

## Validation

Run only this safe validation block:

```powershell
cd backend
$env:PYTHONPATH = (Get-Location).Path
pytest tests\test_fund_events.py tests\test_fund_research_report.py -q
```

## Acceptance Criteria

- Fund events/news can be collected from local providers and normalized.
- Provider failures downgrade into visible `data_quality`/health metadata, not crashes.
- Fund report evidence can carry event context without hallucinating unavailable data.
- Tests pass without external services.

## Final Report Required

Write `docs\pm\reports\FT-P1-3.md` with:

- implementation summary
- files changed
- validation command/result
- PM fallback note if Claude coding agent was unavailable
- residual risks or follow-up items
