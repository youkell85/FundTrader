/**
 * 报告快照摘要 helper
 *
 * 单一职责：基于已保存方案的 response JSON，提取只读模块摘要和指标快览。
 *
 * 约束：
 * - 不调用后端
 * - 不触发计算
 * - 不修改 store
 * - 兼容旧 snapshot（缺字段时不崩溃）
 */

function toFiniteNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "" || Number.isNaN(v)) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function fmtPct(v: unknown): string {
  const n = toFiniteNum(v);
  if (n === null) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(2)}%`;
}

function fmtNum(v: unknown, digits = 2): string {
  const n = toFiniteNum(v);
  if (n === null) return "—";
  return n.toFixed(digits);
}

export interface SnapshotModuleSummary {
  hasAllocation: boolean;
  hasVariants: boolean;
  hasDca: boolean;
  hasBacktest: boolean;
  hasExecutionPlan: boolean;
  hasResearchCandidates: boolean;
  hasConstraintDraft: boolean;
  metrics: {
    expectedReturn: string;
    volatility: string;
    maxDrawdown: string;
    sharpe: string;
    fundCount: number;
    variantCount: number;
  };
  backtestMetrics: {
    annualizedReturn: string;
    annualizedVolatility: string;
    maxDrawdown: string;
    sharpe: string;
  };
  dcaMetrics: {
    totalInvested: string;
    finalValue: string;
    totalReturn: string;
  };
  warnings: string[];
}

function getBacktestPrimaryMetrics(res: any) {
  const metrics = res?.backtestResult?.metrics;
  if (!metrics || typeof metrics !== "object") return null;
  const modes = Object.keys(metrics);
  if (modes.length === 0) return null;
  const key = modes.includes("saa_taa")
    ? "saa_taa"
    : modes.includes("saa_only")
      ? "saa_only"
      : modes[0];
  return metrics[key];
}

export function summarizeSavedReportSnapshot(response: unknown): SnapshotModuleSummary {
  const res = response as any;

  const hasAllocation = !!res && typeof res === "object" && Array.isArray(res.funds);
  const hasVariants = !!res?.variants && typeof res.variants === "object" && Object.keys(res.variants).length > 0;
  const hasDca = !!res?.dca_plan?.result || !!res?.dcaResult;
  const hasBacktest = !!res?.backtestResult && typeof res.backtestResult === "object";
  const hasExecutionPlan = !!res?.execution_plan && typeof res.execution_plan === "object";
  const hasResearchCandidates = Array.isArray(res?.researchCandidates) && res.researchCandidates.length > 0;
  const hasConstraintDraft = Array.isArray(res?.constraintDrafts) && res.constraintDrafts.length > 0;

  const saa = res?.saa || {};
  const funds = Array.isArray(res?.funds) ? res.funds : [];

  const bt = getBacktestPrimaryMetrics(res);

  const dca = res?.dca_plan?.result || res?.dcaResult || {};

  const warnings: string[] = [];
  if (!hasBacktest) warnings.push("旧快照缺少策略回测");
  if (!hasVariants) warnings.push("旧快照缺少多方案对比");
  if (!hasDca) warnings.push("暂无定投结果");

  return {
    hasAllocation,
    hasVariants,
    hasDca,
    hasBacktest,
    hasExecutionPlan,
    hasResearchCandidates,
    hasConstraintDraft,
    metrics: {
      expectedReturn: fmtPct(saa.expected_return),
      volatility: fmtPct(saa.expected_volatility),
      maxDrawdown: fmtPct(saa.expected_max_drawdown),
      sharpe: fmtNum(saa.sharpe_ratio, 2),
      fundCount: funds.length,
      variantCount: hasVariants ? Object.keys(res.variants).length : 0,
    },
    backtestMetrics: {
      annualizedReturn: bt ? fmtPct(bt.annualized_return) : "—",
      annualizedVolatility: bt ? fmtPct(bt.annualized_volatility) : "—",
      maxDrawdown: bt ? fmtPct(bt.max_drawdown) : "—",
      sharpe: bt ? fmtNum(bt.sharpe_ratio, 2) : "—",
    },
    dcaMetrics: {
      totalInvested: toFiniteNum(dca.totalInvested) !== null
        ? (toFiniteNum(dca.totalInvested) as number).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "—",
      finalValue: toFiniteNum(dca.finalValue) !== null
        ? (toFiniteNum(dca.finalValue) as number).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "—",
      totalReturn: fmtPct(dca.totalReturn),
    },
    warnings,
  };
}
