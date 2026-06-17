# Acceptance: FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001

**Mode:** list
**Generated:** 2026-06-16T16:39:36.9896315+08:00

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
cd backend
python -m py_compile app/api/allocation.py
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.