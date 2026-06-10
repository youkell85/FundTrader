# Acceptance: P3-AUDIT-POLICY-001

**Mode:** list
**Generated:** 2026-06-10T21:50:14.8168138+08:00

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
cd backend
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
python -m pytest -q
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.