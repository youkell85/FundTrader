# Acceptance: P2-REGIME-THRESHOLDS-001

**Mode:** list
**Generated:** 2026-06-10T19:10:49.9605220+08:00

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
python -m pytest tests/test_regime_thresholds.py tests/test_allocation_api_contract.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader
git diff --check
git status --short --untracked-files=all
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.