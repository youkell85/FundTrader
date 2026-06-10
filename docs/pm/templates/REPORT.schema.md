# Report Schema v1

Preferred shape for coding-agent final reports. Forward-compatible: old reports
do not need to conform immediately.

## Required Sections

```markdown
# <TASK_ID> Final Report

## Status

status: complete | needs_fix | blocked

## Summary

## Files Changed

## Validation

## Scope / Safety

## Open Risks

## Recommended Next Action
```

## Section Guidance

### Status

One of:

- `complete` - all implementation tasks finished, validation passed.
- `needs_fix` - implementation done but validation failed or scope violation detected.
- `blocked` - could not proceed due to missing decisions, repo drift, or external dependency.

### Summary

One or two paragraphs describing what was done and the outcome.

### Files Changed

Table or list of every file modified, created, or deleted. Include a brief note
on what changed and why.

### Validation

Commands run and their results. Include exit codes, key output, and whether
each check passed.

### Scope / Safety

Confirm that only allowed files were touched, no commits/pushes/deploys were
made, and unrelated worktree changes were preserved.

### Open Risks

Anything the PM should know before accepting the change: untracked files,
unresolved design questions, follow-up work needed.

### Recommended Next Action

One sentence: accept, create hotfix, run follow-up task, or escalate.
