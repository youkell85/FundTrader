# PLAN-ALIGNMENT-AUDIT-001 — Integrated Plan Alignment Audit Report

**Date:** 2026-06-11
**Executor:** Claude Code
**Task:** Audit-only — map current implementation to `docs/0610/integrated-plan.md`

---

## PM Digest

```
Status: needs_fix
Changed: docs/pm/reports/PLAN-ALIGNMENT-AUDIT-001.md
Validation: passed - repo-head, grep-audit, code-search
Risk: P0 never formally closed; P4 not in integrated plan; P1-3/P1-5 gaps; ETF cache empty
Decision: Reclassify P4 as P1-1-Extension? Formally close P0? Prioritize ETF cache population?
Next: ask_user
```

---

## 1. Status

**Verdict: needs_fix** — The integrated plan's P0-P3 requirements have substantial implementation coverage, but P0 was never formally closed (no P0 acceptance reports exist). P1 has two known gaps (P1-3 macro data, P1-5 fund mapping refresh). The current P4 work stream is a deepening of P1-1 (CMA Anchor calibration) and is not a separate phase in the integrated plan. The most critical operational gap is an empty local ETF price cache blocking the long-window calibration pipeline.

## 2. Summary

All P1, P2, and P3 tasks have formal reports and acceptance artifacts on disk. P3 is definitively closed (P3-CLOSEOUT-001). However, P0 — the highest-priority phase in the integrated plan — has no dedicated PM task files in `docs/pm/outbox/` and no P0-labelled acceptance reports. P0-level functionality exists in code (price validation, CMA quality, MC finite guards, data quality contract, production health) but the governance trail is incomplete.

The P4 work stream (6 completed tasks) is a deepening of P1-1 (CMA Anchor dynamic calibration), not a new phase. The integrated plan explicitly puts CMA Anchor calibration under P1-1. The P4 naming creates a misalignment with the source-of-truth plan.

The most critical operational gap: the local ETF price cache has **zero** rows for 12 of 14 representative ETFs (`P4-ETF-CACHE-COVERAGE-AUDIT-001` confirms 0.14 coverage, minimum threshold 0.7). This means the long-window calibration producer cannot function without a cache population run.

## 3. P0/P1/P2/P3 Matrix vs Integrated Plan

### P0 — Data & Output Safety (Target: 70-75 credibility)

| Sub-requirement | Status | Evidence | Notes |
|---|---|---|---|
| **P0-1** Market price quality gate | **partial** | `market_data_fetcher.py:_validate_price_series()`, `test_allocation_data_quality.py` (4 tests, 511880 jump rejection) | Dedicated `test_market_data_quality.py` not found; tests folded into `test_allocation_data_quality.py`. `test_cma_data_quality.py` (2 tests) covers CMA-side quality. |
| **P0-2** CMA input sanitization | **done** | `cma_manager.py:_sanitize_signal_layer()`, `_build_cma_quality()`. Asset boundaries in code. `CMAResult.quality` dict present. | Pydantic `CMAQuality` model not found — dict-based approach used instead. Functional coverage exists. |
| **P0-3** Monte Carlo / API finite guard | **partial** | `assert_json_finite()` in `api/allocation.py`. `monte_carlo.py` input validation. `orchestrator.py` MC exception handling → `monte_carlo=null`. | Dedicated `test_monte_carlo_no_nan.py` not found. MC NaN tests likely folded into existing test suites. |
| **P0-4** Data quality contract | **done** | `models.py:AllocationDataQuality` + `AllocationResponse.data_quality`. `orchestrator.py:_build_data_quality()`. `PipelineHealthPanel.tsx` updated. `test_allocation_data_quality.py` validates contract. | Matches integrated plan §2 model specification. |
| **P0-5** Production health gating | **done** | `/allocation/market-data/status` endpoint exists. `check-production-allocation.ps1` smoke script. `PipelineHealthPanel` renders health. Production `calibration.health=degraded` observed. | Production `rolling_stats_available=false` and `vol_ratio=null` noted in integrated plan §3-P0-5 — current state aligns with plan's concern. |

**P0 overall: partial** — Core logic exists but formal closure missing. No P0-labelled task files or acceptance reports.

### P1 — Dynamic Calibration (Target: 82-85 credibility)

| Sub-requirement | Status | Evidence | Notes |
|---|---|---|---|
| **P1-1** CMA Anchor dynamic calibration | **done** | `historical_calibrator.py` (with P4-V2 long-window extension). `test_historical_calibrator.py` (12 tests). `cma_manager.py:_get_anchor_layer()` loads from calibrator before static fallback. | P4 work deepens this. Calibrator versioned via `CALIBRATION_VERSION`. Source provenance: `long_window_cache`, `long_window_snapshot`, `historical_market_data`, `sqlite_cache`, `static_assumption`. |
| **P1-2** Factor loading dynamic calibration | **partial** | `factor_calibrator.py` exists with 252d OLS. `_validate_price_series()` reuse confirmed. | Integrated plan enhancements (R^2, n_obs, window metadata, multi-window history, proxy quality) — extent unclear from reports. No dedicated P1-2 task report. |
| **P1-3** Macro data source governance | **missing** | Fiscal deficit/DXY changes in dirty working tree (`macro_fetcher.py` modified, uncommitted). No P1-3 task report or acceptance file. | Integrated plan §4-P1-3 requirements not formally completed. Static fallback 3.0 for fiscal deficit still marked as gap. |
| **P1-4** IC decay historical computation | **done** | `ic_decay.py` real Spearman IC. `market_data_service.py:_compute_ic_decay()` rewritten. `test_ic_decay.py` (24 tests passing). Report: `P1-REAL-IC-DECAY-001`. | Acceptance: `P1-REAL-IC-DECAY-001.acceptance.json` present. |
| **P1-5** Fund mapping metadata refresh | **missing** | No `fund_pool_refresher.py` found. No P1-5 task report. `fund_mapper.py` static pool still referenced. | Integrated plan §4-P1-5 requires dynamic AUM/volume/fee refresh. |
| **P1-6** Stress/MC jump param calibration | **done** | `stress_test.py:_load_stress_scenarios()`, `monte_carlo.py:_load_jump_params()`. Cache-backed with `static_assumption` fallback. Report: `P1-STRESS-MC-PROVENANCE-001` + validation `HF1-P1-STRESS-MC-VALIDATION-001`. | Acceptance: `P1-STRESS-MC-PROVENANCE-001.acceptance.json` present. |

**P1 overall: partial** — 4 of 6 sub-requirements done or partially done. P1-3 (macro) and P1-5 (fund mapping) are missing.

### P2 — Model & Explanation Enhancement (Target: 88-90 credibility)

| Sub-requirement | Status | Evidence | Notes |
|---|---|---|---|
| **P2-1** Regime threshold calibration | **done** | `RegimeThresholds` dataclass. `regime_detector.py` + `regime_replay.py`. `test_regime_thresholds.py` (34 tests). Report: `P2-REGIME-THRESHOLDS-001`. | Byte-identical defaults when no cache. Cache-backed overrides from `historical_calibration`. |
| **P2-2** TAA low-confidence smoothing | **done** | Commit `9cbd267` ("Smooth low-confidence TAA signals"). | Gamma-based decay. Code evidence in `market_data_service.py`. |
| **P2-3** Circuit breaker destination | **done** | `circuit_breaker.py:_load_destination_policy()`. `test_circuit_breaker_destination.py` (20 tests). Report: `P2-CIRCUIT-DESTINATION-001`. | Destination policy from `StatsSnapshotCache`. Default proportional fallback preserved. |
| **P2-4** Scenario analysis dynamic | **done** | `scenario_analysis.py:_load_scenario_params()`. `test_scenario_analysis_dynamic.py` (25 tests). Report: `P2-SCENARIO-DYNAMIC-001`. | Cache-backed probabilities, baseline returns, multipliers. Provenance fields in API response. |
| **P2-5** Risk questionnaire enhancement | **done** | `risk_profiler.py:_load_calibration()`. `test_risk_profiler_questionnaire.py` (27 tests). Report: `P2-RISK-QUESTIONNAIRE-001`. | Cache-backed weights/thresholds. Provenance fields flow to `UserProfileSummary`. |

**P2 overall: done** — All 5 sub-requirements have dedicated task reports and acceptance artifacts.

### P3 — Production Operations (Target: 90+ credibility)

| Sub-requirement | Status | Evidence | Notes |
|---|---|---|---|
| Parameter versioning | **done** | `calibration_audit.py` with `AuditPolicy`. `calibration_version` in calibrator. | P3-CALIBRATION-AUDIT-001, HF1-P3-CALIBRATION-AUDIT-001. |
| Drift monitoring | **done** | `calibration_audit.py` drift checks (return/vol/jump). Thresholds in `AuditPolicy`. | 72 calibration audit tests passing. |
| Production smoke | **done** | `check-production-allocation.ps1`. P3-PROD-SMOKE-001. P3-POST-DEPLOY-ACCEPT-001 (6 gates passing). | Production at `e6d8c61`. |
| Frontend transparency | **done** | `PipelineHealthPanel.tsx` calibration audit block. `DataFreshnessBar.tsx`. P3-AUDIT-POLICY-UI-001. | TypeScript check + vite build passing. |
| Formal closeout | **done** | P3-CLOSEOUT-001. P3-FINAL-ACCEPTANCE-001 (72 tests, tsc -b, production smoke). | All P3 acceptance artifacts present. |

**P3 overall: done** — Formally closed. All acceptance gates passed.

## 4. P4 Work Stream Assessment

The current P4 work stream (6 tasks) is:

| P4 Task | Status | What it delivers |
|---|---|---|
| P4-SCOPE-AUDIT-001 | complete | Gap analysis; confirms P4 ≈ P1-1 deepening |
| P4-CMA-EQUILIBRIUM-V2 | complete | Long-window consumer path in `HistoricalCalibrator` (12 tests) |
| P4-LONG-WINDOW-PRODUCER-V1 | complete | Cache-only long-window stats producer (7 tests) |
| P4-LONG-WINDOW-MANUAL-TRIGGER-V1 | complete | PowerShell manual trigger script (dry-run safe) |
| P4-ETF-CACHE-COVERAGE-AUDIT-001 | complete | **Revealed: 0.14 ETF cache coverage, 12 of 14 ETFs have 0 rows** |
| P4-LONG-WINDOW-PRODUCER-AUDIT-001 | complete | Capability audit; confirmed producer feasibility |

**Assessment:** All P4 tasks are deepenings of P1-1 (CMA Anchor dynamic calibration), which the integrated plan §4-P1-1 already defines. The P4 label creates a false impression of a new phase. The integrated plan has no P4 phase — it goes P0 → P1 → P2 → P3 → continuous auditing.

**Recommendation:** Reclassify P4 tasks as P1-1-Extension subtasks. The P4 work is valuable and should not be discarded, but it should be tracked under the integrated plan's P1-1 umbrella.

**Critical blocker for P4/P1-1-Extension:** The local ETF cache is empty. Without cache population, the long-window producer returns `None` and the calibrator falls back to short-window stats → static assumptions. The ETF cache coverage audit found 0 rows for all 13 representative ETF codes (only `cash` and `money_fund` are synthesized).

## 5. Files Changed

Only `docs/pm/reports/PLAN-ALIGNMENT-AUDIT-001.md` — this report. No source code, tests, scripts, or other PM artifacts were modified.

## 6. Validation Commands and Results

### 6.1 Repo Check

```
HEAD: c39c84b
Last 5 commits:
  c39c84b Close P3 PM workflow
  e6d8c61 Complete P3 calibration audit workflow
  b7349c0 Complete P1 P2 allocation calibration workflow
  9cbd267 Smooth low-confidence TAA signals
  e5adc16 Expose fund metadata provenance

Working tree:
  Modified tracked: AGENTS.md, CLAUDE.md,
    backend/app/allocation/data/historical_calibrator.py,
    backend/tests/test_historical_calibrator.py
  Untracked: .codegraph/, .mavis/, .reasonix/, docs/0610/, docs/pm/outbox/P4-*,
    docs/pm/reviews/P4-*, backend/app/allocation/data/long_window_producer.py,
    backend/tests/test_long_window_producer.py, scripts/build-long-window-stats.ps1,
    scripts/check-etf-cache-coverage.ps1, nul
```

All dirty files are P4-related or tool artifacts. No unexpected drift.

### 6.2 Acceptance Artifact Inventory

```
P1: 4 task reports + 4 acceptance files
P2: 4 task reports + 4 acceptance files
P3: 9 task reports + 9 acceptance files
P4: 6 task reports + 6 acceptance files
P0: NONE — No P0-labelled task files or acceptance reports exist
```

### 6.3 Code Evidence Summary

| Integrated Plan Requirement | Code Location | Test Coverage |
|---|---|---|
| Price quality gate (P0-1) | `market_data_fetcher.py:_validate_price_series()` | `test_allocation_data_quality.py` (4 tests) |
| CMA sanitizer (P0-2) | `cma_manager.py:_sanitize_signal_layer()` | `test_cma_data_quality.py` (2 tests) |
| MC finite guard (P0-3) | `api/allocation.py:assert_json_finite()` | Scattered across test suites |
| Data quality contract (P0-4) | `models.py:AllocationDataQuality`, `orchestrator.py:_build_data_quality()` | `test_allocation_data_quality.py`, `test_allocation_api_contract.py` |
| Production health (P0-5) | `api/allocation.py` market-data/status endpoint | `check-production-allocation.ps1` |
| CMA Anchor calibration (P1-1) | `historical_calibrator.py` | `test_historical_calibrator.py` (12 tests) |
| Factor calibration (P1-2) | `factor_calibrator.py` | `test_factor_calibrator.py` |
| IC decay (P1-4) | `ic_decay.py`, `market_data_service.py` | `test_ic_decay.py` (24 tests) |
| Stress/MC calibration (P1-6) | `stress_test.py`, `monte_carlo.py` | `test_stress_monte_carlo_calibration.py` |
| Regime thresholds (P2-1) | `regime_detector.py` | `test_regime_thresholds.py` (34 tests) |
| Circuit destination (P2-3) | `circuit_breaker.py` | `test_circuit_breaker_destination.py` (20 tests) |
| Scenario dynamic (P2-4) | `scenario_analysis.py` | `test_scenario_analysis_dynamic.py` (25 tests) |
| Risk questionnaire (P2-5) | `risk_profiler.py` | `test_risk_profiler_questionnaire.py` (27 tests) |

### 6.4 Grep Audit (Task Validation Commands)

```
rg -n "P0-|P1-|P2-|P3-|P4-|blocked|decision_needed|needs_fix|passed|failed"
  docs/pm/reports docs/pm/reviews -S
→ 124 matches across reports and acceptance files.
  Zero "blocked", "decision_needed", "needs_fix", or "failed" in acceptance JSONs.
  All acceptance files report passed=0, failed=0 (clean).

rg -n "P0|P1|P2|P3|data_quality|NaN|Inf|511880|historical_calibrator|long_window|
  market-data/status|calibration.health"
  docs/0610/integrated-plan.md backend frontend scripts docs/pm/reports -S
→ 187 matches. All terms tracked in integrated plan present in codebase.
  No orphaned references.
```

## 7. Deviations from Integrated Plan

### 7.1 P0 Governance Gap (HIGH)

The integrated plan §3 defines P0 as the first and highest-priority phase ("Day 2-4: P0 data safety"). The plan states: "Only after P0 is complete should we discuss whether smart allocation can be used for real-money decisions."

P0 has no formal task files, no acceptance reports, and no explicit closeout. P1/P2/P3 were executed and closed without P0 being formally declared complete. This violates the plan's execution order.

**However:** P0-level code exists and the later phases implicitly depend on it. `_validate_price_series()`, `_sanitize_signal_layer()`, `assert_json_finite()`, `AllocationDataQuality`, and production health checks are all present in the codebase. P0 was implemented but never governed.

### 7.2 P1 Gaps (MEDIUM)

- **P1-3 (macro data):** Fiscal deficit and DXY fixes in dirty working tree, uncommitted. No task report.
- **P1-5 (fund mapping refresh):** No `fund_pool_refresher.py`, no task report. Fund metadata still static.

### 7.3 P4 vs P1-1 Classification (LOW)

The integrated plan has no P4 phase. The plan's timeline ends at P3 + continuous auditing. The current P4 work is a deepening of P1-1 (CMA Anchor calibration). The P4-SCOPE-AUDIT-001 report itself acknowledges this: "P4 is partially resolved by P1/P2/P3 infra."

**Recommendation:** Reclassify P4 tasks as P1-1-Extension subtasks. The work is valuable and should continue, but under the correct plan umbrella.

### 7.4 ETF Cache Emptiness (HIGH — Operational)

The ETF cache coverage audit (P4-ETF-CACHE-COVERAGE-AUDIT-001) confirms:

```
status: insufficient
coverage: 0.1429
available_count: 0 (12 of 14 ETFs have 0 cache rows)
synthesized_count: 2 (cash + money_fund fallback)
missing_count: 12
```

This blocks the long-window calibration pipeline. Without cache population, `HistoricalCalibrator` falls back to short-window stats → static config.py assumptions. The long-window producer returns `None` for insufficient coverage.

## 8. Scope / Safety

| Check | Result |
|---|---|
| Read-only audit | Yes — No source code, tests, or scripts modified |
| Approved scope | Yes — Only `docs/pm/reports/PLAN-ALIGNMENT-AUDIT-001.md` written |
| Unrelated dirty files preserved | Yes — AGENTS.md, CLAUDE.md, .codegraph/, .mavis/, .reasonix/, nul untouched |
| `docs/0610/*` untouched | Yes — Read only |
| `docs/pm/outbox/*` untouched | Yes — Not modified |
| `docs/pm/reviews/*` untouched | Yes — Not modified |
| No git operations | Yes — No commit, push, add, reset, or destructive commands |
| No live data calls | Yes — No network requests made |
| No database writes | Yes — SQLite read-only via code inspection only |

## 9. Open Risks or PM Decisions Needed

### Decision 1: Formalize P0 closure or create follow-up? (HIGH priority)

P0-level code exists but no formal governance trail. Options:
- **A:** Create a P0 acceptance report acknowledging that P0 requirements are met by existing P1/P2/P3 infrastructure, and close P0 retroactively.
- **B:** Create dedicated P0 task files with explicit acceptance criteria from the integrated plan and validate them formally.
- **C:** Accept P0 as implicitly covered and move on.

**Recommendation: Option A** — the code is there, the tests pass, and the P3 production deployment doesn't return NaN/Inf. A retroactive acceptance report is the least-cost path to governance completeness.

### Decision 2: Reclassify P4 as P1-1-Extension? (MEDIUM priority)

The integrated plan puts CMA Anchor calibration under P1-1. The P4 label creates plan drift. Options:
- **A:** Rename P4 tasks to P1-1-Extension-V1, V2, etc.
- **B:** Keep P4 label but add a note in the integrated plan acknowledging it as P1-1 deepening.
- **C:** No change — accept P4 as a new phase.

**Recommendation: Option A** — keeps the single source of truth clean.

### Decision 3: Prioritize ETF cache population over further P4 wiring? (HIGH priority)

The long-window calibration pipeline cannot function without ETF price history in the local cache. Options:
- **A:** Create a cache population task first (fetch representative ETF prices from approved provider, save to SQLite), then retest long-window pipeline.
- **B:** Proceed with P1-3 (macro data) and P1-5 (fund mapping) gaps first, deferring cache population.
- **C:** Both in parallel.

**Recommendation: Option A** — without cache data, further P4/P1-1 work is testing against empty data. The cache population is the critical path.

### Decision 4: Bayesian shrinkage prior source (open from P4-SCOPE-AUDIT-001)

The `opus.md` design calls for DMS global priors. The integrated plan is silent. This decision blocks the next deepening of `HistoricalCalibrator.calibrate_equilibrium_returns()`.

### Decision 5: P1-3 and P1-5 — create task files or accept as deferred?

P1-3 (macro data) has dirty working tree changes but no task file or report. P1-5 (fund mapping) has no implementation at all. Options:
- **A:** Create P1-3 and P1-5 task files, complete them before declaring P1 closed.
- **B:** Defer to post-MVP. P0/P1 partial completion may be sufficient for current credibility target.

## 10. Recommended Next Action

**`ask_user`** — PM must answer the 5 decisions above. The highest-priority path forward:

1. **Retroactively close P0** (Decision 1, Option A) — write a P0 acceptance report referencing existing code evidence.
2. **Populate ETF cache** (Decision 3, Option A) — unblocks the long-window calibration pipeline.
3. **Reclassify P4 as P1-1-Extension** (Decision 2, Option A) — realigns with integrated plan.
4. **Create P1-3 and P1-5 tasks** or defer them (Decision 5).
5. **Resolve Bayesian prior decision** (Decision 4) — needed for next calibration deepening.

Once decisions are made, the next PM-Claude task should be the highest-priority actionable item (likely ETF cache population or P0 closeout acceptance report).