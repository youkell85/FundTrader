# Acceptance: FT-UX-V11-MACRO-NORTHFLOW-COVERAGE-001

**Mode:** list
**Generated:** 2026-06-16T17:17:19.6759694+08:00

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
python -m py_compile app/data/market_context_fetcher.py
python -m pytest tests/test_fund_research_report.py -q
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.