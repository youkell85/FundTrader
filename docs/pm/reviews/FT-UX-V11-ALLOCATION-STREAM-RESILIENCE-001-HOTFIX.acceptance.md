# Acceptance: FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001-HOTFIX

**Mode:** list
**Generated:** 2026-06-16T16:39:37.0076312+08:00

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
cd frontend
npm.cmd run check
npm.cmd run build
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.