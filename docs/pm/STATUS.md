# FundTrader PM Status

## Current State

PM workflow installed. P1 and P2 allocation calibration tasks are complete and locally accepted.

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

No active running PM task.

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

Deployment still requires explicit user approval.

P3 note: unauthenticated production `POST /fund/api/allocation/generate`
returning HTTP 401 is accepted as WARN, not FAIL, in the current smoke policy.
