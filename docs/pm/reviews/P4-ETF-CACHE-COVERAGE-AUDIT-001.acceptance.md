# Acceptance: P4-ETF-CACHE-COVERAGE-AUDIT-001

**Mode:** run
**Generated:** 2026-06-11T00:12:15.3642266+08:00

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
.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json -AllowInsufficient
python -m py_compile backend\app\allocation\data\long_window_producer.py
git diff --check -- scripts\check-etf-cache-coverage.ps1 docs\pm\outbox\P4-ETF-CACHE-COVERAGE-AUDIT-001.md
```

- **Exit Code:** 0

```
{"assets": [{"asset": "a_share_large", "code": "510300", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "a_share_small", "code": "512100", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "a_share_value", "code": "515180", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "a_share_growth", "code": "159915", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "hk_equity", "code": "513050", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "us_equity", "code": "513500", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "rate_bond", "code": "511010", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "credit_bond", "code": "511030", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "convertible", "code": "511380", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "money_fund", "code": "511880", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "gold", "code": "518880", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "commodity", "code": "161815", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "reits", "code": "508000", "reason": "insufficient_cache_data:0", "status": "missing", "total_max_date": null, "total_min_date": null, "total_rows": 0, "window_max_date": null, "window_min_date": null, "window_rows": 0}, {"asset": "cash", "code": null, "reason": "no_representative_etf", "status": "synthesized"}], "available_count": 0, "coverage": 0.1429, "min_coverage": 0.7, "min_observations": 252, "missing_count": 12, "status": "insufficient", "synthesized_count": 2, "window_end": "2026-06-10", "window_start": "2023-06-11", "years": 3}
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.