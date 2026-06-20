## PM Digest

Status: complete
Changed: backend/app/data/market_context_fetcher.py, backend/tests/test_fund_research_report.py, frontend/src/components/fund-detail/DetailStatusPanels.tsx, docs/pm/reports/FT-MARKET-CONTEXT-V2-001.md
Validation: passed - pytest test_fund_research_report.py; npm run check; npm run build; gitnexus detect-changes; git diff --check
Risk: high detect-changes cumulative impact, market-context impact precheck was low and edits stayed in approved surfaces
Decision: none
Next: accept

# FT-MARKET-CONTEXT-V2-001 Report

## 1. Status

Complete. Market context now includes an additive holdings-flow match section
that compares holdings industry exposure with cached industry flow rows and
reports direction, match score, source, as-of, and missing reasons.

## 2. Summary

- Added `sections.holdingsFlowMatch`.
- Preserved existing `northFlow`, `sectorFlow`, and `holdingsStyle` sections.
- Reused existing `fund_holdings_snapshot`-first industry exposure logic.
- Calculated `signalDirection`: `supportive`, `conflicting`, `neutral`, or
  `unknown`.
- Added match score, matched rows, unsupported rows, and weighted flow metadata.
- Updated Market Context UI to show the new section, signal direction, match
  score, and matched industry trends.

## 3. Market Context V2 Response Summary

`holdingsFlowMatch` is additive and follows the same section contract:

```json
{
  "status": "available | partial | missing",
  "dataStatus": "available | partial | missing",
  "source": "macro_history:sector_flow",
  "asOf": "YYYY-MM-DD",
  "coverage": 0.0,
  "missingReason": null,
  "data": {
    "holdingsIndustryExposure": [],
    "matchedFlowRows": [],
    "unsupportedRows": [],
    "matchScore": 0.0,
    "signalDirection": "supportive | conflicting | neutral | unknown",
    "weightedFlow": 0.0
  }
}
```

## 4. Files Changed

- `backend/app/data/market_context_fetcher.py`
- `backend/tests/test_fund_research_report.py`
- `frontend/src/components/fund-detail/DetailStatusPanels.tsx`
- `docs/pm/reports/FT-MARKET-CONTEXT-V2-001.md`

## 5. Frontend States Implemented

- Market Context panel includes `Holdings-flow match`.
- Displays source/date, signal direction, match score, and matched industry
  trend chips.
- Missing or unavailable flow data keeps visible missing reasons.

## 6. Validation Commands And Results

```powershell
npx gitnexus impact get_fund_market_context --repo FundTrader --direction upstream
npx gitnexus impact build_fund_evidence_pack --repo FundTrader --direction upstream
npx gitnexus impact MarketContextPanel --repo FundTrader --direction upstream
```

Result: all LOW.

```powershell
$env:PYTHONPATH=(Resolve-Path .\backend).Path
python -m pytest backend\tests\test_fund_research_report.py -q
```

Result: passed, `15 passed`.

```powershell
cd frontend
npm.cmd run check
npm.cmd run build
```

Result: passed. TypeScript check and production build completed.

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

Result: HIGH cumulative risk across 11 files / 91 symbols and 8 DiagnosisTab
flows.

```powershell
git diff --check -- backend\app\data\market_context_fetcher.py backend\tests\test_fund_research_report.py frontend\src\components\fund-detail\DetailStatusPanels.tsx
```

Result: passed. Git emitted CRLF working-copy warnings only.

## 7. GitNexus Impact / Detect-Changes Summary

- Pre-edit market-context targets were LOW.
- Post-edit HIGH is cumulative across all five accepted task implementations,
  not isolated to this market-context section.

## 8. Scope / Safety

- No provider credentials, database schema, allocation optimizer, or deployment
  files were edited.
- Existing market-context endpoint shape remains backward-compatible.
- No synthetic flow values are created; missing flow data returns structured
  `partial` or `missing`.

## 9. Open Risks

- Flow quality depends on cached sector flow freshness.
- Browser visual QA is still recommended before production deployment.

## 10. Recommended Next Action

Accept `FT-MARKET-CONTEXT-V2-001`, then run full final validation and proceed
to commit/push/deploy.
