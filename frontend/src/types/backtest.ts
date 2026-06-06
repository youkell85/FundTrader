/**
 * 配置回测引擎 — 前端类型定义
 */
import type { RiskTolerance, MarketRegime } from "./allocation";

export type RebalanceFrequency = "monthly" | "quarterly" | "semi_annually";
export type ComparisonMode = "saa_only" | "saa_taa" | "equal_weight" | "sixty_forty";

export interface BacktestRequest {
  risk_profile: RiskTolerance;
  start_date: string;
  end_date: string;
  rebalance_frequency: RebalanceFrequency;
  comparison_modes: ComparisonMode[];
  initial_amount: number;
}

export interface BacktestCurvePoint {
  date: string;
  value: number;
  drawdown: number;
}

export interface RebalanceEvent {
  date: string;
  regime: MarketRegime;
  turnover: number;
  top_changes: Record<string, number>;
}

export interface BacktestMetrics {
  annualized_return: number;
  annualized_volatility: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  calmar_ratio: number;
  max_drawdown: number;
  max_drawdown_duration_days: number;
  monthly_win_rate: number;
  avg_turnover: number;
  total_rebalances: number;
  taa_value_added: number | null;
  benchmark_status?: 'available' | 'missing' | 'partial';
}

export interface RegimeHistoryEntry {
  start_date: string;
  end_date: string;
  regime: MarketRegime;
}

export interface DataQuality {
  assets_with_full_history: number;
  assets_with_partial_history: number;
  missing_assets: string[];
  macro_coverage_pct: number;
  earliest_common_date: string;
  total_trading_days: number;
}

export interface RollingSharpePoint {
  date: string;
  value: number;
}

export interface BacktestResponse {
  curves: Record<ComparisonMode, BacktestCurvePoint[]>;
  metrics: Record<ComparisonMode, BacktestMetrics>;
  regime_history: RegimeHistoryEntry[];
  rebalance_events: RebalanceEvent[];
  attribution: Record<MarketRegime, { total_return: number; period_count: number; total_days: number }>;
  rolling_sharpe: Record<ComparisonMode, RollingSharpePoint[]>;
  monthly_returns: Record<ComparisonMode, Record<string, number>>;
  data_quality: DataQuality;
}

export const FREQUENCY_LABELS: Record<RebalanceFrequency, string> = {
  monthly: "月度", quarterly: "季度", semi_annually: "半年",
};

export const MODE_LABELS: Record<ComparisonMode, string> = {
  saa_only: "纯SAA", saa_taa: "SAA+TAA", equal_weight: "等权", sixty_forty: "60/40",
};

export const MODE_COLORS: Record<ComparisonMode, string> = {
  saa_only: "#5470C6", saa_taa: "#EE6666", equal_weight: "#FAC858", sixty_forty: "#91CC75",
};
