# Acceptance: FT-P1-3

**Mode:** run
**Generated:** 2026-06-18T14:44:44.4030596+08:00

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
cd backend
$env:PYTHONPATH = (Get-Location).Path
pytest tests\test_fund_events.py tests\test_fund_research_report.py -q
```

- **Exit Code:** 0

```
.........                                                                [100%]
============================== warnings summary ===============================
tests/test_fund_events.py::test_collect_fund_events_normalizes_static_provider_events
tests/test_fund_events.py::test_collect_fund_events_downgrades_provider_failure
tests/test_fund_events.py::test_collect_fund_events_marks_disabled_provider
tests/test_fund_research_report.py::test_fund_research_report_markdown_is_deterministic_and_source_backed
tests/test_fund_research_report.py::test_fund_research_report_markdown_is_deterministic_and_source_backed
tests/test_fund_research_report.py::test_fund_evidence_pack_downgrades_when_critical_evidence_missing
  D:\Workspace\Fundtrader\backend\app\data\fund_events.py:94: DeprecationWarning: datetime.datetime.utcnow() is deprecated and scheduled for removal in a future version. Use timezone-aware objects to represent datetimes in UTC: datetime.datetime.now(datetime.UTC).
    clock = now or datetime.utcnow()

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
9 passed, 6 warnings in 3.87s
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.