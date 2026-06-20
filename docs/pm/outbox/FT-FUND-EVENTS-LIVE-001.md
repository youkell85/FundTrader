# FT-FUND-EVENTS-LIVE-001 - Production Fund Events Providers

Created: 2026-06-21
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Productionize the existing provider-style fund events layer by wiring real,
configurable event providers for fund announcements and news while keeping tests
deterministic and evidence-pack safe.

The user-facing outcome is a fund event timeline that can enrich evidence packs
and reports with real announcements when providers are available, and with clear
`disabled`, `partial`, or `missing` states when they are not.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - `FT-P1-3` added deterministic fund event aggregation but explicitly avoided
    live credentials, scraping, or production network dependencies.
  - Production prior work proved `eastmoney:fund_announcement_report` can be a
    useful real source when available.
  - This task should borrow DSA provider/fallback patterns, but FundTrader must
    remain a fund research/allocation product, not a stock trading agent.
  - Live providers must be configurable and safe to disable.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/data/fund_events.py`
- `backend/app/data/data_gateway.py` only for provider health integration
- `backend/app/services/fund_service.py` only for existing announcement helpers
- `backend/app/reports/fund_research_report.py`
- `backend/app/api/fund.py`
- `backend/tests/test_fund_events.py`
- `backend/tests/test_fund_research_report.py`
- `frontend/api/fund-router.ts`
- `frontend/src/pages/FundDetail/useFundDetailData.ts`
- `frontend/src/pages/FundDetail/tabs/HoldingsTab.tsx`
- `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`
- `frontend/src/pages/FundDetail/components/*`
- `docs/pm/reports/FT-FUND-EVENTS-LIVE-001.md`
- `docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.review.md`
- `docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.review.json`
- `docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.acceptance.md`
- `docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.acceptance.json`

Files or areas the coding agent must not edit:

- `.env` or credential files
- Browser automation or scraper infrastructure
- General LLM agent routing
- Allocation algorithm code
- Database schema unless PM approves a separate migration task
- Deployment files
- Git history, branches, tags, or remotes

## Allowed Files

- `backend/app/data/fund_events.py`
- `backend/app/data/data_gateway.py`
- `backend/app/services/fund_service.py`
- `backend/app/reports/fund_research_report.py`
- `backend/app/api/fund.py`
- `backend/tests/test_fund_events.py`
- `backend/tests/test_fund_research_report.py`
- `frontend/api/fund-router.ts`
- `frontend/src/pages/FundDetail/useFundDetailData.ts`
- `frontend/src/pages/FundDetail/tabs/HoldingsTab.tsx`
- `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`
- `frontend/src/pages/FundDetail/components/*`
- `docs/pm/reports/FT-FUND-EVENTS-LIVE-001.md`
- `docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.review.md`
- `docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.review.json`
- `docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.acceptance.md`
- `docs/pm/reviews/FT-FUND-EVENTS-LIVE-001.acceptance.json`

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

If the status contains unrelated changes, preserve them and continue only inside
the approved scope.

## Required GitNexus Impact Before Editing

Run and summarize upstream blast radius before touching symbols:

```powershell
npx gitnexus impact collect_fund_events --repo FundTrader --direction upstream
npx gitnexus impact build_fund_evidence_pack --repo FundTrader --direction upstream
npx gitnexus impact get_fund_manager_report --repo FundTrader --direction upstream
```

If any result is HIGH or CRITICAL, stop and report the blast radius before
editing.

## Implementation Tasks

1. Inspect current `backend/app/data/fund_events.py` and the existing report
   integration.
2. Add provider classes or provider functions for:
   - deterministic local/static provider used in tests
   - Eastmoney announcement/report provider, using existing safe service helpers
     when available
   - iFinD/news placeholder provider that is disabled unless configured
3. Normalize every event to:
   - `title`
   - `url`
   - `source`
   - `published_at`
   - `fund_code`
   - `event_type`
   - `summary`
   - `data_quality`
   - `field_sources`
4. Add provider health output:
   - enabled / disabled
   - status
   - last_success_at
   - last_error
   - cooldown_until if applicable
   - capabilities
5. Extend evidence pack and report rendering to surface event status and event
   rows without inventing unavailable context.
6. Add frontend event timeline UI in Fund Detail:
   - display available events grouped by type/date
   - show source and published date
   - show disabled/missing state when no providers are configured
7. Add focused tests with mocked providers only.
8. Write the final implementation report.

## Contracts And Design Decisions

- Tests must not rely on live external services.
- Provider credentials must be read from existing environment/config mechanisms;
  do not write secrets.
- Provider failure must downgrade to explicit `partial/missing`, not crash the
  evidence pack or detail page.
- Fund events enrich reports; they do not become trading advice.
- Existing `/fund/api/*` route shapes must remain compatible.

## Frontend Design Rules

- Add an event timeline only where it supports fund diagnosis.
- Do not use a social/news-feed layout.
- Use compact rows with event type, date, source, and data-quality status.
- For missing state, show why events are unavailable and whether providers are
  disabled or failing.

## Validation

Run:

```powershell
cd D:\Workspace\Fundtrader\backend
$env:PYTHONPATH = (Get-Location).Path
python -m pytest tests\test_fund_events.py tests\test_fund_research_report.py -q
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

Before any commit, run:

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

Expected result:

- Deterministic tests pass without live providers.
- Real providers are configurable and disabled safely by default when credentials
  are unavailable.
- Evidence pack/report include event context or explicit missing state.
- Frontend typecheck and build pass.

## Stop Conditions

Stop and write a report instead of guessing when:

- Existing service helpers cannot provide safe announcement data.
- A new database table is required.
- Live provider credentials or legal/compliance decisions are missing.
- Implementing event timeline requires broad FundDetail restructuring.
- Validation fails for unrelated repo state.

## Final Report Required

Write `docs/pm/reports/FT-FUND-EVENTS-LIVE-001.md` with:

```markdown
## PM Digest

Status: complete | needs_fix | blocked | decision_needed
Changed: file1, file2
Validation: passed | failed | skipped - command names only
Risk: none | brief risk
Decision: none | exact PM/user question
Next: accept | create_hotfix | run_followup | ask_user
```

Then include:

1. Status
2. Summary
3. Providers added or deferred
4. Files changed
5. Frontend states implemented
6. Validation commands and results
7. GitNexus impact / detect-changes summary
8. Scope / safety
9. Open risks
10. Recommended next action
