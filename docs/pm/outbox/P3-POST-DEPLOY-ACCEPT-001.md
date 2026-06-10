# P3-POST-DEPLOY-ACCEPT-001 - P3 post deploy production acceptance

Created: 2026-06-10T22:43:24+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Low-token post-deploy production acceptance for P3. Verify that deployed
production is running commit `e6d8c61`, services are active, public health and
frontend endpoints respond, production allocation smoke has zero FAIL, and the
deployed pipeline-health response includes `calibration.policy`.

This is validation/report-only. Do not implement code, do not commit, do not
push, and do not deploy.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.
  - Current user request is to continue the PM-Claude low-token workflow to
    acceptable state after deployment.
  - P3 deploy was already performed for commit `e6d8c61`.
  - User accepted smoke policy: unauthenticated production
    `POST /fund/api/allocation/generate` returning HTTP 401 is WARN, not FAIL.
  - Low-token mode: run only listed commands; do not inspect generated logs.

## Approved Scope

Files or areas the coding agent may edit:

- `docs/pm/reports/P3-POST-DEPLOY-ACCEPT-001.md`

Files or areas the coding agent must not edit:

- Backend files
- Frontend files
- Scripts
- `AGENTS.md`
- `CLAUDE.md`
- `.codegraph/**`
- `.mavis/**`
- `.reasonix/**`
- `docs/0610/**`
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

## Implementation Tasks

1. Run the repo check and summarize current local HEAD/status headline only.
2. Run the production validation commands listed below.
3. Write the report with verdict:
   - `accept` if production HEAD is `e6d8c61`, services are active, health/front
     endpoints pass, smoke has zero FAIL, and `calibration.policy` has no missing
     required keys.
   - `needs_fix` if any command fails or policy fields are missing.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Validation/report-only. Do not edit code.
- Existing unrelated local dirty files are not blockers unless they prevent
  validation.
- HTTP 401 from unauthenticated allocation generate is WARN by PM/user decision.

## Validation

Commands or checks the coding agent must run:

```powershell
git rev-parse --short HEAD
git status --short --untracked-files=all
ssh -o StrictHostKeyChecking=no -i C:\Users\youke\.ssh\id_ed25519_nopass -p 22222 root@43.160.226.62 "cd /opt/fundtrader && git rev-parse --short HEAD && systemctl is-active fundtrader && systemctl is-active fundtrader-frontend"
curl.exe -s http://43.160.226.62/fund/api/health
curl.exe -o NUL -s -w "%{http_code}" http://43.160.226.62/fund/
.\scripts\check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api
powershell -NoProfile -Command "$r = Invoke-RestMethod -Uri 'http://43.160.226.62/fund/api/allocation/pipeline-health' -TimeoutSec 30; $p = $r.calibration.policy; $required = @('return_drift_threshold','vol_drift_threshold','jump_probability_min','jump_probability_max','coverage_threshold','policy_source'); $missing = @($required | Where-Object { -not $p.PSObject.Properties[$_] }); [pscustomobject]@{ calibration_health=$r.calibration.health; policy_source=$p.policy_source; missing_policy_keys=($missing -join ',') } | ConvertTo-Json -Compress; if ($missing.Count -gt 0) { exit 1 }"
```

Expected result:

- Server HEAD is `e6d8c61`.
- Both services are `active`.
- Health returns `status=ok`; frontend HTTP code is `200`.
- Production smoke has zero FAIL; 401 WARN is acceptable.
- Policy shape check exits 0 and reports no missing keys.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P3-POST-DEPLOY-ACCEPT-001.md` with:

Start the report with this short machine-readable digest:

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
2. Summary
3. Files changed
4. Validation commands and results
5. Scope / safety
6. Open risks or PM decisions needed
7. Recommended next action

Do not include hidden chain-of-thought or `<think>` blocks.
Keep successful command output summarized. Include full output only for failures.
