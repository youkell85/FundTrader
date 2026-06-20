# Acceptance: FT-MARKET-CONTEXT-V2-001

**Mode:** list
**Generated:** 2026-06-21T01:02:54.2227597+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 3 |
| Safe | 3 |
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
python -m pytest tests\test_market_context_fetcher.py tests\test_fund_research_report.py -q
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

### Block 2

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
git diff --check -- scripts\refresh-market-context-cache.ps1 scripts\refresh-market-context-cache.sh scripts\check-production-fund-dsa.ps1
```

### Block 3

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
npx gitnexus detect-changes --repo FundTrader --scope all
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.