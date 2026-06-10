# {{TASK_ID}} - {{TITLE}}

Created: {{CREATED_AT}}
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Describe the user-facing outcome in one or two paragraphs.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- TBD

Files or areas the coding agent must not edit:

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

1. TBD
2. TBD
3. TBD

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- TBD

## Validation

Commands or checks the coding agent must run:

```powershell
# TBD
```

Expected result:

- TBD

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/{{TASK_ID}}.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
