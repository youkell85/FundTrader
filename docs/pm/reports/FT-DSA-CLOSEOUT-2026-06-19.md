# FT DSA Closeout - 2026-06-19

## PM Digest

- Status: implemented locally, pending commit/push/deploy acceptance
- Scope: six DSA/GPT follow-up recommendations for FundTrader
- Execution mode: Codex implementation in the main repo
- Representative fund: `000001`

## What Changed

1. PM closeout and status tracking were refreshed so the DSA/GPT track is no longer described only as the initial handoff.
2. Bond holdings now receive backend enrichment for inferred `bondType`, inferred government/policy-bank `issuer`, and estimated `marketValue` when real total scale and NAV ratio are available.
3. Market context now has a refreshable cache path for northbound flow, market fund flow, and industry fund flow, with explicit partial/warning states when providers fail.
4. Fund detail operations coverage now exposes a clearer next action and keeps provider/problem-field visibility available in the status panel.
5. Research reports now include bond-holding evidence and a stronger conclusion that calls out market-context and bond-evidence quality.
6. CI and production smoke coverage now include the DSA endpoints, report exports, detail provenance, and cache refresh tooling.

## Validation

Local validation passed on 2026-06-19:

```powershell
cd backend
$env:PYTHONPATH=(Resolve-Path .).Path
python -m pytest -q
# 439 passed, 4 warnings
```

```powershell
cd frontend
npm.cmd run check
npm.cmd test
npm.cmd run build
# TypeScript passed; 12 files / 186 tests passed; production build passed
```

```powershell
bash -n scripts/refresh-market-context-cache.sh
# shell syntax passed
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\refresh-market-context-cache.ps1 -Limit 10
# saved: 北向资金净流入
# warnings: market flow and sector flow provider refresh failed in the local proxy/network environment
```

## Residual Risks

- Eastmoney market-flow and sector-flow provider availability is still environment-dependent. The implementation records warnings and serves explicit `partial` context instead of synthetic values.
- Production acceptance still requires commit, push to GitHub/Gitee, server deploy, server-side cache refresh, and post-deploy smoke.

## Next Action

Proceed with GitNexus change detection, commit, push, deploy, server-side cache refresh, and production smoke:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-production-fund-dsa.ps1 -Code 000001
```
