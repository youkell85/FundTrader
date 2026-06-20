## PM Digest

Status: complete
Changed: docs/pm/reports/FT-DSA-PROD-BASELINE-001.md
Validation: passed - refresh-market-context-cache.ps1; check-production-fund-dsa.ps1
Risk: provider freshness remains environment-dependent for Eastmoney market flow and AkShare sector flow
Decision: none
Next: accept

# FT-DSA-PROD-BASELINE-001 Report

## 1. Status

Complete. The production DSA baseline smoke passed against
`http://43.160.226.62/fund/api` for representative fund `000001`.

Claude Code was dispatched first through the PM loop, but stopped before writing
the required report after its permission flow blocked the validation scripts.
Codex PM then ran the same validation commands directly and recorded the
evidence here.

## 2. Endpoint Status Matrix

| Area | Endpoint | Result | Evidence |
| --- | --- | --- | --- |
| Health | `/fund/api/health` | pass | HTTP 200, `status=ok` |
| Provider status | `/fund/api/data-sources/status` | pass | HTTP 200, `available=7/7` |
| Detail completeness | `/fund/api/fund/detail-completeness?code=000001` | pass | HTTP 200, `available=15/17` |
| Detail field coverage | `/fund/api/fund/detail-fields?code=000001` | pass | Smoke script reported coverage `0.8871` and `fieldSources` present |
| Bond holdings | `/fund/api/fund/bond-holdings?code=000001` | pass, explicit partial | HTTP 200, `rows=10`, `dataStatus=partial`, source from AkShare/Eastmoney F10 bond holdings |
| Turnover history | `/fund/api/fund/turnover-history?code=000001&periods=8` | pass | HTTP 200, `rows=8`, `coverage=1.0`, `dataStatus=available` |
| Purchase info | `/fund/api/fund/purchase-info?code=000001` | pass | HTTP 200, `dataStatus=available`, `source=eastmoney:fundf10_fee_page` |
| Market context | `/fund/api/fund/000001/market-context` | pass, explicit partial | HTTP 200, `coverage=0.725`, `dataStatus=partial`; required sections present |
| Research report markdown | `/fund/api/fund/000001/research-report?format=md` | pass | HTTP 200, `text/markdown; charset=utf-8`, 3922 bytes |
| Research report docx | `/fund/api/fund/000001/research-report?format=docx` | pass | HTTP 200, Word document content type, 2793 bytes |
| Research report pdf | `/fund/api/fund/000001/research-report?format=pdf` | pass | HTTP 200, `application/pdf`, 4009 bytes |

## 3. Files Changed

- `docs/pm/reports/FT-DSA-PROD-BASELINE-001.md`

No backend, frontend, database, credential, or deployment files were changed.

## 4. Validation Commands And Results

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

Result: HEAD was `9f7b25e`. The only visible untracked files before this report
were the five new PM outbox task packages and the first-task review artifacts.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\refresh-market-context-cache.ps1 -Limit 10
```

Result: passed with `status=available`. Saved northbound flow plus ten sector
flow cache records. Provider warnings were recorded for Eastmoney market flow
proxy connectivity and AkShare sector flow parsing.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-production-fund-dsa.ps1 -Code 000001
```

Result: passed. Smoke summary was `PASS: 13`, `WARN: 0`, `FAIL: 0`.

## 5. Production Caveats

- Market context is production-usable, but provider freshness is still
  environment-dependent. The cache refresh reported Eastmoney market flow proxy
  failure and AkShare sector flow parse failure while still saving available
  northbound and sector data.
- `bond-holdings` and `market-context` correctly expose explicit `partial`
  states rather than synthetic complete data.
- The script validates report export HTTP status and this report additionally
  checked content types for `md`, `docx`, and `pdf`.

## 6. Open Risks Or PM Decisions Needed

No PM decision is required for this baseline. Follow-up feature work can proceed
while preserving the explicit `available` / `partial` / `missing` contracts.

## 7. Recommended Next Action

Accept `FT-DSA-PROD-BASELINE-001`, then continue with the next task package.
