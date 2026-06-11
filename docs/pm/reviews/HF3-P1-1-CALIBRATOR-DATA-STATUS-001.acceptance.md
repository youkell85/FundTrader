# Acceptance: HF3-P1-1-CALIBRATOR-DATA-STATUS-001

**Mode:** run
**Generated:** 2026-06-11T01:00:21.7650225+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 8 |
| Safe | 1 |
| Skipped (unsafe) | 0 |
| Unsupported | 0 |
| Passed | 1 |
| Failed | 0 |

## Blocks

### Block 1

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
Push-Location backend; python -m pytest tests/test_historical_calibrator.py tests/test_long_window_producer.py tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q; $testExit=$LASTEXITCODE; Pop-Location; if ($testExit -ne 0) { exit $testExit }
git diff --check -- backend\app\allocation\data\historical_calibrator.py backend\tests\test_historical_calibrator.py 2>$null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

- **Exit Code:** 0

```
........................................................................ [ 79%]
...................                                                      [100%]
91 passed in 1.82s
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.