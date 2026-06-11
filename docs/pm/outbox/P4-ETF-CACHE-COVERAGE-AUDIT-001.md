# P4-ETF-CACHE-COVERAGE-AUDIT-001 - P4 ETF cache coverage audit

Created: 2026-06-11T00:08:16+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

Add a read-only diagnostic for the P4 long-window ETF cache dependency. The
manual long-window producer currently returns unavailable when local
`ETFPriceCache` coverage is too sparse; this task makes the missing coverage
visible per representative ETF before any write, network fetch, commit, deploy,
or product decision.

## Context

- Current repo: FundTrader
- Current task owner: Codex PM
- Coding agent role: implementer only
- Important background:
  - Keep unrelated dirty worktree changes untouched.
  - If repo state has drifted from this handoff, stop and report before editing.

## Approved Scope

Files or areas the coding agent may edit:

- `scripts/check-etf-cache-coverage.ps1`
- `docs/pm/outbox/P4-ETF-CACHE-COVERAGE-AUDIT-001.md`
- `docs/pm/reports/P4-ETF-CACHE-COVERAGE-AUDIT-001.md`

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

1. Add a PowerShell script that audits local SQLite `etf_daily_prices` coverage
   for the P4 representative ETF map used by `long_window_producer`.
2. Keep the script read-only: no `ETFPriceCache.save_batch`, no
   `StatsSnapshotCache.save`, no live provider calls, no schema changes.
3. Report total rows, min/max dates, 3-year window rows, and availability status
   per asset. Include `-Json` output for PM acceptance.
4. Return exit code `0` when coverage is enough for P4 producer, `2` when
   coverage is insufficient, and `1` only for real execution errors. Add an
   explicit validation-only switch that allows insufficient coverage to return
   `0` while keeping the default exit-code contract intact.

## Contracts And Design Decisions

List stable interfaces, API contracts, UX rules, data-shape rules, or module
boundaries that the coding agent must preserve.

- Do not modify production request paths or allocation runtime behavior.
- Use existing `ASSET_CLASSES` and `long_window_producer.REPRESENTATIVE_ETFS`.
- Match producer coverage semantics: cash is synthesized, and missing
  `money_fund` can be synthesized by the producer.
- Do not fetch market data or write local caches in this task.

## Validation

Commands or checks the coding agent must run:

```powershell
.\scripts\check-etf-cache-coverage.ps1 -AsOfDate 2026-06-10 -Json -AllowInsufficient
python -m py_compile backend\app\allocation\data\long_window_producer.py
git diff --check -- scripts\check-etf-cache-coverage.ps1 docs\pm\outbox\P4-ETF-CACHE-COVERAGE-AUDIT-001.md
```

Expected result:

- Coverage script runs and reports either `status: ok` or
  `status: insufficient` without writing cache.
- Py compile passes.
- Diff check passes.

## Stop Conditions

Stop and write a report instead of guessing when:

- The implementation requires changing files outside the approved scope.
- A product, architecture, data-contract, or deployment decision is missing.
- Validation fails for reasons unrelated to this task.
- The repo state is too different from the assumptions in this handoff.

## Final Report Required

Write `docs/pm/reports/P4-ETF-CACHE-COVERAGE-AUDIT-001.md` with:

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
