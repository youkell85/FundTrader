/**
 * 基金研究候选匹配 helper。
 *
 * 单一职责：基于 fundType / name / category 做轻量规则推断，
 * 把候选基金与当前资产配置组合做比对，输出研究建议。
 *
 * 不调用 LLM，不修改权重，不做量化优化。
 */

import { num, returnPct, drawdownPct, sharpeFmt, feePct, scaleYi } from "./fund-data";
import type { BacktestResponse, BacktestMetrics, DataQuality } from "@/types/backtest";
import type { ParsedDcaResult } from "@/lib/execution-plan";

/** 轻量数值格式化（不乘100） */
function fmtNum(v: unknown, digits = 2, suffix = ''): string {
  if (v === undefined || v === null || v === '' || Number.isNaN(v)) return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

function fmtPctNum(v: unknown): string {
  if (v === undefined || v === null || v === '' || Number.isNaN(v)) return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(2)}%`;
}

function fmtMoney(v: unknown): string {
  if (v === undefined || v === null || v === '' || Number.isNaN(v)) return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 资产大类推断结果 */
export type AssetClass = "equity" | "bond" | "cash" | "alternative" | "global" | "hybrid" | "unrecognized";

const ASSET_CLASS_MAP: Record<string, AssetClass> = {
  equity: "equity",
  hybrid: "hybrid",
  bond: "bond",
  index: "equity",
  etf: "equity",
  qdii: "global",
  money: "cash",
  fof: "hybrid",
  reits: "alternative",
};

const TYPE_KEYWORDS: Array<{ keywords: string[]; asset: AssetClass }> = [
  { keywords: ["货币", "现金", "理财", "短债", "同业存单"], asset: "cash" },
  { keywords: ["债券", "信用债", "利率债", "可转债", "纯债", "固收"], asset: "bond" },
  { keywords: ["黄金", "商品", "原油", "REIT", "reit"], asset: "alternative" },
  { keywords: ["QDII", "海外", "港股", "美股", "全球", "美元", "欧元"], asset: "global" },
  { keywords: ["股票", " equity", "偏股", "普通股票"], asset: "equity" },
  { keywords: ["混合", "灵活配置", "平衡", "稳健配置"], asset: "hybrid" },
  { keywords: ["指数", "ETF", "etf", "LOF", "联接", "增强"], asset: "equity" },
];

/** 从 fundType / category / name 推断资产大类 */
export function inferAssetClass(type: string, name: string, category?: string): AssetClass {
  const raw = (type || "").toLowerCase().trim();
  if (ASSET_CLASS_MAP[raw]) return ASSET_CLASS_MAP[raw];

  const text = `${type || ""} ${category || ""} ${name || ""}`;
  for (const rule of TYPE_KEYWORDS) {
    if (rule.keywords.some((kw) => text.includes(kw))) return rule.asset;
  }
  return "unrecognized";
}

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  equity: "权益类",
  bond: "固收类",
  cash: "现金类",
  alternative: "另类",
  global: "海外",
  hybrid: "混合型",
  unrecognized: "未识别",
};

export interface PortfolioFund {
  code: string;
  name: string;
  type: string;
  asset_class?: string;
  role?: string;
}

export interface CandidateMatchResult {
  /** 候选基金是否在组合中（同代码） */
  inPortfolio: boolean;
  /** 组合中同资产大类的基金 */
  peerFunds: PortfolioFund[];
  /** 推断的资产大类 */
  inferredAsset: AssetClass;
  /** 数据完整性评分 0~1 */
  dataCompleteness: number;
  /** 关键优势标签 */
  advantages: string[];
  /** 研究建议文案 */
  suggestion: string;
  /** 数据状态：ok / partial / missing */
  dataStatus: "ok" | "partial" | "missing";
}

function calcDataCompleteness(perf: Record<string, unknown>): number {
  const keys = ["return1y", "maxDrawdown", "sharpeRatio", "volatility"];
  const present = keys.filter((k) => num(perf[k]) !== null).length;
  return present / keys.length;
}

/** 判断候选基金与当前组合的关系，并生成研究建议 */
export function analyzeCandidateMatch(
  candidate: any,
  portfolioFunds: PortfolioFund[]
): CandidateMatchResult {
  const perf = candidate.performance || {};
  const code = candidate.fundCode || candidate.code || "";
  const type = candidate.fundType || candidate.type || "";
  const name = candidate.fundName || candidate.name || "";
  const category = candidate.category || "";

  const inPortfolio = portfolioFunds.some((f) => f.code === code);
  const inferredAsset = inferAssetClass(type, name, category);
  const completeness = calcDataCompleteness(perf);

  // 组合中同大类的基金
  const peerFunds = portfolioFunds.filter((f) => {
    if (f.code === code) return false;
    const peerAsset = inferAssetClass(f.type, f.name, f.asset_class);
    return peerAsset === inferredAsset || peerAsset === "hybrid" || inferredAsset === "hybrid";
  });

  // 数据状态
  let dataStatus: "ok" | "partial" | "missing" = "ok";
  if (completeness <= 0.25) dataStatus = "missing";
  else if (completeness < 0.75) dataStatus = "partial";

  const advantages: string[] = [];
  const r1y = num(perf.return1y);
  const sharpe = num(perf.sharpeRatio);
  const mdd = num(perf.maxDrawdown);
  const feeM = num(candidate.feeManage);
  const scale = num(candidate.totalScale);

  // 与同类对比（如果数据完整）
  if (peerFunds.length > 0 && dataStatus !== "missing") {
    // 简单取同类第一只做对比基准
    // 实际场景下 peerFunds 没有 performance 数据，只有基础信息
    // 这里仅基于候选自身数据判断优势
  }

  if (feeM !== null) {
    const pctVal = Math.abs(feeM) > 1 ? feeM : feeM * 100;
    if (pctVal < 0.8) advantages.push("费率较低");
    if (pctVal < 0.5) advantages.push("费率优势显著");
  }
  if (scale !== null && scale > 10) advantages.push("规模充足");
  if (sharpe !== null && sharpe > 1) advantages.push("Sharpe优秀");
  if (sharpe !== null && sharpe > 0.5 && sharpe <= 1) advantages.push("Sharpe尚可");
  if (mdd !== null && mdd > -20) advantages.push("回撤控制较好");
  if (r1y !== null && r1y > 20) advantages.push("近1年收益突出");

  // 生成建议
  let suggestion = "";
  if (inPortfolio) {
    suggestion = "已在当前组合中，可继续跟踪";
  } else if (dataStatus === "missing") {
    suggestion = "数据不足，暂不建议纳入优化约束";
  } else if (sharpe === null || mdd === null) {
    suggestion = "关键风险指标缺失，需先补数据";
  } else if (peerFunds.length === 0) {
    if (inferredAsset === "unrecognized") {
      suggestion = "资产类别未识别，建议人工确认后再评估";
    } else {
      suggestion = `当前组合缺少${ASSET_CLASS_LABELS[inferredAsset]}配置，可作为风格补充研究`;
    }
  } else {
    // 有同类基金，做轻量对比建议
    const hasBetterSharpe = sharpe !== null && sharpe > 0.5;
    const hasLowerFee = feeM !== null && (Math.abs(feeM) > 1 ? feeM : feeM * 100) < 1.0;
    if (hasBetterSharpe && hasLowerFee) {
      suggestion = "同类中Sharpe较好且费率有优势，可作为替代研究对象";
    } else if (hasBetterSharpe) {
      suggestion = "可作为同类替代研究对象";
    } else if (hasLowerFee) {
      suggestion = "费率优势，可纳入费用敏感筛选";
    } else {
      suggestion = "与现有同类基金相比暂无显著优势，建议持续观察";
    }
  }

  return {
    inPortfolio,
    peerFunds,
    inferredAsset,
    dataCompleteness: completeness,
    advantages,
    suggestion,
    dataStatus,
  };
}

/** 约束草案动作类型 */
export type ConstraintAction =
  | "already_in_portfolio"
  | "candidate_for_peer_comparison"
  | "candidate_for_style_supplement"
  | "data_required"
  | "watch_only";

/** 约束草案单项 */
export interface ConstraintDraftItem {
  fundCode: string;
  fundName: string;
  assetClass: AssetClass;
  assetClassLabel: string;
  action: ConstraintAction;
  priority: "high" | "medium" | "low";
  reason: string;
  constraints: string[];
  dataStatus: "ok" | "partial" | "missing";
}

function pickPriority(action: ConstraintAction): ConstraintDraftItem["priority"] {
  switch (action) {
    case "already_in_portfolio":
      return "low";
    case "candidate_for_style_supplement":
      return "high";
    case "candidate_for_peer_comparison":
      return "medium";
    case "data_required":
      return "high";
    case "watch_only":
      return "low";
  }
}

function pickAction(match: CandidateMatchResult, candidate: any): ConstraintAction {
  if (match.inPortfolio) return "already_in_portfolio";
  if (match.dataStatus === "missing") return "data_required";
  if (match.peerFunds.length === 0 && match.dataStatus === "ok" && match.inferredAsset !== "unrecognized")
    return "candidate_for_style_supplement";

  // 有同类且数据完整/部分 → 判断是否peer comparison 还是 watch_only
  const sharpe = num(candidate.performance?.sharpeRatio);
  const fee = num(candidate.feeManage);
  const hasBetterSharpe = sharpe !== null && sharpe > 0.8;
  const hasLowerFee = fee !== null && (Math.abs(fee) > 1 ? fee : fee * 100) < 1.0;
  const hasAdvantage = match.advantages.length >= 2;

  if (match.peerFunds.length > 0 && (hasBetterSharpe || hasLowerFee || hasAdvantage)) {
    return "candidate_for_peer_comparison";
  }
  return "watch_only";
}

function buildConstraints(action: ConstraintAction, match: CandidateMatchResult, candidate: any): string[] {
  const constraints: string[] = [];
  const perf = candidate.performance || {};

  switch (action) {
    case "already_in_portfolio":
      constraints.push("已在组合中，关注其权重稳定性");
      if (match.dataStatus === "missing") constraints.push("建议补全净值与风险指标数据");
      break;
    case "candidate_for_style_supplement": {
      constraints.push(`补充${ASSET_CLASS_LABELS[match.inferredAsset]}敞口`);
      const sharpe = num(perf.sharpeRatio);
      if (sharpe !== null) constraints.push(`Sharpe ${sharpe.toFixed(2)}，纳入优化池前需复核波动率假设`);
      const fee = num(candidate.feeManage);
      if (fee !== null) constraints.push(`费率${fee < 1 ? (fee * 100).toFixed(2) : fee.toFixed(2)}%`);
      break;
    }
    case "candidate_for_peer_comparison": {
      constraints.push("同类替代观察");
      const sharpe = num(perf.sharpeRatio);
      if (sharpe !== null && sharpe > 0.8) constraints.push(`Sharpe ${sharpe.toFixed(2)}优于同类基准参考`);
      const fee = num(candidate.feeManage);
      if (fee !== null && (Math.abs(fee) > 1 ? fee : fee * 100) < 1.0) constraints.push("费率较低，适合费用敏感约束");
      const mdd = num(perf.maxDrawdown);
      if (mdd !== null && mdd > -20) constraints.push(`回撤${mdd.toFixed(2)}%，风控约束友好`);
      break;
    }
    case "data_required":
      constraints.push("关键指标缺失，暂不满足纳入条件");
      if (num(perf.return1y) === null) constraints.push("缺近1年收益");
      if (num(perf.maxDrawdown) === null) constraints.push("缺最大回撤");
      if (num(perf.sharpeRatio) === null) constraints.push("缺Sharpe");
      break;
    case "watch_only":
      constraints.push("持续观察，等待数据或行情变化");
      if (match.advantages.length > 0) constraints.push(`当前优势：${match.advantages.join("、")}`);
      break;
  }
  return constraints;
}

function buildReason(action: ConstraintAction, match: CandidateMatchResult): string {
  switch (action) {
    case "already_in_portfolio":
      return "与组合中基金代码一致，无需重复纳入";
    case "candidate_for_style_supplement":
      return `当前组合缺少${ASSET_CLASS_LABELS[match.inferredAsset]}配置，可补充风格敞口`;
    case "candidate_for_peer_comparison":
      return "同类基金中部分指标占优，建议作为替代研究对象跟踪";
    case "data_required":
      return "净值或风险指标缺失严重，暂无法形成有效约束";
    case "watch_only":
      return match.suggestion || "与现有同类相比暂无显著优势，建议持续观察";
  }
}

/** 基于候选池与组合生成配置约束草案 */
export function generateConstraintDraft(
  candidates: any[],
  portfolioFunds: PortfolioFund[]
): ConstraintDraftItem[] {
  if (candidates.length === 0) return [];

  const poolResults = analyzeCandidatePool(candidates, portfolioFunds);

  return poolResults.map(({ candidate, match }) => {
    const action = pickAction(match, candidate);
    return {
      fundCode: candidate.fundCode || candidate.code || "",
      fundName: candidate.fundAbbr || candidate.fundName || candidate.name || "",
      assetClass: match.inferredAsset,
      assetClassLabel: ASSET_CLASS_LABELS[match.inferredAsset],
      action,
      priority: pickPriority(action),
      reason: buildReason(action, match),
      constraints: buildConstraints(action, match, candidate),
      dataStatus: match.dataStatus,
    };
  });
}

/** 安全清洗 Markdown 表格中的 | */
function mdEsc(v: string): string {
  return String(v).replace(/\|/g, "\\|");
}

const ACTION_LABELS_MD: Record<ConstraintAction, string> = {
  already_in_portfolio: "已在组合中",
  candidate_for_peer_comparison: "同类替代观察",
  candidate_for_style_supplement: "风格补充候选",
  data_required: "数据待补齐",
  watch_only: "持续观察",
};

const PRIORITY_LABELS_MD = { high: "高", medium: "中", low: "低" } as const;

function getPrimaryMetrics(metrics: Record<string, BacktestMetrics> | undefined): BacktestMetrics | null {
  if (!metrics || Object.keys(metrics).length === 0) return null;
  const modes = Object.keys(metrics);
  return modes.includes('saa_taa') ? metrics['saa_taa'] : modes.includes('saa_only') ? metrics['saa_only'] : metrics[modes[0]];
}

export interface ResearchReportSnapshot {
  candidates: any[];
  matches: Array<{ candidate: any; match: CandidateMatchResult }>;
  constraintDrafts: ConstraintDraftItem[];
  capturedAt: string;
}

export interface ResearchReportInput {
  portfolioFunds: PortfolioFund[];
  candidates: any[];
  constraintDrafts: ConstraintDraftItem[];
  backtestResult?: BacktestResponse | null;
  dcaResult?: ParsedDcaResult | null;
  researchReportSnapshot?: ResearchReportSnapshot | null;
  generatedAt?: Date | string;
}

/** 生成一页式 Markdown 研究报告 */
export function generateResearchReportMarkdown(input: ResearchReportInput): string {
  const { portfolioFunds, backtestResult, dcaResult, generatedAt } = input;

  // Prefer snapshot data if provided, otherwise fall back to direct parameters
  const snapshot = input.researchReportSnapshot;
  const candidates = snapshot ? snapshot.candidates : input.candidates;
  const constraintDrafts = snapshot ? snapshot.constraintDrafts : input.constraintDrafts;
  const matches = snapshot ? snapshot.matches : analyzeCandidatePool(candidates, portfolioFunds);

  const ts = generatedAt ? new Date(generatedAt).toLocaleString("zh-CN") : new Date().toLocaleString("zh-CN");

  const lines: string[] = [];
  lines.push("# 配置研究报告");
  lines.push("");
  lines.push(`生成时间：${ts}`);
  lines.push("");

  // 1. 当前组合基金
  lines.push("## 1. 当前组合基金");
  lines.push("");
  if (portfolioFunds.length === 0) {
    lines.push("暂无组合基金数据。");
  } else {
    lines.push("| 基金 | 类型/资产大类 | 角色 |");
    lines.push("|---|---|---|");
    for (const f of portfolioFunds) {
      const asset = inferAssetClass(f.type, f.name, f.asset_class);
      lines.push(`| ${mdEsc(f.code)} ${mdEsc(f.name)} | ${mdEsc(ASSET_CLASS_LABELS[asset])} | ${mdEsc(f.role || "—")} |`);
    }
  }
  lines.push("");

  // 2. 研究候选池
  lines.push("## 2. 研究候选池");
  lines.push("");
  if (candidates.length === 0) {
    lines.push("暂无研究候选。");
  } else {
    lines.push("| 基金 | 推断资产大类 | 近1年 | 回撤 | Sharpe | 费率 | 规模 |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const c of candidates) {
      const perf = c.performance || {};
      const type = c.fundType || c.type || "";
      const name = c.fundName || c.name || "";
      const asset = inferAssetClass(type, name, c.category);
      lines.push(
        `| ${mdEsc(c.fundCode || c.code || "")} ${mdEsc(c.fundAbbr || c.fundName || c.name || "")} | ${mdEsc(ASSET_CLASS_LABELS[asset])} | ${returnPct(perf.return1y)} | ${drawdownPct(perf.maxDrawdown)} | ${sharpeFmt(perf.sharpeRatio)} | ${feePct(c.feeManage)} | ${scaleYi(c.totalScale)} |`
      );
    }
  }
  lines.push("");

  // 3. 候选池匹配分析
  lines.push("## 3. 候选池匹配分析");
  lines.push("");
  if (candidates.length === 0) {
    lines.push("暂无研究候选。");
  } else {
    // Use pre-computed matches from snapshot if available, else compute live
    const matchItems = snapshot ? snapshot.matches : analyzeCandidatePool(candidates, portfolioFunds);
    lines.push("| 基金 | 匹配结论 | 同类对象 | 数据状态 |");
    lines.push("|---|---|---|---|");
    for (const { candidate, match } of matchItems) {
      const conclusion = match.inPortfolio
        ? "已在组合中"
        : match.peerFunds.length > 0
        ? `同类${match.peerFunds.length}只`
        : "新资产类别";
      lines.push(
        `| ${mdEsc(candidate.fundCode || candidate.code || "")} ${mdEsc(candidate.fundAbbr || candidate.fundName || candidate.name || "")} | ${mdEsc(conclusion)} | ${match.peerFunds.map((p) => mdEsc(p.name)).join("、") || "—"} | ${match.dataStatus === "ok" ? "完整" : match.dataStatus === "partial" ? "部分缺失" : "缺失"} |`
      );
    }
  }
  lines.push("");

  // 4. 配置约束草案
  lines.push("## 4. 配置约束草案");
  lines.push("");
  if (constraintDrafts.length === 0) {
    lines.push("暂无配置约束草案。");
  } else {
    lines.push("| 基金 | 建议类型 | 优先级 | 约束草案 | 原因 |");
    lines.push("|---|---|---|---|---|");
    for (const d of constraintDrafts) {
      lines.push(
        `| ${mdEsc(d.fundCode)} ${mdEsc(d.fundName)} | ${mdEsc(ACTION_LABELS_MD[d.action])} | ${mdEsc(PRIORITY_LABELS_MD[d.priority])} | ${mdEsc(d.constraints.join("；"))} | ${mdEsc(d.reason)} |`
      );
    }
  }
  lines.push("");

  // 5. 回测摘要
  lines.push("## 5. 回测摘要");
  lines.push("");

  // 5.1 策略回测
  lines.push("### 5.1 策略回测");
  lines.push("");
  const primaryMetrics = getPrimaryMetrics(backtestResult?.metrics);
  if (!primaryMetrics) {
    lines.push("暂无策略回测结果。");
  } else {
    lines.push("| 指标 | 数值 |");
    lines.push("|---|---:|");
    lines.push(`| 年化收益 | ${mdEsc(fmtPctNum(primaryMetrics.annualized_return))} |`);
    lines.push(`| 年化波动 | ${mdEsc(fmtPctNum(primaryMetrics.annualized_volatility))} |`);
    lines.push(`| 最大回撤 | ${mdEsc(fmtPctNum(primaryMetrics.max_drawdown))} |`);
    lines.push(`| Sharpe | ${mdEsc(fmtNum(primaryMetrics.sharpe_ratio, 2))} |`);
    lines.push(`| Sortino | ${mdEsc(fmtNum(primaryMetrics.sortino_ratio, 2))} |`);
    lines.push(`| Calmar | ${mdEsc(fmtNum(primaryMetrics.calmar_ratio, 2))} |`);
    lines.push(`| 月度胜率 | ${mdEsc(fmtNum(primaryMetrics.monthly_win_rate, 1, '%'))} |`);
  }
  lines.push("");

  // 5.2 定投回测
  lines.push("### 5.2 定投回测");
  lines.push("");
  if (!dcaResult) {
    lines.push("暂无定投回测结果。");
  } else {
    lines.push("| 指标 | 数值 |");
    lines.push("|---|---:|");
    lines.push(`| 总投入 | ${mdEsc(fmtMoney(dcaResult.totalInvested))} |`);
    lines.push(`| 期末市值 | ${mdEsc(fmtMoney(dcaResult.finalValue))} |`);
    lines.push(`| 总收益 | ${mdEsc(fmtPctNum(dcaResult.totalReturn))} |`);
    lines.push(`| 年化收益 | ${mdEsc(fmtPctNum(dcaResult.annualizedReturn))} |`);
    lines.push(`| 最大回撤 | ${mdEsc(fmtPctNum(dcaResult.maxDrawdown))} |`);
  }
  lines.push("");

  // 5.3 数据质量
  lines.push("### 5.3 数据质量");
  lines.push("");
  const dataQuality = backtestResult?.data_quality;
  if (!dataQuality) {
    lines.push("暂无数据质量信息。");
  } else {
    lines.push("| 指标 | 数值 |");
    lines.push("|---|---:|");
    lines.push(`| 回测区间 | ${mdEsc(dataQuality.earliest_common_date || "—")} ~ ${new Date().toISOString().slice(0, 10)} |`);
    lines.push(`| 回测天数 | ${mdEsc(dataQuality.total_trading_days != null ? String(dataQuality.total_trading_days) + " 天" : "—")} |`);
    lines.push(`| 资产覆盖率 | ${mdEsc(dataQuality.macro_coverage_pct != null ? dataQuality.macro_coverage_pct.toFixed(2) + "%" : "—")} |`);
    lines.push(`| 完整 / 部分资产 | ${mdEsc(dataQuality.assets_with_full_history != null && dataQuality.assets_with_partial_history != null ? String(dataQuality.assets_with_full_history) + " / " + String(dataQuality.assets_with_partial_history) : "—")} |`);
    lines.push(`| 缺失资产 | ${mdEsc(dataQuality.missing_assets.length > 0 ? dataQuality.missing_assets.join(", ") : "无缺失资产")} |`);
    const equalWeightAvailable = backtestResult?.metrics?.['equal_weight'] != null;
    const sixtyFortyAvailable = backtestResult?.metrics?.['sixty_forty'] != null;
    lines.push(`| 等权基准 | ${mdEsc(equalWeightAvailable ? "可用" : "暂无基准数据")} |`);
    lines.push(`| 60/40 基准 | ${mdEsc(sixtyFortyAvailable ? "可用" : "暂无基准数据")} |`);
    lines.push("");

    // 数据降级说明
    if (dataQuality.assets_with_partial_history > 0 || dataQuality.missing_assets.length > 0 || (dataQuality.macro_coverage_pct != null && dataQuality.macro_coverage_pct < 90)) {
      const warnings: string[] = [];
      if (dataQuality.assets_with_partial_history > 0) {
        warnings.push(`${dataQuality.assets_with_partial_history} 只资产使用部分历史数据`);
      }
      if (dataQuality.missing_assets.length > 0) {
        warnings.push(`${dataQuality.missing_assets.length} 只资产缺失`);
      }
      if (dataQuality.macro_coverage_pct != null && dataQuality.macro_coverage_pct < 90) {
        warnings.push(`宏观因子覆盖率 ${dataQuality.macro_coverage_pct.toFixed(1)}%`);
      }
      lines.push(`**数据降级说明**：${mdEsc(warnings.join("；"))}。结果仅供研究参考。**`);
      lines.push("");
    }
  }
  lines.push("");

  // 6. 数据缺口
  lines.push("## 6. 数据缺口");
  lines.push("");
  const missingItems = candidates.filter((c) => {
    const perf = c.performance || {};
    return num(perf.return1y) === null || num(perf.maxDrawdown) === null || num(perf.sharpeRatio) === null;
  });
  if (missingItems.length === 0) {
    lines.push("当前候选池关键指标数据完整度较好。");
  } else {
    for (const c of missingItems) {
      const perf = c.performance || {};
      const gaps: string[] = [];
      if (num(perf.return1y) === null) gaps.push("近1年收益");
      if (num(perf.maxDrawdown) === null) gaps.push("最大回撤");
      if (num(perf.sharpeRatio) === null) gaps.push("Sharpe");
      lines.push(`- ${mdEsc(c.fundCode || c.code || "")} ${mdEsc(c.fundAbbr || c.fundName || c.name || "")}：${gaps.join("、")}缺失`);
    }
  }
  lines.push("");

  // 7. 说明
  lines.push("## 7. 说明");
  lines.push("");
  lines.push("本报告为研究辅助材料，不会自动修改组合。");
  lines.push("数据来自公开净值和基金披露信息，仅供参考。");
  lines.push("");

  return lines.join("\n");
}

/** 批量分析候选池匹配 */
export function analyzeCandidatePool(
  candidates: any[],
  portfolioFunds: PortfolioFund[]
): Array<{ candidate: any; match: CandidateMatchResult }> {
  return candidates.map((c) => ({
    candidate: c,
    match: analyzeCandidateMatch(c, portfolioFunds),
  }));
}
