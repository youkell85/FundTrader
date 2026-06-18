# Acceptance: FT-UX-V11-PROD-DEPLOY-SMOKE-001

**Mode:** run
**Generated:** 2026-06-18T13:09:22.7353722+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 1 |
| Safe | 0 |
| Skipped (unsafe) | 1 |
| Unsupported | 0 |
| Passed | 0 |
| Failed | 0 |

## Blocks

### Block 1

- **Classification:** skipped_unsafe
- **Reason:** Contains unsafe pattern: deploy
- **Language:** powershell

```powershell
cd "D:\Workspace\Fundtrader"
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
Test-Path "D:\Workspace\docs\ux-v11-deploy-runbook-20260617.md" | Out-Null
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.