# P1-REAL-IC-DECAY-001 - P1 real historical IC decay

Created: 2026-06-10T18:36:00+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Replace the current proxy IC decay calculation with a genuine historical IC path where local cached history is available, while preserving graceful fallback when history is insufficient.

TAA adaptive factor weights should be based on rank correlation between historical macro signal values and forward asset returns, not a single current macro snapshot multiplied by confidence. API request paths must remain cache-only and must not trigger external network calls.

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
- `backend/app/storage/database.py` only if a small read-helper is needed for cached history
- `backend/tests/test_ic_decay.py`
- `backend/tests/test_market_data_service_ic_decay.py`
- Existing allocation tests only if they need narrow compatibility updates

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

Also run GitNexus impact analysis before editing these symbols and summarize the risk in the final report:

```powershell
npx gitnexus impact MarketDataService._compute_ic_decay --repo FundTrader
npx gitnexus impact compute_ic_series --repo FundTrader
```

If the CLI syntax differs, run the closest available GitNexus impact command or report the exact CLI limitation.

## Implementation Tasks

1. Inspect `MarketDataService._compute_ic_decay`, `ic_decay.compute_ic_series`, `ic_decay.analyze_macro_signals`, `MacroCache.get_history`, and available ETF price/cache helpers.
2. Implement historical IC computation using only local cached data during refresh:
   - Build category-level macro signal time series from `MacroCache.get_history(...)`.
   - Align signal dates to asset return dates where possible.
   - Use representative asset return series from already available local rolling/cache data or existing local ETF price cache helpers.
   - Prefer existing `ic_decay.compute_ic_series` / `analyze_macro_signals` utilities rather than inventing a separate metric.
3. If historical macro or return history is insufficient, do not fabricate IC from the current snapshot. Instead, leave IC data unavailable or mark the result with explicit metadata such as `source: "insufficient_history"` so `_get_adaptive_weights()` falls back to static weights.
4. Extend IC result metadata enough for PM/API diagnostics: include source, sample size, as-of date/window when available.
5. Keep request-time behavior unchanged: API reads from in-memory cache only; no network calls in TAA request path.
6. Add focused unit tests covering:
   - Real historical IC path from synthetic cached macro/return series.
   - Insufficient history fallback does not produce proxy fake IC.
   - Existing `compute_ic_series` behavior remains stable.
7. Do not commit, push, deploy, stage files, or modify git remotes.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- `market_data_service.get_ic_decay()` may still return `None`; `taa_engine._get_adaptive_weights()` must continue to fall back to static weights.
- Do not break existing IC result keys consumed by TAA: `quality`, `half_life`, `ic_mean`.
- New metadata fields must be additive.
- No external network calls are allowed from allocation request paths.
- Do not clean up unrelated encoding or Chinese text display issues.
- Stop if choosing a benchmark asset universe requires a product decision beyond the existing representative ETF mapping.

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

- New targeted IC tests pass.
- Full backend suite passes or unrelated failures are clearly explained.
- `git diff --check` has no errors other than known CRLF warnings if present.
- `git status` shows only approved-file changes plus PM workflow artifacts and pre-existing unrelated dirty files.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P1-REAL-IC-DECAY-001.md` with:

1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed

Do not include hidden chain-of-thought or `<think>` blocks.
