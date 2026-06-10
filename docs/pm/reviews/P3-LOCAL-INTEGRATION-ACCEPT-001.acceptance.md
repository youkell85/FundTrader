# Acceptance: P3-LOCAL-INTEGRATION-ACCEPT-001

**Mode:** list
**Generated:** 2026-06-10T22:33:30.2524827+08:00

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
git rev-parse --short HEAD
git status --short --untracked-files=all
cd backend
python -m pytest tests/test_calibration_audit.py::PipelineHealthIncludesCalibrationTest -q
python -c "from app.allocation.orchestrator import get_pipeline_health; r=get_pipeline_health(); c=r.get('calibration') or {}; p=c.get('policy') or {}; required=['return_drift_threshold','vol_drift_threshold','jump_probability_min','jump_probability_max','coverage_threshold','policy_source']; missing=[k for k in required if k not in p]; print({'health': c.get('health'), 'policy_source': p.get('policy_source'), 'missing_policy_keys': missing}); raise SystemExit(1 if missing else 0)"
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.