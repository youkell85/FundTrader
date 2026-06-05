/**
 * 基金详情页 — 数据状态治理。
 *
 * 保留与 iFinD 重排方案锁定的字段契约：
 *   dataStatus / source / asOf / coverage / missingReason
 *
 * 在 13 个并行查询（detailByCode / rating / purchaseInfo / holderStructure /
 * yearReturns / peerPerformance / scaleHistory / turnoverHistory /
 * managerHistory / bondAllocation / bondHoldings / detailCompleteness /
 * managerReport / riskSummary）之上，提供：
 *   - 5 态枚举：available / partial / missing / pending / error
 *   - 统一摘要生成器 summarizeDetailCoverage()
 *   - 与上游 trpc.isLoading / isError 兼容的判定辅助
 */

export type DetailDataStatus =
  | "available"
  | "partial"
  | "missing"
  | "pending"
  | "error"
  // 兼容历史契约：以前用 "simulated" 表示占位数据，现在等同 missing。
  | "simulated";

export type DetailRowsPayload<T> = {
  rows?: T[];
  dataStatus?: DetailDataStatus;
  missingReason?: string | null;
  source?: string | null;
  asOf?: string | null;
  coverage?: number;
};

export function isRealDetailStatus(
  status?: DetailDataStatus | string | null,
): boolean {
  return status === "available" || status === "partial" || status === undefined;
}

export function realRows<T>(
  payload: DetailRowsPayload<T> | null | undefined,
): T[] {
  if (!payload || !isRealDetailStatus(payload.dataStatus)) return [];
  return Array.isArray(payload.rows) ? payload.rows : [];
}

export function missingReason(
  payload: { missingReason?: string | null } | null | undefined,
  fallback: string,
): string {
  return payload?.missingReason || fallback;
}

// === 5 态文案与配色（与 FundTable 暗色 liquid-glass 配色一致） ===
export const STATUS_LABELS: Record<DetailDataStatus, string> = {
  available: "可用",
  partial: "部分可用",
  missing: "缺失",
  pending: "生成中",
  error: "接口错误",
  // 兼容旧契约：历史上以 "simulated" 表示占位数据
  simulated: "缺失",
};

export const STATUS_TONES: Record<DetailDataStatus, string> = {
  // 绿色 — 实际数据已就绪
  available: "text-[#16C784] border-[#16C784]/30 bg-[#16C784]/5",
  // 琥珀 — 部分数据回来，等待补全
  partial: "text-[#FFB800] border-[#FFB800]/30 bg-[#FFB800]/5",
  // 灰 — 接口已就绪但 rows 为空
  missing: "text-white/45 border-white/10 bg-white/[0.02]",
  // 蓝 — LLM/规则生成中
  pending: "text-[#5AA9FF] border-[#3B6CFF]/30 bg-[#3B6CFF]/5",
  // 红 — tRPC 层报错
  error: "text-[#F5384B] border-[#F5384B]/30 bg-[#F5384B]/5",
  simulated: "text-white/45 border-white/10 bg-white/[0.02]",
};

/** 把 trpc 状态机压成 5 态。
 *
 * 优先级（从高到低）：
 *   1. isError                 → "error"
 *   2. isLoading && !hasData   → "pending"
 *   3. dataStatus === "available"    → "available"
 *   4. dataStatus === "partial"      → "partial"
 *   5. dataStatus === "missing" |
 *      dataStatus === "simulated"    → "missing"
 *   6. !dataStatus && hasData        → "available"
 *   7. 其他                          → "missing"
 */
export function deriveStatus(args: {
  isLoading?: boolean;
  isError?: boolean;
  hasData?: boolean;
  dataStatus?: DetailDataStatus | string | null;
}): DetailDataStatus {
  if (args.isError) return "error";
  if (args.isLoading && !args.hasData) return "pending";
  if (args.dataStatus === "available") return "available";
  if (args.dataStatus === "partial") return "partial";
  if (args.dataStatus === "missing" || args.dataStatus === "simulated") return "missing";
  if (!args.dataStatus && args.hasData) return "available";
  return "missing";
}

// === 覆盖度摘要 ===

export type CoverageKey =
  | "detailByCode"
  | "rating"
  | "purchaseInfo"
  | "holderStructure"
  | "yearReturns"
  | "peerPerformance"
  | "scaleHistory"
  | "turnoverHistory"
  | "managerHistory"
  | "bondAllocation"
  | "bondHoldings"
  | "detailCompleteness"
  | "managerReport"
  | "riskSummary";

export const COVERAGE_LABELS: Record<CoverageKey, string> = {
  detailByCode: "基金主数据",
  rating: "基金评级",
  purchaseInfo: "购买信息",
  holderStructure: "持有人结构",
  yearReturns: "年度回报",
  peerPerformance: "同类业绩",
  scaleHistory: "规模历史",
  turnoverHistory: "换手率",
  managerHistory: "经理变更",
  bondAllocation: "券种配置",
  bondHoldings: "重仓债券",
  detailCompleteness: "数据覆盖",
  managerReport: "运作分析",
  riskSummary: "风险摘要",
};

export const COVERAGE_ENDPOINTS: Record<CoverageKey, string> = {
  detailByCode: "trpc.fund.detailByCode",
  rating: "trpc.fund.rating",
  purchaseInfo: "trpc.fund.purchaseInfo",
  holderStructure: "trpc.fund.holderStructure",
  yearReturns: "trpc.fund.yearReturns",
  peerPerformance: "trpc.fund.peerPerformance",
  scaleHistory: "trpc.fund.scaleHistory",
  turnoverHistory: "trpc.fund.turnoverHistory",
  managerHistory: "trpc.fund.managerHistory",
  bondAllocation: "trpc.fund.bondAllocation",
  bondHoldings: "trpc.fund.bondHoldings",
  detailCompleteness: "trpc.fund.detailCompleteness",
  managerReport: "trpc.fund.managerReport",
  riskSummary: "trpc.fund.riskSummary",
};

export type CoverageEntry = {
  key: CoverageKey;
  label: string;
  endpoint: string;
  status: DetailDataStatus;
  reason?: string | null;
  asOf?: string | null;
  source?: string | null;
};

export type CoverageInput = Partial<Record<CoverageKey, CoverageEntry>>;

/** 把 13 个 trpc useQuery 的状态聚合成一个统一摘要，供 CoverageSummary 组件消费。 */
export function summarizeDetailCoverage(
  entries: CoverageInput,
): { items: CoverageEntry[]; total: number; available: number; partial: number; missing: number; pending: number; error: number } {
  const items = Object.entries(entries)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => v as CoverageEntry);
  const counts = { available: 0, partial: 0, missing: 0, pending: 0, error: 0 };
  for (const it of items) counts[it.status] += 1;
  return {
    items,
    total: items.length,
    ...counts,
  };
}
