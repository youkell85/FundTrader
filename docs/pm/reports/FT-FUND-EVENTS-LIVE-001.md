## PM Digest

Status: complete
Changed: backend/app/data/fund_events.py, backend/tests/test_fund_events.py, frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx, docs/pm/reports/FT-FUND-EVENTS-LIVE-001.md
Validation: passed - pytest test_fund_events.py test_fund_research_report.py; npm run check; npm run build; gitnexus detect-changes; git diff --check
Risk: high detect-changes cumulative impact, event changes contained to approved provider/evidence/diagnosis surfaces
Decision: none
Next: accept

# FT-FUND-EVENTS-LIVE-001 Report

## 1. Status

Complete. The fund event layer now has a production-oriented provider contract
with real Eastmoney announcements, deterministic static tests, a disabled iFinD
placeholder, provider health aliases, and a Fund Detail event timeline.

## 2. Summary

- Preserved the existing deterministic static provider.
- Kept Eastmoney announcement provider disabled by default unless explicitly
  configured.
- Added disabled-by-default `IfindNewsPlaceholderProvider` for future licensed
  news integration.
- Added provider health aliases: `lastSuccessAt`, `lastError`, and
  `cooldownUntil`.
- Added payload aliases: `dataStatus`, `fundCode`, `providerHealth`, `source`,
  and `missingReason`.
- Added Fund Detail Diagnosis event rows sourced from
  `evidencePack.fund_events.events`.

## 3. Providers Added Or Deferred

| Provider | State | Notes |
| --- | --- | --- |
| `static_fund_events` | available in tests/offline snapshots | Deterministic, no network. |
| `eastmoney_fund_announcement` | live but disabled by default | Enabled via `FUND_EVENTS_EASTMONEY_ENABLED`. |
| `ifind_fund_news` | placeholder disabled by default | Raises a configured-missing error if enabled before credentials/integration exist. |

## 4. Files Changed

- `backend/app/data/fund_events.py`
- `backend/tests/test_fund_events.py`
- `frontend/src/pages/FundDetail/tabs/DiagnosisTab.tsx`
- `docs/pm/reports/FT-FUND-EVENTS-LIVE-001.md`

## 5. Frontend States Implemented

- Available events show date, event type, source, and title.
- Missing or disabled providers show the backend missing reason.
- No event text is invented when providers are disabled or empty.

## 6. Validation Commands And Results

```powershell
npx gitnexus impact collect_fund_events --repo FundTrader --direction upstream
npx gitnexus impact build_fund_evidence_pack --repo FundTrader --direction upstream
npx gitnexus impact get_fund_manager_report --repo FundTrader --direction upstream
```

Result: `collect_fund_events` LOW, `build_fund_evidence_pack` LOW,
`get_fund_manager_report` HIGH. No changes were made to
`get_fund_manager_report`.

```powershell
$env:PYTHONPATH=(Resolve-Path .\backend).Path
python -m pytest backend\tests\test_fund_events.py backend\tests\test_fund_research_report.py -q
```

Result: passed, `20 passed`, with existing `datetime.utcnow` deprecation
warnings.

```powershell
cd frontend
npm.cmd run check
npm.cmd run build
```

Result: passed. TypeScript check and production build completed.

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

Result: HIGH cumulative risk across 9 files / 78 symbols and 8 DiagnosisTab
flows.

```powershell
git diff --check -- backend\app\data\fund_events.py backend\tests\test_fund_events.py frontend\src\pages\FundDetail\tabs\DiagnosisTab.tsx
```

Result: passed. Git emitted CRLF working-copy warnings only.

## 7. GitNexus Impact / Detect-Changes Summary

- Event provider edit target was LOW risk.
- Manager report helper was HIGH risk, so it was intentionally left untouched.
- Post-edit HIGH classification is cumulative and centered on already-approved
  evidence/report/DiagnosisTab surfaces.

## 8. Scope / Safety

- No credentials, `.env`, scraper infrastructure, database schema, allocation
  code, or deployment files were changed.
- Tests remain deterministic and do not call live providers.
- Live providers remain configurable and safe to disable.

## 9. Open Risks

- iFinD/news remains a placeholder until licensed provider credentials and legal
  usage rules are confirmed.
- Eastmoney live availability is still environment-dependent by design.

## 10. Recommended Next Action

Accept `FT-FUND-EVENTS-LIVE-001`, then continue to
`FT-MARKET-CONTEXT-V2-001`.
