# HF1-P1-REAL-IC-DECAY-001 - HF1 fix P1 real IC test failures

Created: 2026-06-10T18:58:05+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Hotfix the failed P1 real historical IC decay handoff by fixing the current targeted test failures and writing the required PM report.

The previous dispatch implemented changes in `market_data_service.py`, `ic_decay.py`, and new IC tests, but timed out without a report. Its targeted test run showed 7 failures. Do not redesign the feature; only repair the known failures and validate.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `backend/app/allocation/data/market_data_service.py`
- `backend/app/allocation/data/ic_decay.py`
- `backend/tests/test_ic_decay.py`
- `backend/tests/test_market_data_service_ic_decay.py`
- `docs/pm/reports/HF1-P1-REAL-IC-DECAY-001.md`

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
- `backend/app/storage/database.py` unless a one-line import/test seam is absolutely required
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

1. Inspect the current diffs in the approved files and the previous log `docs/pm/logs/P1-REAL-IC-DECAY-001.jsonl` for the exact failures.
2. Fix the known targeted failures:
   - `build_daily_signal_series(...)` tests currently use fewer than the implementation's minimum valid observations; make tests realistic or make the helper accept an explicit testable minimum without weakening production behavior.
   - `patch("app.allocation.data.market_data_service.MacroCache")` and `ETFPriceCache` currently fail because those names are imported inside the function; patch the correct target or introduce a narrow module-level import seam.
   - `market_data_service.market_data_service._ic_decay_cache` access is wrong because `from app.allocation.data import market_data_service` returns the singleton instance; set `_ic_decay_cache` on the instance directly.
3. Confirm the historical IC implementation still meets the original contract:
   - no proxy IC from current snapshot,
   - insufficient history is explicit and causes static TAA fallback,
   - real historical path computes `quality`, `half_life`, and `ic_mean` from aligned series.
4. Run validation commands below.
5. Write `docs/pm/reports/HF1-P1-REAL-IC-DECAY-001.md`.
6. Do not commit, push, deploy, stage files, or modify git remotes.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- `market_data_service.get_ic_decay()` may return `None` or an insufficient-history marker; TAA must continue to fall back to static weights.
- Preserve existing consumed IC keys: `quality`, `half_life`, `ic_mean`.
- New metadata must be additive.
- No allocation API request path may perform external network calls.
- Do not clean up unrelated encoding/text issues.
- No product decision is needed for this HF.

## Validation

Commands or checks the coding agent must run:

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest tests/test_ic_decay.py tests/test_market_data_service_ic_decay.py tests/test_taa_confidence_attenuation.py -q
python -m pytest -q

cd D:\Workspace\Fundtrader
git diff --check
git status --short --untracked-files=all
```

Expected result:

- Targeted IC/TAA tests pass.
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

Write `docs/pm/reports/HF1-P1-REAL-IC-DECAY-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
