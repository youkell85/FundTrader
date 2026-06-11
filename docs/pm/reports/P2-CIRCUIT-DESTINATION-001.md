# P2-CIRCUIT-DESTINATION-001 — Implementation Report

**Date**: 2026-06-10
**Executor**: Claude Code
**HEAD**: `9cbd267` (Smooth low-confidence TAA signals)

## 1. Summary

Added a configurable destination policy layer to the circuit breaker's equity reduction logic. The `_reduce_equity()` function now accepts an optional `destination` dict that controls how the equity cut is distributed among cash-equivalent assets (`money_fund`, `cash`). A new `_load_destination_policy()` function reads destination weights from `StatsSnapshotCache("historical_calibration")` → `circuit_breaker_destination.params` at runtime.

**Default behavior is preserved**: when no policy is configured (or the policy is invalid), the existing proportional-to-existing-weights distribution is used unchanged.

## 2. Files Changed

### `backend/app/allocation/circuit_breaker.py`

- **`_reduce_equity()`**: Added optional `destination: Optional[Dict[str, float]]` parameter. When provided with valid positive weights for cash-equivalent assets, the equity cut is distributed according to those weights. Invalid destinations (empty, all-zero, negative, non-cash-equiv-only) fall back to the default proportional distribution.
- **`_load_destination_policy()`** (new): Reads `StatsSnapshotCache.get("historical_calibration")` → `circuit_breaker_destination.params`. Supports both nested `{"params": {...}}` and flat structures. Filters to cash-equivalent assets only, normalizes weights to sum to 1, and returns `None` on any failure (missing cache, invalid types, all-zero weights, exceptions).
- **`evaluate_breaker()`**: Now calls `_load_destination_policy()` and passes the result to `_reduce_equity()`. Contract unchanged: still returns `(allocations, triggered)`.

### `backend/tests/test_circuit_breaker_destination.py` (new)

20 tests across 4 test classes:

| Class | Tests | Coverage |
|-------|-------|----------|
| `CircuitBreakerDestinationDefaultTest` | 3 | Proportional distribution, equal distribution when no cash, explicit `None` |
| `CircuitBreakerDestinationConfiguredTest` | 3 | Specified weights, all-to-one routing, unnormalized input normalization |
| `CircuitBreakerDestinationInvalidTest` | 4 | Empty dict, all-zero, negative weights, non-cash-equiv assets ignored |
| `CircuitBreakerDestinationPolicyLoaderTest` | 10 | No cache, missing key, nested params, flat params, normalization, non-cash-equiv filtering, all-zero, all-negative, non-dict params, exception handling |

## 3. Backtest Note

The backtest engine (`backend/app/allocation/backtest/engine.py`) has its own `_apply_circuit_breaker()` function (line 515) with different distribution logic — it distributes equally to cash_equiv and then renormalizes the entire allocation. This was **not unified** with the live `_reduce_equity()` because:

1. The backtest function has materially different behavior (equal distribution + full renormalization vs proportional distribution).
2. Unifying would change backtest results, which is outside the approved scope.
3. The backtest function is a private helper used only in one place (line 281).

If PM wants backtest to also use the destination policy, a separate task should be created.

## 4. Validation

### New tests

```
$ cd backend && python -m pytest tests/test_circuit_breaker_destination.py -q -v
20 passed in 0.21s
```

### Contract + destination tests

```
$ python -m pytest tests/test_allocation_api_contract.py tests/test_circuit_breaker_destination.py -q
22 passed in 1.62s
```

### Full backend suite

```
$ python -m pytest -q
199 passed in 127.33s (0:02:07)
```

### Git diff check

```
$ git diff --check
# Only CRLF warnings on pre-existing dirty files (AGENTS.md, CLAUDE.md, etc.)
# No whitespace errors in our changes
```

### Working tree

Only `circuit_breaker.py` (modified) and `test_circuit_breaker_destination.py` (new) are our changes. All pre-existing dirty files preserved untouched.

## 5. Open Risks / PM Decisions Needed

1. **Backtest unification**: The backtest engine has a separate `_apply_circuit_breaker()` with different distribution logic. If PM wants destination policy to apply in backtests too, a follow-up task is needed. The current implementation only affects the live path via `evaluate_breaker()`.

2. **Cache key contract**: The destination policy reads from `historical_calibration.circuit_breaker_destination.params`. This key is not yet populated by any calibrator. Until a calibrator or admin tool writes this key, the policy loader always returns `None` (default behavior). This is by design — the task only adds the *reading* side.

3. **No runtime config hot-reload**: The policy is read once per `evaluate_breaker()` call from the cache. If the cache is updated between calls, the next call picks up the new policy. This is acceptable since `StatsSnapshotCache` has a 24h TTL and breaker evaluation is per-rebalance-cycle.
