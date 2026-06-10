# P2-REGIME-THRESHOLDS-001 - P2 calibratable regime thresholds

Created: 2026-06-10T19:10:16+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Make regime scoring and classification thresholds calibratable while preserving current behavior when no calibration snapshot exists.

The regime detector currently hard-codes neutral points and quadrant threshold values. P2 acceptance requires these values to come from a documented default config with optional cached calibration override, so future historical calibration can tune them without editing classification logic.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/regime_detector.py`
- `backend/app/allocation/backtest/regime_replay.py`
- `backend/tests/test_regime_thresholds.py`
- Existing allocation tests only if narrow compatibility updates are needed

Files or areas the coding agent must not edit:

- `AGENTS.md`
- `CLAUDE.md`
- `.codegraph/**`
- `.mavis/**`
- `.reasonix/**`
- `docs/0610/**`
- `docs/pm/outbox/**`
- `docs/pm/running/**`
- `docs/pm/logs/**`
- `nul`
- Frontend files
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

Run GitNexus impact analysis before editing these symbols and summarize the blast radius in the report:

```powershell
npx gitnexus impact detect_regime --repo FundTrader
npx gitnexus impact _classify_quadrant --repo FundTrader
npx gitnexus impact detect_regime_at --repo FundTrader
```

If the CLI syntax differs, use the closest available GitNexus command and report the limitation.

## Implementation Tasks

1. Inspect current live `regime_detector.py` and backtest `regime_replay.py` scoring/classification duplication.
2. Introduce a small regime threshold config structure with current hard-coded values as defaults:
   - quadrant threshold currently `0.2`;
   - PMI neutral `50.0`, PMI scale `2.0`;
   - GDP neutral `4.5`, GDP scale `3.0`;
   - CPI neutral `2.0`, CPI scale `2.0`;
   - PPI neutral `0.0`, PPI scale `4.0`;
   - M2 neutral `8.5`, M2 scale `3.0`;
   - 10Y yield neutral `3.0`, 10Y scale `1.0`.
3. Load optional cached overrides from local `StatsSnapshotCache.get("historical_calibration")`, preferably a nested section such as `regime_thresholds.params`. Invalid/missing values must fall back per-field to defaults.
4. Apply the same thresholds to live detection and backtest replay so they do not diverge.
5. Do not change persistence locks or `_PERSISTENCE_MIN_INTERVAL_S`.
6. Add focused tests covering:
   - default config preserves existing quadrant outcomes;
   - cached threshold override changes classification at the boundary;
   - invalid cached values fall back to defaults;
   - backtest replay and live detector share equivalent threshold semantics.
7. Do not commit, push, deploy, stage files, or modify git remotes.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Existing regime names and `RegimeState` fields must not change.
- Existing behavior must remain unchanged when no cached calibration exists.
- Live detection and backtest replay should use the same threshold semantics.
- Runtime reads must be local/cache-only; no network calls.
- Preserve `threading.Lock` usage and module-level persistence state.
- Do not clean unrelated text encoding issues.

## Validation

Commands or checks the coding agent must run:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_regime_thresholds.py tests/test_allocation_api_contract.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader
git diff --check
git status --short --untracked-files=all
```

Expected result:

- New targeted regime threshold tests pass.
- Full backend suite passes or unrelated failures are clearly explained.
- `git diff --check` has no errors other than known CRLF warnings if present.
- No unexpected edits outside approved files, PM workflow artifacts, and pre-existing unrelated dirty files.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P2-REGIME-THRESHOLDS-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
