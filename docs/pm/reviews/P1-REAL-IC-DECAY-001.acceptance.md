# Acceptance: P1-REAL-IC-DECAY-001

**Mode:** list
**Generated:** 2026-06-10T18:36:45.7613342+08:00

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
python -m pytest tests/test_ic_decay.py tests/test_market_data_service_ic_decay.py tests/test_taa_confidence_attenuation.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader
git diff --check
git status --short --untracked-files=all
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.