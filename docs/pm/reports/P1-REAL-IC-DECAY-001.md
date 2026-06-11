# P1-REAL-IC-DECAY-001 — Implementation Report

**Date:** 2026-06-10
**Executor:** Claude Code
**Status:** Complete

---

## 1. Summary

Replaced the proxy IC decay calculation in `MarketDataService._compute_ic_decay()` with genuine historical IC computation using local cached data. The old implementation fabricated IC from a single macro snapshot multiplied by confidence. The new implementation:

- Reads macro indicator time series from `MacroCache.get_history()` (SQLite, no network)
- Reads ETF daily prices from `ETFPriceCache.get_range()` (SQLite, no network)
- Builds daily signal series via forward-fill of monthly macro observations (`build_daily_signal_series`)
- Computes real Spearman rank correlation between signal values and forward asset returns via `compute_ic_series`
- When history is insufficient (< 6 monthly observations or < 60 aligned data points), marks result with `source: "insufficient_history"` so `_get_adaptive_weights()` falls back to static weights
- Adds diagnostic metadata: `source`, `sample_size`, `as_of_date`, `indicators_used`, `ic_series`
- Preserves all existing IC result keys: `quality`, `half_life`, `ic_mean`
- Fixed pre-existing name mismatch: `"社融增速"` → `"社融增量"` (matches DB column)

API request paths remain cache-only — no network calls are triggered.

## 2. Files Changed

| File | Change |
|------|--------|
| `backend/app/allocation/data/ic_decay.py` | Added `build_daily_signal_series()` function; added `datetime` import |
| `backend/app/allocation/data/market_data_service.py` | Rewrote `_compute_ic_decay()` to use historical data from `MacroCache`/`ETFPriceCache` |
| `backend/tests/test_ic_decay.py` | **New.** 16 unit tests for `build_daily_signal_series`, `compute_ic_series`, `ic_half_life`, `signal_quality_score`, `analyze_macro_signals` |
| `backend/tests/test_market_data_service_ic_decay.py` | **New.** 7 integration tests for `_compute_ic_decay` with mocked cache data |

No changes to `taa_engine.py` — `_get_adaptive_weights()` already handles the new format correctly (categories with no data → score 0 → fallback to static weights).

## 3. Validation

### Targeted Tests
```
cd backend
python -m pytest tests/test_ic_decay.py tests/test_market_data_service_ic_decay.py tests/test_taa_confidence_attenuation.py -q
```
**Result:** 24 passed (16 + 7 + 1)

### Full Backend Suite
```
python -m pytest -q
```
**Result:** 147 passed in 135.34s

### Git Diff Check
```
git diff --check
```
**Result:** Only pre-existing CRLF warnings on unrelated files (AGENTS.md, CLAUDE.md, models.py, monte_carlo.py, stress_test.py, test_allocation_monte_carlo.py, allocation.ts). No new whitespace errors.

### Git Status
Only approved-file changes plus pre-existing PM workflow artifacts and unrelated dirty files. No unexpected modifications.

### GitNexus Impact Analysis
- `compute_ic_series`: **LOW risk** — 1 direct caller (`analyze_macro_signals`), 0 processes affected
- `MarketDataService._compute_ic_decay`: Not indexed by name (private method), but its only consumer is `MarketDataService.refresh()` which already wraps it in try/except

## 4. Open Risks / PM Decisions Needed

1. **Benchmark asset universe:** The implementation uses `a_share_large` (ETF 510300) as the sole proxy asset for IC computation. A product decision may be needed on whether to compute IC against multiple asset classes (e.g., bonds for interest rate signals, commodities for inflation signals) rather than a single equity proxy.

2. **Macro history depth:** `MacroCache.get_history()` defaults to 24 monthly observations. The implementation requests 60. Real-world IC quality depends on how much history has accumulated in the SQLite cache. Fresh deployments with < 6 months of data will always get `insufficient_history` and fall back to static weights.

3. **ETF price cache population:** `ETFPriceCache` is populated by the backtest engine (`historical_data.py`), not by the refresh cycle. If the backtest has never run, the ETF price cache may be empty, causing IC computation to skip. This is correct behavior (no network calls) but may surprise operators.

4. **Signal-to-return alignment:** Monthly macro values are forward-filled to daily frequency. This is standard practice but assumes macro data is released at month-end. If some indicators (e.g., PMI) are released mid-month, the alignment may be off by up to 30 days.
