# Acceptance: FT-P0-5

**Mode:** run
**Generated:** 2026-06-18T14:16:28.2450379+08:00

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
cd D:\Workspace\Fundtrader
python -m pytest backend\tests -q
cd frontend
npm.cmd run check
npm.cmd run build
```

- **Exit Code:** 0

```

=================================== ERRORS ====================================
_______ ERROR collecting backend/tests/test_allocation_api_contract.py ________
ImportError while importing test module 'D:\Workspace\Fundtrader\backend\tests\test_allocation_api_contract.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
C:\Users\youke\AppData\Local\Programs\Python\Python314\Lib\importlib\__init__.py:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
backend\tests\test_allocation_api_contract.py:7: in <module>
    from app.api import allocation as allocation_api
E   ModuleNotFoundError: No module named 'app'
_______ ERROR collecting backend/tests/test_allocation_data_quality.py ________
ImportError while importing test module 'D:\Workspace\Fundtrader\backend\tests\test_allocation_data_quality.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
C:\Users\youke\AppData\Local\Programs\Python\Python314\Lib\importlib\__init__.py:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
backend\tests\test_allocation_data_quality.py:6: in <module>
    from app.allocation.data import market_data_fetcher
E   ModuleNotFoundError: No module named 'app'
________ ERROR collecting backend/tests/test_allocation_monte_carlo.py ________
ImportError while importing test module 'D:\Workspace\Fundtrader\backend\tests\test_allocation_monte_carlo.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
C:\Users\youke\AppData\Local\Programs\Python\Python314\Lib\importlib\__init__.py:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
backend\tests\test_allocation_monte_carlo.py:6: in <module>
    from app.allocation.config import ASSET_CLASSES, N_ASSETS
E   ModuleNotFoundError: No module named 'app'
____ ERROR collecting backend/tests/test_backtest_historical_data_cache.py ____
ImportError while importing test module 'D:\Workspace\Fundtrader\backend\tests\test_backtest_historical_data_cache.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
C:\Users\youke\AppData\Local\Programs\Python\Python314\Lib\importlib\__init__.py:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
backend\tests\test_backtest_historical_data_cache.py:3: in <module>
    from app.allocation.backtest import historical_data as h
E   ModuleNotFoundError: No module named 'app'
___________ ERROR collecting backend/tests/test_backtest_metrics.py ___________
ImportError while importing test module 'D:\Workspace\Fundtrader\backend\tests\test_backtest_metrics.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
C:\Users\youke\AppData\Local\Programs\Python\Python314\Lib\importlib\__init__.py:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
backend\tests\test_backtest_metrics.py:6: in <module>
    from app.allocation.backtest.metrics import compute_metrics
E   ModuleNotFoundError: No module named 'app'
__________ ERROR collecting backend/tests/test_calibration_audit.py ___________
ImportError while importing test module 'D:\Workspace\Fundtrader\backend\tests\test_calibration_audit.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
C:\Users\youke\AppData\Local\Programs\Python\Python314\Lib\importlib\__init__.py:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
backend\tests\test_c...[truncated]
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.