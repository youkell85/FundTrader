# Acceptance: P4-LONG-WINDOW-PRODUCER-V1

**Mode:** list
**Generated:** 2026-06-10T23:30:48.5316978+08:00

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
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
cd backend; python -m py_compile app/allocation/data/long_window_producer.py tests/test_long_window_producer.py
cd backend; python -m pytest tests/test_long_window_producer.py -q
cd backend; python -m pytest tests/test_historical_calibrator.py -q
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.