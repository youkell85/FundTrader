"""Backtest data models — Pydantic v2 request/response schemas."""

from datetime import date
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class BacktestRequest(BaseModel):
    """Request to run an allocation backtest over historical data."""

    risk_profile: Literal["conservative", "moderate", "balanced", "aggressive", "radical"] = "balanced"
    start_date: str = Field(..., description="Start date ISO format YYYY-MM-DD")
    end_date: str = Field(..., description="End date ISO format YYYY-MM-DD")
    rebalance_frequency: Literal["monthly", "quarterly", "semi_annually"] = "quarterly"
    comparison_modes: List[Literal["saa_only", "saa_taa", "equal_weight", "sixty_forty"]] = Field(
        default=["saa_only", "saa_taa", "sixty_forty"]
    )
    initial_amount: float = Field(default=1_000_000, gt=0)

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_iso_date(cls, value: str) -> str:
        date.fromisoformat(value)
        return value

    @model_validator(mode="after")
    def validate_date_range(self) -> "BacktestRequest":
        start = date.fromisoformat(self.start_date)
        end = date.fromisoformat(self.end_date)
        if end <= start:
            raise ValueError("end_date must be after start_date")
        if (end - start).days > 3650:
            raise ValueError("backtest range must not exceed 10 years")
        return self


class BacktestCurvePoint(BaseModel):
    """Single point on a backtest equity/drawdown curve."""

    date: str
    value: float
    cumulative_return: float  # %
    drawdown: float  # % (always <= 0)


class RebalanceEvent(BaseModel):
    """Record of a single rebalance action."""

    date: str
    regime: str
    regime_label: str
    weights_before: Dict[str, float]
    weights_after: Dict[str, float]
    turnover: float  # % (sum of abs weight changes / 2)
    circuit_breaker_triggered: bool = False
    taa_equity_adjustment: float = 0.0


class BacktestMetrics(BaseModel):
    """Aggregate performance metrics for one simulation mode."""

    annualized_return: float  # %
    annualized_volatility: float  # % (frontend-aligned alias)
    max_drawdown: float  # % (positive number representing loss)
    max_drawdown_duration_days: int
    sharpe_ratio: float
    calmar_ratio: Optional[float] = None
    sortino_ratio: Optional[float] = None
    monthly_win_rate: float  # % of positive months (frontend-aligned)
    avg_turnover: float  # % average per rebalance
    total_rebalances: int = 0
    taa_value_added: Optional[float] = None  # excess vs saa_only
    information_ratio: Optional[float] = None
    alpha: Optional[float] = None  # % annualized
    beta: Optional[float] = None
    tracking_error: Optional[float] = None  # % annualized


class RegimeHistoryEntry(BaseModel):
    """A contiguous period under one market regime."""

    start_date: str
    end_date: str
    regime: str
    regime_label: str


class DataQuality(BaseModel):
    """Metadata about data coverage in the backtest."""

    assets_with_full_history: int
    assets_with_partial_history: int
    missing_assets: List[str]
    macro_coverage_pct: float
    earliest_common_date: str
    total_trading_days: int


class CostAssumptionSummary(BaseModel):
    """Cost assumption and turnover impact summary."""

    enabled: bool = False
    cost_bps: Optional[float] = None  # bps per rebalance
    total_cost_pct: Optional[float] = None  # % cumulative cost estimate
    annualized_cost_pct: Optional[float] = None  # % annualized cost estimate
    avg_turnover_pct: Optional[float] = None  # % average turnover
    rebalance_count: Optional[int] = None
    source: Optional[str] = None
    missing_reason: Optional[str] = None


class BacktestResponse(BaseModel):
    """Complete backtest result."""

    curves: Dict[str, List[BacktestCurvePoint]]
    metrics: Dict[str, BacktestMetrics]
    regime_history: List[RegimeHistoryEntry]
    rebalance_events: List[RebalanceEvent]
    attribution: Dict[str, Any]  # regime -> {period_return, count, avg_monthly}
    rolling_sharpe: List[Dict[str, Any]]  # [{date, mode1_sharpe, mode2_sharpe, ...}]
    monthly_returns: Dict[str, Dict[str, float]]  # mode -> {"2020-01": 2.3, ...}
    data_quality: DataQuality
    cost_assumption: Optional[CostAssumptionSummary] = None
