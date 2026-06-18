# FT-P2-1 - Fixed Prompt Template Lightweight Fund Agent

## Goal

Harden FundTrader's fixed-template lightweight Fund Agent around three whitelisted templates: single-fund diagnosis, portfolio explanation, and DCA review.

## Context

`docs\0615\gpt` says FundTrader should not import a full TradingAgents multi-agent stack. The right P2 target is fixed prompt templates and whitelisted tool plans built from audited fund evidence packs.

Claude coding agent execution is currently unavailable in this environment because CC Switch returns `AppIdNoAuthError`; Codex PM fallback may execute the scoped implementation and must report that fallback explicitly.

## Approved Scope

- Use existing `backend\app\agents\fund_agent.py` if present.
- Ensure exactly these template IDs exist:
  - `single_fund_diagnosis`
  - `portfolio_explanation`
  - `dca_review`
- Each template must declare allowed tools and consume only evidence-pack/context inputs.
- Missing evidence must downgrade plan status/conclusion strength.
- Do not add live LLM calls, arbitrary tool execution, or generalized agent routing.

## Allowed Files

- `backend\app\agents\fund_agent.py`
- `backend\tests\test_fund_agent.py`
- `docs\pm\reports\FT-P2-1.md`

If equivalent behavior already exists, add tests/report instead of duplicating code.

## Implementation Tasks

1. Inspect existing Fund Agent template code.
2. Harden template IDs, allowed tools, evidence compacting, and missing-data behavior if needed.
3. Add focused tests for all three templates and missing evidence downgrade.
4. Write the final implementation report to `docs\pm\reports\FT-P2-1.md`.

## Validation

Run only this safe validation block:

```powershell
cd backend
$env:PYTHONPATH = (Get-Location).Path
pytest tests\test_fund_agent.py -q
```

## Acceptance Criteria

- Three fixed templates are available and stable.
- Output references only whitelisted tools/evidence.
- Missing evidence downgrades plan status instead of fabricating a confident recommendation.
- Tests pass without live LLM calls.

## Final Report Required

Write `docs\pm\reports\FT-P2-1.md` with:

- implementation summary
- files changed
- validation command/result
- PM fallback note if Claude coding agent was unavailable
- residual risks or follow-up items
