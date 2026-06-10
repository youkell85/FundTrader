# P3-CLOSEOUT-001 - P3 closeout

Created: 2026-06-10T22:50:23+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Low-token P3 closeout. Produce the final PM closeout report that states P3 is
complete after commit, push, deployment, and post-deploy acceptance.

This task is report-only. Do not implement code, do not commit, do not push,
and do not deploy.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.
  - Deployed commit: `e6d8c61 Complete P3 calibration audit workflow`.
  - P3 post-deploy acceptance task already reports `Next: accept`.
  - User accepted smoke policy: unauthenticated production
    `POST /fund/api/allocation/generate` returning HTTP 401 is WARN, not FAIL.
  - Low-token mode: only read PM brief/status and write the closeout report.

## Approved Scope

Files or areas the coding agent may edit:

- `docs/pm/reports/P3-CLOSEOUT-001.md`

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

1. Run the repo check and summarize current HEAD/status headline only.
2. Run:
   - `.\scripts\pm-brief.ps1 -TaskId P3-POST-DEPLOY-ACCEPT-001`
   - `.\scripts\pm-status.ps1`
3. Write a concise closeout report with:
   - final verdict: `closed`
   - deployed commit
   - post-deploy acceptance summary
   - known non-blocking observation: `calibration.health=degraded` is not a
     deployment regression
   - remaining local unrelated dirty files
   - recommended next action

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Report-only. Do not edit code or scripts.
- Do not stage, commit, push, or deploy.
- Existing unrelated dirty files are not blockers.

## Validation

Commands or checks the coding agent must run:

```powershell
git rev-parse --short HEAD
git status --short --untracked-files=all
.\scripts\pm-brief.ps1 -TaskId P3-POST-DEPLOY-ACCEPT-001
.\scripts\pm-status.ps1
```

Expected result:

- HEAD is `e6d8c61`.
- Post-deploy brief says `Status: complete`, `Validation: passed`, `Next: accept`.
- No PM running locks.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P3-CLOSEOUT-001.md` with:

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
