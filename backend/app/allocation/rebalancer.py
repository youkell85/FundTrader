"""
再平衡引擎 — 偏离度监控、触发规则、调仓建议生成
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Literal, Optional, Tuple


# ─── 触发规则阈值 ───

DEVIATION_THRESHOLDS: Dict[str, Dict[str, float]] = {
    # risk_profile: { absolute_pct: 单资产偏离触发, group_pct: 大类偏离触发 }
    "conservative": {"absolute_pct": 3.0, "group_pct": 5.0},
    "moderate": {"absolute_pct": 4.0, "group_pct": 6.0},
    "balanced": {"absolute_pct": 5.0, "group_pct": 8.0},
    "aggressive": {"absolute_pct": 6.0, "group_pct": 10.0},
    "radical": {"absolute_pct": 8.0, "group_pct": 12.0},
}

# 时间触发：不同风格的最长无再平衡间隔(天)
TIME_TRIGGER_DAYS: Dict[str, int] = {
    "conservative": 60,
    "moderate": 90,
    "balanced": 90,
    "aggressive": 120,
    "radical": 180,
}

# 资产类 -> 大类分组
ASSET_TO_GROUP: Dict[str, str] = {
    "a_share_large": "equity", "a_share_small": "equity",
    "a_share_value": "equity", "a_share_growth": "equity",
    "hk_equity": "equity", "us_equity": "equity",
    "rate_bond": "fixed_income", "credit_bond": "fixed_income",
    "convertible": "fixed_income",
    "money_fund": "cash_equiv", "cash": "cash_equiv",
    "gold": "alternative", "commodity": "alternative", "reits": "alternative",
}


@dataclass
class DeviationItem:
    """单个资产/大类的偏离度信息"""
    name: str
    target_weight: float  # %
    current_weight: float  # %
    deviation: float  # 绝对偏离 (current - target)
    deviation_pct: float  # |deviation|
    is_group: bool = False
    severity: Literal["normal", "warning", "critical"] = "normal"


@dataclass
class RebalanceTrigger:
    """触发条件"""
    trigger_type: Literal["deviation", "time", "regime_change", "manual"]
    description: str
    triggered: bool
    details: str = ""


@dataclass
class TradeAction:
    """单笔调仓操作"""
    asset_class: str
    asset_label: str
    direction: Literal["buy", "sell"]
    current_weight: float
    target_weight: float
    delta_weight: float  # 变化量(正值)
    delta_amount: float  # 预估金额
    fund_code: str = ""
    fund_name: str = ""
    priority: int = 1  # 1=高优先, 2=中, 3=低


@dataclass
class RebalanceSuggestion:
    """一次完整的再平衡建议"""
    suggestion_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    generated_at: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M"))
    risk_profile: str = "balanced"
    triggers: List[RebalanceTrigger] = field(default_factory=list)
    should_rebalance: bool = False
    urgency: Literal["low", "medium", "high"] = "low"
    deviations: List[DeviationItem] = field(default_factory=list)
    actions: List[TradeAction] = field(default_factory=list)
    total_turnover: float = 0.0  # 换手率(%)
    estimated_cost: float = 0.0  # 预估交易成本(元)
    summary: str = ""


@dataclass
class RebalanceHistoryEntry:
    """历史调仓记录"""
    entry_id: str
    executed_at: str
    risk_profile: str
    trigger_type: str
    actions_count: int
    total_turnover: float
    estimated_cost: float
    status: Literal["executed", "skipped", "partial"]
    summary: str


# ─── 核心函数 ───

def compute_deviations(
    target_allocations: Dict[str, float],
    current_allocations: Dict[str, float],
    risk_profile: str = "balanced",
) -> List[DeviationItem]:
    """计算每个资产及大类的偏离度"""
    thresholds = DEVIATION_THRESHOLDS.get(risk_profile, DEVIATION_THRESHOLDS["balanced"])
    abs_threshold = thresholds["absolute_pct"]
    group_threshold = thresholds["group_pct"]

    items: List[DeviationItem] = []

    # 资产级偏离
    all_assets = set(list(target_allocations.keys()) + list(current_allocations.keys()))
    for asset in sorted(all_assets):
        target = target_allocations.get(asset, 0.0)
        current = current_allocations.get(asset, 0.0)
        dev = current - target
        dev_abs = abs(dev)
        severity: Literal["normal", "warning", "critical"] = "normal"
        if dev_abs >= abs_threshold * 1.5:
            severity = "critical"
        elif dev_abs >= abs_threshold:
            severity = "warning"
        items.append(DeviationItem(
            name=asset, target_weight=target, current_weight=current,
            deviation=round(dev, 2), deviation_pct=round(dev_abs, 2),
            is_group=False, severity=severity,
        ))

    # 大类级偏离
    target_groups: Dict[str, float] = {}
    current_groups: Dict[str, float] = {}
    for asset in all_assets:
        group = ASSET_TO_GROUP.get(asset, "other")
        target_groups[group] = target_groups.get(group, 0.0) + target_allocations.get(asset, 0.0)
        current_groups[group] = current_groups.get(group, 0.0) + current_allocations.get(asset, 0.0)

    for group in sorted(set(list(target_groups.keys()) + list(current_groups.keys()))):
        target = target_groups.get(group, 0.0)
        current = current_groups.get(group, 0.0)
        dev = current - target
        dev_abs = abs(dev)
        severity = "normal"
        if dev_abs >= group_threshold * 1.5:
            severity = "critical"
        elif dev_abs >= group_threshold:
            severity = "warning"
        items.append(DeviationItem(
            name=group, target_weight=round(target, 2), current_weight=round(current, 2),
            deviation=round(dev, 2), deviation_pct=round(dev_abs, 2),
            is_group=True, severity=severity,
        ))

    return items


def check_triggers(
    deviations: List[DeviationItem],
    risk_profile: str = "balanced",
    last_rebalance_date: Optional[str] = None,
    regime_changed: bool = False,
) -> List[RebalanceTrigger]:
    """检查所有再平衡触发条件"""
    triggers: List[RebalanceTrigger] = []

    # 1. 偏离度触发
    critical_devs = [d for d in deviations if d.severity == "critical"]
    warning_devs = [d for d in deviations if d.severity == "warning"]
    if critical_devs:
        names = ", ".join(d.name for d in critical_devs[:3])
        triggers.append(RebalanceTrigger(
            trigger_type="deviation", triggered=True,
            description="严重偏离触发",
            details=f"{len(critical_devs)}个资产严重偏离目标 ({names})",
        ))
    elif warning_devs:
        names = ", ".join(d.name for d in warning_devs[:3])
        triggers.append(RebalanceTrigger(
            trigger_type="deviation", triggered=True,
            description="偏离度触发",
            details=f"{len(warning_devs)}个资产偏离目标 ({names})",
        ))
    else:
        triggers.append(RebalanceTrigger(
            trigger_type="deviation", triggered=False,
            description="偏离度正常",
            details="所有资产在目标区间内",
        ))

    # 2. 时间触发
    max_days = TIME_TRIGGER_DAYS.get(risk_profile, 90)
    if last_rebalance_date:
        try:
            last_dt = datetime.strptime(last_rebalance_date, "%Y-%m-%d")
            days_since = (datetime.now() - last_dt).days
            time_triggered = days_since >= max_days
            triggers.append(RebalanceTrigger(
                trigger_type="time", triggered=time_triggered,
                description=f"距上次调仓 {days_since} 天",
                details=f"{'已超过' if time_triggered else '未到'}{max_days}天定期再平衡周期",
            ))
        except ValueError:
            triggers.append(RebalanceTrigger(
                trigger_type="time", triggered=False,
                description="时间规则", details="上次调仓日期格式无效",
            ))
    else:
        triggers.append(RebalanceTrigger(
            trigger_type="time", triggered=True,
            description="首次建仓",
            details="无历史调仓记录，建议按目标建仓",
        ))

    # 3. 市场体制变化触发
    triggers.append(RebalanceTrigger(
        trigger_type="regime_change", triggered=regime_changed,
        description="市场体制变化" if regime_changed else "市场体制稳定",
        details="检测到市场体制切换，建议战术性调整" if regime_changed else "当前市场体制未发生显著变化",
    ))

    return triggers


def generate_actions(
    target_allocations: Dict[str, float],
    current_allocations: Dict[str, float],
    total_amount: float = 500000,
    fund_mapping: Optional[Dict[str, Tuple[str, str]]] = None,
    min_trade_pct: float = 0.5,
) -> List[TradeAction]:
    """生成具体的调仓操作列表"""
    from .fund_mapper import map_funds, _FUND_POOL

    actions: List[TradeAction] = []
    all_assets = set(list(target_allocations.keys()) + list(current_allocations.keys()))

    # 资产中文标签
    _LABELS = {
        "a_share_large": "A股大盘", "a_share_small": "A股小盘",
        "a_share_value": "A股价值", "a_share_growth": "A股成长",
        "hk_equity": "港股", "us_equity": "美股(QDII)",
        "rate_bond": "利率债", "credit_bond": "信用债", "convertible": "可转债",
        "money_fund": "货币基金", "gold": "黄金ETF",
        "commodity": "商品期货", "reits": "公募REITs", "cash": "现金",
    }

    for asset in sorted(all_assets):
        target = target_allocations.get(asset, 0.0)
        current = current_allocations.get(asset, 0.0)
        delta = target - current  # 正=买入, 负=卖出

        if abs(delta) < min_trade_pct:
            continue

        direction: Literal["buy", "sell"] = "buy" if delta > 0 else "sell"
        delta_amount = abs(delta) / 100.0 * total_amount

        # 尝试从基金映射获取代码
        fund_code = ""
        fund_name = ""
        if fund_mapping and asset in fund_mapping:
            fund_code, fund_name = fund_mapping[asset]
        else:
            # 从 fund_pool 中找到该 asset_class 的第一个基金
            for code, profile in _FUND_POOL.items():
                if profile.asset_class == asset:
                    fund_code = code
                    fund_name = profile.name
                    break

        # 优先级：偏离越大越优先
        priority = 1 if abs(delta) >= 5.0 else (2 if abs(delta) >= 2.0 else 3)

        actions.append(TradeAction(
            asset_class=asset,
            asset_label=_LABELS.get(asset, asset),
            direction=direction,
            current_weight=round(current, 2),
            target_weight=round(target, 2),
            delta_weight=round(abs(delta), 2),
            delta_amount=round(delta_amount, 2),
            fund_code=fund_code,
            fund_name=fund_name,
            priority=priority,
        ))

    # 按优先级排序，同优先级按金额降序
    actions.sort(key=lambda a: (a.priority, -a.delta_amount))
    return actions


def run_rebalance_check(
    target_allocations: Dict[str, float],
    current_allocations: Dict[str, float],
    risk_profile: str = "balanced",
    total_amount: float = 500000,
    last_rebalance_date: Optional[str] = None,
    regime_changed: bool = False,
) -> RebalanceSuggestion:
    """执行完整的再平衡检查并返回建议"""

    # 1. 计算偏离度
    deviations = compute_deviations(target_allocations, current_allocations, risk_profile)

    # 2. 检查触发条件
    triggers = check_triggers(deviations, risk_profile, last_rebalance_date, regime_changed)

    # 3. 判断是否需要再平衡
    any_triggered = any(t.triggered for t in triggers)
    has_critical = any(d.severity == "critical" for d in deviations)
    has_warning = any(d.severity == "warning" for d in deviations)

    # 4. 确定紧急度
    urgency: Literal["low", "medium", "high"] = "low"
    if has_critical or (regime_changed and has_warning):
        urgency = "high"
    elif has_warning or any(t.triggered and t.trigger_type == "time" for t in triggers):
        urgency = "medium"

    # 5. 生成调仓操作
    actions: List[TradeAction] = []
    if any_triggered:
        actions = generate_actions(
            target_allocations, current_allocations,
            total_amount=total_amount,
        )

    # 6. 计算换手率和成本
    total_turnover = sum(a.delta_weight for a in actions) / 2.0  # 单边换手
    # 估算交易成本：ETF约0.1%，主动基金约0.15%
    estimated_cost = sum(a.delta_amount * 0.001 for a in actions)

    # 7. 生成摘要
    if not any_triggered:
        summary = "当前持仓在目标范围内，无需调仓"
    elif urgency == "high":
        summary = f"检测到{len(actions)}笔调仓需求，建议尽快执行再平衡"
    else:
        summary = f"建议调整{len(actions)}个持仓，预计换手{total_turnover:.1f}%"

    return RebalanceSuggestion(
        risk_profile=risk_profile,
        triggers=triggers,
        should_rebalance=any_triggered,
        urgency=urgency,
        deviations=deviations,
        actions=actions,
        total_turnover=round(total_turnover, 2),
        estimated_cost=round(estimated_cost, 2),
        summary=summary,
    )


# ─── 模拟历史数据 ───

def get_mock_history() -> List[RebalanceHistoryEntry]:
    """返回模拟的历史调仓记录"""
    now = datetime.now()
    return [
        RebalanceHistoryEntry(
            entry_id="h001", executed_at=(now - timedelta(days=7)).strftime("%Y-%m-%d"),
            risk_profile="balanced", trigger_type="deviation",
            actions_count=4, total_turnover=3.2, estimated_cost=160.0,
            status="executed", summary="权益超配3%，减仓A股大盘+增配利率债",
        ),
        RebalanceHistoryEntry(
            entry_id="h002", executed_at=(now - timedelta(days=45)).strftime("%Y-%m-%d"),
            risk_profile="balanced", trigger_type="time",
            actions_count=3, total_turnover=2.1, estimated_cost=105.0,
            status="executed", summary="季度定期再平衡，微调组合回归目标权重",
        ),
        RebalanceHistoryEntry(
            entry_id="h003", executed_at=(now - timedelta(days=98)).strftime("%Y-%m-%d"),
            risk_profile="balanced", trigger_type="regime_change",
            actions_count=6, total_turnover=5.8, estimated_cost=290.0,
            status="executed", summary="市场从金发女孩转向过热，降低权益增配黄金和债券",
        ),
        RebalanceHistoryEntry(
            entry_id="h004", executed_at=(now - timedelta(days=140)).strftime("%Y-%m-%d"),
            risk_profile="balanced", trigger_type="deviation",
            actions_count=2, total_turnover=1.5, estimated_cost=75.0,
            status="skipped", summary="偏离度轻微，用户选择暂不调仓",
        ),
        RebalanceHistoryEntry(
            entry_id="h005", executed_at=(now - timedelta(days=210)).strftime("%Y-%m-%d"),
            risk_profile="balanced", trigger_type="manual",
            actions_count=5, total_turnover=4.3, estimated_cost=215.0,
            status="executed", summary="用户手动发起再平衡，全面回归SAA目标权重",
        ),
    ]
