import type {
  AllocationRequest,
  AllocationResponse,
  DataStatus,
  GoalType,
} from "./allocation";

export interface EvidenceRef {
  source: string;
  as_of?: string | null;
  description: string;
  url?: string | null;
  confidence: number;
}

export interface FusionDataQuality {
  status: DataStatus;
  source: string;
  as_of?: string | null;
  coverage: number;
  confidence: number;
  missing_reason?: string | null;
  warnings: string[];
}

export interface LifecycleGoalItem {
  id: string;
  name: string;
  goal_type: GoalType;
  target_amount: number;
  horizon_years: number;
  priority: number;
  current_balance: number;
  monthly_contribution: number;
  metadata: Record<string, unknown>;
}

export interface GlidePathPoint {
  age: number;
  equity_weight: number;
  bond_weight: number;
  cash_weight: number;
  alternative_weight: number;
  note: string;
}

export interface PolicyBand {
  asset_class: string;
  target_weight: number;
  min_weight: number;
  max_weight: number;
  rebalance_trigger: number;
}

export interface IpsSummary {
  investor_profile: string;
  objectives: string[];
  constraints: string[];
  risk_budget: Record<string, unknown>;
  suitability_notes: string[];
}

export interface LifecycleGoalSummary {
  total_goals: number;
  total_target_amount: number;
  total_current_balance: number;
  total_monthly_contribution: number;
  funding_gap: number;
  primary_goal_id?: string | null;
  required_monthly_contribution?: number | null;
  target_success_rate: number;
  fallback_used: boolean;
  fallback_reason?: string | null;
}

export interface LifecyclePolicyRequest {
  client_id?: string | null;
  base_request: AllocationRequest;
  goals: LifecycleGoalItem[];
  current_age: number;
  retirement_age?: number | null;
  review_frequency: "quarterly" | "semiannual" | "annual";
  target_success_rate: number;
  owner_user_id?: string | null;
}

export interface LifecyclePolicyResponse {
  plan_id?: string | null;
  allocation: AllocationResponse;
  goal_summary: LifecycleGoalSummary;
  glide_path: GlidePathPoint[];
  policy_bands: PolicyBand[];
  ips_summary: IpsSummary;
  required_monthly_contribution?: number | null;
  data_quality: FusionDataQuality;
  suitability_status: "approved" | "review_required" | "rejected";
  evidence_refs: EvidenceRef[];
  warnings: string[];
}
