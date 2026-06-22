import type { EvidenceRef, FusionDataQuality } from "./lifecycle";

export type DcaStrategyType =
  | "fixed"
  | "ratio"
  | "ma"
  | "martingale"
  | "valuation"
  | "ma_deviation"
  | "drawdown_boost"
  | "target_value";

export interface DcaStrategyScore {
  strategy_id: string;
  strategy_type: DcaStrategyType;
  annualized_return?: number | null;
  volatility?: number | null;
  max_drawdown?: number | null;
  sharpe_ratio?: number | null;
  hit_rate?: number | null;
  score: number;
  rank?: number | null;
  data_quality: FusionDataQuality;
}

export interface DcaStrategyLabRequest {
  fund_codes: string[];
  start_date: string;
  end_date: string;
  monthly_amount: number;
  strategy_types: DcaStrategyType[];
  benchmark_code?: string | null;
  owner_user_id?: string | null;
}

export interface DcaStrategyLabResponse {
  run_id?: string | null;
  scores: DcaStrategyScore[];
  best_strategy_id?: string | null;
  data_quality: FusionDataQuality;
  evidence_refs: EvidenceRef[];
  warnings: string[];
}
