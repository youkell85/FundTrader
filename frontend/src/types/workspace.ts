export interface WorkspaceFeatures {
  features: Record<string, boolean>;
  policy: {
    direct_contact_storage: boolean;
    auto_outreach: boolean;
    org_rbac_import: boolean;
  };
}

export interface ClientHoldingInput {
  asset_class: string;
  weight: number;
}

export interface Client360Request {
  client: {
    client_ref?: string;
    display_name?: string;
    name?: string;
    risk_level?: string;
    age?: number;
    goals?: string[];
    contact_authorized?: boolean;
    [key: string]: unknown;
  };
  holdings?: ClientHoldingInput[];
  recent_events?: Record<string, unknown>[];
  context?: Record<string, unknown>;
}

export interface Client360Profile {
  client_ref: string;
  display_name: string;
  risk_level: string;
  life_stage: string;
  goals: string[];
  holding_count: number;
  holding_assets: Record<string, number>;
  review_focus: string[];
  owner_user_id?: string | null;
  contact_policy: {
    direct_contact_storage: string;
    contact_authorized: boolean;
    removed_fields: string[];
  };
  data_quality: {
    status: "real" | "partial" | "missing" | string;
    source: string;
    coverage: number;
    confidence: number;
    missing_reason?: string | null;
  };
  warnings: string[];
  generated_at: string;
}

export interface Client360Response {
  client_360: Client360Profile;
}

export interface NbaSuggestion {
  id: string;
  action_type: string;
  title: string;
  priority: "high" | "medium" | "low" | string;
  rationale: string;
  required_evidence: string[];
  manual_only: boolean;
  auto_send: boolean;
  status: "draft" | string;
}

export interface NbaResponse {
  client_ref?: string;
  suggestions: NbaSuggestion[];
  policy: {
    manual_only: boolean;
    auto_send: boolean;
    auto_outreach: boolean;
  };
  generated_at: string;
}

export interface TaskDraft {
  id: string;
  source_suggestion_id?: string;
  title: string;
  note: string;
  status: "draft" | string;
  requires_manual_approval: boolean;
  auto_send: boolean;
  due_date: string;
}

export interface TaskDraftResponse {
  tasks: TaskDraft[];
  policy: {
    manual_only: boolean;
    auto_send: boolean;
  };
  generated_at: string;
}
