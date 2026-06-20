/**
 * FundTrader v4.0 资产配置引擎 — 前端类型定义
 */
export type RiskTolerance = "conservative" | "moderate" | "balanced" | "aggressive" | "radical";
export type InvestmentHorizon = "short" | "medium" | "long" | "very_long";
export type MarketRegime = "goldilocks" | "overheat" | "stagflation" | "deflation" | "baseline";
export type GoalType = "retirement" | "education" | "housing" | "wealth";

export interface AllocationRequest {
  age: number; goal_type?: GoalType; investment_horizon?: InvestmentHorizon;
  amount: number; target_date?: string; behavior_answers?: Record<string, string>;
  risk_tolerance: RiskTolerance; max_drawdown?: number; preferred_tags: string[];
}

export interface AllocationResponse {
  meta: AllocationMeta; user_profile: UserProfileSummary;
  saa: SAASummary; taa: TAASummary; funds: FundItem[];
  portfolio_metrics: Record<string, number>; stress_tests: StressScenarioItem[];
  monte_carlo: MonteCarloResult | null; scenario_analysis: ScenarioAnalysis | null;
  factor_exposures: Record<string, number>; constraints: ConstraintCheckItem[];
  risk_disclaimer: string; warnings: string[];
  data_quality?: AllocationDataQuality | null;
}

export interface AllocationMeta {
  engine_version: string; generated_at: string; regime: MarketRegime;
  regime_label: string; regime_pending: string | null; regime_pending_count: number;
  regime_is_confirmed: boolean; taa_skipped: boolean; circuit_breaker_triggered: boolean;
}
export interface UserProfileSummary {
  risk_tolerance: RiskTolerance; risk_label: string;
  effective_risk: RiskTolerance; behavior_adjusted: boolean;
  age: number; amount: number; horizon: string;
  // ─── Behavior calibration provenance (optional, API-compatible) ───
  behavior_score?: number | null;
  behavior_question_count?: number | null;
  behavior_source?: string | null;
  behavior_calibration_version?: string | null;
  behavior_as_of?: string | null;
}
export interface SAASummary {
  allocations: Record<string, number>; group_allocations: Record<string, number>;
  equity_center: number; expected_return: number; expected_volatility: number;
  expected_max_drawdown: number; sharpe_ratio: number; glide_path_applied: boolean;
  risk_contributions: Record<string, number>;
  risk_contribution_source?: string;
  data_status?: string;
  missing_reason?: string;
}
export interface TAASummary {
  taa_adjusted: Record<string, number>; adjustments: Record<string, number>;
  composite_score: number; equity_adjustment: number;
  fed_value: number | null; fed_interpretation: string;
  signals: MacroSignalItem[]; category_summary: Record<string, CategorySignal>;
  business_cycle: BusinessCycle;
}
export interface MacroSignalItem {
  factor_name: string; category: string; score: number;
  confidence: string; value: number|null; threshold_desc: string|null;
  raw_score?: number | null; confidence_value?: number | null; attenuation?: number | null;
}
export interface CategorySignal { name:string; weight:number; avg_score:number; interpretation:string; signal_count:number; }
export interface BusinessCycle {
  phase: string; phase_name: string; preferred_style: string;
  preferred_industries: string[]; bond_duration: string;
}
export interface FundItem {
  code: string; name: string; type: string; asset_class: string;
  company: string;
  weight: number; amount: number; role: string; reason: string; score: number;
  metadata_status?: "real" | "partial" | "assumption" | "stale" | "missing" | "rejected";
  metadata_source?: string;
  metadata_as_of?: string | null;
  stale_days?: number | null;
  management_fee?: number | null;
  custody_fee?: number | null;
  sales_service_fee?: number | null;
  subscription_fee?: number | null;
  fee_source?: string | null;
}
export interface StressScenarioItem {
  scenario: string; impact: number; max_loss: number;
  source?: string | null; source_window?: string | null; calibration_version?: string | null;
}
export interface MonteCarloResult {
  median_return: number; percentile_10: number; percentile_25: number;
  percentile_75: number; percentile_90: number; max_drawdown_95: number;
  var_95: number; cvar_95: number; prob_positive: number;
  var_95_annual?: number | null; cvar_95_annual?: number | null;
  jump_source?: string | null; jump_as_of?: string | null; jump_sample_size?: number | null; calibration_version?: string | null; jump_missing_reason?: string | null;
}
export interface ScenarioAnalysis {
  weighted_return: number;
  scenarios: { scenario:string; description:string; probability:number; impact:number }[];
  source?: string | null;
  calibration_version?: string | null;
  as_of_date?: string | null;
  probability_source?: string | null;
  baseline_source?: string | null;
}
export interface ConstraintCheckItem { rule:string; value:string; limit:string; passed:boolean; }

export type DataStatus = "real" | "partial" | "assumption" | "stale" | "missing" | "rejected";

export interface DataQualityItem {
  status: DataStatus;
  source?: string | null;
  as_of?: string | null;
  coverage?: number | null;
  reason?: string | null;
  confidence?: number | null;
}

export interface AllocationDataQuality {
  overall_status: DataStatus;
  macro: Record<string, DataQualityItem>;
  market: Record<string, DataQualityItem>;
  cma: DataQualityItem;
  factor: DataQualityItem;
  fund_mapping: DataQualityItem;
  monte_carlo: DataQualityItem;
  invalid_assets: Record<string, string>;
  assumptions_used: string[];
}

export const ASSET_CLASS_LABELS: Record<string,string> = {
  a_share_large:"A股大盘",a_share_small:"A股小盘",a_share_value:"A股价值",
  a_share_growth:"A股成长",hk_equity:"港股",us_equity:"美股(QDII)",
  rate_bond:"利率债",credit_bond:"信用债",convertible:"可转债",
  money_fund:"货币基金",gold:"黄金ETF",commodity:"商品期货",reits:"公募REITs",cash:"现金",
};
export const ASSET_GROUP_LABELS: Record<string,string> = { equity:"权益类",fixed_income:"固收类",alternative:"另类",cash_equiv:"现金类" };
export const RISK_LABELS: Record<string,string> = {
  conservative:"保守型",moderate:"稳健型",balanced:"平衡型",aggressive:"进取型",radical:"激进型",
};
export const REGIME_LABELS: Record<string,string> = {
  goldilocks:"金发女孩",overheat:"过热",stagflation:"滞胀",deflation:"通缩衰退",baseline:"基准",
};
export const GOAL_LABELS: Record<string,string> = { retirement:"养老储备",education:"子女教育",housing:"购房首付",wealth:"财富增值" };
export const HORIZON_LABELS: Record<string,string> = { short:"短期(<1年)",medium:"中期(1-5年)",long:"长期(>5年)",very_long:"超长期(>10年)" };
export const GROUP_COLORS: Record<string,string> = { equity:"#EE6666",fixed_income:"#5470C6",alternative:"#FAC858",cash_equiv:"#16C784" };
export const SIGNAL_COLORS: Record<string,string> = { growth:"#EE6666",inflation:"#FAC858",interest:"#5470C6",credit_money:"#91CC75",liquidity:"#73C0DE",policy:"#9D7BFF",overseas:"#F59E0B" };

export interface DataSourceProviderStatus {
  name: string;
  available: boolean;
  priority: number;
  status?: "available" | "degraded" | "missing" | "cooldown" | string;
  capabilities?: string[];
  last_check: string | null;
  last_error: string | null;
  lastError?: string | null;
  lastSuccessAt?: string | null;
  last_success_at?: string | null;
  lastFailureAt?: string | null;
  last_failure_at?: string | null;
  cooldownUntil?: string | null;
  cooldown_until?: string | null;
  failureCount?: number;
  failure_count?: number;
  circuitOpen?: boolean;
  circuit_open?: boolean;
  used: boolean;
  fallback_reason?: string;
  source_hint?: string;
}

export interface DataSourceHealthSnapshot {
  timestamp: string;
  service: MarketDataStatus | null;
  providers: DataSourceProviderStatus[];
  cache: {
    snapshot_cache_key: string;
    has_snapshot: boolean;
    age_seconds: number | null;
    ttl_seconds: number | null;
  };
  stale_assets: string[];
  stream_supported: boolean;
}

export interface MarketDataSourcesStatus {
  source: string;
  market_data_service: MarketDataStatus;
  providers: DataSourceProviderStatus[];
  quotas: {
    tickflow_paid: Record<string, unknown>;
    tickflow_free: Record<string, unknown>;
    quota_notes?: string[];
    supported_periods?: string[];
    [key: string]: unknown;
  };
}

export interface MarketDataStreamPayload {
  type: "market_data_health";
  timestamp: string;
  data: DataSourceHealthSnapshot;
}

export interface MarketDataStatus {
  last_refresh: string | null;
  macro_available: boolean;
  macro_confidence: number;
  macro_indicators?: Record<string, {
    value?: number | null;
    source?: string | null;
    confidence?: number | null;
    fetch_time?: string | null;
    ttl_seconds?: number | null;
  }>;
  rolling_stats_available: boolean;
  vol_ratio: number | null;
  health?: "healthy" | "degraded" | "critical" | "unknown";
  rolling_coverage?: number;
  valid_assets?: string[];
  invalid_assets?: Record<string, string>;
  assumptions_used?: string[];
  providers?: DataSourceProviderStatus[];
  cache?: {
    snapshot_cache_key?: string;
    has_snapshot?: boolean;
    age_seconds?: number | null;
    ttl_seconds?: number | null;
  };
  stream_supported?: boolean;
}

export const REGIME_COLORS: Record<string, string> = {
  goldilocks: "#16C784", overheat: "#EE6666",
  stagflation: "#FAC858", deflation: "#73C0DE", baseline: "#666666",
};

export const SIGNAL_CATEGORY_ORDER = ["growth", "inflation", "interest", "credit_money", "liquidity", "policy", "overseas"] as const;
export const SIGNAL_CATEGORY_LABELS: Record<string, string> = {
  growth: "经济增长", inflation: "通胀水平", interest: "利率环境",
  credit_money: "信用/货币", liquidity: "市场流动性", policy: "政策导向", overseas: "海外环境",
};

// ─── Fund Ranking Types ───
export interface FundRankingItem {
  code: string;
  name: string;
  fund_type: string;
  rank: number;
  total_score: number;
  tracking_score: number;
  liquidity_score: number;
  cost_score: number;
  scale_score: number;
  performance_score: number;
  is_recommended: boolean;
  reasons: string[];
  management_fee: number;
  custody_fee: number;
  aum: number;
  tracking_error: number;
  metadata_status?: "real" | "partial" | "assumption" | "stale" | "missing" | "rejected";
  metadata_source?: string;
  metadata_as_of?: string | null;
  stale_days?: number | null;
}

export interface FundRankingResponse {
  rankings: Record<string, FundRankingItem[]>;
}

// ─── Rebalance Types ───
export interface RebalanceDeviationItem {
  name: string;
  target_weight: number;
  current_weight: number;
  deviation: number;
  deviation_pct: number;
  is_group: boolean;
  severity: "normal" | "warning" | "critical";
}

export interface RebalanceTriggerItem {
  trigger_type: "deviation" | "time" | "regime_change" | "manual";
  description: string;
  triggered: boolean;
  details: string;
}

export interface TradeActionItem {
  asset_class: string;
  asset_label: string;
  direction: "buy" | "sell";
  current_weight: number;
  target_weight: number;
  delta_weight: number;
  delta_amount: number;
  fund_code: string;
  fund_name: string;
  priority: number;
}

export interface RebalanceCheckRequest {
  target_allocations: Record<string, number>;
  current_allocations: Record<string, number>;
  risk_profile: string;
  total_amount: number;
  last_rebalance_date?: string;
  regime_changed: boolean;
}

export interface RebalanceCheckResponse {
  suggestion_id: string;
  generated_at: string;
  risk_profile: string;
  should_rebalance: boolean;
  urgency: "low" | "medium" | "high";
  triggers: RebalanceTriggerItem[];
  deviations: RebalanceDeviationItem[];
  actions: TradeActionItem[];
  total_turnover: number;
  estimated_cost: number;
  summary: string;
}

export interface RebalanceHistoryItem {
  entry_id: string;
  executed_at: string;
  risk_profile: string;
  trigger_type: string;
  actions_count: number;
  total_turnover: number;
  estimated_cost: number;
  status: "executed" | "skipped" | "partial";
  summary: string;
}

export interface RebalanceHistoryResponse {
  history: RebalanceHistoryItem[];
}

export const URGENCY_LABELS: Record<string, string> = { low: "低", medium: "中", high: "高" };
export const URGENCY_COLORS: Record<string, string> = { low: "#16C784", medium: "#FAC858", high: "#EE6666" };
export const TRIGGER_TYPE_LABELS: Record<string, string> = {
  deviation: "偏离度", time: "定期", regime_change: "体制变化", manual: "手动",
};
export const STATUS_LABELS: Record<string, string> = { executed: "已执行", skipped: "已跳过", partial: "部分执行" };
export const STATUS_COLORS: Record<string, string> = { executed: "#16C784", skipped: "#666666", partial: "#FAC858" };

// ─── Storage Types ───
export interface SavedPlanItem {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  description: string;
  request: Record<string, any>;
  response: Record<string, any>;
  risk_profile: string;
  is_favorite: boolean;
  is_archived: boolean;
}

export interface PlanListResponse {
  plans: SavedPlanItem[];
  total: number;
}

export interface SavePlanRequest {
  name: string;
  description?: string;
  request: Record<string, any>;
  response: Record<string, any>;
}

export interface RebalanceStatsResponse {
  total_records: number;
  executed_count: number;
  total_cost: number;
  last_rebalance_date: string | null;
}

// ─── Three-Variant Output Types ───
export interface VariantItem {
  label: "defensive" | "balanced" | "growth";
  label_cn: string;
  risk_tolerance: RiskTolerance;
  response: AllocationResponse;
}

export interface VariantComparison {
  expected_return: Record<string, number>;
  volatility: Record<string, number>;
  sharpe_ratio: Record<string, number>;
  max_drawdown: Record<string, number>;
  equity_ratio: Record<string, number>;
}

export interface VariantsResponse {
  variants: Record<string, VariantItem>;
  comparison: VariantComparison;
}

export const VARIANT_LABELS: Record<string, string> = {
  defensive: "防御型", balanced: "均衡型", growth: "进取型",
};
export const VARIANT_COLORS: Record<string, string> = {
  defensive: "#5470C6", balanced: "#FAC858", growth: "#EE6666",
};

// ─── Explainability Report Types ───
export interface ExplainSectionModel {
  title: string;
  key: string;
  summary: string;
  details: string[];
  icon: "info" | "warning" | "success" | "chart";
}

export interface ExplainReportModel {
  sections: ExplainSectionModel[];
  overall_summary: string;
  confidence_score: number;
}

export const EXPLAIN_ICON_COLORS: Record<string, string> = {
  info: "#5470C6", warning: "#FAC858", success: "#16C784", chart: "#91CC75",
};

// ─── What-If Simulator Types ───
export interface WhatIfRequest {
  base_request: AllocationRequest;
  amount_multiplier: number;
  return_adjust: number;
  vol_multiplier: number;
  equity_shift: number;
  bond_duration_shift: number;
  alt_shift: number;
}

export interface WhatIfResponse {
  modified_allocations: Record<string, number>;
  expected_return: number;
  expected_volatility: number;
  sharpe_ratio: number;
  max_drawdown: number;
  equity_ratio: number;
  delta_return: number;
  delta_volatility: number;
  delta_sharpe: number;
}

export const WHATIF_SLIDER_CONFIG = {
  amount_multiplier: { min: 0.5, max: 2.0, step: 0.1, label: "投资金额倍数", unit: "x" },
  return_adjust: { min: -3, max: 3, step: 0.5, label: "预期收益调整", unit: "%" },
  vol_multiplier: { min: 0.5, max: 2.0, step: 0.1, label: "波动率倍数", unit: "x" },
  equity_shift: { min: -20, max: 20, step: 1, label: "权益偏移", unit: "%" },
  bond_duration_shift: { min: -1, max: 1, step: 0.1, label: "久期调整", unit: "年" },
  alt_shift: { min: -10, max: 10, step: 1, label: "另类偏移", unit: "%" },
} as const;

// ─── A/C Share Selector Types ───
export interface ShareSelectorRequest {
  funds: Array<{ code: string; name: string }>;
  holding_months: number;
  amount: number;
}

export interface ShareRecommendationItem {
  fund_code: string;
  fund_name: string;
  recommended_share: "A" | "C";
  reason: string;
  breakeven_months: number;
  total_cost_a: number;
  total_cost_c: number;
  savings: number;
  fee_source?: string;
  missing_reason?: string;
}

export interface ShareSelectorResponse {
  recommendations: ShareRecommendationItem[];
  holding_months: number;
  summary: string;
  data_status?: "real" | "partial" | "missing";
  missing_reason?: string | null;
}

export const SHARE_COLORS: Record<string, string> = {
  A: "#5470C6", C: "#16C784",
};

// ─── Correlation Constraint Types ───
export interface CorrelationCheckRequest {
  allocations: Record<string, number>;
  threshold?: number;
  material_weight?: number;
}

export interface CorrelationPairItem {
  asset_a: string;
  asset_b: string;
  correlation: number;
  exceeds_threshold: boolean;
}

export interface CorrelationCheckResponse {
  max_correlation: number;
  max_pair: string[];
  threshold: number;
  passed: boolean;
  violations: CorrelationPairItem[];
  warnings: string[];
  correlation_matrix: Record<string, Record<string, number>>;
  suggestions: string[];
}

// ─── Fee Scoring Types ───
export interface FeeAnalysisRequest {
  funds: Array<Record<string, any>>;
  asset_class: string;
}

export interface FeeAnalysisItem {
  fund_code: string;
  fund_name: string;
  asset_class: string;
  management_fee: number;
  custody_fee: number;
  sales_service_fee: number;
  subscription_fee: number;
  total_expense_ratio: number;
  fee_efficiency_score: number;
  category_avg_ter: number;
  fee_vs_category: number;
  cost_1y: number;
  cost_3y: number;
  cost_5y: number;
}

export interface FeeAnalysisResponse {
  analyses: FeeAnalysisItem[];
  asset_class: string;
  recommendation: string;
}

// ─── Pipeline Health Types ───
export interface PipelineStepDiag {
  step: string;
  status: "ok" | "degraded" | "error";
  elapsed_ms: number;
  detail?: string;
}

export interface PipelineHealthRecord {
  timestamp: string;
  total_ms: number;
  steps: PipelineStepDiag[];
  warnings: string[];
  degraded_steps: string[];
  failed_steps: string[];
  health: "healthy" | "degraded" | "critical";
}

export interface CalibrationSectionItem {
  key: string;
  status: "real" | "partial" | "assumption" | "stale" | "missing" | "rejected";
  source: string;
  as_of?: string | null;
  calibration_version?: string | null;
  coverage?: number | null;
  invalid_count: number;
  assumption_count: number;
  warnings: string[];
}

export interface CalibrationAuditPolicy {
  return_drift_threshold: number;
  vol_drift_threshold: number;
  jump_probability_min: number;
  jump_probability_max: number;
  coverage_threshold: number;
  policy_source: string;
  policy_version?: string | null;
}

export interface CalibrationAudit {
  health: "healthy" | "degraded" | "critical" | "unknown";
  sections: CalibrationSectionItem[];
  warning_count: number;
  missing_count: number;
  policy?: CalibrationAuditPolicy | null;
}

export interface PipelineHealthResponse {
  last_run: PipelineHealthRecord | null;
  subsystems: {
    regime: { confirmed_regime: string; confirmed_label: string; pending_regime: string | null; pending_label: string | null; pending_count: number; is_stable: boolean };
    circuit_breaker: { confirmed_level: number; confirmed_name: string; reduction_pct: number; pending_downgrade: number | null; pending_name: string | null; downgrade_confirm_count: number; is_stable: boolean };
  };
  history_summary: {
    total_runs: number;
    healthy: number;
    degraded: number;
    critical: number;
    avg_total_ms: number;
  };
  calibration?: CalibrationAudit | null;
  health: "healthy" | "degraded" | "critical" | "unknown";
}

export const STEP_LABELS: Record<string, string> = {
  risk_profiling: "风险画像", cma_estimation: "资本市场假设估计", saa_optimization: "战略配置优化",
  regime_detection: "市场状态检测", taa_adjustment: "战术调整", circuit_breaker: "断路器",
  constraint_check: "约束检查", fund_mapping: "基金映射", monte_carlo: "蒙特卡洛",
  stress_test: "压力测试", factor_exposure: "因子暴露", scenario_analysis: "情景分析",
  portfolio_metrics: "组合指标", output_assembly: "输出组装",
};

export const CALIBRATION_SECTION_LABELS: Record<string, string> = {
  equilibrium_returns: "均衡收益", equilibrium_vols: "均衡波动", correlation_matrix: "相关性矩阵",
  jump_params: "跳跃参数", stress_scenarios: "压力情景", regime_thresholds: "体制阈值",
  circuit_breaker_destination: "断路器目标", scenario_analysis: "情景分析", risk_questionnaire: "风险问卷",
};

export const CALIBRATION_STATUS_LABELS: Record<string, string> = {
  real: "实时", partial: "部分", assumption: "假设", stale: "过期", missing: "缺失", rejected: "已拒绝",
};

export const HEALTH_COLORS: Record<string, string> = {
  healthy: "#16C784", degraded: "#FAC858", critical: "#EE6666", unknown: "#666666",
};

// ─── Dual Engine Types ───
export interface DualEngineSide {
  elapsed_ms: number;
  allocations: Record<string, number>;
  group_allocations: Record<string, number>;
  expected_return: number;
  expected_volatility: number;
  sharpe_ratio: number;
  regime: string;
  circuit_breaker: boolean;
  fed_value: number | null;
  warnings: string[];
}

export interface DualEngineComparison {
  alloc_diff: Record<string, { v3: number; v4: number; delta: number; changed: boolean }>;
  group_diff: Record<string, { v3: number; v4: number; delta: number }>;
  metrics_diff: Record<string, { v3: number; v4: number; delta: number }>;
  changed_assets: number;
  total_assets: number;
  max_allocation_delta: number;
  regime_same: boolean;
  breaker_same: boolean;
  v4_has_fed_model: boolean;
  performance_ratio: number;
  assessment: string;
}

export interface DualEngineResponse {
  mode: "shadow" | "canary" | "full";
  v3: DualEngineSide;
  v4: DualEngineSide;
  comparison: DualEngineComparison;
}
