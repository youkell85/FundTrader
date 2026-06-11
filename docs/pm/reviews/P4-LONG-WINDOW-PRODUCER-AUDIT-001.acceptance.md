# Acceptance: P4-LONG-WINDOW-PRODUCER-AUDIT-001

**Mode:** list
**Generated:** 2026-06-10T23:25:02.0244815+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 8 |
| Safe | 1 |
| Skipped (unsafe) | 0 |
| Unsupported | 0 |

## Blocks

### Block 1

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
rg -n "class ETFPriceCache|def save_batch|def get_range|load_etf_history|_fetch_etf_prices_with_dates|_calibrate_factors|_save_stats_to_db|long_window_stats" backend/app backend/tests docs/pm/reports
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.