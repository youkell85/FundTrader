"""Pydantic v2 models — matches frontend TypeScript AllocationRequest/Response exactly."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


# ─── Request ───

RiskTolerance = Literal["conservative", "moderate", "balanced", "aggressive", "radical"]
InvestmentHorizon = Literal["short", "medium", "long", "very_long"]
GoalType = Literal["retirement", "education", "housing", "wealth"]
MarketRegime = Literal["goldilocks", "overheat", "stagflation", "deflation", "baseline"]


class AllocationRequest(BaseModel):
    age: int = 35
    goal_type: Optional[GoalType] = "wealth"
    investment_horizon: Optional[InvestmentHorizon] = "medium"
    amount: float = 500000
    target_date: Optional[str] = None
    behavior_answers: Optional[Dict[str, str]] = None
    risk_tolerance: RiskTolerance = "balanced"
    max_drawdown: Optional[float] = None
    preferred_tags: List[str] = Field(default_factory=list)


# ─── Response Sub-Models ───

class AllocationMeta(BaseModel):
    engine_version: str = "4.0.0"
    generated_at: str = ""
    regime: MarketRegime = "baseline"
    regime_label: str = "基准"
    regime_pending: Optional[str] = None
    regime_pending_count: int = 0
    regime_is_confirmed: bool = True
    taa_skipped: bool = False
    circuit_breaker_triggered: bool = False


class UserProfileSummary(BaseModel):
    risk_tolerance: RiskTolerance
    risk_label: str
    effective_risk: RiskTolerance
    behavior_adjusted: bool = False
    age: int
    amount: float
    horizon: str


class SAASummary(BaseModel):
    allocations: Dict[str, float]
    group_allocations: Dict[str, float]
    equity_center: float
    expected_return: float
    expected_volatility: float
    expected_max_drawdown: float
    sharpe_ratio: float
    glide_path_applied: bool = False
    risk_contributions: Dict[str, float]


class MacroSignalItem(BaseModel):
    factor_name: str
    category: str
    score: float  # -1.0 to +1.0 continuous score
    confidence: str
    value: Optional[float] = None
    threshold_desc: Optional[str] = None


class CategorySignal(BaseModel):
    name: str
    weight: float
    avg_score: float
    interpretation: str
    signal_count: int


class BusinessCycle(BaseModel):
    phase: str
    phase_name: str
    preferred_style: str
    preferred_industries: List[str]
    bond_duration: str


class TAASummary(BaseModel):
    taa_adjusted: Dict[str, float]
    adjustments: Dict[str, float]
    composite_score: float = 0.0
    equity_adjustment: float = 0.0
    fed_value: Optional[float] = None
    fed_interpretation: str = ""
    signals: List[MacroSignalItem] = Field(default_factory=list)
    category_summary: Dict[str, CategorySignal] = Field(default_factory=dict)
    business_cycle: BusinessCycle = Field(
        default_factory=lambda: BusinessCycle(
            phase="mid", phase_name="复苏中期", preferred_style="均衡",
            preferred_industries=["消费", "科技", "金融"], bond_duration="中等久期",
        )
    )


class FundItem(BaseModel):
    code: str
    name: str
    type: str
    asset_class: str
    company: str = ""
    weight: float
    amount: float
    role: str
    reason: str
    score: float


class StressScenarioItem(BaseModel):
    scenario: str
    impact: float
    max_loss: float


class MonteCarloResult(BaseModel):
    median_return: float
    percentile_10: float
    percentile_25: float
    percentile_75: float
    percentile_90: float
    max_drawdown_95: float
    var_95: float
    cvar_95: float
    var_95_annual: Optional[float] = None  # Annualized (comparable across horizons)
    cvar_95_annual: Optional[float] = None
    prob_positive: float


class ScenarioItem(BaseModel):
    scenario: str
    description: str
    probability: float
    impact: float


class ScenarioAnalysis(BaseModel):
    weighted_return: float
    scenarios: List[ScenarioItem]


class ConstraintCheckItem(BaseModel):
    rule: str
    value: str
    limit: str
    passed: bool


# ─── Full Response ───

class AllocationResponse(BaseModel):
    meta: AllocationMeta
    user_profile: UserProfileSummary
    saa: SAASummary
    taa: TAASummary
    funds: List[FundItem]
    portfolio_metrics: Dict[str, float]
    stress_tests: List[StressScenarioItem]
    monte_carlo: Optional[MonteCarloResult] = None
    scenario_analysis: Optional[ScenarioAnalysis] = None
    factor_exposures: Dict[str, float]
    constraints: List[ConstraintCheckItem]
    risk_disclaimer: str = ""
    warnings: List[str] = Field(default_factory=list)


# ─── Internal Intermediate Types ───

class RiskProfile(BaseModel):
    risk_tolerance: RiskTolerance
    effective_risk: RiskTolerance
    equity_center: float  # 0-100
    max_drawdown: float  # 0-100
    volatility_target: float
    behavior_adjusted: bool = False
    glide_path_applied: bool = False
    age: int
    amount: float
    horizon: InvestmentHorizon
    horizon_months: int


class CMAResult(BaseModel):
    expected_returns: Dict[str, float]  # annualized %
    volatilities: Dict[str, float]  # annualized %
    covariance_matrix: List[List[float]]  # 14×14


class RegimeState(BaseModel):
    regime: MarketRegime = "baseline"
    regime_label: str = "基准"
    confidence: float = 0.5
    score: float = 0.0
    pending_regime: Optional[str] = None
    pending_count: int = 0
    is_confirmed: bool = True


# ─── Fund Ranking API Models ───

class FundRankingItem(BaseModel):
    """单只基金的排名信息"""
    code: str
    name: str
    fund_type: str
    rank: int
    total_score: float
    tracking_score: float
    liquidity_score: float
    cost_score: float
    scale_score: float
    performance_score: float
    is_recommended: bool
    reasons: List[str]
    management_fee: float
    custody_fee: float
    aum: float
    tracking_error: float


class FundRankingRequest(BaseModel):
    preferred_tags: List[str] = Field(default_factory=list)


class FundRankingResponse(BaseModel):
    """全资产类别基金排名"""
    rankings: Dict[str, List[FundRankingItem]]


# ─── Rebalance API Models ───

class RebalanceDeviationItem(BaseModel):
    """偏离度信息"""
    name: str
    target_weight: float
    current_weight: float
    deviation: float
    deviation_pct: float
    is_group: bool = False
    severity: Literal["normal", "warning", "critical"] = "normal"


class RebalanceTriggerItem(BaseModel):
    """触发条件"""
    trigger_type: Literal["deviation", "time", "regime_change", "manual"]
    description: str
    triggered: bool
    details: str = ""


class TradeActionItem(BaseModel):
    """单笔调仓操作"""
    asset_class: str
    asset_label: str
    direction: Literal["buy", "sell"]
    current_weight: float
    target_weight: float
    delta_weight: float
    delta_amount: float
    fund_code: str = ""
    fund_name: str = ""
    priority: int = 1


class RebalanceCheckRequest(BaseModel):
    """再平衡检查请求"""
    target_allocations: Dict[str, float]
    current_allocations: Dict[str, float]
    risk_profile: str = "balanced"
    total_amount: float = 500000
    last_rebalance_date: Optional[str] = None
    regime_changed: bool = False


class RebalanceCheckResponse(BaseModel):
    """再平衡检查结果"""
    suggestion_id: str
    generated_at: str
    risk_profile: str
    should_rebalance: bool
    urgency: Literal["low", "medium", "high"]
    triggers: List[RebalanceTriggerItem]
    deviations: List[RebalanceDeviationItem]
    actions: List[TradeActionItem]
    total_turnover: float
    estimated_cost: float
    summary: str


class RebalanceHistoryItem(BaseModel):
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


class RebalanceHistoryResponse(BaseModel):
    """历史调仓记录列表"""
    history: List[RebalanceHistoryItem]


# ─── Storage API Models ───

class SavePlanRequest(BaseModel):
    """保存配置方案请求"""
    name: str = "未命名方案"
    description: str = ""
    request: Dict[str, Any]
    response: Dict[str, Any]


class SavedPlanItem(BaseModel):
    """已保存的配置方案"""
    id: str
    created_at: str
    updated_at: str
    name: str
    description: str
    request: Dict[str, Any]
    response: Dict[str, Any]
    risk_profile: str
    is_favorite: bool = False
    is_archived: bool = False


class PlanListResponse(BaseModel):
    """方案列表响应"""
    plans: List[SavedPlanItem]
    total: int


class UpdatePlanRequest(BaseModel):
    """更新方案请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    is_favorite: Optional[bool] = None
    is_archived: Optional[bool] = None


class AddRebalanceRecordRequest(BaseModel):
    """添加调仓记录请求"""
    risk_profile: str
    trigger_type: str
    actions: List[Dict[str, Any]]
    total_turnover: float = 0
    estimated_cost: float = 0
    status: Literal["executed", "skipped", "partial"] = "executed"
    summary: str = ""
    notes: str = ""
    plan_id: Optional[str] = None
    executed_at: Optional[str] = None


class RebalanceStatsResponse(BaseModel):
    """调仓统计响应"""
    total_records: int
    executed_count: int
    total_cost: float
    last_rebalance_date: Optional[str] = None


# ─── Three-Variant Output Models ───

class VariantItem(BaseModel):
    """单个方案变体"""
    label: str  # "defensive" / "balanced" / "growth"
    label_cn: str  # "防御型" / "均衡型" / "进取型"
    risk_tolerance: RiskTolerance
    response: AllocationResponse


class VariantComparison(BaseModel):
    """三方案对比摘要"""
    expected_return: Dict[str, float]  # {defensive: x, balanced: y, growth: z}
    volatility: Dict[str, float]
    sharpe_ratio: Dict[str, float]
    max_drawdown: Dict[str, float]
    equity_ratio: Dict[str, float]


class VariantsResponse(BaseModel):
    """三方案输出响应"""
    variants: Dict[str, VariantItem]
    comparison: VariantComparison


# ─── Explainability Report Models ───

class ExplainSectionModel(BaseModel):
    """报告中的一个章节"""
    title: str
    key: str
    summary: str
    details: List[str] = Field(default_factory=list)
    icon: str = "info"


class ExplainReportModel(BaseModel):
    """可解释性报告响应"""
    sections: List[ExplainSectionModel]
    overall_summary: str
    confidence_score: float


# ─── What-If Simulator Models ───

class WhatIfRequest(BaseModel):
    """What-If模拟器请求"""
    base_request: AllocationRequest
    amount_multiplier: float = 1.0  # 0.5x - 2.0x
    return_adjust: float = 0.0  # -3% to +3%
    vol_multiplier: float = 1.0  # 0.5x - 2.0x
    equity_shift: float = 0.0  # -20% to +20%
    bond_duration_shift: float = 0.0  # -1 to +1
    alt_shift: float = 0.0  # -10% to +10%


class WhatIfResponse(BaseModel):
    """What-If模拟器响应"""
    modified_allocations: Dict[str, float]
    expected_return: float
    expected_volatility: float
    sharpe_ratio: float
    max_drawdown: float
    equity_ratio: float
    delta_return: float
    delta_volatility: float
    delta_sharpe: float


# ─── A/C Share Selector Models ───

class ShareSelectorRequest(BaseModel):
    """A/C份额选择请求"""
    funds: List[Dict[str, str]]  # [{"code": "...", "name": "..."}]
    holding_months: float = 12  # 预期持有期限（月）
    amount: float = 10000  # 投资金额


class ShareRecommendationItem(BaseModel):
    """A/C份额推荐"""
    fund_code: str
    fund_name: str
    recommended_share: Literal["A", "C"]
    reason: str
    breakeven_months: float
    total_cost_a: float
    total_cost_c: float
    savings: float


class ShareSelectorResponse(BaseModel):
    """A/C份额选择响应"""
    recommendations: List[ShareRecommendationItem]
    holding_months: float
    summary: str


# ─── Correlation Constraint Models ───

class CorrelationPairItem(BaseModel):
    """相关性配对"""
    asset_a: str
    asset_b: str
    correlation: float
    exceeds_threshold: bool


class CorrelationCheckRequest(BaseModel):
    """相关性约束检查请求"""
    allocations: Dict[str, float]
    threshold: float = 0.85


class CorrelationCheckResponse(BaseModel):
    """相关性约束检查响应"""
    max_correlation: float
    max_pair: List[str]
    threshold: float
    passed: bool
    violations: List[CorrelationPairItem]
    warnings: List[str]
    correlation_matrix: Dict[str, Dict[str, float]]
    suggestions: List[str]


# ─── Fee Scoring Models ───

class FeeAnalysisRequest(BaseModel):
    """费率分析请求"""
    funds: List[Dict[str, Any]]  # [{code, name, management_fee, custody_fee, ...}]
    asset_class: str


class FeeAnalysisItem(BaseModel):
    """单只基金的费率分析"""
    fund_code: str
    fund_name: str
    asset_class: str
    management_fee: float
    custody_fee: float
    sales_service_fee: float
    subscription_fee: float
    total_expense_ratio: float
    fee_efficiency_score: float
    category_avg_ter: float
    fee_vs_category: float
    cost_1y: float
    cost_3y: float
    cost_5y: float


class FeeAnalysisResponse(BaseModel):
    """费率分析响应"""
    analyses: List[FeeAnalysisItem]
    asset_class: str
    recommendation: str
