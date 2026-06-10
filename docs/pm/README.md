# FundTrader PM Workflow

This project has the reusable Codex PM -> Claude coding-agent workflow installed.

## Purpose

- Codex acts as PM, reviewer, and acceptance gate.
- Claude CLI acts as the implementation agent.
- Task handoffs are written to `docs\pm\outbox`.
- Claude reports are written to `docs\pm\reports`.
- PM reviews are written to `docs\pm\reviews`.
- Runtime logs are written to `docs\pm\logs`.

## Common Commands

```powershell
.\scripts\pm-new-task.ps1 -Title "Task title" -TaskId TASK-XXX
.\scripts\pm-dispatch.ps1 -Task docs\pm\outbox\TASK-XXX.md
.\scripts\pm-review.ps1 -Task docs\pm\outbox\TASK-XXX.md
.\scripts\pm-accept.ps1 -Task docs\pm\outbox\TASK-XXX.md
.\scripts\pm-accept.ps1 -Task docs\pm\outbox\TASK-XXX.md -Run
.\scripts\pm-loop.ps1 -Task docs\pm\outbox\TASK-XXX.md -MaxRounds 3 -MaxMinutes 90
.\scripts\pm-cost.ps1
.\scripts\pm-status.ps1
```

## Safety Rules

- No commit by default.
- No push by default.
- No deploy by default.
- Do not use `git add .`.
- Do not run destructive validation commands.
- `pm-accept.ps1 -Run` only executes allowlisted safe commands.
- Stop on `blocked` or `needs_fix`; Codex PM decides the next step.

## Project Notes

Fill these in before dispatching real work:

- Build commands:
- Test commands:
- Allowed edit directories:
- Forbidden edit directories:
- Deployment rules:
- Frontend build permission:
- Database or data-directory edit permission:
- Production verification requirements:
