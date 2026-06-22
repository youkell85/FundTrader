import type { DataStatus, RiskTolerance } from "./allocation";
import type { EvidenceRef, FusionDataQuality } from "./lifecycle";

export type PortfolioRole = "core" | "satellite" | "defensive" | "liquidity" | "alternative";

export interface PortfolioCandidate {
  fund_code: string;
  fund_name: string;
  asset_class: string;
  role: PortfolioRole;
  min_weight: number;
  max_weight: number;
  metadata_status: DataStatus;
  missing_reason?: string | null;
}

export interface PortfolioConstraint {
  max_single_fund_weight: number;
  max_same_company_weight: number;
  min_fund_count: number;
  max_fund_count: number;
  target_asset_weights: Record<string, number>;
}

export interface PortfolioHoldingItem {
  fund_code: string;
  fund_name: string;
  weight: number;
  role: PortfolioRole;
  rationale: string;
  data_quality: FusionDataQuality;
}

export interface PortfolioXRay {
  asset_weights: Record<string, number>;
  fund_count: number;
  concentration_top3: number;
  estimated_fee?: number | null;
  overlap_warnings: string[];
}

export interface PortfolioBuildRequest {
  candidates: PortfolioCandidate[];
  constraints: PortfolioConstraint;
  risk_tolerance: RiskTolerance;
  amount: number;
  owner_user_id?: string | null;
}

export interface PortfolioBuildResponse {
  portfolio_id?: string | null;
  holdings: PortfolioHoldingItem[];
  xray: PortfolioXRay;
  suitability_status: "approved" | "review_required" | "rejected";
  data_quality: FusionDataQuality;
  evidence_refs: EvidenceRef[];
  warnings: string[];
}
