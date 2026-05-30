"""Alert Engine — monitor portfolio deviations and generate real-time alerts.

Provides backend support for push notifications when portfolio weights
deviate from targets beyond configured thresholds.
"""
import logging
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)


@dataclass
class Alert:
    """A single alert notification."""
    id: str
    type: str  # "deviation", "drawdown", "vol_spike", "rebalance_due"
    severity: str  # "info", "warning", "critical"
    title: str
    message: str
    asset_class: Optional[str] = None
    value: Optional[float] = None
    threshold: Optional[float] = None
    created_at: str = ""
    read: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# Default alert thresholds
DEFAULT_THRESHOLDS = {
    "deviation_warning": 3.0,     # 3% absolute deviation
    "deviation_critical": 5.0,    # 5% absolute deviation
    "drawdown_warning": -8.0,     # -8% drawdown
    "drawdown_critical": -15.0,   # -15% drawdown
    "vol_spike_ratio": 1.5,       # 1.5x normal volatility
    "rebalance_overdue_days": 90, # 90 days since last rebalance
}

_DEFAULT_USER = "__default__"
_alerts_by_user: Dict[str, List[Dict]] = {}
_alerts_lock = threading.Lock()


def _get_user_alerts(user_id: str) -> List[Dict]:
    if user_id not in _alerts_by_user:
        _alerts_by_user[user_id] = []
    return _alerts_by_user[user_id]


def check_alerts(
    target_weights: Dict[str, float],
    current_weights: Optional[Dict[str, float]] = None,
    portfolio_return: Optional[float] = None,
    vol_ratio: Optional[float] = None,
    last_rebalance_date: Optional[str] = None,
    thresholds: Optional[Dict[str, float]] = None,
    user_id: str = _DEFAULT_USER,
) -> List[Dict[str, Any]]:
    """Check portfolio state against thresholds and generate alerts.

    Args:
        target_weights: SAA target weights {asset_class: weight}
        current_weights: Current actual weights (if None, simulated with drift)
        portfolio_return: Current portfolio cumulative return %
        vol_ratio: Current vol / historical vol ratio
        last_rebalance_date: ISO date of last rebalance
        thresholds: Custom thresholds (overrides defaults)

    Returns:
        List of alert dicts
    """
    th = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    alerts = []
    now = datetime.now().isoformat()

    # 1. Deviation alerts
    if current_weights:
        for asset, target in target_weights.items():
            current = current_weights.get(asset, 0.0)
            deviation = abs(current - target) * 100  # percentage points

            if deviation >= th["deviation_critical"]:
                alerts.append(Alert(
                    id=f"dev_crit_{asset}_{now[:10]}",
                    type="deviation",
                    severity="critical",
                    title=f"{asset} 严重偏离",
                    message=f"当前权重 {current*100:.1f}%，目标 {target*100:.1f}%，偏离 {deviation:.1f}pp",
                    asset_class=asset,
                    value=round(deviation, 2),
                    threshold=th["deviation_critical"],
                    created_at=now,
                ).to_dict())
            elif deviation >= th["deviation_warning"]:
                alerts.append(Alert(
                    id=f"dev_warn_{asset}_{now[:10]}",
                    type="deviation",
                    severity="warning",
                    title=f"{asset} 偏离预警",
                    message=f"当前权重 {current*100:.1f}%，目标 {target*100:.1f}%，偏离 {deviation:.1f}pp",
                    asset_class=asset,
                    value=round(deviation, 2),
                    threshold=th["deviation_warning"],
                    created_at=now,
                ).to_dict())

    # 2. Drawdown alerts
    if portfolio_return is not None:
        if portfolio_return <= th["drawdown_critical"]:
            alerts.append(Alert(
                id=f"dd_crit_{now[:10]}",
                type="drawdown",
                severity="critical",
                title="组合严重回撤",
                message=f"累计收益 {portfolio_return:.1f}%，超过阈值 {th['drawdown_critical']}%",
                value=round(portfolio_return, 2),
                threshold=th["drawdown_critical"],
                created_at=now,
            ).to_dict())
        elif portfolio_return <= th["drawdown_warning"]:
            alerts.append(Alert(
                id=f"dd_warn_{now[:10]}",
                type="drawdown",
                severity="warning",
                title="组合回撤预警",
                message=f"累计收益 {portfolio_return:.1f}%，超过阈值 {th['drawdown_warning']}%",
                value=round(portfolio_return, 2),
                threshold=th["drawdown_warning"],
                created_at=now,
            ).to_dict())

    # 3. Volatility spike alert
    if vol_ratio is not None and vol_ratio >= th["vol_spike_ratio"]:
        alerts.append(Alert(
            id=f"vol_spike_{now[:10]}",
            type="vol_spike",
            severity="warning",
            title="波动率异常升高",
            message=f"当前波动率为历史均值的 {vol_ratio:.1f} 倍",
            value=round(vol_ratio, 2),
            threshold=th["vol_spike_ratio"],
            created_at=now,
        ).to_dict())

    # 4. Rebalance overdue alert
    if last_rebalance_date:
        try:
            last_dt = datetime.fromisoformat(last_rebalance_date[:10])
            days_since = (datetime.now() - last_dt).days
            if days_since >= th["rebalance_overdue_days"]:
                alerts.append(Alert(
                    id=f"rebal_overdue_{now[:10]}",
                    type="rebalance_due",
                    severity="info",
                    title="调仓逾期",
                    message=f"距上次调仓已 {days_since} 天（阈值 {th['rebalance_overdue_days']} 天）",
                    value=days_since,
                    threshold=th["rebalance_overdue_days"],
                    created_at=now,
                ).to_dict())
        except (ValueError, TypeError):
            pass

    # Store alerts (thread-safe, user-isolated)
    with _alerts_lock:
        _get_user_alerts(user_id).extend(alerts)

    return alerts


def get_active_alerts(user_id: str = _DEFAULT_USER) -> List[Dict[str, Any]]:
    """Get all unread alerts for a specific user."""
    with _alerts_lock:
        return [a for a in _get_user_alerts(user_id) if not a.get("read", False)]


def mark_alert_read(alert_id: str, user_id: str = _DEFAULT_USER) -> bool:
    """Mark an alert as read for a specific user."""
    with _alerts_lock:
        for a in _get_user_alerts(user_id):
            if a["id"] == alert_id:
                a["read"] = True
                return True
    return False


def clear_alerts(user_id: str = _DEFAULT_USER):
    """Clear all alerts for a specific user."""
    with _alerts_lock:
        _get_user_alerts(user_id).clear()
