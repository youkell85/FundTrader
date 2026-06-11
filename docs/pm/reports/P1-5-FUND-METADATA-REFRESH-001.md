# P1-5-FUND-METADATA-REFRESH-001 Report

## PM Digest

```
Status: complete
Changed: fund_pool_refresher.py (new), fund_scorer.py, fund_mapper.py, test_fund_pool_refresher.py (new)
Validation: passed - 10 refresher tests + 359 total
Risk: none
Decision: none
Next: accept
```

## Summary

P1-5 fund metadata refresh is complete. New `fund_pool_refresher.py` module provides live metadata refresh from efinance/Tushare/SQLite with stale tracking. Scorer now penalizes stale and missing metadata funds. Mapper refreshes pool before ranking.

## xreview Audit Results (2026-06-12)

DeepSeek cross-audit found and we fixed:

### P0 (Fixed) - Stale state machine unreachable
- **Problem**: When all data sources fail and `metadata_as_of` is None, `_compute_stale_days(None)` returns None, so stale condition never triggers. Stale/missing penalties in scorer were dead code.
- **Fix**: Added `missing` status for never-refreshed funds (metadata_as_of=None), `assumption` status for within-grace-period, and `stale` for beyond threshold. Now the full state machine works: real -> assumption -> stale -> missing.

### P1 (Fixed) - tracking_error not refreshed
- **Problem**: `_update_profile` did not accept `tracking_error` from updates, so dynamic data could never override the hardcoded value.
- **Fix**: Extended `_update_profile` to accept `tracking_error` from updates dict.

### P2 (Fixed) - Unused _cache_lock
- **Problem**: `_cache_lock = threading.Lock()` defined but never used.
- **Fix**: Removed unused lock and threading import.

### P3 (Noted) - daily_turnover not available from efinance
- efinance API does not provide a direct column for daily turnover. Added TODO comment. This is a known limitation, not a blocking issue.

## Test Results

10 passed in test_fund_pool_refresher.py. 359 passed across all backend tests.

## Recommended Next Action

Accept. All xreview findings addressed.
