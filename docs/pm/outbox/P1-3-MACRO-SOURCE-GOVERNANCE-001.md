# P1-3-MACRO-SOURCE-GOVERNANCE-001 — Macro Data Source Governance

## PM Digest

```
Status: complete
Changed: backend/app/allocation/data/macro_fetcher.py, backend/tests/test_macro_fetcher.py
Validation: passed - macro-fetcher-tests, allocation-contract-tests, dxy-source-label
Risk: none - small source label fix + new test
Decision: none
Next: accept
```

## Task

Implement P1-3 of integrated-plan.md: macro data must have explicit `source/confidence/fetch_time`, static fallback must be low-confidence, DXY must not use misleading `forex_api` label.

## Changes

1. `backend/app/allocation/data/macro_fetcher.py`:
   - DXY source changed from `forex_api` to `derived_fx_formula` (line ~95).
   - Pre-existing governance already covers: fiscal deficit 3-source chain (akshare→official_target→static with confidence 0.85/0.75/0.3), DR007 3-source chain (FR007→Shibor→LPR with tracked `_dr007_actual_source`), all indicators have `source/confidence/fetch_time`.

2. `backend/tests/test_macro_fetcher.py`:
   - New test: `test_fetch_all_labels_dxy_source_as_derived_formula` — verifies DXY source is `derived_fx_formula` and confidence is 0.7.

## Acceptance Criteria Check

| Criterion | Status |
|---|---|
| Each macro indicator has `source` | done — all 13 indicators set source |
| Each macro indicator has `confidence` | done — dynamic per source chain |
| Each macro indicator has `fetch_time` | done — `datetime.now().isoformat()` |
| Fiscal deficit: value 3.0 does not imply source | done — `_fetch_fiscal_deficit_with_source()` returns explicit source tuple |
| Fiscal deficit: static fallback confidence ≤ 0.3 | done — confidence=0.3 when source=static |
| DXY: derived from FX formula, not direct DXY | done — source=`derived_fx_formula`, confidence=0.7 |
| DXY: USD base direction correct | done — test verifies formula with correct exponents |
| DR007: fallback chain with tracked source | done — FR007→Shibor→LPR, `_dr007_actual_source` tracked |
| Static fallback not in strong signal scoring | done — low confidence (0.3-0.5) propagated to TAA |

## Test Results

```
6 passed in test_macro_fetcher.py
13 passed in allocation/contract/data-quality/ic-decay tests
```

## Scope / Safety

- Only 2 files modified: `macro_fetcher.py` (1 line source label) and `test_macro_fetcher.py` (1 new test).
- No API contract changes. No frontend changes.
- No git operations. No database writes. No network calls.

## Recommended Next Action

Accept P1-3. Continue to `P1-5-FUND-METADATA-REFRESH-001`.
