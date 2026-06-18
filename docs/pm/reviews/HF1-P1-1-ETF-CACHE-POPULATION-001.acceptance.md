# Acceptance: HF1-P1-1-ETF-CACHE-POPULATION-001

**Mode:** run
**Generated:** 2026-06-18T12:13:24.1240203+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 8 |
| Safe | 1 |
| Skipped (unsafe) | 0 |
| Unsupported | 0 |
| Passed | 1 |
| Failed | 0 |

## Blocks

### Block 1

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
python -m py_compile backend\app\allocation\data\long_window_producer.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Push-Location backend; python -m pytest tests/test_etf_cache_population_script.py tests/test_long_window_producer.py -q; $testExit=$LASTEXITCODE; Pop-Location; if ($testExit -ne 0) { exit $testExit }
.\scripts\populate-etf-cache.ps1 -StartDate 2023-06-11 -EndDate 2026-06-10 -Json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git diff --check -- scripts\populate-etf-cache.ps1 backend\tests\test_etf_cache_population_script.py docs\pm\outbox\HF1-P1-1-ETF-CACHE-POPULATION-001.md
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

- **Exit Code:** 0

```
...........                                                              [100%]
11 passed in 0.29s
{"after": [{"asset": "a_share_large", "code": "510300", "total_max_date": "2026-06-17", "total_min_date": "2012-05-04", "total_rows": 3431, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "a_share_small", "code": "512100", "total_max_date": "2026-06-17", "total_min_date": "2016-09-29", "total_rows": 2349, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "a_share_value", "code": "515180", "total_max_date": "2026-06-17", "total_min_date": "2019-11-26", "total_rows": 1581, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "a_share_growth", "code": "159915", "total_max_date": "2026-06-17", "total_min_date": "2011-09-20", "total_rows": 3556, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "hk_equity", "code": "513050", "total_max_date": "2026-06-16", "total_min_date": "2017-01-04", "total_rows": 2263, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "us_equity", "code": "513500", "total_max_date": "2026-06-16", "total_min_date": "2013-12-05", "total_rows": 2948, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "rate_bond", "code": "511010", "total_max_date": "2026-06-17", "total_min_date": "2013-03-05", "total_rows": 3228, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "credit_bond", "code": "511030", "total_max_date": "2026-06-17", "total_min_date": "2018-12-27", "total_rows": 1814, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "convertible", "code": "511380", "total_max_date": "2026-06-17", "total_min_date": "2020-03-06", "total_rows": 1511, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "money_fund", "code": "511880", "total_max_date": "2026-06-17", "total_min_date": "2013-04-01", "total_rows": 3213, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "gold", "code": "518880", "total_max_date": "2026-06-17", "total_min_date": "2013-07-18", "total_rows": 3145, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "commodity", "code": "161815", "total_max_date": "2026-06-16", "total_min_date": "2010-12-06", "total_rows": 3600, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 683}, {"asset": "reits", "code": "508088", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}], "apply_result": null, "before": [{"asset": "a_share_large", "code": "510300", "total_max_date": "2026-06-17", "total_min_date": "2012-05-04", "total_rows": 3431, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "a_share_small", "code": "512100", "total_max_date": "2026-06-17", "total_min_date": "2016-09-29", "total_rows": 2349, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "a_share_value", "code": "515180", "total_max_date": "2026-06-17", "total_min_date": "2019-11-26", "total_rows": 1581, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "a_share_growth", "code": "159915", "total_max_date": "2026-06-17", "total_min_date": "2011-09-20", "total_rows": 3556, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "hk_equity", "code": "513050", "total_max_date": "2026-06-16", "total_min_date": "2017-01-04", "total_rows": 2263, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "us_equity", "code": "513500", "tot...[truncated]
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.