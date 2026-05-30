"""TAA Engine — Tactical Asset Allocation with 7-category factor scoring.

Uses real macro indicators for signal scoring when available.
Falls back to neutral (zero) signals if data is unavailable.
"""
import logging
import os
from typing import Dict, List, Optional

from .config import ASSET_CLASSES, ASSET_TO_GROUP, GROUP_MAP
from .models import (
    BusinessCycle,
    CategorySignal,
    MacroSignalItem,
    RegimeState,
    TAASummary,
)

logger = logging.getLogger(__name__)

# 7 signal categories with weights
SIGNAL_CATEGORIES = {
    "growth": {"name": "经济增长", "weight": 0.20},
    "inflation": {"name": "通胀水平", "weight": 0.15},
    "interest": {"name": "利率环境", "weight": 0.15},
    "credit_money": {"name": "信用/货币", "weight": 0.15},
    "liquidity": {"name": "市场流动性", "weight": 0.15},
    "policy": {"name": "政策导向", "weight": 0.10},
    "overseas": {"name": "海外环境", "weight": 0.10},
}

# Max TAA adjustment per asset class (absolute %)
MAX_SINGLE_ADJUSTMENT = 0.15

# FED model neutral rate (Taylor rule approximation)
_FED_NEUTRAL_RATE = 2.5


def _compute_fed_model() -> dict:
    """Compute continuous FED model score.

    Components:
    1. Fed funds rate gap: (FedRate - Neutral) → negative = accommodative
    2. Yield curve slope: 10Y yield - FedRate → positive = expansion expected

    Returns:
        {
            "fed_value": float | None,   # composite score [-1, +1]
            "fed_interpretation": str,
            "components": {rate_gap, curve_slope}
        }
    """
    macro = _get_macro_snapshot()
    if macro is None:
        return {
            "fed_value": None,
            "fed_interpretation": "无宏观数据，Fed模型不可用",
            "components": {},
        }

    fed_rate = macro.get_value("美联储利率")
    yield_10y = macro.get_value("10Y国债收益率")

    if fed_rate is None:
        return {
            "fed_value": None,
            "fed_interpretation": "美联储利率数据不可用",
            "components": {},
        }

    # Component 1: rate gap (Fed rate - neutral). Negative = accommodative.
    rate_gap = fed_rate - _FED_NEUTRAL_RATE
    # Score: inverted so lower rate = positive score. Range [-1, +1].
    rate_gap_score = max(-1.0, min(1.0, -rate_gap / 2.5))

    # Component 2: yield curve slope (10Y - Fed rate as proxy for 2Y)
    if yield_10y is not None:
        curve_slope = yield_10y - fed_rate
        # Positive slope = expansion expected. Score range [-1, +1].
        curve_score = max(-1.0, min(1.0, curve_slope / 2.0))
    else:
        curve_score = 0.0

    # Composite: 60% rate gap + 40% curve slope
    fed_score = round(0.6 * rate_gap_score + 0.4 * curve_score, 3)

    # Interpretation
    if fed_score > 0.3:
        interp = f"宽松(Fed {fed_rate:.1f}%, gap={rate_gap:+.2f}pp, 曲线{'正' if (yield_10y and yield_10y > fed_rate) else '平'}斜)"
    elif fed_score < -0.3:
        interp = f"紧缩(Fed {fed_rate:.1f}%, gap={rate_gap:+.2f}pp, 曲线{'倒挂' if (yield_10y and yield_10y < fed_rate) else '平'}斜)"
    else:
        interp = f"中性(Fed {fed_rate:.1f}%, gap={rate_gap:+.2f}pp)"

    return {
        "fed_value": fed_score,
        "fed_interpretation": interp,
        "components": {
            "fed_rate": fed_rate,
            "rate_gap": round(rate_gap, 2),
            "rate_gap_score": round(rate_gap_score, 3),
            "curve_slope": round(curve_slope, 2) if yield_10y is not None else None,
            "curve_score": round(curve_score, 3),
        },
    }


def _get_adaptive_weights() -> Dict[str, float]:
    """Compute IC-adaptive factor weights, falling back to static weights.

    Uses IC (Information Coefficient) decay analysis to determine which
    macro signals have persistent predictive power. Factors with higher
    IC and slower decay get higher weights.

    Falls back to static SIGNAL_CATEGORIES weights if IC data unavailable.
    """
    try:
        from .data import market_data_service
        ic_data = market_data_service.get_ic_decay()
        if ic_data is None:
            raise ValueError("IC data not available")

        # ic_data: {category: {"quality": float, "half_life": float, "ic_mean": float}}
        raw_scores = {}
        for cat_key in SIGNAL_CATEGORIES:
            info = ic_data.get(cat_key)
            if info and info.get("quality", 0) > 0:
                # Weight = IC_mean * quality (persistence)
                ic_mean = abs(info.get("ic_mean", 0))
                quality = info.get("quality", 0.5)
                raw_scores[cat_key] = ic_mean * quality
            else:
                raw_scores[cat_key] = 0.0

        total = sum(raw_scores.values())
        if total > 1e-6:
            # Normalize to sum=1
            weights = {k: v / total for k, v in raw_scores.items()}
            # Blend with static weights (50/50) to avoid extreme concentration
            static_weights = {k: SIGNAL_CATEGORIES[k]["weight"] for k in SIGNAL_CATEGORIES}
            blended = {k: 0.5 * weights[k] + 0.5 * static_weights[k] for k in weights}
            # Re-normalize
            blend_total = sum(blended.values())
            return {k: v / blend_total for k, v in blended.items()}

        raise ValueError("IC scores all zero")
    except Exception:
        # Fallback to static weights
        return {k: SIGNAL_CATEGORIES[k]["weight"] for k in SIGNAL_CATEGORIES}


def adjust_taa(saa_allocations: Dict[str, float], regime: RegimeState) -> TAASummary:
    """Apply tactical adjustment to SAA based on macro signals.

    Uses IC-adaptive factor weights when available, static weights as fallback.
    Uses real macro data when available, falls back to neutral otherwise.
    Integrates continuous FED model score as supplementary factor.
    """
    # Generate signals from real data (with fallback to neutral)
    signals = _generate_live_signals()
    category_summary = _compute_category_summary(signals)

    # IC-adaptive weights (falls back to static if unavailable)
    # v3 mode: always use static weights
    if os.environ.get("FUNDTRADER_NO_IC_ADAPTIVE"):
        adaptive_weights = {k: SIGNAL_CATEGORIES[k]["weight"] for k in SIGNAL_CATEGORIES}
    else:
        adaptive_weights = _get_adaptive_weights()

    # Update category_summary with adaptive weights
    for cat_key in category_summary:
        category_summary[cat_key].weight = round(adaptive_weights.get(cat_key, category_summary[cat_key].weight), 4)

    # Base composite score (weighted average using adaptive weights)
    base_composite = sum(
        cat.avg_score * adaptive_weights.get(cat_key, SIGNAL_CATEGORIES[cat_key]["weight"])
        for cat_key, cat in category_summary.items()
    )

    # FED continuous model — blend as supplementary factor (15% weight)
    # v3 mode: skip FED model entirely
    if os.environ.get("FUNDTRADER_NO_FED"):
        fed_model = {"fed_value": None, "fed_interpretation": "v3: 无Fed连续化模型", "components": {}}
    else:
        fed_model = _compute_fed_model()
    fed_value = fed_model["fed_value"]
    fed_interp = fed_model["fed_interpretation"]

    if fed_value is not None:
        composite_score = 0.85 * base_composite + 0.15 * fed_value
    else:
        composite_score = base_composite

    # Equity adjustment scaled by confidence
    equity_adjustment = composite_score * 0.10 * regime.confidence

    # Compute per-asset adjustments
    adjustments = _compute_adjustments(saa_allocations, equity_adjustment, regime.confidence)

    # Apply adjustments
    taa_adjusted = {}
    for asset in ASSET_CLASSES:
        taa_adjusted[asset] = round(saa_allocations.get(asset, 0.0) + adjustments.get(asset, 0.0), 6)

    # Ensure non-negative and re-normalize
    taa_adjusted = _renormalize(taa_adjusted)

    # Business cycle from regime
    business_cycle = _infer_business_cycle(regime)

    return TAASummary(
        taa_adjusted=taa_adjusted,
        adjustments=adjustments,
        composite_score=round(composite_score, 3),
        equity_adjustment=round(equity_adjustment, 4),
        fed_value=fed_value,
        fed_interpretation=fed_interp,
        signals=signals,
        category_summary={k: v for k, v in category_summary.items()},
        business_cycle=business_cycle,
    )


def _generate_live_signals() -> List[MacroSignalItem]:
    """Generate signals from real macro data with threshold-based scoring.

    Falls back to neutral (score=0) for any unavailable indicator.
    """
    macro = _get_macro_snapshot()

    # Signal definitions: (name, category, scoring_function)
    signal_defs = [
        ("PMI制造业", "growth", lambda v: _linear_score(v, 49.5, 50.5)),
        ("GDP同比", "growth", lambda v: _linear_score(v, 3.0, 6.0)),
        ("CPI同比", "inflation", lambda v: _linear_score_inverted(v, 1.0, 3.0)),
        ("PPI同比", "inflation", lambda v: _linear_score_inverted(v, -2.0, 3.0)),
        ("10Y国债收益率", "interest", lambda v: _linear_score_inverted(v, 2.5, 3.5)),
        ("DR007", "interest", lambda v: _linear_score_inverted(v, 2.0, 3.0)),
        ("社融增速", "credit_money", lambda v: _linear_score(v, 7.0, 10.0)),
        ("M2增速", "credit_money", lambda v: _linear_score(v, 7.0, 10.0)),
        ("融资余额变化", "liquidity", lambda v: _linear_score(v, -200.0, 200.0)),
        ("北向资金净流入", "liquidity", lambda v: _linear_score(v, -50.0, 100.0)),
        ("财政赤字率", "policy", lambda v: _linear_score(v, 2.5, 3.5)),
        ("美联储利率", "overseas", lambda v: _linear_score_inverted(v, 3.0, 5.5)),
        ("美元指数", "overseas", lambda v: _linear_score_inverted(v, 95.0, 105.0)),
    ]

    signals = []
    for name, category, scorer in signal_defs:
        value = macro.get_value(name) if macro else None
        confidence_str = "low"

        if value is not None:
            score = scorer(value)
            conf = macro.get_confidence(name) if macro else 0.3
            if conf >= 0.8:
                confidence_str = "high"
            elif conf >= 0.5:
                confidence_str = "medium"
            else:
                confidence_str = "low"
            threshold_desc = f"当前值: {value:.2f}"
        else:
            score = 0
            threshold_desc = "数据暂不可用"

        signals.append(MacroSignalItem(
            factor_name=name,
            category=category,
            score=round(score, 2),
            confidence=confidence_str,
            value=value,
            threshold_desc=threshold_desc,
        ))

    return signals


def _linear_score(value: float, low: float, high: float) -> float:
    """Linear scoring: value below low -> -1, above high -> +1, linear in between."""
    mid = (low + high) / 2.0
    half_range = (high - low) / 2.0
    if half_range == 0:
        return 0.0
    return max(-1.0, min(1.0, (value - mid) / half_range))


def _linear_score_inverted(value: float, low: float, high: float) -> float:
    """Inverted linear scoring: value below low -> +1, above high -> -1."""
    return -_linear_score(value, low, high)


def _get_macro_snapshot():
    """Get macro snapshot from market data service."""
    try:
        from .data import market_data_service
        return market_data_service.get_macro_snapshot()
    except Exception:
        return None


def _compute_category_summary(signals: List[MacroSignalItem]) -> Dict[str, CategorySignal]:
    """Aggregate signals into category-level summaries."""
    summary = {}
    for cat_key, cat_info in SIGNAL_CATEGORIES.items():
        cat_signals = [s for s in signals if s.category == cat_key]
        n = len(cat_signals)
        avg = sum(s.score for s in cat_signals) / n if n > 0 else 0.0

        if avg > 0.3:
            interp = "偏多"
        elif avg < -0.3:
            interp = "偏空"
        else:
            interp = "中性"

        summary[cat_key] = CategorySignal(
            name=cat_info["name"],
            weight=cat_info["weight"],
            avg_score=round(avg, 2),
            interpretation=interp,
            signal_count=n,
        )
    return summary


def _compute_adjustments(
    saa: Dict[str, float], equity_adj: float, confidence: float
) -> Dict[str, float]:
    """Compute per-asset TAA adjustments.

    Equity group gets equity_adj distributed proportionally.
    Fixed income absorbs the offset.
    """
    adjustments = {a: 0.0 for a in ASSET_CLASSES}

    if abs(equity_adj) < 0.001:
        return adjustments

    # Distribute equity adjustment proportionally within equity group
    equity_assets = GROUP_MAP["equity"]
    equity_total = sum(saa.get(a, 0.0) for a in equity_assets)

    if equity_total > 0:
        for a in equity_assets:
            share = saa.get(a, 0.0) / equity_total
            adj = equity_adj * share
            adj = max(-MAX_SINGLE_ADJUSTMENT, min(MAX_SINGLE_ADJUSTMENT, adj))
            adjustments[a] = round(adj, 6)

    # Offset from fixed income proportionally
    fi_assets = GROUP_MAP["fixed_income"]
    fi_total = sum(saa.get(a, 0.0) for a in fi_assets)
    total_eq_adj = sum(adjustments[a] for a in equity_assets)

    if fi_total > 0:
        for a in fi_assets:
            share = saa.get(a, 0.0) / fi_total
            adjustments[a] = round(-total_eq_adj * share, 6)

    return adjustments


def _renormalize(allocations: Dict[str, float]) -> Dict[str, float]:
    """Ensure non-negative and sum to 1."""
    for a in allocations:
        allocations[a] = max(0.0, allocations[a])
    total = sum(allocations.values())
    if total > 0:
        for a in allocations:
            allocations[a] = round(allocations[a] / total, 6)
    return allocations


def _infer_business_cycle(regime: RegimeState) -> BusinessCycle:
    """Map regime to business cycle phase."""
    cycle_map = {
        "goldilocks": BusinessCycle(
            phase="expansion", phase_name="扩张期",
            preferred_style="成长", preferred_industries=["科技", "消费", "新能源"],
            bond_duration="短久期",
        ),
        "overheat": BusinessCycle(
            phase="late", phase_name="过热期",
            preferred_style="价值", preferred_industries=["能源", "材料", "金融"],
            bond_duration="超短久期",
        ),
        "stagflation": BusinessCycle(
            phase="stagflation", phase_name="滞胀期",
            preferred_style="防御", preferred_industries=["公用事业", "医药", "必选消费"],
            bond_duration="中等久期",
        ),
        "deflation": BusinessCycle(
            phase="recession", phase_name="衰退期",
            preferred_style="防御", preferred_industries=["国债", "黄金", "公用事业"],
            bond_duration="长久期",
        ),
        "baseline": BusinessCycle(
            phase="mid", phase_name="复苏中期",
            preferred_style="均衡", preferred_industries=["消费", "科技", "金融"],
            bond_duration="中等久期",
        ),
    }
    return cycle_map.get(regime.regime, cycle_map["baseline"])


# ---------------------------------------------------------------------------
# Backtest adapter: TAA with explicit macro snapshot
# ---------------------------------------------------------------------------

def adjust_taa_with_snapshot(
    saa_allocations: Dict[str, float],
    regime: RegimeState,
    macro_snapshot: Dict[str, Optional[float]],
) -> TAASummary:
    """Apply TAA using an explicit macro snapshot (for backtesting).

    Same logic as adjust_taa() but accepts historical point-in-time values
    instead of calling the live market data service.
    """
    signals = _generate_signals_from_snapshot(macro_snapshot)
    category_summary = _compute_category_summary(signals)

    base_composite = sum(
        cat.avg_score * SIGNAL_CATEGORIES[cat_key]["weight"]
        for cat_key, cat in category_summary.items()
    )

    # FED model from snapshot
    fed_model = _compute_fed_model_from_snapshot(macro_snapshot)
    fed_value = fed_model["fed_value"]
    fed_interp = fed_model["fed_interpretation"]

    if fed_value is not None:
        composite_score = 0.85 * base_composite + 0.15 * fed_value
    else:
        composite_score = base_composite

    equity_adjustment = composite_score * 0.10 * regime.confidence

    adjustments = _compute_adjustments(saa_allocations, equity_adjustment, regime.confidence)

    taa_adjusted = {}
    for asset in ASSET_CLASSES:
        taa_adjusted[asset] = round(saa_allocations.get(asset, 0.0) + adjustments.get(asset, 0.0), 6)

    taa_adjusted = _renormalize(taa_adjusted)
    business_cycle = _infer_business_cycle(regime)

    return TAASummary(
        taa_adjusted=taa_adjusted,
        adjustments=adjustments,
        composite_score=round(composite_score, 3),
        equity_adjustment=round(equity_adjustment, 4),
        fed_value=fed_value,
        fed_interpretation=fed_interp,
        signals=signals,
        category_summary={k: v for k, v in category_summary.items()},
        business_cycle=business_cycle,
    )


def _generate_signals_from_snapshot(snapshot: Dict[str, Optional[float]]) -> List[MacroSignalItem]:
    """Generate signals from an explicit macro value dict (no live data call)."""
    signal_defs = [
        ("PMI制造业", "growth", lambda v: _linear_score(v, 49.5, 50.5)),
        ("GDP同比", "growth", lambda v: _linear_score(v, 3.0, 6.0)),
        ("CPI同比", "inflation", lambda v: _linear_score_inverted(v, 1.0, 3.0)),
        ("PPI同比", "inflation", lambda v: _linear_score_inverted(v, -2.0, 3.0)),
        ("10Y国债收益率", "interest", lambda v: _linear_score_inverted(v, 2.5, 3.5)),
        ("DR007", "interest", lambda v: _linear_score_inverted(v, 2.0, 3.0)),
        ("社融增速", "credit_money", lambda v: _linear_score(v, 7.0, 10.0)),
        ("M2增速", "credit_money", lambda v: _linear_score(v, 7.0, 10.0)),
        ("融资余额变化", "liquidity", lambda v: _linear_score(v, -200.0, 200.0)),
        ("北向资金净流入", "liquidity", lambda v: _linear_score(v, -50.0, 100.0)),
        ("财政赤字率", "policy", lambda v: _linear_score(v, 2.5, 3.5)),
        ("美联储利率", "overseas", lambda v: _linear_score_inverted(v, 3.0, 5.5)),
        ("美元指数", "overseas", lambda v: _linear_score_inverted(v, 95.0, 105.0)),
    ]

    signals = []
    for name, category, scorer in signal_defs:
        value = snapshot.get(name)

        if value is not None:
            score = scorer(value)
            confidence_str = "medium"
            threshold_desc = f"当前值: {value:.2f}"
        else:
            score = 0
            confidence_str = "low"
            threshold_desc = "数据暂不可用"

        signals.append(MacroSignalItem(
            factor_name=name,
            category=category,
            score=round(score, 2),
            confidence=confidence_str,
            value=value,
            threshold_desc=threshold_desc,
        ))

    return signals


def _compute_fed_model_from_snapshot(snapshot: Dict[str, Optional[float]]) -> dict:
    """Compute FED model from explicit snapshot data (for backtesting)."""
    fed_rate = snapshot.get("美联储利率")
    yield_10y = snapshot.get("10Y国债收益率")

    if fed_rate is None:
        return {
            "fed_value": None,
            "fed_interpretation": "Backtest: Fed利率数据不可用",
        }

    rate_gap = fed_rate - _FED_NEUTRAL_RATE
    rate_gap_score = max(-1.0, min(1.0, -rate_gap / 2.5))

    if yield_10y is not None:
        curve_slope = yield_10y - fed_rate
        curve_score = max(-1.0, min(1.0, curve_slope / 2.0))
    else:
        curve_score = 0.0

    fed_score = round(0.6 * rate_gap_score + 0.4 * curve_score, 3)

    if fed_score > 0.3:
        interp = f"Backtest: 宽松(Fed {fed_rate:.1f}%)"
    elif fed_score < -0.3:
        interp = f"Backtest: 紧缩(Fed {fed_rate:.1f}%)"
    else:
        interp = f"Backtest: 中性(Fed {fed_rate:.1f}%)"

    return {"fed_value": fed_score, "fed_interpretation": interp}
