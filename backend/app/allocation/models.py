"""Pydantic v2 models — matches frontend TypeScript AllocationRequest/Response exactly."""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, field_validator


# ─── Request ───

RiskTolerance = Literal["conservative", "moderate", "balanced", "aggressive", "radical"]
InvestmentHorizon = Literal["short", "medium", "long", "very_long"]
GoalType = Literal["retirement", "education", "housing", "wealth"]
MarketRegime = Literal["goldilocks", "overheat", "stagflation", "deflation", "baseline"]


class AllocationRequest(BaseModel):
    age: int = Field(default=35, ge=18, le=120)
    goal_type: Optional[GoalType] = "wealth"
    investment_horizon: Optional[InvestmentHorizon] = "medium"
    amount: float = Field(default=500000, gt=0, le=1_000_000_000)
    target_date: Optional[str] = None
    behavior_answers: Optional[Dict[str, str]] = None
    risk_tolerance: RiskTolerance = "balanced"
    max_drawdown: Optional[float] = Field(default=None, ge=0, le=100)
    preferred_tags: List[str] = Field(default_factory=list, max_length=20)

    @field_validator("target_date")
    @classmethod
    def validate_target_date(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return value
        date.fromisoformat(value)
        return value


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
    # ─── Behavior calibration provenance (optional, API-compatible) ───
    behavior_score: Optional[float] = None
    behavior_question_count: Optional[int] = None
    behavior_source: Optional[str] = None
    behavior_calibration_version: Optional[str] = None
    behavior_as_of: Optional[str] = None


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
    risk_contribution_source: str = "covariance_matrix"
    data_status: str = "real"
    missing_reason: Optional[str] = None


class MacroSignalItem(BaseModel):
    factor_name: str
    category: str
    score: float  # -1.0 to +1.0 continuous score
    confidence: str
    value: Optional[float] = None
    threshold_desc: Optional[str] = None
    raw_score: Optional[float] = None
    confidence_value: Optional[float] = None
    attenuation: Optional[float] = None


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
    metadata_status: str = "assumption"
    metadata_source: str = "static_fund_pool"
    metadata_as_of: Optional[str] = None
    stale_days: Optional[int] = None
    management_fee: Optional[float] = None
    custody_fee: Optional[float] = None
    sales_service_fee: Optional[float] = None
    subscription_fee: Optional[float] = None
    fee_source: Optional[str] = None


class StressScenarioItem(BaseModel):
    scenario: str
    impact: float
    max_loss: float
    source: Optional[str] = None
    source_window: Optional[str] = None
    calibration_version: Optional[str] = None


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
    jump_source: Optional[str] = None
    jump_as_of: Optional[str] = None
    jump_sample_size: Optional[int] = None
    calibration_version: Optional[str] = None
    jump_missing_reason: Optional[str] = None


class ScenarioItem(BaseModel):
    scenario: str
    description: str
    probability: float
    impact: float


class ScenarioAnalysis(BaseModel):
    weighted_return: float
    scenarios: List[ScenarioItem]
    source: Optional[str] = None
    calibration_version: Optional[str] = None
    as_of_date: Optional[str] = None
    probability_source: Optional[str] = None
    baseline_source: Optional[str] = None


class ConstraintCheckItem(BaseModel):
    rule: str
    value: str
    limit: str
    passed: bool


DataStatus = Literal["real", "partial", "assumption", "stale", "missing", "rejected"]


class DataQualityItem(BaseModel):
    status: DataStatus
    source: Optional[str] = None
    as_of: Optional[str] = None
    coverage: Optional[float] = None
    reason: Optional[str] = None
    confidence: Optional[float] = None


class AllocationDataQuality(BaseModel):
    overall_status: DataStatus = "real"
    macro: Dict[str, DataQualityItem] = Field(default_factory=dict)
    market: Dict[str, DataQualityItem] = Field(default_factory=dict)
    cma: DataQualityItem
    factor: DataQualityItem
    fund_mapping: DataQualityItem
    monte_carlo: DataQualityItem
    invalid_assets: Dict[str, str] = Field(default_factory=dict)
    assumptions_used: List[str] = Field(default_factory=list)


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
    data_quality: Optional[AllocationDataQuality] = None


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
    # ─── Behavior calibration provenance (optional) ───
    behavior_score: Optional[float] = None
    behavior_question_count: Optional[int] = None
    behavior_source: Optional[str] = None
    behavior_calibration_version: Optional[str] = None
    behavior_as_of: Optional[str] = None


class CMAResult(BaseModel):
    expected_returns: Dict[str, float]  # annualized %
    volatilities: Dict[str, float]  # annualized %
    covariance_matrix: List[List[float]]  # 14×14
    quality: Optional[Dict[str, Any]] = None


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
    metadata_status: str = "assumption"
    metadata_source: str = "static_fund_pool"
    metadata_as_of: Optional[str] = None
    stale_days: Optional[int] = None


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
    fee_source: str = "default_assumption"
    missing_reason: str = ""


class ShareSelectorResponse(BaseModel):
    """A/C份额选择响应"""
    recommendations: List[ShareRecommendationItem]
    holding_months: float
    summary: str
    data_status: Literal["real", "partial", "missing"] = "missing"
    missing_reason: Optional[str] = None


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
    material_weight: float = 0.20


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


# PR-01 fusion contracts: lifecycle, portfolio, DCA lab, professional score, sales.

class EvidenceRef(BaseModel):
    """Traceable source reference used by professional and sales-facing outputs."""
    source: str
    as_of: Optional[str] = None
    description: str = ""
    url: Optional[str] = None
    confidence: float = Field(default=0.0, ge=0, le=1)


class FusionDataQuality(BaseModel):
    status: DataStatus = "missing"
    source: str = ""
    as_of: Optional[str] = None
    coverage: float = Field(default=0.0, ge=0, le=1)
    confidence: float = Field(default=0.0, ge=0, le=1)
    missing_reason: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class LifecycleGoalItem(BaseModel):
    id: str
    name: str
    goal_type: GoalType = "wealth"
    target_amount: float = Field(gt=0)
    horizon_years: int = Field(ge=1, le=80)
    priority: int = Field(default=1, ge=1, le=5)
    current_balance: float = Field(default=0, ge=0)
    monthly_contribution: float = Field(default=0, ge=0)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GlidePathPoint(BaseModel):
    age: int = Field(ge=18, le=120)
    equity_weight: float = Field(ge=0, le=1)
    bond_weight: float = Field(ge=0, le=1)
    cash_weight: float = Field(default=0, ge=0, le=1)
    alternative_weight: float = Field(default=0, ge=0, le=1)
    note: str = ""


class PolicyBand(BaseModel):
    asset_class: str
    target_weight: float = Field(ge=0, le=1)
    min_weight: float = Field(ge=0, le=1)
    max_weight: float = Field(ge=0, le=1)
    rebalance_trigger: float = Field(default=0.05, ge=0, le=1)


class IpsSummary(BaseModel):
    investor_profile: str
    objectives: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)
    risk_budget: Dict[str, Any] = Field(default_factory=dict)
    suitability_notes: List[str] = Field(default_factory=list)


class LifecycleGoalSummary(BaseModel):
    total_goals: int = 0
    total_target_amount: float = 0
    total_current_balance: float = 0
    total_monthly_contribution: float = 0
    funding_gap: float = 0
    primary_goal_id: Optional[str] = None
    required_monthly_contribution: Optional[float] = None
    target_success_rate: float = Field(default=0.8, ge=0, le=1)
    fallback_used: bool = False
    fallback_reason: Optional[str] = None


class LifecyclePolicyRequest(BaseModel):
    client_id: Optional[str] = None
    base_request: AllocationRequest
    goals: List[LifecycleGoalItem] = Field(default_factory=list)
    current_age: int = Field(ge=18, le=120)
    retirement_age: Optional[int] = Field(default=None, ge=40, le=80)
    review_frequency: Literal["quarterly", "semiannual", "annual"] = "annual"
    target_success_rate: float = Field(default=0.8, ge=0.5, le=0.99)
    owner_user_id: Optional[str] = None


class LifecyclePolicyResponse(BaseModel):
    plan_id: Optional[str] = None
    allocation: AllocationResponse
    goal_summary: LifecycleGoalSummary = Field(default_factory=LifecycleGoalSummary)
    glide_path: List[GlidePathPoint] = Field(default_factory=list)
    policy_bands: List[PolicyBand] = Field(default_factory=list)
    ips_summary: IpsSummary
    required_monthly_contribution: Optional[float] = None
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)
    suitability_status: Literal["approved", "review_required", "rejected"] = "review_required"
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


PortfolioRole = Literal["core", "satellite", "defensive", "liquidity", "alternative"]


class PortfolioCandidate(BaseModel):
    fund_code: str
    fund_name: str = ""
    asset_class: str = ""
    role: PortfolioRole = "core"
    min_weight: float = Field(default=0, ge=0, le=1)
    max_weight: float = Field(default=1, ge=0, le=1)
    metadata_status: DataStatus = "missing"
    missing_reason: Optional[str] = None


class PortfolioConstraint(BaseModel):
    max_single_fund_weight: float = Field(default=0.3, ge=0, le=1)
    max_same_company_weight: float = Field(default=0.5, ge=0, le=1)
    min_fund_count: int = Field(default=3, ge=1)
    max_fund_count: int = Field(default=12, ge=1)
    target_asset_weights: Dict[str, float] = Field(default_factory=dict)


class PortfolioHoldingItem(BaseModel):
    fund_code: str
    fund_name: str
    weight: float = Field(ge=0, le=1)
    role: PortfolioRole = "core"
    rationale: str = ""
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)


class PortfolioXRay(BaseModel):
    asset_weights: Dict[str, float] = Field(default_factory=dict)
    fund_count: int = 0
    concentration_top3: float = Field(default=0, ge=0, le=1)
    estimated_fee: Optional[float] = None
    overlap_warnings: List[str] = Field(default_factory=list)


class PortfolioBuildRequest(BaseModel):
    candidates: List[PortfolioCandidate]
    constraints: PortfolioConstraint = Field(default_factory=PortfolioConstraint)
    risk_tolerance: RiskTolerance = "balanced"
    amount: float = Field(default=100000, gt=0)
    owner_user_id: Optional[str] = None


class PortfolioBuildResponse(BaseModel):
    portfolio_id: Optional[str] = None
    holdings: List[PortfolioHoldingItem]
    xray: PortfolioXRay = Field(default_factory=PortfolioXRay)
    suitability_status: Literal["approved", "review_required", "rejected"] = "review_required"
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ModelPortfolioHolding(BaseModel):
    fund_code: str
    fund_name: str
    weight: float = Field(ge=0, le=1)
    role: PortfolioRole = "core"
    metadata_status: DataStatus = "missing"
    missing_reason: Optional[str] = None


class ModelPortfolioItem(BaseModel):
    id: str
    name: str
    risk_level: int = Field(ge=1, le=5)
    description: str = ""
    target_return: Optional[float] = None
    max_drawdown: Optional[float] = None
    target_basis: str = "historical_measurement_target"
    risk_threshold_label: str = "historical risk threshold"
    risk_disclaimer: str = "Historical measurements are not return promises."
    holdings: List[ModelPortfolioHolding] = Field(default_factory=list)
    xray: PortfolioXRay = Field(default_factory=PortfolioXRay)
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ModelPortfolioListResponse(BaseModel):
    items: List[ModelPortfolioItem] = Field(default_factory=list)
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)
    warnings: List[str] = Field(default_factory=list)


DcaStrategyType = Literal[
    "fixed",
    "ratio",
    "ma",
    "martingale",
    "valuation",
    "ma_deviation",
    "drawdown_boost",
    "target_value",
]


class DcaStrategyScore(BaseModel):
    strategy_id: str
    strategy_type: DcaStrategyType
    annualized_return: Optional[float] = None
    volatility: Optional[float] = None
    max_drawdown: Optional[float] = None
    sharpe_ratio: Optional[float] = None
    hit_rate: Optional[float] = None
    score: float = Field(default=0, ge=0, le=100)
    rank: Optional[int] = None
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)


class DcaStrategyLabRequest(BaseModel):
    fund_codes: List[str]
    start_date: str
    end_date: str
    monthly_amount: float = Field(gt=0)
    strategy_types: List[DcaStrategyType] = Field(default_factory=lambda: ["fixed"])
    benchmark_code: Optional[str] = None
    owner_user_id: Optional[str] = None


class DcaStrategyLabResponse(BaseModel):
    run_id: Optional[str] = None
    scores: List[DcaStrategyScore] = Field(default_factory=list)
    best_strategy_id: Optional[str] = None
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ProfessionalPillarScore(BaseModel):
    pillar: str
    score: float = Field(ge=0, le=100)
    status: DataStatus = "missing"
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
    missing_reason: Optional[str] = None


class ProfessionalScoreResponse(BaseModel):
    fund_code: str
    fund_name: str = ""
    total_score: Optional[float] = Field(default=None, ge=0, le=100)
    pillars: List[ProfessionalPillarScore] = Field(default_factory=list)
    evidence_completeness: float = Field(default=0, ge=0, le=1)
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)
    warnings: List[str] = Field(default_factory=list)


SalesScene = Literal[
    "first_meeting",
    "portfolio_review",
    "product_recommendation",
    "risk_explanation",
    "after_sales_followup",
]


class SalesFact(BaseModel):
    key: str
    value: str
    source: str
    as_of: Optional[str] = None
    status: DataStatus = "missing"


class SuitabilityResultModel(BaseModel):
    decision: Literal["approved", "review_required", "rejected"] = "review_required"
    reasons: List[str] = Field(default_factory=list)
    required_disclosures: List[str] = Field(default_factory=list)


class ComplianceResultModel(BaseModel):
    level: Literal["pass", "review", "block"] = "review"
    issues: List[str] = Field(default_factory=list)
    forbidden_claims: List[str] = Field(default_factory=list)


class SalesNarrativeRequest(BaseModel):
    scene: SalesScene
    client_profile: Dict[str, Any] = Field(default_factory=dict)
    fund_code: Optional[str] = None
    portfolio_id: Optional[str] = None
    plan_id: Optional[str] = None
    facts: List[SalesFact] = Field(default_factory=list)
    tone: Literal["professional", "concise", "educational"] = "professional"
    length_type: Literal["short", "standard", "long"] = "standard"
    owner_user_id: Optional[str] = None


class SalesNarrativeResponse(BaseModel):
    generation_id: Optional[str] = None
    content: str
    suitability: SuitabilityResultModel = Field(default_factory=SuitabilityResultModel)
    compliance: ComplianceResultModel = Field(default_factory=ComplianceResultModel)
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
    missing_reason: Optional[str] = None


class PitchBookSection(BaseModel):
    key: str
    title: str
    content: str
    data_quality: FusionDataQuality = Field(default_factory=FusionDataQuality)


class PitchBookResponse(BaseModel):
    title: str
    sections: List[PitchBookSection] = Field(default_factory=list)
    suitability: SuitabilityResultModel = Field(default_factory=SuitabilityResultModel)
    compliance: ComplianceResultModel = Field(default_factory=ComplianceResultModel)
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
