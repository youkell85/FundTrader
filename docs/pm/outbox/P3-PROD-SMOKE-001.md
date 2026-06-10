# P3-PROD-SMOKE-001 - P3 production allocation smoke check

Created: 2026-06-10T21:29:23+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Add a repeatable P3 production smoke check for allocation reliability. The script should verify health, market-data status, pipeline-health/calibration, and one allocation generation request, then fail clearly if HTTP status is bad, JSON is malformed, non-finite values appear, or required `data_quality`/health fields are missing.

This is a read-only operations script task. It should not change backend allocation behavior, deployment logic, or production state.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `scripts/check-production-allocation.ps1`
- `docs/pm/STATUS.md`
- `docs/pm/reports/P3-PROD-SMOKE-001.md`

Files or areas the coding agent must not edit:

- Backend business logic
- Frontend app code
- Deployment scripts or service files other than adding the smoke script named above
- `backend/data/**` or SQLite database files
- `docs/0610/**`, `.codegraph/**`, `.mavis/**`, `.reasonix/**`, `nul`
- `AGENTS.md` and `CLAUDE.md`
- Unrelated generated assets
- Deployment output unless explicitly requested
- Git history, branches, tags, or remotes
- Anything outside this handoff without PM approval

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

If the status contains unrelated changes, preserve them and continue only inside
the approved scope.

Expected unrelated residue:

- Modified but not part of this task: `AGENTS.md`, `CLAUDE.md`
- Untracked and not part of this task: `.codegraph/**`, `.mavis/**`, `.reasonix/**`, `docs/0610/**`, `nul`
- Current P3 calibration audit changes may be present in the working tree; do not revert them.

## Implementation Tasks

1. Add `scripts/check-production-allocation.ps1` with parameters:
   - `-BaseUrl` default `http://43.160.226.62/fund/api`
   - `-TimeoutSeconds` default `120`
   - optional `-SkipGenerate` switch
   - optional `-VerboseJson` switch for printing compact response summaries
2. The script must call, parse JSON, and validate:
   - `GET $BaseUrl/health` expects `status == "ok"`
   - `GET $BaseUrl/market-data/status` expects JSON object and reports health/rolling status if present
   - `GET $BaseUrl/allocation/pipeline-health` expects JSON object and reports `health`; if `calibration` exists, report calibration health/missing/warning counts
   - unless `-SkipGenerate`, `POST $BaseUrl/allocation/generate` with a small deterministic request body
3. For the allocation generate response:
   - require HTTP 200
   - require valid JSON object
   - require no `NaN`, `Infinity`, or `-Infinity` string or numeric values anywhere in response
   - require `data_quality` key
   - if market-data status indicates rolling stats unavailable, assert `data_quality.overall_status != "real"` when generate succeeds
4. Use PowerShell-native JSON parsing and recursion. Do not shell out to curl from inside the script.
5. Produce readable PASS/FAIL output and non-zero exit on failure.
6. Update `docs/pm/STATUS.md` to note the smoke script exists once implemented.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Read-only validation only.
- No commit, no push, no deployment.
- No production mutation.
- Do not require credentials.
- Keep the script project-local and Windows PowerShell compatible.
- Do not add third-party dependencies.

## Validation

Commands or checks the coding agent must run:

```powershell
.\scripts\check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api -SkipGenerate

# Run generate if the endpoint is reachable and does not require unavailable auth in this environment.
.\scripts\check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api

cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
```

Expected result:

- Smoke script passes with `-SkipGenerate`.
- Full smoke script passes if production allocation generation is accessible without additional auth. If auth blocks it, report the exact HTTP status/body and do not fake success.
- Backend targeted tests pass.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P3-PROD-SMOKE-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
