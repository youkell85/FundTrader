# P3-FINAL-ACCEPTANCE-001 - P3 final acceptance snapshot

Created: 2026-06-10T22:24:23+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Produce a low-token final acceptance snapshot for current P3 local work. This
task is review/validation only: decide whether current P3 is locally acceptable
under the PM workflow, and list any blocking gaps if not.

Do not implement new features in this task.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.
  - Low-token mode: avoid broad file reads and do not inspect generated logs.
  - Current user constraint remains: no commit, no push, no deployment.
  - User accepted smoke policy: unauthenticated production
    `POST /fund/api/allocation/generate` returning HTTP 401 is WARN, not FAIL.
  - Relevant completed P3 tasks:
    - `P3-CALIBRATION-AUDIT-001`
    - `HF1-P3-CALIBRATION-AUDIT-001`
    - `P3-PROD-SMOKE-001`
    - `P3-AUDIT-POLICY-001`
    - `P3-AUDIT-POLICY-UI-001`

## Approved Scope

Files or areas the coding agent may edit:

- `docs/pm/reports/P3-FINAL-ACCEPTANCE-001.md`

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

1. Run only the required repo check from this handoff and summarize briefly.
2. Read PM briefs for the two latest P3 tasks only:
   - `.\scripts\pm-brief.ps1 -TaskId P3-AUDIT-POLICY-001`
   - `.\scripts\pm-brief.ps1 -TaskId P3-AUDIT-POLICY-UI-001`
3. Run the validation commands listed below.
4. Write the final acceptance report with a clear verdict:
   - `accept` if all validation passes and no blocker is found.
   - `needs_fix` only if there is a reproducible local failure or missing
     required artifact.
   - `blocked` only if repo state prevents validation.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Review/validation only. Do not edit code or scripts.
- Existing unrelated dirty files are not blockers unless they directly prevent
  validation.
- Production `generate=401` is WARN by PM/user decision, not a blocker.
- Local acceptability does not imply deployment; deployment still requires
  explicit user approval.

## Validation

Commands or checks the coding agent must run:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
cd backend
python -m pytest tests/test_calibration_audit.py tests/test_allocation_api_contract.py -q
cd ..\frontend
npm.cmd run check
cd ..
.\scripts\check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api
```

Expected result:

- pytest focused passes.
- frontend TypeScript check passes.
- production smoke has zero FAIL; WARN for unauthenticated 401 is acceptable.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P3-FINAL-ACCEPTANCE-001.md` with:

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
