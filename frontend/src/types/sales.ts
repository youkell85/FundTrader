import type { DataStatus } from "./allocation";
import type { EvidenceRef, FusionDataQuality } from "./lifecycle";

export type SalesScene =
  | "first_meeting"
  | "portfolio_review"
  | "product_recommendation"
  | "risk_explanation"
  | "after_sales_followup";

export interface ProfessionalPillarScore {
  pillar: string;
  score: number;
  status: DataStatus;
  evidence_refs: EvidenceRef[];
  missing_reason?: string | null;
}

export interface ProfessionalScoreResponse {
  fund_code: string;
  fund_name: string;
  total_score?: number | null;
  pillars: ProfessionalPillarScore[];
  evidence_completeness: number;
  data_quality: FusionDataQuality;
  warnings: string[];
}

export interface SalesFact {
  key: string;
  value: string;
  source: string;
  as_of?: string | null;
  status: DataStatus;
}

export interface SuitabilityResultModel {
  decision: "approved" | "review_required" | "rejected";
  reasons: string[];
  required_disclosures: string[];
}

export interface ComplianceResultModel {
  level: "pass" | "review" | "block";
  issues: string[];
  forbidden_claims: string[];
}

export interface SalesNarrativeRequest {
  scene: SalesScene;
  client_profile: Record<string, unknown>;
  fund_code?: string | null;
  portfolio_id?: string | null;
  plan_id?: string | null;
  facts: SalesFact[];
  tone: "professional" | "concise" | "educational";
  length_type: "short" | "standard" | "long";
  owner_user_id?: string | null;
}

export interface SalesNarrativeResponse {
  generation_id?: string | null;
  content: string;
  suitability: SuitabilityResultModel;
  compliance: ComplianceResultModel;
  data_quality: FusionDataQuality;
  evidence_refs: EvidenceRef[];
  missing_reason?: string | null;
}

export interface PitchBookSection {
  key: string;
  title: string;
  content: string;
  data_quality: FusionDataQuality;
}

export interface PitchBookResponse {
  title: string;
  sections: PitchBookSection[];
  suitability: SuitabilityResultModel;
  compliance: ComplianceResultModel;
  evidence_refs: EvidenceRef[];
}
