# FundTrader PM Status

## Current State

PM workflow installed. P1, P2, and P3 allocation calibration tasks are complete.

Latest accepted scope:

- P1 stress/Monte Carlo provenance
- P1 real historical IC decay
- P2 regime thresholds
- P2 circuit breaker destination policy
- P2 scenario dynamic baseline/probability
- P2 risk questionnaire calibration metadata
- P3 calibration audit and drift health
- P3 calibration audit policy config
- P3 calibration audit policy UI
- P3 production allocation smoke script
- P3 post-deploy production acceptance
- P3 closeout

No active running PM task.

## Current PM Track

DSA/GPT technical-borrowing track opened on 2026-06-18 and has advanced beyond
the initial field-provenance handoff.

- Latest closeout: `docs/pm/reports/FT-DSA-CLOSEOUT-2026-06-19.md`
- Source plan: `D:\Workspace\docs\0615\gpt\FundTrader_2026-06-15.md`
- Completed local scope: bond-holding enrichment, market-context cache contract,
  provider/field operations visibility, report evidence narrative, CI coverage,
  and production smoke tooling.
- Current boundary: implementation is locally validated; final acceptance still
  requires commit, push to GitHub/Gitee, production deploy, server-side market
  cache refresh, and production smoke.

P3 status: closed.

- Closed at commit: `e6d8c61 Complete P3 calibration audit workflow`
- Deployed to production: yes
- Post-deploy acceptance: passed
- Closeout report: `docs/pm/reports/P3-CLOSEOUT-001.md`

## Tools

- `scripts/check-production-allocation.ps1` - P3 production allocation smoke check (added 2026-06-10)

## Operating Rules

- Codex acts as PM / reviewer.
- Claude CLI acts as coding agent.
- All tasks are written to docs\pm\outbox.
- Claude reports are written to docs\pm\reports.
- PM reviews are written to docs\pm\reviews.
- Logs are written to docs\pm\logs.
- No commit, push, or deployment without explicit user approval.

## Project-Specific Notes

Accepted locally with:

- `cd backend; python -m pytest -q`
- `cd frontend; npm.cmd run check`
- `cd frontend; npm.cmd run build`
- `scripts/check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api -SkipGenerate`
- `scripts/check-production-allocation.ps1 -BaseUrl http://43.160.226.62/fund/api`

Latest deployment was explicitly approved and completed for P3 commit `e6d8c61`.

P3 note: unauthenticated production `POST /fund/api/allocation/generate`
returning HTTP 401 is accepted as WARN, not FAIL, in the current smoke policy.
