# P3-LOCAL-INTEGRATION-ACCEPT-001 - P3 local integration acceptance

Created: 2026-06-10T22:32:52+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Low-token local integration acceptance for P3. Verify that the local backend
pipeline health function returns the additive `calibration.policy` object in
the actual `get_pipeline_health()` response shape.

This task is validation/report-only. Do not implement or refactor code.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.
  - Current user constraint remains: no commit, no push, no deployment.
  - P3 final acceptance already passed in `P3-FINAL-ACCEPTANCE-001`.
  - User accepted smoke policy: unauthenticated production
    `POST /fund/api/allocation/generate` returning HTTP 401 is WARN, not FAIL.
  - Low-token mode: do not inspect generated logs, do not run full backend
    pytest, and do not read broad source files unless a command fails.

## Approved Scope

Files or areas the coding agent may edit:

- `docs/pm/reports/P3-LOCAL-INTEGRATION-ACCEPT-001.md`

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

1. Run the required repo check and summarize only the HEAD/status headline.
2. Run the focused validation commands below.
3. Write the report with verdict:
   - `accept` if all commands pass and `calibration.policy` is present with
     default threshold fields.
   - `needs_fix` only if the local integration shape is missing or a command
     fails reproducibly.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Validation/report-only. Do not edit code.
- Existing unrelated dirty files are not blockers unless they prevent
  validation.
- Local acceptability does not imply deployment.

## Validation

Commands or checks the coding agent must run:

```powershell
git rev-parse --short HEAD
git status --short --untracked-files=all
cd backend
python -m pytest tests/test_calibration_audit.py::PipelineHealthIncludesCalibrationTest -q
python -c "from app.allocation.orchestrator import get_pipeline_health; r=get_pipeline_health(); c=r.get('calibration') or {}; p=c.get('policy') or {}; required=['return_drift_threshold','vol_drift_threshold','jump_probability_min','jump_probability_max','coverage_threshold','policy_source']; missing=[k for k in required if k not in p]; print({'health': c.get('health'), 'policy_source': p.get('policy_source'), 'missing_policy_keys': missing}); raise SystemExit(1 if missing else 0)"
```

Expected result:

- Targeted pytest passes.
- Python integration shape check exits 0 and prints `missing_policy_keys: []`.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P3-LOCAL-INTEGRATION-ACCEPT-001.md` with:

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
