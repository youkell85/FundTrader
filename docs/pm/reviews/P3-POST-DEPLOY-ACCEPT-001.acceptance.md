# Acceptance: P3-POST-DEPLOY-ACCEPT-001

**Mode:** list
**Generated:** 2026-06-10T22:44:02.5651776+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 8 |
| Safe | 0 |
| Skipped (unsafe) | 1 |
| Unsupported | 0 |

## Blocks

### Block 1

- **Classification:** skipped_unsafe
- **Reason:** Contains unsafe pattern: systemctl
- **Language:** powershell

```powershell
git rev-parse --short HEAD
git status --short --untracked-files=all
ssh -o StrictHostKeyChecking=no -i C:\Users\youke\.ssh\id_ed25519_nopass -p 22222 root@43.160.226.62 "cd /opt/fundtrader && git rev-parse --short HEAD && systemctl is-active fundtrader && systemctl is-active fundtrader-frontend"
curl.exe -s http://43.160.226.62/fund/api/health
curl.exe -o NUL -s -w "%{http_code}" http://43.160.226.62/fund/
.\scripts\check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api
powershell -NoProfile -Command "$r = Invoke-RestMethod -Uri 'http://43.160.226.62/fund/api/allocation/pipeline-health' -TimeoutSec 30; $p = $r.calibration.policy; $required = @('return_drift_threshold','vol_drift_threshold','jump_probability_min','jump_probability_max','coverage_threshold','policy_source'); $missing = @($required | Where-Object { -not $p.PSObject.Properties[$_] }); [pscustomobject]@{ calibration_health=$r.calibration.health; policy_source=$p.policy_source; missing_policy_keys=($missing -join ',') } | ConvertTo-Json -Compress; if ($missing.Count -gt 0) { exit 1 }"
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.