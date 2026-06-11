# Acceptance: PLAN-ALIGNMENT-AUDIT-001

**Mode:** run
**Generated:** 2026-06-11T00:41:45.3741784+08:00

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
rg -n "P0-|P1-|P2-|P3-|P4-|Status:|Validation:|Risk:|Decision:|Next:|blocked|decision_needed|needs_fix|passed|failed" docs\pm\reports docs\pm\reviews -S
rg -n "P0|P1|P2|P3|data_quality|NaN|Inf|511880|historical_calibrator|long_window|market-data/status|calibration.health" docs\0610\integrated-plan.md backend frontend scripts docs\pm\reports -S
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
?? .reasonix/desktop-topic-title-sources.json
?? .reasonix/desktop-topic-titles.json
?? backend/app/allocation/data/long_window_producer.py
?? backend/tests/test_long_window_producer.py
?? docs/0610/ds.md
?? docs/0610/evaluation_report.md
?? docs/0610/glm.md
?? docs/0610/gpt.md
?? docs/0610/integrated-plan.md
?? docs/0610/opus.md
?? docs/0610/qwen.md
?? docs/pm/outbox/P4-CMA-EQUILIBRIUM-V2.md
?? docs/pm/outbox/P4-ETF-CACHE-COVERAGE-AUDIT-001.md
?? docs/pm/outbox/P4-LONG-WINDOW-MANUAL-TRIGGER-V1.md
?? docs/pm/outbox/P4-LONG-WINDOW-PRODUCER-AUDIT-001.md
?? docs/pm/outbox/P4-LONG-WINDOW-PRODUCER-V1.md
?? docs/pm/outbox/P4-SCOPE-AUDIT-001.md
?? docs/pm/outbox/PLAN-ALIGNMENT-AUDIT-001.md
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
docs\pm\reviews\P2-CIRCUIT-DESTINATION-001.acceptance.md:1:# Acceptance: P2-CIRCUIT-DESTINATION-001
docs\pm\reviews\HF1-P3-CALIBRATION-AUDIT-001.acceptance.md:1:# Acceptance: HF1-P3-CALIBRATION-AUDIT-001
docs\pm\reviews\P1-REAL-IC-DECAY-001.acceptance.json:2:    "taskId":  "P1-REAL-IC-DECAY-001",
docs\pm\reviews\P1-REAL-IC-DECAY-001.acceptance.json:5:    "taskPath":  "docs\\pm\\outbox\\P1-REAL-IC-DECAY-001.md",
docs\pm\reviews\P1-REAL-IC-DECAY-001.acceptance.json:11:                    "passed":  0,
docs\pm\reviews\P1-REAL-IC-DECAY-001.acceptance.json:12:                    "failed":  0
docs\pm\reviews\P2-SCENARIO-DYNAMIC-001.acceptance.json:2:    "taskId":  "P2-SCENARIO-DYNAMIC-001",
docs\pm\reviews\P2-SCENARIO-DYNAMIC-001.acceptance.json:5:    "taskPath":  "docs\\pm\\outbox\\P2-SCENARIO-DYNAMIC-001.md",
docs\pm\reviews\P2-SCENARIO-DYNAMIC-001.acceptance.json:11:                    "passed":  0,
docs\pm\reviews\P2-SCENARIO-DYNAMIC-001.acceptance.json:12:                    "failed":  0
docs\pm\reports\P2-CIRCUIT-DESTINATION-001.md:1:# P2-CIRCUIT-DESTINATION-001 — Implementation Report
docs\pm\reports\P2-CIRCUIT-DESTINATION-001.md:48:20 passed in 0.21s
docs\pm\reports\P2-CIRCUIT-DESTINATION-001.md:55:22 passed in 1.62s
docs\pm\reports\P2-CIRCUIT-DESTINATION-001.md:62:199 passed in 127.33s (0:02:07)
docs\pm\reports\P3-CALIBRATION-AUDIT-001.md:1:# P3-CALIBRATION-AUDIT-001 — P3 Calibration Audit Implementation Report
docs\pm\reports\P3-CALIBRATION-AUDIT-001.md:4:**Executor:** Claude Code via cc-switch (completed via HF1-P3-CALIBRATION-AUDIT-001 hotfix)
docs\pm\reports\P3-CALIBRATION-AUDIT-001.md:13:The original task session was interrupted by a Claude gateway malformed-response failure. The implementation was completed in the hotfix follow-up session HF1-P3-CALIBRATION-AUDIT-001.
docs\pm\reports\P3-CALI...[truncated]
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.