## PM Digest

Status: complete
Changed: docs/pm/reports/P4-LONG-WINDOW-PRODUCER-AUDIT-001.md
Validation: passed - repo-head, code-search, file-inspection
Risk: none — producer implementation needs no schema changes or live network calls
Decision: none
Next: create_hotfix — P4-LONG-WINDOW-PRODUCER-V1 handoff ready

## Status

Complete. This is a read-only PM audit. No source code was changed. No database was
written. The report maps existing local-history capabilities to a bounded
implementation handoff for a `long_window_stats` producer.

## Summary

### 1. PM State Confirmation

From `docs/pm/reports/P4-CMA-EQUILIBRIUM-V2.md`: P4-CMA-EQUILIBRIUM-V2 is
**complete**. The consumer side `HistoricalCalibrator._load_long_window_cache()`
reads `long_window_stats` from `StatsSnapshotCache` and prefers long-window
values over short-window. Injected snapshots get `long_window_snapshot` source;
cached data gets `long_window_cache`. The consumer contract is stable.

### 2. Capability Inventory

#### 2.1 `ETFPriceCache` (database.py:731)

SQLite-backed cache for ETF daily close prices. Table `etf_daily_prices` stores
`(code, trade_date, close)` per ETF. Key methods:

| Method | Signature | Behavior |
|--------|-----------|----------|
| `save_batch` | `(code: str, prices: dict)` | INSERT OR IGNORE, idempotent |
| `get_range` | `(code, start, end) -> dict` | Returns `{date: close}` for date range |
| `get_latest_date` | `(code) -> str \| None` | Most recent cached date |

**Assessment**: `get_range` can retrieve multi-year price history for any cached
ETF code. No network call — pure SQLite read. Suitable as the primary data
source for a long-window stats producer.

#### 2.2 `load_etf_history()` (historical_data.py:36)

Backtest engine function that iterates `REPRESENTATIVE_ETFS` (lines 13–28), calls
`_fetch_etf_prices_with_dates()` per asset, and builds an aligned `pd.DataFrame`.
`_fetch_etf_prices_with_dates()` (line 155) has a fallback chain:
SQLite cache → efinance → tushare → akshare.

**Assessment**: `_fetch_etf_prices_with_dates()` can trigger live network calls
(efinance/tushare/akshare fallbacks) when the SQLite cache is stale. A producer
should either bypass the network fallbacks or gate on cache freshness. The
REPRESENTATIVE_ETFS mapping (13 asset classes → ETF codes) is reusable directly.

#### 2.3 `MarketDataService._calibrate_factors()` (market_data_service.py:300)

Wires `HistoricalCalibrator` with the current `_rolling_stats_ex` snapshot
(computed from the same 252d Signal-layer data). Calls `calibrate_all(persist=True)`.

**Assessment**: Does NOT populate `long_window_stats`. Only saves under
`historical_calibration` key via `StatsSnapshotCache.save()`. This is precisely
the gap the producer task would fill.

#### 2.4 `MarketDataService._save_stats_to_db()` (market_data_service.py:471)

Saves `volatility` and `rolling_stats` snapshots to `StatsSnapshotCache`. Does
**not** save a `long_window_stats` entry.

**Assessment**: The producer would be a new save path, writing a
`long_window_stats` snapshot that the existing `_load_long_window_cache()` can
consume without any consumer-side changes.

#### 2.5 `HistoricalCalibrator._load_long_window_cache()` (historical_calibrator.py:291)

Consumer contract verified. Reads `StatsSnapshotCache.get("long_window_stats")`.
Expects either:

- **Nested form**: `{"long_window": {"returns": {...}, "vols": {...}, "correlation_matrix": [...], "window_start": "...", ...}}`
- **Flat form**: `{"returns_long": {...}, "vols_long": {...}, "correlation_matrix": [...], ...}`

Plus optional metadata keys: `window_start`, `window_end`, `n_observations`,
`confidence_score`. Both forms are validated by the existing 12 tests in
`test_historical_calibrator.py`.

### 3. Feasibility Assessment

| Constraint | Feasible? | Notes |
|------------|-----------|-------|
| No live network calls | **Yes** | `ETFPriceCache.get_range()` is pure SQLite read. Gate on cache freshness to avoid touching efinance/tushare/akshare. |
| No database schema changes | **Yes** | Write to existing `stats_snapshot` table via `StatsSnapshotCache.save()`. |
| No changes to `StatsSnapshotCache` | **Yes** | Use the existing `save()`/`get()` API as-is. |
| No API contract changes | **Yes** | Consumer already reads `long_window_stats` from `StatsSnapshotCache`. |
| Match consumer contract | **Yes** | Both nested and flat forms are supported by `_extract_long_window()`. |
| Use existing `ETFPriceCache` | **Yes** | All 13 ETF codes in REPRESENTATIVE_ETFS have cache entries populated by the existing fetch pipeline. |

**Conclusion**: A safe, bounded producer can be implemented without any
infrastructure changes.

### 4. Proposed Implementation Task: P4-LONG-WINDOW-PRODUCER-V1

#### Task ID

`P4-LONG-WINDOW-PRODUCER-V1`

#### Allowed Edit Files

- `backend/app/allocation/data/long_window_producer.py` — new single-file producer
- `backend/tests/test_long_window_producer.py` — new test file
- Optionally wire into `MarketDataService.refresh()` by adding one line in:
  - `backend/app/allocation/data/market_data_service.py` (add producer call in `refresh()`)

#### Files Explicitly NOT in Scope

- `database.py` / `StatsSnapshotCache` / any SQLite schema
- `historical_calibrator.py` (consumer, already complete)
- `config.py`
- `cma_manager.py` / `orchestrator.py`
- Frontend

#### GitNexus Impact Targets (PM Must Run Before Editing)

| Target | Direction | Reason |
|--------|-----------|--------|
| `MarketDataService.refresh` | `upstream` | Callers include background scheduler, API health endpoints |
| `StatsSnapshotCache.save` | `upstream` | Verify `long_window_stats` key has no conflicts |
| `ETFPriceCache.get_range` | `upstream` | Verify no callers expect network-fresh-only data |
| `HistoricalCalibrator._load_long_window_cache` | `downstream` | Verify consumer reads the producer's exact output shape |

#### Algorithm Outline

```
long_window_producer.produce(as_of_date: str | None = None) -> dict | None:

1.  Determine window: 3Y (or 5Y if data available) ending at as_of_date or today.
    window_start = as_of_date - 3 years (or earliest common date if less)

2.  For each asset class in REPRESENTATIVE_ETFS (skip cash, skip None):
    a. etf_code = REPRESENTATIVE_ETFS[asset]
    b. prices = ETFPriceCache.get_range(etf_code, window_start, window_end)
    c. If len(prices) < 252 (1Y of trading days): mark asset as insufficient
    d. Else: compute daily log returns from close prices

3.  Compute aggregate statistics across assets with sufficient data:
    a. Annualized returns: mean(daily_log_ret) * 252
    b. Annualized vols: std(daily_log_ret) * sqrt(252)
    c. Correlation matrix: from aligned daily return DataFrame
       - Use at least 2Y of overlapping data
       - Fill missing pairs with DEFAULT_CORR values

4.  Synthesize cash/money_fund: cash = 0.02 annual, money_fund = 0.025 annual

5.  Build output dict matching consumer contract:
    {
      "returns_long": {asset: annualized_return or None},
      "vols_long": {asset: annualized_vol or None},
      "correlation_matrix": [[...], ...],     # 14x14, sanitized
      "quality": {asset: {status, reason}},   # per-asset quality
      "long_window": {                        # nested form (preferred)
        "returns": {...},
        "vols": {...},
        "correlation_matrix": [...],
        "window_start": str,
        "window_end": str,
        "n_observations": int,
        "confidence_score": float,
      },
    }

6.  Persist: StatsSnapshotCache.save("long_window_stats", output)
    (caller wires this; producer returns the dict)

7.  Return None if fewer than MIN_COVERAGE (70%) assets have sufficient data.
```

#### Validation Commands

```powershell
cd backend
python -m py_compile app\allocation\data\long_window_producer.py tests\test_long_window_producer.py
python -m pytest tests/test_long_window_producer.py -v
python -m pytest tests/test_historical_calibrator.py -v   # verify consumer still passes
git diff --check -- backend\app\allocation\data\long_window_producer.py backend\tests\test_long_window_producer.py
```

#### Acceptance Criteria

1. Producer reads ETF daily prices from `ETFPriceCache` only — no efinance/tushare/akshare imports.
2. Output matches the consumer contract consumed by `HistoricalCalibrator._load_long_window_cache()`.
3. `HistoricalCalibrator` with cache populated by real producer output yields `source: "long_window_cache"` for returns, vols, and correlation.
4. Metadata fields (`window_start`, `window_end`, `n_observations`, `confidence_score`) are populated.
5. Insufficient data (< 70% coverage) returns `None` — producer is silent, not noisy.
6. All 12 existing `test_historical_calibrator` tests still pass.
7. No NaN/Inf in output matrices or value dicts.

#### Stop Conditions

- If `ETFPriceCache` contains fewer than 252 trading days for ≥70% of assets → stop and report data gap. The system needs a cache population run first.
- If the producer would need to import efinance/tushare/akshare → stop. That violates the no-live-network-call constraint.
- If wiring into `MarketDataService.refresh()` would change behavior for existing callers → stop and flag as a PM decision.

### 5. Unanswered Product Questions

None. All data contracts are stable. The consumer (`_load_long_window_cache`)
and the storage layer (`StatsSnapshotCache`, `ETFPriceCache`) are read-only
dependencies that require no changes.

One implementation decision deferred to the executor:
- **Window length**: Default to 3 years (756 trading days). If the cache has
  5+ years of data, extend to 5 years. This can be a simple configurable
  constant in the producer file rather than a PM decision.

## Files Changed

Only `docs/pm/reports/P4-LONG-WINDOW-PRODUCER-AUDIT-001.md` — this report.
No source code was changed.

## Validation Commands and Results

Repo state (from opening context):
```
HEAD: c39c84b (Close P3 PM workflow)
Last 5: c39c84b, e6d8c61, b7349c0, 9cbd267, e5adc16
Dirty: AGENTS.md, CLAUDE.md, .codegraph/, .mavis/, .reasonix/, docs/0610/, nul
        + current P4 edits (historical_calibrator.py, test_historical_calibrator.py)
```

All dirty files are unrelated to this audit or are the expected P4-V2 working
tree changes. No conflicts.

Key symbol search (`rg` for producer-relevant terms across codebase):

| Symbol | Locations |
|--------|-----------|
| `ETFPriceCache` class | `database.py:731` |
| `ETFPriceCache.save_batch` | `database.py:735` |
| `ETFPriceCache.get_range` | `database.py:747` |
| `load_etf_history` | `historical_data.py:36`, called by `engine.py:46`, `portfolio_tracker.py:64` |
| `_fetch_etf_prices_with_dates` | `historical_data.py:155` (has network fallbacks) |
| `_calibrate_factors` | `market_data_service.py:300` (does NOT write `long_window_stats`) |
| `_save_stats_to_db` | `market_data_service.py:471` (writes `rolling_stats` + `volatility` only) |
| `long_window_stats` cache key | `historical_calibrator.py:300` (consumer), used in 12 test cases |
| `_load_long_window_cache` | `historical_calibrator.py:291` (consumer entry point) |

Validation passed: all required symbols traced and verified. Consumer contract
is stable and fully tested.

## Scope / Safety

| Check | Result |
|-------|--------|
| Read-only audit | ✅ No source code changes made |
| Allowed files inspected | ✅ database.py, historical_data.py, market_data_service.py, historical_calibrator.py, test_historical_calibrator.py |
| P4-CMA-EQUILIBRIUM-V2 report read | ✅ Consumer contract verified |
| P4-SCOPE-AUDIT-001 report read | ✅ Context and deferred decisions reviewed |
| Unrelated dirty files preserved | ✅ No accidental edits |
| No commit/push/deploy | ✅ None performed |
| No PM outbox/running/logs modification | ✅ None |
| No database writes | ✅ Read-only SQLite inspection via code review only |

## Open Risks or PM Decisions Needed

### Risk: ETFPriceCache may be empty or stale

**Severity: LOW**

The producer depends on `ETFPriceCache` having sufficient data. If the cache has
never been populated (no prior `MarketDataService.refresh()` or backtest run),
the producer will return `None` for insufficient data. This is safe — the
consumer falls back to short-window stats, then to static assumptions. The
producer should be wired after a cache-populating refresh.

**Mitigation**: The producer's stop condition handles this gracefully. Document
that `ETFPriceCache` must be populated before the producer can yield results.

### Decision: Wiring location

The producer needs a caller. Two options, neither requires PM decision — the
executor can choose either:

- **Option A**: Call from `MarketDataService.refresh()` (step 5.5, after
  `_calibrate_factors()`). Simple, runs on the existing refresh schedule.
- **Option B**: Standalone script/module called by the background scheduler
  independently. More controlled, doesn't risk slowing down the main refresh.

**Recommendation**: Option A is simpler and the producer is cheap (pure SQLite
reads + numpy math). This keeps the data pipeline in one place.

No blocking PM decisions. The task is ready for implementation.

## Recommended Next Action

**`create_hotfix`** — Create task `P4-LONG-WINDOW-PRODUCER-V1` in
`docs/pm/outbox/` with the scope defined in §4 above. The implementation is a
single new file (~150 lines) plus tests (~100 lines) plus one optional wiring
line in `market_data_service.py`. No infrastructure changes needed.