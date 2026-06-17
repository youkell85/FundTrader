# FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001-HOTFIX - Timeout Semantics And Error Copy

Created: 2026-06-16T00:00:00+08:00
PM: Codex
Executor: Claude Code via local `scripts/pm-dispatch.ps1`

## Goal

Fix two PM review issues from `FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001`.

The user-facing outcome: allocation generation must show a clear failure/timeout message when the backend auto-terminates the pipeline, and touched frontend error copy must not contain mojibake.

## Context

- Parent task: `FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001`
- PM review found:
  1. Backend now sends `cancelled` with the `TaskCancelledError` message, but the frontend still treats every `cancelled` event as user cancel. A timeout message such as `管线超过 120s 总超时,自动终止` must surface as an error, not silently stop generation.
  2. `frontend/src/lib/api.ts` still contains fallback text `娴佸紡璇锋眰澶辫触`, which is mojibake and user-facing on stream request failures.
- Keep all parent-task changes otherwise intact.
- Preserve unrelated dirty worktree changes.

## Allowed Files

- `frontend/src/lib/api.ts`
- `docs/pm/reports/FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001-HOTFIX.md`

## Approved Scope

You may edit only:

- `frontend/src/lib/api.ts`
- `docs/pm/reports/FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001-HOTFIX.md`

You must not edit:

- Backend files
- Allocation engine/math/model files
- Allocation pages/components
- `.env` or credential files
- Home/detail page files
- Generated build output
- Git history, branches, tags, remotes, or deployment files

## Required Repo Check Before Editing

Run and summarize:

```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

If the status contains unrelated changes, preserve them and continue only inside the approved scope.

## Implementation Tasks

1. In `generateAllocationStream`, distinguish timeout/auto-termination from user cancellation.
   - When a `cancelled` SSE payload contains a message matching timeout/auto termination semantics, call `onError` with a readable Chinese message.
   - Suggested detection terms: `超时`, `自动终止`, `timeout`, `timed out`.
   - User-initiated cancellation should still call `onCancelled`.
   - Keep terminal callback one-shot behavior intact.

2. Replace the mojibake fallback error text.
   - Replace `娴佸紡璇锋眰澶辫触` with valid Chinese such as `流式请求失败`.
   - Do not perform broad encoding rewrites.

3. Keep API compatibility.
   - Do not change the function name.
   - Do not remove existing callbacks.
   - Do not change allocation result schema or SSE backend protocol.

## Validation

Run:

```powershell
cd frontend
npm.cmd run check
npm.cmd run build
```

Expected result:

- TypeScript check passes.
- Production build passes.
- `cancelled` timeout messages route to `onError`; user cancel still routes to `onCancelled`.
- No mojibake remains in `generateAllocationStream` user-facing error fallback.
- No files outside the allowed scope are modified.

## Stop Conditions

Stop and write a report instead of guessing when:

- The fix requires editing files outside the approved scope.
- You believe backend protocol changes are required.
- Validation fails for reasons unrelated to this hotfix.
- The repo state is too different from this handoff.

## Final Report Required

Write `docs/pm/reports/FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001-HOTFIX.md`.

Start the report with:

```markdown
## PM Digest

Status: complete | needs_fix | blocked | decision_needed
Changed: file1, file2
Validation: passed | failed | skipped - command names only
Risk: none | brief risk
Decision: none | exact PM/user question
Next: accept | create_hotfix | run_followup | ask_user
```

Then include status, summary, files changed, validation, scope/safety, risks, and recommended next action.
