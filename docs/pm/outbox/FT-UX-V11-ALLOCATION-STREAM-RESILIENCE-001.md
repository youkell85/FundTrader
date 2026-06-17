# FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001 - Allocation Generation Stream Resilience

Created: 2026-06-16T00:00:00+08:00
PM: Codex
Executor: Claude Code via local `scripts/pm-dispatch.ps1`

## Goal

Make FundTrader allocation generation feel reliable even when the quantitative pipeline is slow.

The user-facing outcome: when the user starts "生成真实配置方案", the UI must not appear frozen. It should show timely progress, show that the engine is still alive during long steps, and end in a clear success, failure, timeout, or user-cancelled state.

This is a stream/progress resilience task only. Do not change allocation math, macro data fetch logic, fund mapping, SAA/TAA/Monte Carlo calculations, output schema, or portfolio recommendations.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Current baseline:
  - `backend/app/api/allocation.py` exposes `POST /allocation/generate/stream` via `StreamingResponse`.
  - The stream only yields when `progress_queue` receives progress/result/error/cancelled messages.
  - If a backend step takes a long time before the next callback, the frontend can look stuck.
  - The backend can raise `TaskCancelledError` on user cancel or total timeout, but the stream currently sends a generic `cancelled` message.
  - `frontend/src/lib/api.ts` reads SSE manually and ignores unknown/done events.
  - If the stream closes without `result`, `error`, or `cancelled`, callers can remain in a generating state.
  - `OverviewPage.tsx` and `AllocationWizard.tsx` both use `generateAllocationStream`.
  - `AllocationProgress.tsx` renders the step list and elapsed time, but has no "still working / waiting for engine" notice.
  - The repo currently has unrelated dirty work from prior PM tasks plus `backend/.env`. Preserve all unrelated changes.

## Allowed Files

- `backend/app/api/allocation.py`
- `frontend/src/lib/api.ts`
- `frontend/src/components/allocation/AllocationProgress.tsx`
- `frontend/src/pages/allocation/OverviewPage.tsx`
- `frontend/src/pages/AllocationWizard.tsx`
- `docs/pm/reports/FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001.md`

## Approved Scope

You may edit only:

- `backend/app/api/allocation.py`
- `frontend/src/lib/api.ts`
- `frontend/src/components/allocation/AllocationProgress.tsx`
- `frontend/src/pages/allocation/OverviewPage.tsx`
- `frontend/src/pages/AllocationWizard.tsx`
- `docs/pm/reports/FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001.md`

You must not edit:

- Allocation engine math or model files
- Macro data fetchers
- Fund mapping/ranking logic
- Database/storage files
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

1. Add backend SSE heartbeat without changing allocation results.
   - In `backend/app/api/allocation.py`, make `/allocation/generate/stream` emit lightweight heartbeat messages while the worker thread is alive but no progress event has arrived for several seconds.
   - Heartbeat messages may use an extra SSE payload shape such as `{ "type": "heartbeat", "elapsed": <seconds>, "message": "..." }`.
   - Do not change `AllocationResponse`, `/allocation/generate`, or pipeline calculation logic.
   - Keep existing `progress`, `result`, `error`, `cancelled`, and final `done` behavior compatible.

2. Preserve meaningful cancellation/timeout semantics.
   - When `TaskCancelledError` is raised, include its message in the stream payload.
   - If the message indicates a pipeline timeout/auto termination, the frontend should show it as a clear failure/timeout message rather than silently treating it like a user cancel.
   - User-initiated cancel should still stop generating without pretending a result exists.

3. Harden the frontend SSE reader in `frontend/src/lib/api.ts`.
   - Keep the existing function name and existing callback compatibility.
   - It must handle `heartbeat` and `done` events.
   - It must detect a stream that closes without terminal `result`, `error`, or `cancelled`, and call `onError` with a readable Chinese message.
   - It must not call `onDone` more than once.
   - It must not swallow JSON parse errors in a way that breaks the stream; skipping malformed lines is fine.

4. Surface "still working" feedback in both allocation entry points.
   - Update `OverviewPage.tsx` and `AllocationWizard.tsx` to show heartbeat/waiting messages through `AllocationProgress`.
   - Reset the notice at generation start, on success, on error, and on cancel.
   - Keep the existing cancel button and elapsed timer behavior.
   - Do not change navigation after success.

5. Improve `AllocationProgress.tsx` readability for long-running steps.
   - Add an optional notice/waiting prop.
   - Show concise text such as "引擎仍在运行，正在等待下一步结果..." when applicable.
   - Keep layout compact on desktop and mobile.
   - Do not add new dependencies.

## Contracts And Design Decisions

- Existing callers of `generateAllocationStream` must remain source-compatible.
- `AllocationProgress` may receive optional new props, but existing required props must keep working.
- SSE extra event types are additive only; existing clients that ignore them should still work.
- `AllocationResponse` and all allocation output fields must remain unchanged.
- No fake allocation output may be generated.
- User-facing Chinese text in touched UI should be valid UTF-8 and not mojibake.

## Validation

Run:

```powershell
cd frontend
npm.cmd run check
npm.cmd run build
```

Run backend syntax validation:

```powershell
cd backend
python -m py_compile app/api/allocation.py
```

If practical, do a local stream smoke test. If backend dependencies or external data make this impractical, state the limitation clearly in the report and rely on build/type/syntax checks plus code review.

Expected result:

- TypeScript check passes.
- Production build passes.
- Python syntax validation passes.
- `generateAllocationStream` handles progress, heartbeat, result, error, cancelled, done, and premature stream close.
- Both allocation entry points surface long-running status instead of appearing frozen.
- No files outside the allowed scope are modified.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- The task requires changing allocation engine math or macro-data fetch behavior.
- A product/API decision is needed for a non-additive SSE contract change.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/FT-UX-V11-ALLOCATION-STREAM-RESILIENCE-001.md`.

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
