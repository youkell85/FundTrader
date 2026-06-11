# Acceptance: HF1-P1-1-ETF-CACHE-POPULATION-001

**Mode:** run
**Generated:** 2026-06-11T00:50:42.4851097+08:00

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
.................                                                        [100%]
17 passed in 0.32s
{"after": [{"asset": "a_share_large", "code": "510300", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "a_share_small", "code": "512100", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "a_share_value", "code": "515180", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "a_share_growth", "code": "159915", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "hk_equity", "code": "513050", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "us_equity", "code": "513500", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "rate_bond", "code": "511010", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "credit_bond", "code": "511030", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "convertible", "code": "511380", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "money_fund", "code": "511880", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "gold", "code": "518880", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "commodity", "code": "161815", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "reits", "code": "508000", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}], "apply_result": null, "before": [{"asset": "a_share_large", "code": "510300", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "a_share_small", "code": "512100", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "a_share_value", "code": "515180", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "a_share_growth", "code": "159915", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "hk_equity", "code": "513050", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "us_equity", "code": "513500", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "rate_bond", "code": "511010", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "credit_bond", "code": "511030", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "convertible", "code": "511380", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_da...[truncated]
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.