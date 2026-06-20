# FT-MARKET-CONTEXT-V2-001 - Market Context V2 And Holdings Flow Match

Created: 2026-06-21
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Deepen FundTrader's market context from separate provider snippets into a
decision-oriented fund context layer. It should compare a fund's holdings style
with current northbound, market, industry, or concept flow signals and report
confidence, source, and missing reasons.

The user-facing outcome is a Market Context tab that explains whether current
market flow supports, conflicts with, or is unavailable for the fund's holdings
profile.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - `market_context_fetcher.py` already supports a refreshable cache path for
    northbound flow, market fund flow, and industry fund flow.
  - Production-specific prior work says industry aggregation should read
    `fund_holdings_snapshot` first and only fall back to
    `fund_portfolio_snapshot` for compatibility.
  - Eastmoney market-flow and sector-flow provider availability is environment
    dependent; explicit `partial` context is acceptable.
  - This task should borrow adata/qstock-style flow concepts without making
    unstable external sources critical path.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/data/market_context_fetcher.py`
- `backend/app/services/fund_service.py` only for holdings/industry helpers
- `backend/app/reports/fund_research_report.py`
- `backend/app/api/fund.py`
- `backend/tests/test_fund_research_report.py`
- `backend/tests/test_market_context_fetcher.py`
- `scripts/refresh-market-context-cache.ps1`
- `scripts/refresh-market-context-cache.sh`
- `scripts/check-production-fund-dsa.ps1`
- `frontend/api/fund-router.ts`
- `frontend/src/pages/FundDetail/useFundDetailData.ts`
- `frontend/src/pages/FundDetail/tabs/MarketContextTab.tsx`
- `frontend/src/pages/FundDetail/components/*`
- `frontend/src/components/fund-detail/DetailStatusPanels.tsx`
- `docs/pm/reports/FT-MARKET-CONTEXT-V2-001.md`
- `docs/pm/reviews/FT-MARKET-CONTEXT-V2-001.review.md`
- `docs/pm/reviews/FT-MARKET-CONTEXT-V2-001.review.json`
- `docs/pm/reviews/FT-MARKET-CONTEXT-V2-001.acceptance.md`
- `docs/pm/reviews/FT-MARKET-CONTEXT-V2-001.acceptance.json`

Files or areas the coding agent must not edit:

- Allocation optimizer logic
- General provider credentials or `.env` files
- Database schema unless PM approves a separate migration task
- Unrelated dashboard or home-page UI
- Deployment files
- Git history, branches, tags, or remotes

## Allowed Files

- `backend/app/data/market_context_fetcher.py`
- `backend/app/services/fund_service.py`
- `backend/app/reports/fund_research_report.py`
- `backend/app/api/fund.py`
- `backend/tests/test_fund_research_report.py`
- `backend/tests/test_market_context_fetcher.py`
- `scripts/refresh-market-context-cache.ps1`
- `scripts/refresh-market-context-cache.sh`
- `scripts/check-production-fund-dsa.ps1`
- `frontend/api/fund-router.ts`
- `frontend/src/pages/FundDetail/useFundDetailData.ts`
- `frontend/src/pages/FundDetail/tabs/MarketContextTab.tsx`
- `frontend/src/pages/FundDetail/components/*`
- `frontend/src/components/fund-detail/DetailStatusPanels.tsx`
- `docs/pm/reports/FT-MARKET-CONTEXT-V2-001.md`
- `docs/pm/reviews/FT-MARKET-CONTEXT-V2-001.review.md`
- `docs/pm/reviews/FT-MARKET-CONTEXT-V2-001.review.json`
- `docs/pm/reviews/FT-MARKET-CONTEXT-V2-001.acceptance.md`
- `docs/pm/reviews/FT-MARKET-CONTEXT-V2-001.acceptance.json`

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
npx gitnexus impact get_fund_market_context --repo FundTrader --direction upstream
npx gitnexus impact build_fund_evidence_pack --repo FundTrader --direction upstream
npx gitnexus impact MarketContextPanel --repo FundTrader --direction upstream
```

If any result is HIGH or CRITICAL, stop and report the blast radius before
editing.

## Implementation Tasks

1. Inspect current market context shape and consumers.
2. Add or extend a holdings-flow match section with:
   - holdings industry exposure
   - matched flow rows
   - unsupported / unavailable flow rows
   - match score
   - signal direction: `supportive`, `conflicting`, `neutral`, or `unknown`
   - source/asOf/coverage/missingReason
3. Preserve existing sections:
   - `northFlow`
   - `marketFlow`
   - `industryFlow`
   - `holdingsStyle`
4. Use `fund_holdings_snapshot` as the primary production holdings table and
   `fund_portfolio_snapshot` only as compatibility fallback.
5. Update the research report to cite market context v2 only when evidence is
   available; otherwise include a limitation.
6. Update Market Context frontend tab:
   - compact summary row
   - flow support/conflict badge
   - top matched industries
   - data quality and missing reason area
7. Update refresh and production smoke scripts if endpoint checks need the new
   section.
8. Add focused tests for available, partial, and missing flow contexts.
9. Write the final implementation report.

## Contracts And Design Decisions

- Do not make market flow a hard dependency for fund detail or reports.
- If flow provider data is unavailable, return structured `partial/missing`.
- Do not synthesize market-flow values.
- Existing `market-context` endpoint must remain compatible.
- Research report conclusion strength must downgrade when market context is
  missing or partial.

## Frontend Design Rules

- Market Context tab should be scannable and operational, not decorative.
- Use concise rows and status badges.
- Show source and as-of date near each market signal.
- Keep missing reasons visible without requiring hover.
- Do not overlap text on mobile.

## Validation

Run:

```powershell
cd D:\Workspace\Fundtrader\backend
$env:PYTHONPATH = (Get-Location).Path
python -m pytest tests\test_market_context_fetcher.py tests\test_fund_research_report.py -q
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

If script edits were made:

```powershell
git diff --check -- scripts\refresh-market-context-cache.ps1 scripts\refresh-market-context-cache.sh scripts\check-production-fund-dsa.ps1
```

Before any commit, run:

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

Expected result:

- Tests cover supportive, conflicting/neutral, and missing market context states.
- Frontend check and build pass.
- Production smoke script still targets `/fund/api/fund/000001/market-context`.

## Stop Conditions

Stop and write a report instead of guessing when:

- Holdings table assumptions differ between local and production.
- Market context requires new provider credentials.
- A database schema change is required.
- Existing endpoint response shape would need a breaking change.
- Validation fails for unrelated repo state.

## Final Report Required

Write `docs/pm/reports/FT-MARKET-CONTEXT-V2-001.md` with:

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
3. Market context v2 response summary
4. Files changed
5. Frontend states implemented
6. Validation commands and results
7. GitNexus impact / detect-changes summary
8. Scope / safety
9. Open risks
10. Recommended next action
