# Acceptance: P2-RISK-QUESTIONNAIRE-001

**Mode:** list
**Generated:** 2026-06-10T20:00:37.8391415+08:00

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
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_risk_profiler_questionnaire.py tests/test_allocation_api_contract.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.