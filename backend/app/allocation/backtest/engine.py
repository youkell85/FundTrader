"""Backtest Engine — core simulation loop replaying SAA/TAA over historical data."""

import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from ..config import ASSET_CLASSES, GROUP_MAP, RISK_PROFILES
from ..models import CMAResult, RegimeState, RiskProfile
from ..saa_engine import optimize_saa
from ..taa_engine import adjust_taa_with_snapshot
from ..circuit_breaker import VOL_THRESHOLD_L1, VOL_THRESHOLD_L2, VOL_THRESHOLD_L3, EQUITY_REDUCTION
from .benchmarks import simulate_equal_weight, simulate_sixty_forty
from .historical_data import load_etf_history, load_macro_history
from .metrics import (
    compute_metrics,
    compute_monthly_returns,
    compute_regime_attribution,
    compute_rolling_sharpe,
)
from .models import (
    BacktestCurvePoint,
    BacktestResponse,
    BacktestRequest,
    CostAssumptionSummary,
    DataQuality,
    RebalanceEvent,
    RegimeHistoryEntry,
)
from .regime_replay import build_macro_snapshot_at, compute_vol_ratio_at, detect_regime_at

logger = logging.getLogger(__name__)


def run_backtest(request: BacktestRequest) -> BacktestResponse:
    """Run a full allocation backtest over the requested date range.

    Simulates the SAA/TAA allocation pipeline at each rebalance point,
    tracking portfolio value daily using actual ETF returns.
    """
    logger.info(f"Starting allocation backtest: {request.start_date} → {request.end_date}, "
                f"freq={request.rebalance_frequency}, modes={request.comparison_modes}")

    # 1. Load historical data
    prices_df, quality_info = _load_etf_history_for_backtest(request.start_date, request.end_date)
    returns_df = prices_df.pct_change().fillna(0.0)

    # Load macro history for TAA/regime replay
    macro_history = load_macro_history(request.start_date, request.end_date, allow_network=False)
    macro_coverage = sum(1 for s in macro_history.values() if len(s) > 0) / 13.0 * 100

    # 2. Generate rebalance schedule
    rebalance_dates = _generate_schedule(prices_df.index, request.rebalance_frequency)
    logger.info(f"Generated {len(rebalance_dates)} rebalance dates")

    # 3. Build risk profile for SAA
    profile = _build_risk_profile(request.risk_profile)

    # 4. Simulate each comparison mode
    curves: Dict[str, List[BacktestCurvePoint]] = {}
    all_rebalance_events: List[RebalanceEvent] = []
    regime_history: List[RegimeHistoryEntry] = []

    # Track turnovers per mode
    mode_turnovers: Dict[str, List[float]] = {}

    for mode in request.comparison_modes:
        if mode in ("equal_weight", "sixty_forty"):
            # Benchmark modes — use simple fixed-weight simulation
            if mode == "equal_weight":
                curve = simulate_equal_weight(returns_df, rebalance_dates, request.initial_amount)
            else:
                curve = simulate_sixty_forty(returns_df, rebalance_dates, request.initial_amount)
            curves[mode] = curve
            mode_turnovers[mode] = []
        else:
            # SAA-based modes (saa_only, saa_taa)
            include_taa = (mode == "saa_taa")
            curve, events, regimes, turnovers = _simulate_allocation(
                prices_df=prices_df,
                returns_df=returns_df,
                macro_history=macro_history,
                rebalance_dates=rebalance_dates,
                profile=profile,
                initial_amount=request.initial_amount,
                include_taa=include_taa,
            )
            curves[mode] = curve
            mode_turnovers[mode] = turnovers

            # Use regime history from the most complete mode (saa_taa preferred)
            if include_taa or not regime_history:
                regime_history = regimes
            if include_taa:
                all_rebalance_events = events

    # 5. Compute metrics for each mode
    metrics = {}
    saa_only_return = None

    # Collect daily values for benchmark lookup
    mode_daily_values = {}
    for mode, curve in curves.items():
        mode_daily_values[mode] = [p.value for p in curve]

    def _pick_benchmark(mode: str) -> Optional[List[float]]:
        """Pick a benchmark series for this mode (prefer sixty_forty, then equal_weight)."""
        if "sixty_forty" in mode_daily_values and mode != "sixty_forty":
            return mode_daily_values["sixty_forty"]
        if "equal_weight" in mode_daily_values and mode != "equal_weight":
            return mode_daily_values["equal_weight"]
        return None

    for mode, curve in curves.items():
        daily_values = [p.value for p in curve]
        dates = [p.date for p in curve]
        turnovers = mode_turnovers.get(mode, [])
        benchmark_values = _pick_benchmark(mode)

        m = compute_metrics(daily_values, dates, turnovers, saa_only_return, benchmark_values)
        metrics[mode] = m

        if mode == "saa_only":
            saa_only_return = m.annualized_return / 100.0  # Store for TAA value-add calc

    # Recompute saa_taa metrics with TAA value-added if both exist
    if "saa_taa" in metrics and saa_only_return is not None:
        curve = curves["saa_taa"]
        daily_values = [p.value for p in curve]
        dates = [p.date for p in curve]
        turnovers = mode_turnovers.get("saa_taa", [])
        benchmark_values = _pick_benchmark("saa_taa")
        metrics["saa_taa"] = compute_metrics(daily_values, dates, turnovers, saa_only_return, benchmark_values)

    # 6. Compute rolling Sharpe for primary mode
    rolling_sharpe_data: List[Dict[str, Any]] = []
    primary_mode = "saa_taa" if "saa_taa" in curves else list(curves.keys())[0]
    primary_curve = curves[primary_mode]
    primary_values = [p.value for p in primary_curve]
    primary_dates = [p.date for p in primary_curve]
    rs = compute_rolling_sharpe(primary_values, primary_dates, window=60)
    for point in rs:
        rolling_sharpe_data.append({"date": point["date"], primary_mode: point["sharpe"]})

    # 7. Compute monthly returns per mode
    monthly_returns: Dict[str, Dict[str, float]] = {}
    for mode, curve in curves.items():
        values = [p.value for p in curve]
        dates = [p.date for p in curve]
        monthly_returns[mode] = compute_monthly_returns(values, dates)

    # 8. Regime attribution
    attribution = {}
    if regime_history and primary_mode in curves:
        attribution = compute_regime_attribution(primary_values, primary_dates, regime_history)

    # 9. Downsample curves if too large (>750 points → weekly)
    for mode in curves:
        if len(curves[mode]) > 750:
            curves[mode] = _downsample_curve(curves[mode])

    # 10. Cost assumption summary (transparent, does not deduct from curves)
    cost_assumption = _compute_cost_assumption(all_rebalance_events, request)

    # 11. Assemble response
    data_quality = DataQuality(
        assets_with_full_history=quality_info.get("assets_with_full_history", 0),
        assets_with_partial_history=quality_info.get("assets_with_partial_history", 0),
        missing_assets=quality_info.get("missing_assets", []),
        macro_coverage_pct=round(macro_coverage, 1),
        earliest_common_date=quality_info.get("earliest_common_date", request.start_date),
        total_trading_days=quality_info.get("total_trading_days", 0),
    )

    return BacktestResponse(
        curves=curves,
        metrics=metrics,
        regime_history=regime_history,
        rebalance_events=all_rebalance_events,
        attribution=attribution,
        rolling_sharpe=rolling_sharpe_data,
        monthly_returns=monthly_returns,
        data_quality=data_quality,
        cost_assumption=cost_assumption,
    )


def _load_etf_history_for_backtest(start_date: str, end_date: str):
    """Prefer cached ETF history, then do one live refill on cold-cache misses."""
    try:
        return load_etf_history(start_date, end_date, allow_network=False)
    except ValueError as exc:
        if "No ETF data available" not in str(exc):
            raise
        logger.warning(
            "ETF history cache miss for backtest %s..%s; retrying with live providers",
            start_date,
            end_date,
        )
        return load_etf_history(start_date, end_date, allow_network=True)


# ---------------------------------------------------------------------------
# Core simulation
# ---------------------------------------------------------------------------

def _simulate_allocation(
    prices_df: pd.DataFrame,
    returns_df: pd.DataFrame,
    macro_history: Dict[str, pd.Series],
    rebalance_dates: List[pd.Timestamp],
    profile: RiskProfile,
    initial_amount: float,
    include_taa: bool,
) -> Tuple[List[BacktestCurvePoint], List[RebalanceEvent], List[RegimeHistoryEntry], List[float]]:
    """Simulate SAA (optionally +TAA) allocation over time.

    Returns: (curve, rebalance_events, regime_history, turnovers)
    """
    dates = prices_df.index.tolist()
    n_dates = len(dates)

    # State
    portfolio_value = initial_amount
    holdings: Dict[str, float] = {}  # asset → dollar amount
    current_weights: Dict[str, float] = {}

    # Regime persistence state
    prev_regime = "baseline"
    pending_regime: Optional[str] = None
    pending_count = 0

    # Results
    curve: List[BacktestCurvePoint] = []
    rebalance_events: List[RebalanceEvent] = []
    regime_periods: List[Dict] = []  # [{regime, start_date}]
    turnovers: List[float] = []
    peak_value = initial_amount

    rebalance_set = set(rebalance_dates)
    first_rebalance_done = False

    for i, date in enumerate(dates):
        if i > 0 and first_rebalance_done:
            # Apply daily returns (buy-and-hold drift)
            for asset in list(holdings.keys()):
                if asset in returns_df.columns:
                    ret = returns_df.iloc[i][asset]
                    if not np.isnan(ret):
                        holdings[asset] *= (1 + ret)

            portfolio_value = sum(holdings.values()) if holdings else portfolio_value

        # Rebalance logic
        if date in rebalance_set or (not first_rebalance_done and i == 0):
            weights_before = _get_current_weights(holdings, portfolio_value)

            # Build CMA from trailing data
            cma = _build_cma_from_history(returns_df, i)

            # Detect regime
            snapshot = build_macro_snapshot_at(macro_history, date)
            regime_state, prev_regime, pending_regime, pending_count = detect_regime_at(
                snapshot, prev_regime, pending_regime, pending_count
            )

            # Run SAA optimizer
            try:
                saa_result = optimize_saa(profile, cma)
                saa_weights = saa_result.get("allocations", {})
            except Exception as e:
                logger.warning(f"SAA optimizer failed at {date}: {e}, using fallback")
                saa_weights = _fallback_weights(profile)

            # Apply TAA if enabled
            final_weights = dict(saa_weights)
            taa_eq_adj = 0.0

            if include_taa:
                try:
                    taa_result = adjust_taa_with_snapshot(saa_weights, regime_state, snapshot)
                    final_weights = taa_result.taa_adjusted
                    taa_eq_adj = taa_result.equity_adjustment
                except Exception as e:
                    logger.warning(f"TAA failed at {date}: {e}, using SAA weights")

            # Circuit breaker (using historical vol_ratio)
            cb_triggered = False
            if include_taa:
                vol_ratio = compute_vol_ratio_at(prices_df, date)
                if vol_ratio is not None:
                    level = _compute_cb_level(vol_ratio)
                    if level > 0:
                        cb_triggered = True
                        final_weights = _apply_circuit_breaker(final_weights, level)

            # Normalize weights to available assets
            final_weights = _normalize_to_available(final_weights, returns_df.columns)

            # Apply weights to portfolio
            holdings = {a: portfolio_value * w for a, w in final_weights.items() if w > 0}
            current_weights = final_weights

            # Compute turnover
            turnover = _compute_turnover(weights_before, final_weights)
            turnovers.append(turnover)

            # Record rebalance event
            rebalance_events.append(RebalanceEvent(
                date=date.strftime("%Y-%m-%d"),
                regime=regime_state.regime,
                regime_label=regime_state.regime_label,
                weights_before=weights_before,
                weights_after={k: round(v, 4) for k, v in final_weights.items() if v > 0.001},
                turnover=round(turnover, 2),
                circuit_breaker_triggered=cb_triggered,
                taa_equity_adjustment=round(taa_eq_adj * 100, 2),
            ))

            # Track regime periods
            if not regime_periods or regime_periods[-1]["regime"] != regime_state.regime:
                if regime_periods:
                    regime_periods[-1]["end_date"] = date.strftime("%Y-%m-%d")
                regime_periods.append({
                    "regime": regime_state.regime,
                    "regime_label": regime_state.regime_label,
                    "start_date": date.strftime("%Y-%m-%d"),
                    "end_date": date.strftime("%Y-%m-%d"),
                })
            else:
                regime_periods[-1]["end_date"] = date.strftime("%Y-%m-%d")

            first_rebalance_done = True

        # Record daily value
        peak_value = max(peak_value, portfolio_value)
        cum_return = (portfolio_value / initial_amount - 1) * 100
        drawdown = (portfolio_value / peak_value - 1) * 100

        curve.append(BacktestCurvePoint(
            date=date.strftime("%Y-%m-%d"),
            value=round(portfolio_value, 2),
            cumulative_return=round(cum_return, 3),
            drawdown=round(drawdown, 3),
        ))

    # Finalize regime history
    regime_history = [
        RegimeHistoryEntry(**rp) for rp in regime_periods
    ]

    return curve, rebalance_events, regime_history, turnovers


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _generate_schedule(
    date_index: pd.DatetimeIndex, frequency: str
) -> List[pd.Timestamp]:
    """Generate rebalance dates based on frequency.

    Snaps to first available trading day of each period.
    """
    if len(date_index) == 0:
        return []

    freq_map = {
        "monthly": "MS",      # Month start
        "quarterly": "QS",    # Quarter start
        "semi_annually": "6MS",  # 6-month start
    }

    pd_freq = freq_map.get(frequency, "QS")
    schedule = pd.date_range(
        start=date_index[0],
        end=date_index[-1],
        freq=pd_freq,
    )

    # Snap each date to the nearest available trading day
    available_set = set(date_index)
    snapped = []
    for d in schedule:
        # Find nearest trading day on or after d
        for offset in range(7):  # Max 7 days forward
            candidate = d + pd.Timedelta(days=offset)
            if candidate in available_set:
                snapped.append(candidate)
                break

    return snapped


def _build_risk_profile(risk_profile_name: str) -> RiskProfile:
    """Build a RiskProfile object from a profile name."""
    config = RISK_PROFILES.get(risk_profile_name, RISK_PROFILES["balanced"])

    return RiskProfile(
        risk_tolerance=risk_profile_name,
        effective_risk=risk_profile_name,
        equity_center=config["equity_center"],
        max_drawdown=config.get("max_drawdown", 25.0),
        volatility_target=config.get("volatility_target", 12.0),
        age=35,
        amount=1000000,
        horizon="long",
        horizon_months=60,
    )


def _build_cma_from_history(returns_df: pd.DataFrame, current_idx: int) -> CMAResult:
    """Build CMA (Capital Market Assumptions) from trailing 252 days of returns."""
    from ..config import EQUILIBRIUM_RETURNS, EQUILIBRIUM_VOLS, DEFAULT_CORR

    # Use up to 252 trailing days
    start_idx = max(0, current_idx - 252)
    trailing = returns_df.iloc[start_idx:current_idx]

    expected_returns: Dict[str, float] = {}
    volatilities: Dict[str, float] = {}

    for asset in ASSET_CLASSES:
        if asset in trailing.columns and len(trailing[asset].dropna()) >= 60:
            rets = trailing[asset].dropna()
            ann_ret = float(rets.mean() * 252 * 100)
            ann_vol = float(rets.std() * np.sqrt(252) * 100)

            # Blend with equilibrium (lambda=0.4)
            eq_ret = EQUILIBRIUM_RETURNS.get(asset, 5.0)
            eq_vol = EQUILIBRIUM_VOLS.get(asset, 15.0)

            expected_returns[asset] = round(0.4 * ann_ret + 0.6 * eq_ret, 2)
            volatilities[asset] = round(0.4 * ann_vol + 0.6 * eq_vol, 2)
        else:
            # Pure equilibrium fallback
            expected_returns[asset] = EQUILIBRIUM_RETURNS.get(asset, 5.0)
            volatilities[asset] = EQUILIBRIUM_VOLS.get(asset, 15.0)

    # Covariance matrix from DEFAULT_CORR + volatilities
    n = len(ASSET_CLASSES)
    cov_matrix = []
    for i in range(n):
        row = []
        vol_i = volatilities[ASSET_CLASSES[i]] / 100.0
        for j in range(n):
            vol_j = volatilities[ASSET_CLASSES[j]] / 100.0
            corr = DEFAULT_CORR[i][j] if i < len(DEFAULT_CORR) and j < len(DEFAULT_CORR[i]) else (1.0 if i == j else 0.0)
            row.append(round(corr * vol_i * vol_j, 8))
        cov_matrix.append(row)

    return CMAResult(
        expected_returns=expected_returns,
        volatilities=volatilities,
        covariance_matrix=cov_matrix,
    )


def _fallback_weights(profile: RiskProfile) -> Dict[str, float]:
    """Generate conservative fallback weights when optimizer fails."""
    eq_center = profile.equity_center / 100.0
    fi_share = 1.0 - eq_center

    equity_assets = GROUP_MAP["equity"]
    fi_assets = GROUP_MAP["fixed_income"]
    cash_assets = GROUP_MAP["cash_equiv"]

    weights: Dict[str, float] = {}
    for a in equity_assets:
        weights[a] = eq_center / len(equity_assets)
    for a in fi_assets:
        weights[a] = fi_share * 0.7 / len(fi_assets)
    for a in cash_assets:
        weights[a] = fi_share * 0.3 / len(cash_assets)

    # Fill remaining with 0
    for a in ASSET_CLASSES:
        if a not in weights:
            weights[a] = 0.0

    return weights


def _normalize_to_available(
    weights: Dict[str, float], available_columns: pd.Index
) -> Dict[str, float]:
    """Normalize weights to only include assets present in the data."""
    filtered = {}
    for asset, w in weights.items():
        if asset in available_columns and w > 0:
            filtered[asset] = w

    total = sum(filtered.values())
    if total > 0:
        filtered = {k: v / total for k, v in filtered.items()}

    return filtered


def _get_current_weights(holdings: Dict[str, float], total_value: float) -> Dict[str, float]:
    """Compute current portfolio weights from holdings."""
    if total_value <= 0 or not holdings:
        return {}
    return {a: round(v / total_value, 4) for a, v in holdings.items() if v > 0}


def _compute_turnover(weights_before: Dict[str, float], weights_after: Dict[str, float]) -> float:
    """Compute turnover as sum of absolute weight changes / 2."""
    all_assets = set(list(weights_before.keys()) + list(weights_after.keys()))
    total_change = sum(
        abs(weights_after.get(a, 0) - weights_before.get(a, 0))
        for a in all_assets
    )
    return total_change / 2.0 * 100  # As percentage


def _compute_cb_level(vol_ratio: float) -> int:
    """Determine circuit breaker level from vol_ratio."""
    if vol_ratio >= VOL_THRESHOLD_L3:
        return 3
    elif vol_ratio >= VOL_THRESHOLD_L2:
        return 2
    elif vol_ratio >= VOL_THRESHOLD_L1:
        return 1
    return 0


def _apply_circuit_breaker(weights: Dict[str, float], level: int) -> Dict[str, float]:
    """Apply circuit breaker equity reduction."""
    reduction = EQUITY_REDUCTION.get(level, 0.0)
    if reduction == 0:
        return weights

    adjusted = dict(weights)
    equity_assets = GROUP_MAP["equity"]
    cash_assets = GROUP_MAP["cash_equiv"]

    # Total equity to reduce
    equity_total = sum(adjusted.get(a, 0) for a in equity_assets)
    amount_to_shift = equity_total * reduction

    # Reduce equity proportionally
    if equity_total > 0:
        for a in equity_assets:
            share = adjusted.get(a, 0) / equity_total
            adjusted[a] = adjusted.get(a, 0) - amount_to_shift * share

    # Add to cash_equiv proportionally
    cash_total = sum(adjusted.get(a, 0) for a in cash_assets)
    n_cash = len(cash_assets)
    for a in cash_assets:
        adjusted[a] = adjusted.get(a, 0) + amount_to_shift / n_cash

    # Ensure non-negative
    for a in adjusted:
        adjusted[a] = max(0.0, adjusted[a])

    # Renormalize
    total = sum(adjusted.values())
    if total > 0:
        adjusted = {k: v / total for k, v in adjusted.items()}

    return adjusted


def _downsample_curve(curve: List[BacktestCurvePoint]) -> List[BacktestCurvePoint]:
    """Downsample curve to weekly resolution (every 5th point)."""
    if len(curve) <= 750:
        return curve

    step = max(1, len(curve) // 500)
    downsampled = curve[::step]

    # Always include the last point
    if downsampled[-1] != curve[-1]:
        downsampled.append(curve[-1])

    return downsampled


def _compute_cost_assumption(
    rebalance_events: List[RebalanceEvent],
    request: BacktestRequest,
) -> CostAssumptionSummary:
    """Compute cost assumption summary from rebalance events.

    This is transparent display only — does not deduct from curves.
    """
    # No rebalance events → no turnover data
    if not rebalance_events:
        return CostAssumptionSummary(
            enabled=False,
            missing_reason="暂无换手数据",
        )

    turnovers = [e.turnover for e in rebalance_events if e.turnover is not None]
    if not turnovers:
        return CostAssumptionSummary(
            enabled=False,
            missing_reason="暂无换手数据",
        )

    # Conservative default: 20 bps per rebalance
    COST_BPS_DEFAULT = 20.0

    avg_turnover = float(np.mean(turnovers))
    rebalance_count = len(turnovers)

    # Total cost estimate: turnover % * cost_bps / 10000
    # Each rebalance cost = turnover * cost_bps / 10000
    total_cost = sum(t * COST_BPS_DEFAULT / 10000.0 for t in turnovers)

    # Annualized cost from request date range
    try:
        from datetime import datetime
        start_dt = datetime.strptime(request.start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(request.end_date, "%Y-%m-%d")
        n_days = max(1, (end_dt - start_dt).days)
        n_years = n_days / 365.25
        annualized_cost = total_cost / n_years if n_years > 0 else None
    except Exception:
        annualized_cost = None

    return CostAssumptionSummary(
        enabled=True,
        cost_bps=COST_BPS_DEFAULT,
        total_cost_pct=round(total_cost * 100, 2),
        annualized_cost_pct=round(annualized_cost * 100, 2) if annualized_cost is not None else None,
        avg_turnover_pct=round(avg_turnover, 2),
        rebalance_count=rebalance_count,
        source="default_assumption",
    )
