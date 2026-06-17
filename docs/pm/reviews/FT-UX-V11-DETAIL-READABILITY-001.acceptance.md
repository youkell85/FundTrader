# Acceptance: FT-UX-V11-DETAIL-READABILITY-001

**Mode:** list
**Generated:** 2026-06-16T15:52:53.4999726+08:00

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
cd frontend
npm.cmd run check
npm.cmd run build
```

### Block 2

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5177
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.