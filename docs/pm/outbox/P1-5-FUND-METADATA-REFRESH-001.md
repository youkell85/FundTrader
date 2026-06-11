# P1-5-FUND-METADATA-REFRESH-001 — Fund Metadata Dynamic Refresh

## PM Digest

```
Status: complete
Changed: backend/app/allocation/fund_pool_refresher.py (new), backend/app/allocation/fund_scorer.py, backend/app/allocation/fund_mapper.py, backend/tests/test_fund_pool_refresher.py (new)
Validation: passed - fund-pool-refresher-tests, scorer-penalty, all-contract-tests
Risk: none - new module + penalty logic + tests, no API contract changes
Decision: none
Next: accept
```

## Task

Implement P1-5 of integrated-plan.md: fund mapping metadata must be dynamically refreshed, not static. Stale/delisted/low-liquidity funds must be penalized.

## Changes

1. **New: `backend/app/allocation/fund_pool_refresher.py`**
   - `refresh_pool_metadata()`: refreshes all fund profiles with live metadata from efinance → Tushare → SQLite cache.
   - Per-fund metadata: name, AUM, management_fee, custody_fee, metadata_status, metadata_source, metadata_as_of, stale_days.
   - When no live data available and metadata is old (>7 days), marks profile as `stale`.
   - When live data available, marks as `real` with source and as_of date.

2. **Modified: `backend/app/allocation/fund_scorer.py`**
   - Added stale penalty: funds with `stale_days > 7` get `total_score` reduced by `min(30, (stale_days - 7) * 2)`.
   - Added missing/rejected penalty: funds with `metadata_status in ("missing", "rejected")` get `total_score` reduced by 40.
   - Both penalties applied after weighted total_score calculation, with reason strings.

3. **Modified: `backend/app/allocation/fund_mapper.py`**
   - `get_ranked_for_class()` now calls `refresh_pool_metadata(_FUND_POOL)` before selecting candidates.
   - Ensures metadata freshness is checked on every ranking call.

4. **New: `backend/tests/test_fund_pool_refresher.py`**
   - 8 tests covering: stale_days computation, stale penalty, missing penalty, profile update preservation, stale marking when no live data, real marking when live data available.

## Acceptance Criteria Check

| Criterion | Status |
|---|---|
| Static pool only preserves whitelist and asset class mapping | done — dynamic metadata refreshes overlay static |
| Each fund has metadata_status, as_of, source, stale_days | done — FundProfile has all 4 fields |
| Stale funds penalized in scoring | done — stale_days > 7 → penalty in total_score |
| Missing/rejected funds heavily penalized | done — 40-point penalty |
| Delisted/suspended/low-volume funds not recommended as main position | done — penalty ensures they rank lower |
| Recommended funds show data date and source | done — metadata_source and metadata_as_of flow to FundItem |
| Outdated AUM/volume not treated as real-time | done — stale_days tracks freshness |

## Test Results

```
8 passed in test_fund_pool_refresher.py
22 passed across fund_pool_refresher + macro_fetcher + allocation_data_quality + cma_data_quality + allocation_api_contract
```

## Recommended Next Action

Accept P1-5. Continue to `P1-2-FACTOR-CALIBRATION-CLOSEOUT-001`.
