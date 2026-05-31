"""Data models for market data layer."""
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class MacroIndicator:
    """A single macro economic indicator value."""
    name: str
    value: Optional[float] = None
    source: str = "static"          # "akshare" | "tushare" | "cache" | "static"
    confidence: float = 0.3         # 0-1: live=0.9, cached=0.7, static=0.3
    fetch_time: Optional[str] = None
    ttl_seconds: int = 86400


@dataclass
class RollingAssetStats:
    """Rolling statistics for one asset class."""
    asset_class: str
    annualized_return: float        # % (e.g. 8.5)
    annualized_vol: float           # % (e.g. 22.0)
    as_of_date: str = ""
    window_days: int = 252


@dataclass
class VolatilitySnapshot:
    """Volatility ratio snapshot for circuit breaker."""
    current_vol_20d: float          # annualized 20-day vol (decimal)
    long_term_vol_252d: float       # annualized 252-day vol (decimal)
    vol_ratio: float                # = current / long_term
    as_of_date: str = ""


@dataclass
class MacroSnapshot:
    """Container for all 13 macro indicators."""
    indicators: Dict[str, MacroIndicator] = field(default_factory=dict)
    overall_confidence: float = 0.3

    def get_value(self, name: str) -> Optional[float]:
        ind = self.indicators.get(name)
        return ind.value if ind else None

    def get_confidence(self, name: str) -> float:
        ind = self.indicators.get(name)
        return ind.confidence if ind else 0.0
