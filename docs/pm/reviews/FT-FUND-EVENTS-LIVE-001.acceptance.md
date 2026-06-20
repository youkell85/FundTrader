# Acceptance: FT-FUND-EVENTS-LIVE-001

**Mode:** list
**Generated:** 2026-06-21T00:58:54.4588532+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 2 |
| Safe | 2 |
| Skipped (unsafe) | 0 |
| Unsupported | 0 |

## Blocks

### Block 1

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
cd D:\Workspace\Fundtrader\backend
$env:PYTHONPATH = (Get-Location).Path
python -m pytest tests\test_fund_events.py tests\test_fund_research_report.py -q
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

### Block 2

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.