# Acceptance: P4-LONG-WINDOW-MANUAL-TRIGGER-V1

**Mode:** list
**Generated:** 2026-06-10T23:59:26.7063947+08:00

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
python -m py_compile backend\app\allocation\data\long_window_producer.py
.\scripts\build-long-window-stats.ps1 -AsOfDate 2026-06-10 -Json
cd backend; python -m pytest tests/test_long_window_producer.py tests/test_historical_calibrator.py -q
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.