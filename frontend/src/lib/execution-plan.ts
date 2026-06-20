import type { AllocationResponse, FundItem } from "@/types/allocation";

export interface DcaConfig {
  codes: string[];
  weights: number[];
  strategy: "fixed_amount" | "fixed_ratio" | "value_averaging" | "smart_beta" | "martingale";
  startDate: string;
  endDate: string;
  investAmount: number;
  investFrequency: "weekly" | "biweekly" | "monthly";
  feeRate?: number;
  slippageRate?: number;
}

/** BFF mapBacktestResult 返回的原始字段（字符串数字） */
export interface RawDcaResult {
  totalInvested: string;
  finalValue: string;
  totalReturn: string;
  annualizedReturn: string;
  maxDrawdown: string;
  sharpeRatio: string;
  feeCost: string;
  curve?: Array<{ date: string; invested: number; value: number; feeCost?: number }>;
  strategy: string;
  frequency: string;
  fundMeta?: Array<{ code: string; name: string; weight: number }>;
}

/** 前端展示用的已解析数字类型 */
export interface ParsedDcaResult {
  totalInvested: number;
  finalValue: number;
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  feeCost: number;
  curve?: Array<{ date: string; invested: number; value: number; feeCost?: number }>;
  strategy: string;
  frequency: string;
  fundMeta?: Array<{ code: string; name: string; weight: number }>;
}

export type DcaResult = ParsedDcaResult;

export interface ExecutionPlan {
  funds: Array<{ code: string; name: string; weight: number; amount: number; role: string }>;
  totalAmount: number;
  riskProfile: string;
  createdAt: string;
}

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export function parseDcaResultForExecution(raw: RawDcaResult | unknown): ParsedDcaResult {
  const r = raw as RawDcaResult;
  return {
    totalInvested: toNum(r?.totalInvested),
    finalValue: toNum(r?.finalValue),
    totalReturn: toNum(r?.totalReturn),
    annualizedReturn: toNum(r?.annualizedReturn),
    maxDrawdown: toNum(r?.maxDrawdown),
    sharpeRatio: toNum(r?.sharpeRatio),
    feeCost: toNum(r?.feeCost),
    curve: r?.curve,
    strategy: String(r?.strategy || ""),
    frequency: String(r?.frequency || ""),
    fundMeta: r?.fundMeta,
  };
}

export function normalizeWeights(count: number, current: number[] = [], lockedIndex?: number, lockedValue?: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [100];
  const values = Array.from({ length: count }, (_, i) => {
    const v = Number(current[i]);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
  });

  if (lockedIndex !== undefined && lockedIndex >= 0 && lockedIndex < count) {
    values[lockedIndex] = Math.max(0, Math.min(100, Math.round(lockedValue ?? 0)));
    const remaining = 100 - values[lockedIndex];
    const others = values.map((_, i) => i).filter((i) => i !== lockedIndex);
    const otherTotal = others.reduce((sum, i) => sum + values[i], 0);
    let used = 0;
    others.forEach((i, order) => {
      const next = order === others.length - 1
        ? remaining - used
        : otherTotal > 0
          ? Math.round((values[i] / otherTotal) * remaining)
          : Math.round(remaining / others.length);
      values[i] = Math.max(0, next);
      used += values[i];
    });
    return values;
  }

  const total = values.reduce((sum, v) => sum + v, 0) || 100;
  let used = 0;
  const result = values.map((v, i) => {
    if (i === values.length - 1) return Math.max(0, 100 - used);
    const normalized = Math.round((v / total) * 100);
    used += normalized;
    return normalized;
  });
  const drift = 100 - result.reduce((s, v) => s + v, 0);
  if (drift !== 0 && result.length > 0) {
    result[0] = Math.max(0, result[0] + drift);
  }
  return result;
}

export function buildExecutionPlanFromAllocation(output: AllocationResponse): ExecutionPlan {
  const fundAmountSum = output.funds.reduce((s, f) => s + (f.amount || 0), 0);
  return {
    funds: output.funds.map((f: FundItem) => ({
      code: f.code,
      name: f.name,
      weight: f.weight,
      amount: f.amount,
      role: f.role,
    })),
    totalAmount: output.user_profile?.amount || fundAmountSum || 500000,
    riskProfile: output.user_profile?.risk_tolerance || "balanced",
    createdAt: output.meta?.generated_at || new Date().toISOString(),
  };
}

export function buildDcaBacktestInput(
  plan: ExecutionPlan,
  overrides?: Partial<DcaConfig>,
): DcaConfig {
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    codes: plan.funds.map((f) => f.code),
    weights: plan.funds.map((f) => f.weight),
    strategy: "fixed_amount",
    startDate: yearAgo,
    endDate: today,
    investAmount: 1000,
    investFrequency: "monthly",
    feeRate: 0.15,
    slippageRate: 0.05,
    ...overrides,
  };
}

export function validateExecutionPlan(plan: ExecutionPlan | null): { valid: boolean; error?: string } {
  if (!plan) return { valid: false, error: "未生成执行计划" };
  if (!plan.funds || plan.funds.length === 0) return { valid: false, error: "基金组合为空" };
  if (plan.funds.some((f) => !f.code || !/^[0-9A-Za-z]{6,10}$/.test(f.code))) {
    return { valid: false, error: "基金代码格式异常" };
  }
  const totalWeight = plan.funds.reduce((s, f) => s + (f.weight || 0), 0);
  if (totalWeight <= 0) return { valid: false, error: "权重总和非正数" };
  return { valid: true };
}

export function isMockOutput(output: AllocationResponse | null): boolean {
  if (!output) return true;
  if (!output.meta?.engine_version) return true;
  if (!output.meta?.generated_at) return true;
  if (output.meta.generated_at === "2025-01-15T08:30:00Z") return true;
  if (output.user_profile?.amount == null || output.user_profile.amount <= 0) return true;
  if (!Array.isArray(output.funds) || output.funds.length === 0) return true;
  if (!output.saa || !output.taa || !output.portfolio_metrics) return true;

  return false;
}
