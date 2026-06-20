# Acceptance: FT-DSA-PROD-BASELINE-001

**Mode:** list
**Generated:** 2026-06-21T00:40:59.2325364+08:00

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
cd D:\Workspace\Fundtrader
powershell -ExecutionPolicy Bypass -File .\scripts\refresh-market-context-cache.ps1 -Limit 10
powershell -ExecutionPolicy Bypass -File .\scripts\check-production-fund-dsa.ps1 -Code 000001
```

### Block 2

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
git diff --check -- scripts\check-production-fund-dsa.ps1 scripts\refresh-market-context-cache.ps1 scripts\refresh-market-context-cache.sh
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.