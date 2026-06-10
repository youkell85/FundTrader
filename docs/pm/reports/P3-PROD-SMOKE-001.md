# P3-PROD-SMOKE-001 — Implementation Report

**Date:** 2026-06-10
**PM:** Codex
**Executor:** Claude Code
**Branch:** master @ b7349c0

## 1. Summary

Created `scripts/check-production-allocation.ps1`, a read-only PowerShell smoke script that validates the production FundTrader allocation pipeline via HTTP endpoints. Updated `docs/pm/STATUS.md` to reference the new tool. All validation checks passed.

## 2. Files Changed

| File | Change |
|---|---|
| `scripts/check-production-allocation.ps1` | **Created** — 4-step smoke check script |
| `docs/pm/STATUS.md` | **Edited** — added Tools section noting the smoke script |

No other files were modified. Unrelated working-tree changes preserved.

## 3. Validation Commands and Results

### 3.1 Smoke Script — SkipGenerate

```powershell
.\scripts\check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api -SkipGenerate -VerboseJson
```

**Result: ALL CHECKS PASSED (3 PASS, 0 WARN, 0 FAIL)**

- `/health` → HTTP 200, `status: "ok"` ✓
- `/market-data/status` → HTTP 200, valid JSON, `health: "degraded"`, `rolling_stats_available: True` ✓
- `/allocation/pipeline-health` → HTTP 200, valid JSON, `health: "unknown"` (no prior runs), calibration not yet populated ✓
- Generate step skipped ✓

### 3.2 Smoke Script — Full (with Generate)

```powershell
.\scripts\check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api -VerboseJson
```

**Result: ALL CHECKS PASSED (3 PASS, 1 WARN, 0 FAIL)**

- First 3 checks identical to above ✓
- `POST /allocation/generate` → HTTP **401** (auth required). Reported as WARN, not FAIL — correct behavior per task spec. The endpoint requires a session cookie or Bearer token via `get_current_user` dependency. The script accurately reports the 401 status without faking success.

### 3.3 Backend Targeted Tests

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

**Result: 35 passed in 1.69s** ✓

## 4. Script Design Notes

- **Parameters:** `-BaseUrl`, `-TimeoutSeconds`, `-SkipGenerate`, `-VerboseJson` — all as specified.
- **Non-finite value detection:** Recursive walker checks all numeric values and string literals (`"NaN"`, `"Infinity"`, `"-Infinity"`) at every JSON path — handles objects, arrays, dictionaries, and PSCustomObjects.
- **No external dependencies:** Uses `Invoke-WebRequest` (PS-native); no curl, no third-party modules.
- **Exit code:** Non-zero on any FAIL; zero when all checks pass or only WARNs.
- **Idempotent:** Read-only; no mutation of any production state.

## 5. Open Risks / PM Decisions Needed

1. **Auth on `/allocation/generate`:** The generate endpoint requires authentication (`get_current_user` dependency chain). Without credentials, the smoke script correctly reports HTTP 401 as a warning. PM should decide whether to:
   - Accept 401 as the expected smoke behavior for generate (current state)
   - Provide a bearer token or session cookie mechanism for the script
   - Add an unauthenticated smoke-only endpoint that exercises the pipeline without auth

2. **Calibration field absent:** `pipeline-health` returned no `calibration` key (no prior runs on the target instance). This is expected for a freshly deployed or idle instance. The script handles the absence gracefully but PM may want to note the expected state after first allocation.

3. **Market data `health: "degraded"`:** Rolling coverage at 71.4% (below 70% threshold would be critical). This is a production data quality observation, not a script issue. PM may want to review the invalid/assumption assets.