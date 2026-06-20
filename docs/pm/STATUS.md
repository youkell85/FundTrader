# FundTrader PM Status

## Current State

PM workflow installed. P1, P2, and P3 allocation calibration tasks are complete.
The latest production runtime deploy is commit `d9b60e5`
(`chore(gitnexus): refresh index metadata`). That deploy pulled from Gitee,
rebuilt the frontend/BFF bundle, restarted `fundtrader-frontend`, and passed
basic production smoke:

- `/fund/api/health` returned ok
- `/fund/` returned HTTP 200
- remote `/opt/fundtrader` HEAD was `d9b60e5`
- `fundtrader-frontend` was active

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
- Current boundary: DSA/GPT runtime code through `d9b60e5` is committed, pushed
  to GitHub/Gitee, and deployed. If the DSA/GPT track is resumed for formal
  closeout, run the server-side market-context cache refresh and the DSA-specific
  production smoke explicitly instead of relying only on the basic app health
  check. Later documentation-only PM commits do not require app redeploy.

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
Latest runtime deployment after subsequent allocation/UI/data-truth work was
completed at commit `d9b60e5`. Documentation-only PM updates after that commit
do not change the deployed app bundle.

P3 note: unauthenticated production `POST /fund/api/allocation/generate`
returning HTTP 401 is accepted as WARN, not FAIL, in the current smoke policy.

## Refactor Boundary Notes

Keep future refactors focused and evidence-backed:

- `backend/app/api/fund.py` is the main detail/provenance/report surface. Split
  it only by stable route families, and keep `detail-completeness` as the
  contract anchor.
- `frontend/src/pages/FundDetail.tsx` and `frontend/src/pages/FundDetail/`
  should preserve explicit `available` / `partial` / `missing` display states.
- `frontend/src/hooks/useAllocationData.ts` and
  `frontend/src/lib/execution-plan.ts` are high-impact allocation result gates.
  Run GitNexus impact/detect-changes before touching them.
- `frontend/src/components/allocation/RebalancePanel.tsx` must not reintroduce
  demo current-holding fallbacks; show blocked or missing state until real
  holdings exist.
- BFF proxy timeout behavior belongs in `frontend/api/boot.ts` and
  `frontend/src/lib/api.ts`; do not add separate ad hoc AbortController logic
  for allocation/backtest paths.
