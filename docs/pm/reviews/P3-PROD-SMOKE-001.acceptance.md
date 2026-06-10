# Acceptance: P3-PROD-SMOKE-001

**Mode:** list
**Generated:** 2026-06-10T21:30:03.0456909+08:00

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
.\scripts\check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api -SkipGenerate

# Run generate if the endpoint is reachable and does not require unavailable auth in this environment.
.\scripts\check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api

cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.