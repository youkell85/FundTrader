# Acceptance: HF2-P1-1-ETF-CACHE-APPLY-001

**Mode:** run
**Generated:** 2026-06-11T00:57:06.9345900+08:00

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
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json
cd backend; python -m pytest tests/test_historical_calibrator.py tests/test_long_window_producer.py tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

- **Exit Code:** 0

```
c39c84b Close P3 PM workflow
e6d8c61 Complete P3 calibration audit workflow
b7349c0 Complete P1 P2 allocation calibration workflow
9cbd267 Smooth low-confidence TAA signals
e5adc16 Expose fund metadata provenance
c39c84b
 M AGENTS.md
 M CLAUDE.md
 M backend/app/allocation/data/historical_calibrator.py
 M backend/tests/test_historical_calibrator.py
?? .codegraph/.gitignore
?? .codegraph/daemon.pid
?? .mavis/plans/audit-plan.yaml
?? .mavis/plans/decision-c1.json
?? .reasonix/desktop-topic-created-at.json
?? .reasonix/desktop-topic-title-sources.json
?? .reasonix/desktop-topic-titles.json
?? backend/app/allocation/data/long_window_producer.py
?? backend/tests/test_etf_cache_population_script.py
?? backend/tests/test_long_window_producer.py
?? docs/0610/ds.md
?? docs/0610/evaluation_report.md
?? docs/0610/glm.md
?? docs/0610/gpt.md
?? docs/0610/integrated-plan.md
?? docs/0610/opus.md
?? docs/0610/qwen.md
?? docs/pm/outbox/HF1-P1-1-ETF-CACHE-POPULATION-001.md
?? docs/pm/outbox/HF2-P1-1-ETF-CACHE-APPLY-001.md
?? docs/pm/outbox/P4-CMA-EQUILIBRIUM-V2.md
?? docs/pm/outbox/P4-ETF-CACHE-COVERAGE-AUDIT-001.md
?? docs/pm/outbox/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.md
?? docs/pm/outbox/P4-LONG-WINDOW-PRODUCER-AUDIT-001.md
?? docs/pm/outbox/P4-LONG-WINDOW-PRODUCER-V1.md
?? docs/pm/outbox/P4-SCOPE-AUDIT-001.md
?? docs/pm/outbox/PLAN-ALIGNMENT-AUDIT-001.md
?? docs/pm/reviews/HF1-P1-1-ETF-CACHE-POPULATION-001.acceptance.json
?? docs/pm/reviews/HF1-P1-1-ETF-CACHE-POPULATION-001.acceptance.md
?? docs/pm/reviews/P4-CMA-EQUILIBRIUM-V2.acceptance.json
?? docs/pm/reviews/P4-CMA-EQUILIBRIUM-V2.acceptance.md
?? docs/pm/reviews/P4-ETF-CACHE-COVERAGE-AUDIT-001.acceptance.json
?? docs/pm/reviews/P4-ETF-CACHE-COVERAGE-AUDIT-001.acceptance.md
?? docs/pm/reviews/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.acceptance.json
?? docs/pm/reviews/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.acceptance.md
?? docs/pm/reviews/P4-LONG-WINDOW-PRODUCER-AUDIT-001.acceptance.json
?? docs/pm/reviews/P4-LONG-WINDOW-PRODUCER-AUDIT-001.acceptance.md
?? docs/pm/reviews/P4-LONG-WINDOW-PRODUCER-V1.acceptance.json
?? docs/pm/reviews/P4-LONG-WINDOW-PRODUCER-V1.acceptance.md
?? docs/pm/reviews/P4-SCOPE-AUDIT-001.acceptance.json
?? docs/pm/reviews/P4-SCOPE-AUDIT-001.acceptance.md
?? docs/pm/reviews/PLAN-ALIGNMENT-AUDIT-001.acceptance.json
?? docs/pm/reviews/PLAN-ALIGNMENT-AUDIT-001.acceptance.md
?? nul
?? scripts/build-long-window-stats.ps1
?? scripts/check-etf-cache-coverage.ps1
?? scripts/populate-etf-cache.ps1
{"assets": [{"asset": "a_share_large", "code": "510300", "reason": null, "status": "available", "total_max_date": "2026-06-10", "total_min_date": "2012-05-04", "total_rows": 3426, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "a_share_small", "code": "512100", "reason": null, "status": "available", "total_max_date": "2026-06-10", "total_min_date": "2016-09-29", "total_rows": 2344, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "a_share_value", "code": "515180", "reason": null, "status": "available", "total_max_date": "2026-06-10", "total_min_date": "2019-11-26", "total_rows": 1576, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "a_share_growth", "code": "159915", "reason": null, "status": "available", "total_max_date": "2026-06-10", "total_min_date": "2011-09-20", "total_rows": 3551, "window_max_date": "2026-06-10", "window_min_date": "2023-06-12", "window_rows": 727}, {"asset": "hk_equity", "code": "513050", "reason": null, "status": "available", "total_max_date": "2026-06-09", "total_min_date": "2017-01-04", "total_rows": 2258, "window_max_date": "2026-06-09", "window_min_date": "2023-06-12", "window_rows": 726}, {"asset": "us_equity", "code": "513500", "reason": null, "status": "available", "total_max_date": "2026-06-09", "total_min_date": "2013-12-05", "total_rows": 2943, "window_max_date": "20...[truncated]
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.