# Acceptance: FT-P0-3

**Mode:** run
**Generated:** 2026-06-18T14:01:11.6251130+08:00

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
cd D:\Workspace\Fundtrader\backend
python -m pytest -q
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

- **Exit Code:** 0

```
........................................................................ [ 17%]
........................................................................ [ 34%]
........................................................................ [ 52%]
........................................................................ [ 69%]
........................................................................ [ 86%]
.......................................................                  [100%]
415 passed in 60.85s (0:01:00)

> my-app@0.0.0 check
> tsc -b


> my-app@0.0.0 build
> vite build && esbuild api/boot.ts --platform=node --bundle --format=esm --outdir=dist --banner:js="import { createRequire } from 'module';const require = createRequire(import.meta.url);"

[36mvite v7.3.3 [32mbuilding client environment for production...[36m[39m
transforming...
[32m✓[39m 2631 modules transformed.
rendering chunks...
computing gzip size...
[2mdist/public/[22m[32mindex.html                                    [39m[1m[2m  0.79 kB[22m[1m[22m[2m │ gzip:   0.39 kB[22m
[2mdist/public/[22m[35massets/index-Doi39AMU.css                     [39m[1m[2m131.54 kB[22m[1m[22m[2m │ gzip:  22.26 kB[22m
[2mdist/public/[22m[36massets/check-I-GlMR9K.js                      [39m[1m[2m  0.13 kB[22m[1m[22m[2m │ gzip:   0.14 kB[22m
[2mdist/public/[22m[36massets/chevron-up-CMht1K8-.js                 [39m[1m[2m  0.13 kB[22m[1m[22m[2m │ gzip:   0.14 kB[22m
[2mdist/public/[22m[36massets/chevron-down-h9JCkFhX.js               [39m[1m[2m  0.13 kB[22m[1m[22m[2m │ gzip:   0.14 kB[22m
[2mdist/public/[22m[36massets/plus-Bk4rlYaV.js                       [39m[1m[2m  0.15 kB[22m[1m[22m[2m │ gzip:   0.15 kB[22m
[2mdist/public/[22m[36massets/x-DR7unRVM.js                          [39m[1m[2m  0.16 kB[22m[1m[22m[2m │ gzip:   0.15 kB[22m
[2mdist/public/[22m[36massets/arrow-left-THhiWNjx.js                 [39m[1m[2m  0.17 kB[22m[1m[22m[2m │ gzip:   0.16 kB[22m
[2mdist/public/[22m[36massets/arrow-right-CzYLQnIz.js                [39m[1m[2m  0.17 kB[22m[1m[22m[2m │ gzip:   0.16 kB[22m
[2mdist/public/[22m[36massets/clock-CXdt2iqG.js                      [39m[1m[2m  0.17 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m
[2mdist/public/[22m[36massets/gauge-C6K0PSOx.js                      [39m[1m[2m  0.18 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m
[2mdist/public/[22m[36massets/trending-down-OWplIXJ5.js              [39m[1m[2m  0.18 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m
[2mdist/public/[22m[36massets/circle-check-C0qcJ3XF.js               [39m[1m[2m  0.18 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m
[2mdist/public/[22m[36massets/play-sawZtn7-.js                       [39m[1m[2m  0.19 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m
[2mdist/public/[22m[36massets/circle-check-big-DNrmxNWV.js           [39m[1m[2m  0.20 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m
[2mdist/public/[22m[36massets/rotate-ccw-DCxDdgFW.js                 [39m[1m[2m  0.20 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m
[2mdist/public/[22m[36massets/info-D-FT9rQ2.js                       [39m[1m[2m  0.21 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m
[2mdist/public/[22m[36massets/circle-x-33J1B605.js                   [39m[1m[2m  0.21 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m
[2mdist/public/[22m[36massets/target-DwbNW2zv.js                     [39m[1m[2m  0.23 kB[22m[1m[22m[2m │ gzip:   0.16 kB[22m
[2mdist/public/[22m[36massets/activity-0D4DQdPO.js                   [39m[1m[2m  0.24 kB[22m[1m[22m[2m │ gzip:   0.20 kB[22m
[2mdist/public/[22m[36massets/copy-iFpuYMa0.js                       [39m[1m[2m  0.24 kB[22m[1m[22m[2m │ gzip:   0.21 kB[22m
[2mdist/public/[22m[36massets/database-DAGX4z1r.js                   [39m[1m[2m  0.24 kB[22m[1m[22m[2m │ gzip:   0.20 kB[22m
[2mdist/public/[22m[36massets/cha...[truncated]
```

## Recommended Next Action

All safe blocks passed. Review skipped blocks manually if needed.