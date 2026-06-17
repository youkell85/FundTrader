# Acceptance: FT-UX-V11-FUND-BASEPATH-ROUTE-001

**Mode:** run
**Generated:** 2026-06-17T04:19:59.5345853+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 8 |
| Safe | 1 |
| Skipped (unsafe) | 0 |
| Unsupported | 0 |
| Passed | 0 |
| Failed | 1 |

## Blocks

### Block 1

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
cd frontend
npm.cmd run check
npm.cmd run build
cd ..
```

- **Exit Code:** -1

## Recommended Next Action

One or more safe blocks failed. Review output and fix issues.