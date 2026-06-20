# FT-DSA-PROD-BASELINE-001 - DSA Production Baseline Smoke

Created: 2026-06-21
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Prove the currently absorbed DSA/GPT capabilities are production-usable before
new feature work builds on them. This task is validation-first and should not
change product behavior unless a narrow smoke script or report artifact is
needed to make the verification repeatable.

The user-facing outcome is a clear baseline showing whether provider health,
field provenance, market context, and research-report exports work on the live
`/fund/` production path.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer / verifier only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - Current production path must remain `/fund/` and `/fund/api/*`.
  - Latest DSA closeout says runtime code through `d9b60e5` was deployed, but
    DSA-specific market-context cache refresh and production smoke should be
    run explicitly when this track resumes.
  - Do not edit business code unless a smoke script defect blocks verification.

## Approved Scope

Files or areas the coding agent may edit:

- `scripts/check-production-fund-dsa.ps1`
- `scripts/refresh-market-context-cache.ps1`
- `scripts/refresh-market-context-cache.sh`
- `docs/pm/reports/FT-DSA-PROD-BASELINE-001.md`
- `docs/pm/reviews/FT-DSA-PROD-BASELINE-001.review.md`
- `docs/pm/reviews/FT-DSA-PROD-BASELINE-001.review.json`
- `docs/pm/reviews/FT-DSA-PROD-BASELINE-001.acceptance.md`
- `docs/pm/reviews/FT-DSA-PROD-BASELINE-001.acceptance.json`

Files or areas the coding agent must not edit:

- Backend or frontend product code unless PM approves a follow-up hotfix
- Database files
- `.env` or credential files
- Deployment output
- Git history, branches, tags, or remotes
- Anything outside this handoff without PM approval

## Allowed Files

- `scripts/check-production-fund-dsa.ps1`
- `scripts/refresh-market-context-cache.ps1`
- `scripts/refresh-market-context-cache.sh`
- `docs/pm/reports/FT-DSA-PROD-BASELINE-001.md`
- `docs/pm/reviews/FT-DSA-PROD-BASELINE-001.review.md`
- `docs/pm/reviews/FT-DSA-PROD-BASELINE-001.review.json`
- `docs/pm/reviews/FT-DSA-PROD-BASELINE-001.acceptance.md`
- `docs/pm/reviews/FT-DSA-PROD-BASELINE-001.acceptance.json`

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

If the status contains unrelated changes, preserve them and continue only inside
the approved scope.

## Implementation Tasks

1. Read the current DSA/GPT status and closeout context:
   - `docs/pm/STATUS.md`
   - `docs/pm/reports/FT-DSA-CLOSEOUT-2026-06-19.md`
   - `scripts/check-production-fund-dsa.ps1`
2. Verify the script covers at least these production endpoints:
   - `/fund/api/health`
   - `/fund/api/data-sources/status`
   - `/fund/api/fund/detail-completeness?code=000001`
   - `/fund/api/fund/bond-holdings?code=000001`
   - `/fund/api/fund/turnover-history?code=000001&periods=8`
   - `/fund/api/fund/purchase-info?code=000001`
   - `/fund/api/fund/000001/market-context`
   - `/fund/api/fund/000001/research-report?format=md`
   - `/fund/api/fund/000001/research-report?format=docx`
   - `/fund/api/fund/000001/research-report?format=pdf`
3. Run server-side or local cache refresh for market context where credentials
   and environment allow it. If it cannot run, record the exact limitation and
   keep the result as `partial`, not failed, if the application serves explicit
   fallback data.
4. Run the DSA production smoke and capture a compact status matrix.
5. If the smoke script has a narrow URL/path/format bug, fix only the script and
   rerun. If product endpoints fail, do not patch product code in this task;
   write a hotfix recommendation instead.
6. Write the final report.

## Contracts And Design Decisions

- This is a production baseline task, not a feature task.
- `partial` is acceptable only when the API response explicitly reports source,
  missing reason, or provider warning.
- A 401 on authenticated allocation generation is not in scope for this DSA
  smoke.
- Do not invent values for market context or report exports.
- Keep `.env`, credentials, and database files out of git.

## Validation

Run:

```powershell
cd D:\Workspace\Fundtrader
powershell -ExecutionPolicy Bypass -File .\scripts\refresh-market-context-cache.ps1 -Limit 10
powershell -ExecutionPolicy Bypass -File .\scripts\check-production-fund-dsa.ps1 -Code 000001
```

If script edits were made, also run:

```powershell
git diff --check -- scripts\check-production-fund-dsa.ps1 scripts\refresh-market-context-cache.ps1 scripts\refresh-market-context-cache.sh
```

Expected result:

- Production health returns ok.
- Frontend path returns HTTP 200 if checked.
- DSA endpoints return `available` or explicit `partial/missing` states.
- Report export formats return expected content types or a documented
  endpoint-level failure.

## Stop Conditions

Stop and write a report instead of guessing when:

- A production endpoint fails in product code.
- SSH, credentials, or provider access is missing.
- Verification requires changing backend/frontend product behavior.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/FT-DSA-PROD-BASELINE-001.md` with:

```markdown
## PM Digest

Status: complete | needs_fix | blocked | decision_needed
Changed: file1, file2
Validation: passed | failed | skipped - command names only
Risk: none | brief risk
Decision: none | exact PM/user question
Next: accept | create_hotfix | run_followup | ask_user
```

Then include:

1. Status
2. Endpoint status matrix
3. Files changed
4. Validation commands and results
5. Production caveats
6. Open risks or PM decisions needed
7. Recommended next action
