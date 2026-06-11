# P4-SCOPE-AUDIT-001 — P4 Scope Audit for Calibrated Equilibrium Parameters

## PM Digest

Status: complete
Changed: docs/pm/reports/P4-SCOPE-AUDIT-001.md
Validation: passed - repo-head, code-search, file-inspection
Risk: P4 partially resolved by P1/P2/P3 infra but calibrator is thin wrapper
Decision: ask PM whether to deepen calibrator or proceed to P5/P6
Next: ask_user

---

## 1. Status

**Verdict: `complete` — safe next boundary identified.**

P1, P2, and P3 are closed. The next actionable P4 work ("calibrated equilibrium parameters") is partially covered by existing P1/P2/P3 infrastructure — the CMA anchor layer already attempts dynamic calibration via `HistoricalCalibrator`. However, the calibrator is a thin facade over the same 252-day rolling stats used by the Signal layer. It does not implement the long-term equilibrium calibration (multi-year ETF history, Bayesian shrinkage to CAPM priors, Ledoit-Wolf, Tushare data fetch) described in the planning docs (`opus.md`, `integrated-plan.md`). This report proposes the smallest safe implementation slice for deepening P4.

---

## 2. Summary

### 2.1 Current Repo State

| Field | Value |
|-------|-------|
| HEAD | `c39c84b` |
| HEAD short | `c39c84b` |
| Branch | `master` |
| Last 5 commits | Close P3 PM workflow, Complete P3 calibration audit, Complete P1 P2 allocation calibration, Smooth TAA, Expose fund metadata provenance |
| Unrelated dirty files | `AGENTS.md`, `CLAUDE.md`, `.codegraph/**`, `.mavis/**`, `.reasonix/**`, `docs/0610/**`, `nul` |

All dirty files are unrelated and preserved.

### 2.2 PM State Confirmation

From `docs/pm/STATUS.md`: "P1, P2, and P3 allocation calibration tasks are complete. No active running PM task. P3 status: closed."

### 2.3 What P4 Is

From `docs/0610/opus.md` §1.3 (30-item audit):

> **P4** — `config.py` `EQUILIBRIUM_RETURNS` hardcoded (a_share_large=8.5%, etc.) with no documented source. **Impact:** CMA Anchor layer and SAA optimization targets are distorted.

From `docs/0610/integrated-plan.md` §4:

> **P1-1 CMA Anchor 动态校准** — `config.py` 中 `EQUILIBRIUM_RETURNS`、`EQUILIBRIUM_VOLS`、`DEFAULT_CORR` 是核心硬编码。它们作为长期先验可以保留，但不能永远不校准。

The `opus.md` §2.3.1 design proposes a much richer calibrator: 3-5Y Tushare ETF prices, Bayesian shrinkage to DMS global priors, EWMA correlation with Ledoit-Wolf, positive definiteness enforcement.

### 2.4 What P1/P2/P3 Already Delivered (Relevant to P4)

| Delivery | File | P4 Coverage |
|----------|------|-------------|
| **CMA anchor dynamic loading** | `cma_manager.py:_get_anchor_layer()` | ✅ Loads from `HistoricalCalibrator` before falling back to static config. Produces quality metadata (source, as_of, coverage, calibration_version). |
| **HistoricalCalibrator facade** | `historical_calibrator.py` (316 lines) | ⚠️ Partial — reads from `compute_rolling_stats_ex()` (same Signal data), not true multi-year equilibrium. |
| **Signal layer sanitizer** | `cma_manager.py:_sanitize_signal_layer()` | ✅ Invalid/out-of-bounds signal values are rejected per-asset with group-aware bounds. `money_fund` capped to [-2%, 8%] return, [0%, 3%] vol. |
| **CMA quality metadata** | `cma_manager.py:_build_cma_quality()` | ✅ Outputs `data_status`, `blend_lambda`, `rolling_coverage`, `valid_assets`, `invalid_assets`, `anchor_source`, `anchor_as_of`, `calibration_version`. |
| **Calibration audit** | `calibration_audit.py` | ✅ Reads `StatsSnapshotCache("historical_calibration")`, compares against config.py drift thresholds. |
| **Orchestrator quality aggregation** | `orchestrator.py` | ✅ `AllocationDataQuality` model + per-step quality aggregation in pipeline. |
| **AllocationResponse data_quality** | `models.py` | ✅ `AllocationDataQuality` with per-module `DataQualityItem` objects already in the API response contract. |

**Assessment:** P4's infrastructure needs (dynamic anchor loading, quality metadata, audit) are already built. The gap is that the calibrator itself uses the same rolling data already available from `MarketDataService` — it's not a distinct long-term equilibrium calculation.

### 2.5 Gap Analysis

| Dimension | Current State | P4 Target (per planning docs) | Gap |
|-----------|--------------|------|-----|
| Data window | 252-day rolling (Signal layer data) | 3-5 year ETF daily prices from Tushare | **Not implemented** |
| Return estimation | Simple mean of 252d daily returns | Bayesian shrinkage to DMS global CAPM priors | **Not implemented** |
| Correlation matrix | EWMA from 252d data | EWMA + Ledoit-Wolf shrinkage + positive definiteness | **Partially** — `matrix_utils.ensure_positive_definite()` exists |
| Stress drawdowns | Static `STRESS_SCENARIOS` in `config.py` | Historical event-window max drawdown from real ETF prices | **Not implemented** |
| Tushare data fetch | None for calibration | ETF price fetch, macro history, factor proxy returns | **Not implemented** |
| Persistence | SQLite via `StatsSnapshotCache` | SQLite with version/timestamp per calibration run | **Partially** — schema exists |
| Quality contracts | `source`, `as_of`, `coverage`, `assumptions_used` | Same, plus confidence_score per calibration | **Partially** |

---

## 3. Recommended Next Slice: P4-CMA-EQUILIBRIUM-V2

### 3.1 Minimal Implementation Scope

The smallest safe increment is to deepen `HistoricalCalibrator` so that `calibrate_equilibrium_returns()`, `calibrate_equilibrium_vols()`, and `calibrate_correlation_matrix()` produce results from **longer-window data** distinct from the Signal layer, with metadata that allows the audit system to distinguish "multi-year equilibrium" from "252d rolling signal."

**Allowed edit files:**

- `backend/app/allocation/data/historical_calibrator.py` — add `_fetch_long_window_stats()` to query ETF daily prices from SQLite over 3-5 year windows (no network, cache-only).
- `backend/tests/test_historical_calibrator.py` — new tests for long-window calibration path.

**Explicitly NOT in scope:** Tushare live fetch, Bayesian shrinkage to DMS priors, Ledoit-Wolf full implementation, new SQLite schema, new API endpoints, frontend changes.

### 3.2 Task ID Suggestion

`P4-CMA-EQUILIBRIUM-V2`

### 3.3 GitNexus Impact Targets (PM Must Run Before Editing)

| Target | Direction | Reason |
|--------|-----------|--------|
| `HistoricalCalibrator.calibrate_equilibrium_returns` | `upstream` | Callers: `cma_manager._get_anchor_layer()`, `calibration_audit.audit_calibration()` |
| `HistoricalCalibrator.calibrate_all` | `upstream` | Callers: `cma_manager`, `market_data_service.refresh()` if wired |
| `StatsSnapshotCache.get` | `upstream` | All calibration cache consumers |
| `EQUILIBRIUM_RETURNS` (config.py) | `upstream` | Fallback consumers: `cma_manager`, `calibration_audit` |

### 3.4 Validation Commands

```powershell
# Repo state
git log --oneline -5
git status --short

# Backend tests
cd backend; python -m pytest tests/ -x -q

# Target-specific
cd backend; python -m pytest tests/test_historical_calibrator.py -x -v

# Frontend integrity
cd frontend; npm.cmd run build
```

### 3.5 Acceptance Criteria

1. `HistoricalCalibrator` reads long-window (3Y+) ETF daily price data from SQLite cache when available.
2. When long-window data exists for ≥70% of assets, equilibrium returns/voles/correlation are computed from it (distinct from Signal-layer 252d).
3. When long-window data is insufficient, calibrator falls back to short-window stats, then to static config — with explicit provenance in `source` field.
4. Calibration result metadata includes `window_start`, `window_end`, `n_observations` per asset, and a `confidence_score`.
5. No NaN/Inf values enter `CMAResult` through the anchor path.
6. Existing tests continue to pass (backward compatibility).
7. `calibration_audit.audit_calibration()` correctly detects drift between new calibration and static config.py values.

### 3.6 Stop Conditions

- If the deepening requires a synchronous Tushare network call (out of scope; cache-only).
- If there is a product decision about whether to use DMS global priors vs. China local priors for Bayesian shrinkage (stop and ask).
- If the existing SQLite cache doesn't store enough ETF price history to compute 3Y windows (stop and report data gap).

---

## 4. Files Changed

Only `docs/pm/reports/P4-SCOPE-AUDIT-001.md` — this report. No source code was changed.

---

## 5. Validation Commands and Results

```powershell
PS> git log --oneline -5
c39c84b Close P3 PM workflow
e6d8c61 Complete P3 calibration audit workflow
b7349c0 Complete P1 P2 allocation calibration workflow
9cbd267 Smooth low-confidence TAA signals
e5adc16 Expose fund metadata provenance

PS> git rev-parse --short HEAD
c39c84b

PS> git status --short --untracked-files=all
# Preserved unrelated dirty files shown above (§2.1)
# Report file is new and within allowed scope
```

Key code search (`rg` for P4-related terms across codebase):

- `EQUILIBRIUM_RETURNS`: Defined in `config.py:43`, consumed in `cma_manager.py:19`, `calibration_audit.py:14`, `orchestrator.py:182` (fallback path).
- `DEFAULT_CORR`: Defined in `config.py:81`, consumed in `cma_manager.py:19`, `historical_calibrator.py:18`.
- `blend_lambda`: Computed in `cma_manager.py:_compute_blend_weight()`, propagated through `_build_cma_quality()` into `CMAResult.quality`.
- `quality`: Present in `cma_manager.py` (signal quality, anchor quality, CMA quality), `market_data_service.py`, `historical_calibrator.py`, `orchestrator.py` (`AllocationDataQuality` model).
- `calibration_version`: Present in `historical_calibrator.py` (`CALIBRATION_VERSION`), `cma_manager.py` (`calibration_version` in anchor quality).
- `historical_calibration`: Cache key used by `cma_manager._get_anchor_layer()`, `calibration_audit.py`, `circuit_breaker.py:181` and `:196`.

All inspected files are within the allowed read-only scope. No source code was changed.

---

## 6. Scope / Safety

| Check | Result |
|-------|--------|
| Read-only audit | ✅ No source code changes made |
| Allowed files inspected | ✅ config.py, cma_manager.py, historical_calibrator.py, market_data_service.py, orchestrator.py |
| P1/P2/P3 reports read | ✅ All task files verified as closed |
| `docs/0610/*.md` read | ✅ opus.md, qwen.md, integrated-plan.md |
| Unrelated dirty files preserved | ✅ No accidental edits |
| No commit/push/deploy | ✅ None performed |
| No PM outbox/running/logs modification | ✅ None |

---

## 7. Open Risks and PM Decisions Needed

### 7.1 Risk: HistoricalCalibrator is a thin wrapper

**Severity: MEDIUM**

The current `historical_calibrator.py` (316 lines) is a facade. `calibrate_equilibrium_returns()` reads `market_data_service.get_rolling_stats_ex()` — the same 252-day data used by the Signal layer. It then labels the result with "historical_market_data" source, but it's not a distinct long-term equilibrium calculation. This means the Anchor and Signal layers are not truly independent.

**Mitigation:** The proposed P4-CMA-EQUILIBRIUM-V2 slice deepens the calibrator to use truly longer-window (3Y+) distinct data, making Anchor and Signal independent.

### 7.2 Risk: Jump params and stress scenarios still static

**Severity: LOW**

`calibrate_jump_params()` and `calibrate_stress_scenarios()` both return static config.py values with explicit `static_jump_params` / `static_stress_scenarios` provenance. These are correctly labeled as assumptions in the quality metadata, so they don't pretend to be real. Defer to P5 (correlation matrix) or P6 (stress/MC).

### 7.3 Decision Needed: Calibration prior source

The `opus.md` §2.3.1 design uses DMS (Dimson-Marsh-Staunton) global long-term CAPM priors for Bayesian shrinkage. The `integrated-plan.md` is silent on prior source. Before implementing Bayesian shrinkage, the PM must decide:

- **Option A:** DMS global priors (7.5% A股, 8.0% 美股, 3.0% 利率债, etc.) — well-cited academic source but may not reflect China A-share specifics.
- **Option B:** China-local priors estimated from CSI 300 / CSI 500 10Y+ history.
- **Option C:** No Bayesian shrinkage in V2; simple multi-year rolling mean with confidence flagging, deferring shrinkage to a later P4 sub-task.

### 7.4 Decision Needed: P4 vs. P5 ordering

The planning docs couple P4 (equilibrium returns) with P5 (correlation matrix calibration). The current codebase treats them as separate calibrator methods that can be deepened independently. The PM should confirm:

- **Option A:** P4 equilibrium returns only (this report's recommended slice).
- **Option B:** P4+P5 combined into one implementation task (equilibrium returns + correlation matrix, both in historical_calibrator.py).
- **Option C:** P5 first (correlation matrix calibration may yield higher marginal benefit since `DEFAULT_CORR` is more impactful on SAA than return estimates).

---

## 8. Recommended Next Action

**`ask_user`** — The PM should answer the two decisions in §7.3 and §7.4, then create task `P4-CMA-EQUILIBRIUM-V2` in `docs/pm/outbox/` with the scope boundaries in §3 above.

If the PM adopts the default recommendation (Option C for §7.3 — no Bayesian shrinkage in V2; Option A for §7.4 — P4 only), the coding agent can proceed immediately with a ~200-line change to `historical_calibrator.py` plus ~150 lines of tests.
