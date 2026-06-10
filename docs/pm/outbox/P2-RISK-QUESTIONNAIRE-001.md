# P2-RISK-QUESTIONNAIRE-001 - P2 risk questionnaire calibration metadata

Created: 2026-06-10T19:59:46+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Bring the P2 risk questionnaire work to an acceptance-ready state without changing product copy or the visible questionnaire options. The current three-question behavior calibration must remain the default behavior, while the backend gains a cache-backed calibration policy and provenance metadata so future questionnaire scoring can be adjusted from historical calibration data rather than only hardcoded constants.

The API response should expose enough optional metadata for PM/QA/front-end consumers to tell whether behavior calibration used static defaults or a historical calibration snapshot. Missing or invalid calibration data must degrade safely to the existing static behavior.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/risk_profiler.py`
- `backend/app/allocation/models.py`
- `backend/app/allocation/orchestrator.py`
- `backend/tests/test_risk_profiler_questionnaire.py` or another focused new/updated backend test file
- `frontend/src/types/allocation.ts`

Files or areas the coding agent must not edit:

- Frontend questionnaire copy/options in `frontend/src/pages/AllocationWizard.tsx` unless PM explicitly approves a product copy change
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

Also follow the repo GitNexus rule before editing symbols:

```powershell
npx gitnexus impact profile_user --direction upstream
npx gitnexus impact RiskProfile --direction upstream
npx gitnexus impact UserProfileSummary --direction upstream
```

If the exact CLI syntax differs, run the equivalent GitNexus impact command and report the direct callers, affected flows, and risk level. If any impact result is HIGH or CRITICAL, stop and report instead of editing.

## Implementation Tasks

1. Add a small risk-questionnaire calibration loader in `risk_profiler.py` that attempts to read `StatsSnapshotCache("historical_calibration")` params under a dedicated key such as `risk_questionnaire.params`. The loader must validate shape and values, ignore malformed entries, and fall back to the existing `_BEHAVIOR_ADJUSTMENTS` and threshold behavior.
2. Preserve the current default behavior exactly:
   - Existing question IDs remain `q1_drawdown`, `q2_rally`, `q3_volatility`.
   - Existing answer weights remain unchanged when no valid snapshot exists.
   - Existing thresholds remain: average score `< -0.5` shifts down one risk level; `> 1.5` shifts up one risk level.
   - Unknown answers/questions are ignored.
3. Add optional provenance/diagnostic fields to `RiskProfile` and `UserProfileSummary`, for example:
   - `behavior_score: float | None`
   - `behavior_question_count: int`
   - `behavior_source: str | None`
   - `behavior_calibration_version: str | None`
   - `behavior_as_of: str | None`
   Exact naming may vary, but keep it clear and stable.
4. Wire the new fields from `profile_user()` through `orchestrator.py` into the API response.
5. Update `frontend/src/types/allocation.ts` with the optional response fields only. Do not change UI text or questionnaire UX.
6. Add focused tests covering:
   - default static behavior is unchanged
   - cache-backed weights/thresholds can shift risk differently
   - invalid cache data falls back to static behavior
   - unknown answers are ignored
   - provenance fields appear in profile/summary where appropriate

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- This is a calibration/provenance task, not a questionnaire redesign.
- No commit, no push, no deployment.
- No database migration.
- No frontend product-copy or question-option changes.
- API additions must be backward-compatible optional fields.
- If historical calibration snapshot is missing, stale, partial, or malformed, allocation must still succeed with the current static scoring.
- Do not alter age glide-path, max drawdown override, or risk profile base parameters.
- Keep changes narrow and preserve existing locks/module-level safety rules elsewhere.

## Validation

Commands or checks the coding agent must run:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_risk_profiler_questionnaire.py tests/test_allocation_api_contract.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
```

Expected result:

- All listed commands pass.
- Report any warnings separately; do not hide failures.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P2-RISK-QUESTIONNAIRE-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
