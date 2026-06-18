# Acceptance: FT-DSA-P0-FIELDS-PROVIDER-HEALTH-001

**Mode:** run
**Generated:** 2026-06-18T10:43:07.7857243+08:00

## Summary

| Metric | Count |
|--------|-------|
| Total blocks | 3 |
| Safe | 3 |
| Skipped (unsafe) | 0 |
| Unsupported | 0 |
| Passed | 3 |
| Failed | 0 |

## Blocks

### Block 1

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest -q
```

- **Exit Code:** 0

```
........................................................................ [ 17%]
........................................................................ [ 35%]
........................................................................ [ 52%]
........................................................................ [ 70%]
........................................................................ [ 88%]
................................................                         [100%]
408 passed in 33.77s
```

### Block 2

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

- **Exit Code:** 0

```

> my-app@0.0.0 check
> tsc -b


> my-app@0.0.0 build
> vite build && esbuild api/boot.ts --platform=node --bundle --format=esm --outdir=dist --banner:js="import { createRequire } from 'module';const require = createRequire(import.meta.url);"

[36mvite v7.3.3 [32mbuilding client environment for production...[36m[39m
transforming...
[32m✓[39m 2631 modules transformed.
rendering chunks...
computing gzip size...
[2mdist/public/[22m[32mindex.html                                    [39m[1m[2m  0.79 kB[22m[1m[22m[2m │ gzip:   0.38 kB[22m
[2mdist/public/[22m[35massets/index-Doi39AMU.css                     [39m[1m[2m131.54 kB[22m[1m[22m[2m │ gzip:  22.26 kB[22m
[2mdist/public/[22m[36massets/check-Cw9-6SaF.js                      [39m[1m[2m  0.13 kB[22m[1m[22m[2m │ gzip:   0.14 kB[22m
[2mdist/public/[22m[36massets/chevron-up-DwM8Vidw.js                 [39m[1m[2m  0.13 kB[22m[1m[22m[2m │ gzip:   0.14 kB[22m
[2mdist/public/[22m[36massets/chevron-down-CowQ9lou.js               [39m[1m[2m  0.13 kB[22m[1m[22m[2m │ gzip:   0.14 kB[22m
[2mdist/public/[22m[36massets/plus-CQjj7dBI.js                       [39m[1m[2m  0.15 kB[22m[1m[22m[2m │ gzip:   0.15 kB[22m
[2mdist/public/[22m[36massets/x-DtmrZnB7.js                          [39m[1m[2m  0.16 kB[22m[1m[22m[2m │ gzip:   0.15 kB[22m
[2mdist/public/[22m[36massets/arrow-left-Cdi3LFut.js                 [39m[1m[2m  0.17 kB[22m[1m[22m[2m │ gzip:   0.16 kB[22m
[2mdist/public/[22m[36massets/arrow-right-R4YTzpVY.js                [39m[1m[2m  0.17 kB[22m[1m[22m[2m │ gzip:   0.16 kB[22m
[2mdist/public/[22m[36massets/clock-D0_xiIki.js                      [39m[1m[2m  0.17 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m
[2mdist/public/[22m[36massets/gauge-DTzvLhzS.js                      [39m[1m[2m  0.18 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m
[2mdist/public/[22m[36massets/trending-down-CxTCfzkm.js              [39m[1m[2m  0.18 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m
[2mdist/public/[22m[36massets/circle-check-GJ8KSa3T.js               [39m[1m[2m  0.18 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m
[2mdist/public/[22m[36massets/play-BGob31qy.js                       [39m[1m[2m  0.19 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m
[2mdist/public/[22m[36massets/circle-check-big-BDBYDBXK.js           [39m[1m[2m  0.20 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m
[2mdist/public/[22m[36massets/rotate-ccw-ySm4_-qE.js                 [39m[1m[2m  0.20 kB[22m[1m[22m[2m │ gzip:   0.19 kB[22m
[2mdist/public/[22m[36massets/info-BdMAIMxn.js                       [39m[1m[2m  0.21 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m
[2mdist/public/[22m[36massets/circle-x-DlS0_ksp.js                   [39m[1m[2m  0.21 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m
[2mdist/public/[22m[36massets/target-tzW38M1f.js                     [39m[1m[2m  0.23 kB[22m[1m[22m[2m │ gzip:   0.16 kB[22m
[2mdist/public/[22m[36massets/activity-DqEdPG6d.js                   [39m[1m[2m  0.24 kB[22m[1m[22m[2m │ gzip:   0.20 kB[22m
[2mdist/public/[22m[36massets/copy-ic-731Iu.js                       [39m[1m[2m  0.24 kB[22m[1m[22m[2m │ gzip:   0.21 kB[22m
[2mdist/public/[22m[36massets/database-CSAkAoQ1.js                   [39m[1m[2m  0.24 kB[22m[1m[22m[2m │ gzip:   0.20 kB[22m
[2mdist/public/[22m[36massets/chart-column-COGFvDcZ.js               [39m[1m[2m  0.25 kB[22m[1m[22m[2m │ gzip:   0.19 kB[22m
[2mdist/public/[22m[36massets/eye-D_frpekt.js                        [39m[1m[2m  0.26 kB[22m[1m[22m[2m │ gzip:   0.20 kB[22m
[2mdist/public/[22m[36massets/zap-B85W3OlY.js                        [39m[1m[2m  0.26 kB[22m[1m[22m[2m │ gzip:   0.21 kB[22m
[2mdist/public/[22m[36massets/triangle-alert-CK6gRjz7.js             [39m[1m[2m  0.27 kB[22m[1m[22m[2m │ gzip:   0.22 kB[22m
[2mdi...[truncated]
```

### Block 3

- **Classification:** safe
- **Reason:** Passed safety checks
- **Language:** powershell

```powershell
cd D:\Workspace\Fundtrader
curl.exe -s http://127.0.0.1:8766/fund/api/health
curl.exe -s http://127.0.0.1:8766/fund/api/data-sources/status
```

- **Exit Code:** 0

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.