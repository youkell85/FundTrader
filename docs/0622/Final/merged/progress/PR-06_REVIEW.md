# PR-06 Professional Fund Evaluation Review

## Scope
- Kept legacy `professional_analysis()` behavior unchanged.
- Added API-layer augmentation for `/professional/{code}` through `professional_score_service`.
- Added `professional_evaluation`, `style_analyzer`, and `brinson` modules.
- Added standalone `/professional/:code` frontend page for professional score, evidence completeness, and Brinson readiness.
- Kept existing fund detail diagnosis rendering chain unchanged after GitNexus staged detect flagged it as too broad.

## GitNexus Impact
- `backend/app/api/professional.py:fund_professional` upstream impact: LOW.
- `frontend/src/App.tsx:App` upstream impact: LOW.
- Prior implementation touched `professional_service.py` and `DiagnosisTab`, then produced HIGH staged detect; it was reworked so the legacy service and diagnosis tab are no longer modified.

## Data Contract
- Existing `/professional/{code}` fields remain compatible: `sharpe_ratio`, `max_drawdown`, `volatility`, `asset_allocation`, `industry_distribution`, `style_box`, and `nav_summary`.
- New fields are additive: `professional_score`, `style_profile`, and `brinson_attribution`.
- Each professional score pillar has either evidence refs or explicit `status=missing` plus `missing_reason`.
- If evidence completeness is below the threshold, `total_score` is downgraded to null.
- If holdings or industry evidence is missing, Brinson returns `status=missing` and does not invent attribution effects.

## Verification
- `cd backend && python -m pytest tests/test_professional_service_contract.py`
  - 10 passed.
- `cd frontend && npm run check`
  - passed.
- Import smoke:
  - `imports_ok`.

## Residual Risk
- Brinson attribution remains readiness-only until real benchmark industry weights are available.
- Cost scoring depends on real fee fields from `fund_metadata_cache` or `fund_metrics_snapshot`; missing fee evidence downgrades the cost pillar.
- Professional score is a research aid, not a regulatory fund rating.
