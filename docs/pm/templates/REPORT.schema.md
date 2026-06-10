# Report Schema v1

Preferred shape for coding-agent final reports. Forward-compatible: old reports
do not need to conform immediately.

## Required Sections

```markdown
# <TASK_ID> Final Report

## PM Digest

Status: complete | needs_fix | blocked | decision_needed
Changed: file1, file2
Validation: passed | failed | skipped - command names only
Risk: none | brief risk
Decision: none | exact PM/user question
Next: accept | create_hotfix | run_followup | ask_user

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

### PM Digest

Keep this section at the top of every report and under 12 lines. It is the
default Codex PM read path for low-token acceptance. Put only the final status,
changed-file summary, validation result, risk, decision need, and next action
here. Do not include command output, long prose, or hidden reasoning.

### Status

One of:

- `complete` - all implementation tasks finished, validation passed.
- `needs_fix` - implementation done but validation failed or scope violation detected.
- `blocked` - could not proceed due to missing decisions, repo drift, or external dependency.
- `decision_needed` - implementation should not continue until PM/user chooses.

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
