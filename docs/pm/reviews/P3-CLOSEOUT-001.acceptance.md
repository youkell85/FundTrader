# Acceptance: P3-CLOSEOUT-001

**Mode:** list
**Generated:** 2026-06-10T22:51:03.5077988+08:00

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
- **Reason:** Contains unsafe pattern: deploy
- **Language:** powershell

```powershell
git rev-parse --short HEAD
git status --short --untracked-files=all
.\scripts\pm-brief.ps1 -TaskId P3-POST-DEPLOY-ACCEPT-001
.\scripts\pm-status.ps1
```

## Recommended Next Action

Review listed blocks. Use -Run to execute safe blocks.