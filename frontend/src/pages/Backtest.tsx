import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  Calculator,
  CheckCircle2,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/providers/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ACCENT_HIGHLIGHT,
  ACCENT_INFO,
  ACCENT_PRIMARY,
  DOWN_COLOR,
  POSITIVE_METRIC_COLOR,
  RISK_COLOR,
  UP_COLOR,
  getChangeTextClass,
} from "@/lib/colors";

type SortMetric = "annualizedReturn" | "maxDrawdown" | "sharpeRatio";

const typeLabels: Record<string, string> = {
  equity: "股票型",
  hybrid: "混合型",
  bond: "债券型",
  index: "指数型",
  etf: "ETF",
  qdii: "QDII",
  money: "货币型",
  fof: "FOF",
  reits: "REITs",
};

const strategyLabels: Record<string, string> = {
  compare: "智能策略横评",
  fixed: "固定金额",
  ratio: "估值区间调节",
  ma: "均线偏离调节",
  martingale: "下跌加倍投入",
  fixed_amount: "固定金额",
  fixed_ratio: "估值区间调节",
  value_averaging: "均线偏离调节",
  smart_beta: "智能估值调节",
};

const strategies = [
  { value: "compare", label: "智能策略横评", desc: "同时回测多种定投规则，用风险调整后得分选出更稳的执行方案。" },
  { value: "fixed_amount", label: "固定金额", desc: "每期投入固定金额，适合工资现金流和长期纪律投资。" },
  { value: "fixed_ratio", label: "估值区间调节", desc: "低位提高投入，高位降低投入，平衡成本与追高风险。" },
  { value: "value_averaging", label: "均线偏离调节", desc: "根据净值相对均线的位置自动调节金额，强调成本控制。" },
  { value: "martingale", label: "下跌加倍投入", desc: "回撤后提高投入强度，适合资金储备充足且能承受波动的账户。" },
];

const frequencies = [
  { value: "weekly", label: "每周" },
  { value: "biweekly", label: "双周" },
  { value: "monthly", label: "每月" },
];

const riskProfiles = [
  { value: "conservative", label: "稳健", maxDd: 10, target: 4 },
  { value: "balanced", label: "平衡", maxDd: 18, target: 7 },
  { value: "growth", label: "进取", maxDd: 28, target: 10 },
];

function todayString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function toNum(value: unknown) {
  const num = parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(num) ? num : 0;
}

function money(value: unknown) {
  return `¥${Math.round(toNum(value)).toLocaleString()}`;
}

function pct(value: unknown, signed = true) {
  const num = toNum(value);
  return `${signed && num > 0 ? "+" : ""}${num.toFixed(2)}%`;
}

function equalWeights(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function normalizeWeights(count: number, current: number[] = [], lockedIndex?: number, lockedValue?: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [100];
  const values = Array.from({ length: count }, (_, index) => {
    const value = Number(current[index]);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  });

  if (lockedIndex !== undefined && lockedIndex >= 0 && lockedIndex < count) {
    values[lockedIndex] = Math.max(0, Math.min(100, Math.round(lockedValue ?? 0)));
    const remaining = 100 - values[lockedIndex];
    const others = values.map((_, index) => index).filter((index) => index !== lockedIndex);
    const otherTotal = others.reduce((sum, index) => sum + values[index], 0);
    let used = 0;
    others.forEach((index, order) => {
      const next = order === others.length - 1
        ? remaining - used
        : otherTotal > 0
          ? Math.round((values[index] / otherTotal) * remaining)
          : Math.round(remaining / others.length);
      values[index] = Math.max(0, next);
      used += values[index];
    });
    return values;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return equalWeights(count);
  let used = 0;
  return values.map((value, index) => {
    const next = index === count - 1 ? 100 - used : Math.round((value / total) * 100);
    used += next;
    return Math.max(0, next);
  });
}

function metricValue(fund: any, metric: SortMetric) {
  const perf = fund.performance || {};
  if (metric === "annualizedReturn") return toNum(perf.annualizedReturn ?? perf.return1y);
  if (metric === "maxDrawdown") return Math.abs(toNum(perf.maxDrawdown));
  return toNum(perf.sharpeRatio);
}

function buildAdvice(result: any, maxDrawdownLimit: string, targetAnnualReturn: string) {
  if (!result) return null;
  const annual = toNum(result.annualizedReturn);
  const drawdown = Math.abs(toNum(result.maxDrawdown));
  const sharpe = toNum(result.sharpeRatio);
  const benchmarkReturn = toNum(result.benchmark?.totalReturn ?? result.benchmarkReturn);
  const excess = toNum(result.totalReturn) - benchmarkReturn;
  const maxDd = toNum(maxDrawdownLimit);
  const target = toNum(targetAnnualReturn);
  const passedRisk = maxDd <= 0 || drawdown <= maxDd;
  const passedReturn = target <= 0 || annual >= target;
  const recommended = strategyLabels[result.recommendedStrategyKey] || strategyLabels[result.selectedStrategyKey] || "当前策略";

  const verdict = passedRisk && passedReturn && sharpe >= 0.25
    ? "可执行"
    : passedRisk && annual > 0
      ? "谨慎执行"
      : "需要调参";
  const action = verdict === "可执行"
    ? `建议按${recommended}执行，保持当前频率，并每季度复核一次权重与回撤。`
    : verdict === "谨慎执行"
      ? "建议先降低单期金额或提高债券/货币类权重，等夏普和超额收益改善后再加速投入。"
      : "当前组合没有满足收益或回撤约束，建议缩短权益暴露、改用固定金额策略，或重新筛选基金。";

  return {
    verdict,
    action,
    points: [
      `组合年化 ${pct(annual, false)}，目标 ${pct(target, false)}，${passedReturn ? "达到" : "未达到"}收益约束。`,
      `最大回撤 ${pct(drawdown, false)}，预算 ${pct(maxDd, false)}，${passedRisk ? "处于预算内" : "超过预算"}。`,
      `相对一次性买入超额 ${pct(excess)}，用于判断分批投入是否改善了持有体验。`,
      `风险调整后推荐策略为 ${recommended}，优先级高于单看收益率。`,
    ],
  };
}

function MetricCard({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon: typeof Activity }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] p-3 min-h-[92px]">
      <div className="flex items-center justify-between gap-2 text-white/55 text-xs">
        <span>{label}</span>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="data-number mt-3 text-lg md:text-2xl font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

export default function Backtest() {
  const { data: listData } = trpc.fund.list.useQuery(
    { page: 1, pageSize: 300, withMetrics: false },
    { staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const allFunds = listData?.funds ?? [];
  const utils = trpc.useUtils();
  const llmMutation = trpc.fund.analyzeDcaLLM.useMutation();

  const [selectedFunds, setSelectedFunds] = useState<number[]>([]);
  const [weights, setWeights] = useState<number[]>([]);
  const [strategy, setStrategy] = useState("compare");
  const [frequency, setFrequency] = useState("monthly");
  const [amount, setAmount] = useState("1000");
  const [startDate, setStartDate] = useState("2021-01-01");
  const [endDate, setEndDate] = useState(todayString());
  const [riskProfile, setRiskProfile] = useState("balanced");
  const [maxDrawdownLimit, setMaxDrawdownLimit] = useState("18");
  const [targetAnnualReturn, setTargetAnnualReturn] = useState("7");
  const [feeRate, setFeeRate] = useState("0.15");
  const [slippageRate, setSlippageRate] = useState("0.02");
  const [fundSearch, setFundSearch] = useState("");
  const [activeType, setActiveType] = useState("all");
  const [sortMetric, setSortMetric] = useState<SortMetric>("annualizedReturn");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [result, setResult] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [llmReview, setLlmReview] = useState<any>(null);
  const [llmLoading, setLlmLoading] = useState(false);

  const groupedFunds = useMemo(() => {
    const keyword = fundSearch.trim().toLowerCase();
    const groups = new Map<string, any[]>();
    allFunds.forEach((fund: any) => {
      if (selectedFunds.includes(fund.id)) return;
      const searchable = [fund.fundCode, fund.fundName, fund.fundAbbr, fund.category, typeLabels[fund.fundType]].join(" ").toLowerCase();
      if (keyword && !searchable.includes(keyword)) return;
      const key = fund.fundType || "other";
      groups.set(key, [...(groups.get(key) || []), fund]);
    });
    return Array.from(groups.entries())
      .map(([type, funds]) => ({
        type,
        label: typeLabels[type] || type || "其他",
        funds: funds
          .slice()
          .sort((a, b) => sortOrder === "desc" ? metricValue(b, sortMetric) - metricValue(a, sortMetric) : metricValue(a, sortMetric) - metricValue(b, sortMetric))
          .slice(0, 18),
      }))
      .sort((a, b) => b.funds.length - a.funds.length);
  }, [allFunds, fundSearch, selectedFunds, sortMetric, sortOrder]);

  const visibleGroups = activeType === "all" ? groupedFunds : groupedFunds.filter((group) => group.type === activeType);
  const selectedFundDetails = selectedFunds.map((id) => allFunds.find((fund: any) => fund.id === id)).filter(Boolean);
  const weightTotal = weights.slice(0, selectedFunds.length).reduce((sum, weight) => sum + (Number(weight) || 0), 0);
  const advice = useMemo(() => buildAdvice(result, maxDrawdownLimit, targetAnnualReturn), [result, maxDrawdownLimit, targetAnnualReturn]);
  const chartDomain = useMemo<[number, number]>(() => {
    const values = (result?.monthlyData || []).flatMap((point: any) => [toNum(point.invested), toNum(point.value), toNum(point.benchmark)]).filter(Number.isFinite);
    if (!values.length) return [0, 10000];
    const max = Math.max(...values);
    return [0, Math.ceil(max * 1.12)];
  }, [result]);
  const curveSummary = useMemo(() => {
    if (!result) return null;
    const finalValue = toNum(result.finalValue);
    const invested = toNum(result.totalInvested);
    const benchmark = toNum(result.benchmark?.finalValue);
    return {
      dcaProfit: finalValue - invested,
      benchmarkProfit: benchmark - invested,
      gap: finalValue - benchmark,
    };
  }, [result]);
  const strategyChartData = useMemo(() => {
    const rows = result?.strategyResults || [];
    const maxReturn = Math.max(1, ...rows.map((item: any) => Math.abs(toNum(item.annualizedReturn))));
    const maxDrawdown = Math.max(1, ...rows.map((item: any) => Math.abs(toNum(item.maxDrawdown))));
    const maxSharpe = Math.max(1, ...rows.map((item: any) => Math.abs(toNum(item.sharpeRatio))));
    return rows.map((item: any) => ({
      ...item,
      label: strategyLabels[item.key] || item.key,
      returnScore: (toNum(item.annualizedReturn) / maxReturn) * 100,
      drawdownScore: (1 - Math.abs(toNum(item.maxDrawdown)) / maxDrawdown) * 100,
      sharpeScore: (toNum(item.sharpeRatio) / maxSharpe) * 100,
    }));
  }, [result]);

  const handleRiskProfile = (value: string) => {
    const profile = riskProfiles.find((item) => item.value === value);
    setRiskProfile(value);
    if (profile) {
      setMaxDrawdownLimit(String(profile.maxDd));
      setTargetAnnualReturn(String(profile.target));
    }
  };

  const handleAddFund = (fundId: number) => {
    if (selectedFunds.includes(fundId)) return;
    const next = [...selectedFunds, fundId];
    setSelectedFunds(next);
    setWeights(equalWeights(next.length));
  };

  const handleRemoveFund = (index: number) => {
    const next = selectedFunds.filter((_, i) => i !== index);
    setSelectedFunds(next);
    setWeights(normalizeWeights(next.length, weights.filter((_, i) => i !== index)));
  };

  const handleRun = async () => {
    if (!selectedFunds.length) {
      setErrorMsg("请至少选择一只基金。");
      return;
    }
    const investAmount = toNum(amount);
    if (investAmount <= 0) {
      setErrorMsg("单期投入金额必须大于 0。");
      return;
    }
    if (new Date(startDate) >= new Date(endDate)) {
      setErrorMsg("起始日期必须早于结束日期。");
      return;
    }
    const normalizedWeights = normalizeWeights(selectedFunds.length, weights);
    setWeights(normalizedWeights);
    setIsRunning(true);
    setErrorMsg("");
    setLlmReview(null);
    try {
      const data = await utils.fund.runBacktest.fetch({
        fundIds: selectedFunds,
        weights: normalizedWeights,
        strategy: strategy as any,
        startDate,
        endDate,
        investAmount,
        investFrequency: frequency as any,
        feeRate: toNum(feeRate),
        slippageRate: toNum(slippageRate),
        riskProfile,
        maxDrawdownLimit: toNum(maxDrawdownLimit),
        targetAnnualReturn: toNum(targetAnnualReturn),
      });
      setResult(data);
    } catch (err: any) {
      setErrorMsg(err?.message || "回测计算失败，请检查参数后重试。");
    } finally {
      setIsRunning(false);
    }
  };

  const handleLLMReview = async () => {
    if (!result || llmLoading) return;
    setLlmLoading(true);
    try {
      const firstFund = selectedFundDetails[0] as any;
      const review = await llmMutation.mutateAsync({
        code: result.fundCode || firstFund?.fundCode || "",
        name: result.fundName || firstFund?.fundAbbr || "组合定投",
        dca: {
          totalInvested: result.totalInvested,
          finalValue: result.finalValue,
          totalReturn: result.totalReturn,
          annualizedReturn: result.annualizedReturn,
          maxDrawdown: result.maxDrawdown,
          sharpeRatio: result.sharpeRatio,
          feeCost: result.feeCost,
          strategy: strategyLabels[result.selectedStrategyKey] || strategyLabels[strategy] || strategy,
          frequency,
          weights,
          constraints: { riskProfile, maxDrawdownLimit, targetAnnualReturn },
        },
        benchmark: result.benchmark || {},
      });
      setLlmReview(review?.review ?? review);
    } catch {
      setLlmReview({ raw: "智能评价服务暂时不可用，请稍后重试。" });
    } finally {
      setLlmLoading(false);
    }
  };

  const selectedStrategyName = result ? strategyLabels[result.selectedStrategyKey] || strategyLabels[strategy] : strategyLabels[strategy];
  const benchmarkReturn = toNum(result?.benchmark?.totalReturn ?? result?.benchmarkReturn);
  const excessReturn = toNum(result?.totalReturn) - benchmarkReturn;

  return (
    <div className="min-h-screen bg-[#000212] pt-14 pb-24 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:pb-12">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex flex-col gap-3 py-6 md:flex-row md:items-end md:justify-between md:py-8">
          <div>
            <div className="flex items-center gap-2 text-xs text-white/40">
              <SlidersHorizontal className="h-4 w-4" style={{ color: ACCENT_INFO }} />
              专业组合定投工作台
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-4xl">智能定投与组合回测</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">
              用真实净值曲线、组合权重、交易频率、费率摩擦和风险预算，评估定投策略是否值得执行。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center md:w-[420px]">
            {[
              { label: "策略库", value: "4+" },
              { label: "约束", value: `${maxDrawdownLimit}%` },
              { label: "目标年化", value: `${targetAnnualReturn}%` },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2">
                <div className="text-[11px] text-white/55">{item.label}</div>
                <div className="data-number mt-1 text-sm font-semibold text-white/80">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[430px_1fr]">
          <div className="space-y-4">
            <div className="liquid-glass p-4 md:p-5">
              <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-white">
                <WalletCards className="h-5 w-5" style={{ color: ACCENT_PRIMARY }} />
                基金池与权重
              </h2>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  value={fundSearch}
                  onChange={(event) => setFundSearch(event.target.value)}
                  placeholder="输入代码、名称、类型筛选基金"
                  className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#3B6CFF]/50"
                />
              </div>

              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                <button onClick={() => setActiveType("all")} className={`h-8 rounded-lg border px-3 text-xs ${activeType === "all" ? "border-[#3B6CFF]/35 bg-[#3B6CFF]/18 text-[#00F0FF]" : "border-white/[0.06] bg-white/[0.03] text-white/45"}`}>全部</button>
                {groupedFunds.map((group) => (
                  <button key={group.type} onClick={() => setActiveType(group.type)} className={`h-8 whitespace-nowrap rounded-lg border px-3 text-xs ${activeType === group.type ? "border-[#3B6CFF]/35 bg-[#3B6CFF]/18 text-[#00F0FF]" : "border-white/[0.06] bg-white/[0.03] text-white/45"}`}>
                    {group.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-white/50">排序</span>
                {[
                  { key: "annualizedReturn", label: "年化" },
                  { key: "maxDrawdown", label: "回撤" },
                  { key: "sharpeRatio", label: "夏普" },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      if (sortMetric === item.key) setSortOrder(sortOrder === "desc" ? "asc" : "desc");
                      else {
                        setSortMetric(item.key as SortMetric);
                        setSortOrder(item.key === "maxDrawdown" ? "asc" : "desc");
                      }
                    }}
                    className={`h-7 rounded-lg border px-2.5 text-[11px] ${sortMetric === item.key ? "border-[#00F0FF]/30 bg-[#00F0FF]/12 text-[#00F0FF]" : "border-white/[0.06] bg-white/[0.03] text-white/40"}`}
                  >
                    {item.label}{sortMetric === item.key ? (sortOrder === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                ))}
              </div>

              <div className="mt-3 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                {visibleGroups.map((group) => (
                  <div key={group.type} className="overflow-hidden rounded-lg border border-white/[0.06] bg-[#070B18]/70">
                    <div className="flex justify-between bg-white/[0.03] px-3 py-2 text-xs text-white/55">
                      <span>{group.label}</span>
                      <span className="data-number">{group.funds.length}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1 p-1.5 sm:grid-cols-2 xl:grid-cols-1">
                      {group.funds.map((fund: any) => (
                        <button key={fund.id} type="button" onClick={() => handleAddFund(fund.id)} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]">
                          <Plus className="h-3.5 w-3.5 shrink-0 text-[#5AA9FF]" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-white/85">{fund.fundAbbr || fund.fundName}</div>
                            <div className="data-number text-xs text-white/55">{fund.fundCode} · {fund.category}</div>
                            <div className="mt-1 flex items-center gap-2 text-[10px]">
                              <span className={`data-number ${getChangeTextClass(metricValue(fund, "annualizedReturn"))}`}>年化 {metricValue(fund, "annualizedReturn").toFixed(2)}%</span>
                              <span className="data-number" style={{ color: RISK_COLOR }}>回撤 {metricValue(fund, "maxDrawdown").toFixed(2)}%</span>
                              <span className="data-number" style={{ color: POSITIVE_METRIC_COLOR }}>夏普 {metricValue(fund, "sharpeRatio").toFixed(2)}</span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {selectedFundDetails.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between px-1 text-[11px] text-white/55">
                    <span>组合权重合计</span>
                    <span className={`data-number ${weightTotal === 100 ? "text-[#00F0FF]" : "text-[#F5384B]"}`}>{weightTotal}%</span>
                  </div>
                  {selectedFundDetails.map((fund: any, index: number) => (
                    <div key={fund.id} className="rounded-lg border border-white/[0.08] bg-white/[0.045] p-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#00F0FF]" />
                        <span className="min-w-0 flex-1 truncate text-sm text-white">{fund.fundAbbr || fund.fundName}</span>
                        <button onClick={() => handleRemoveFund(index)} className="rounded-md p-1 text-white/55 hover:bg-white/[0.06] hover:text-white">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={weights[index] || 0}
                          onChange={(event) => setWeights(normalizeWeights(selectedFunds.length, weights, index, Number(event.target.value)))}
                          className="w-full accent-[#3B6CFF]"
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={weights[index] || 0}
                          onChange={(event) => setWeights(normalizeWeights(selectedFunds.length, weights, index, Number(event.target.value)))}
                          className="data-number h-8 w-16 rounded-lg border border-white/[0.08] bg-[#0B1021] px-2 text-xs text-white outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="liquid-glass p-4 md:p-5">
              <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-white">
                <Settings2 className="h-5 w-5" style={{ color: ACCENT_INFO }} />
                策略参数
              </h2>
              <div className="space-y-4">
                <section>
                  <label className="mb-2 block text-xs text-white/40">定投策略</label>
                  <div className="space-y-1.5">
                    {strategies.map((item) => (
                      <button key={item.value} onClick={() => setStrategy(item.value)} className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-all ${strategy === item.value ? "border-[#3B6CFF]/25 bg-[#3B6CFF]/15 text-[#5AA9FF]" : "border-transparent text-white/55 hover:bg-white/[0.03] hover:text-white/75"}`}>
                        <div className="font-medium">{item.label}</div>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-white/55">{item.desc}</div>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/40">单期投入</label>
                    <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} className="data-number h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none focus:border-[#3B6CFF]/50" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/40">频率</label>
                    <Select value={frequency} onValueChange={setFrequency}>
                      <SelectTrigger className="h-10 w-full rounded-lg border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white focus:border-[#3B6CFF]/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover text-popover-foreground border-white/[0.08]">
                        {frequencies.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/40">起始日期</label>
                    <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none focus:border-[#3B6CFF]/50" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/40">结束日期</label>
                    <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none focus:border-[#3B6CFF]/50" />
                  </div>
                </section>

                <section>
                  <label className="mb-2 block text-xs text-white/40">风险档位</label>
                  <div className="grid grid-cols-3 gap-2">
                    {riskProfiles.map((profile) => (
                      <button key={profile.value} onClick={() => handleRiskProfile(profile.value)} className={`h-9 rounded-lg border text-xs ${riskProfile === profile.value ? "border-[#00F0FF]/30 bg-[#00F0FF]/12 text-[#00F0FF]" : "border-white/[0.06] bg-white/[0.03] text-white/45"}`}>
                        {profile.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/40">最大回撤预算 %</label>
                    <input type="number" value={maxDrawdownLimit} onChange={(event) => setMaxDrawdownLimit(event.target.value)} className="data-number h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/40">目标年化 %</label>
                    <input type="number" value={targetAnnualReturn} onChange={(event) => setTargetAnnualReturn(event.target.value)} className="data-number h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/40">申购费率 %</label>
                    <input type="number" value={feeRate} onChange={(event) => setFeeRate(event.target.value)} className="data-number h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/40">摩擦成本 %</label>
                    <input type="number" value={slippageRate} onChange={(event) => setSlippageRate(event.target.value)} className="data-number h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none" />
                  </div>
                </section>

                {errorMsg && (
                  <div className="flex items-start gap-2 text-xs" style={{ color: RISK_COLOR }}>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}
                <button onClick={handleRun} disabled={selectedFunds.length === 0 || isRunning} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#3B6CFF] to-[#2A52CC] text-sm font-medium text-white transition-all hover:from-[#4A7CFF] hover:to-[#3A62CC] disabled:cursor-not-allowed disabled:opacity-40">
                  {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {isRunning ? "正在回测..." : "运行专业回测"}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {result ? (
              <>
                <div className="liquid-glass p-4 md:p-6">
                  <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h2 className="text-lg font-medium text-white">{selectedStrategyName} · 回测结论</h2>
                      <p className="mt-1 text-xs leading-relaxed text-white/40">
                        组合曲线按权重汇总；费用与摩擦成本作为现金流成本估算；一次性买入基准使用相同累计投入金额。
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2 text-right">
                      <div className="text-[11px] text-white/55">建议状态</div>
                      <div className="mt-1 text-sm font-semibold" style={{ color: advice?.verdict === "可执行" ? UP_COLOR : advice?.verdict === "谨慎执行" ? ACCENT_HIGHLIGHT : RISK_COLOR }}>
                        {advice?.verdict}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <MetricCard label="累计投入" value={money(result.totalInvested)} color={ACCENT_PRIMARY} icon={WalletCards} />
                    <MetricCard label="期末市值" value={money(result.finalValue)} color={POSITIVE_METRIC_COLOR} icon={TrendingUp} />
                    <MetricCard label="总收益率" value={pct(result.totalReturn)} color={toNum(result.totalReturn) >= 0 ? UP_COLOR : DOWN_COLOR} icon={Activity} />
                    <MetricCard label="现金流年化" value={pct(result.annualizedReturn, false)} color={toNum(result.annualizedReturn) >= 0 ? UP_COLOR : DOWN_COLOR} icon={Target} />
                    <MetricCard label="最大回撤" value={pct(result.maxDrawdown, false)} color={RISK_COLOR} icon={ShieldCheck} />
                    <MetricCard label="夏普比率" value={toNum(result.sharpeRatio).toFixed(2)} color={ACCENT_INFO} icon={Sparkles} />
                  </div>
                </div>

                <div className="liquid-glass p-4 md:p-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-medium text-white">资金曲线</h2>
                      <p className="mt-1 text-xs text-white/55">本金、定投账户市值和同等总本金一次性买入的市值对比</p>
                    </div>
                    <div className="data-number text-xs text-white/55">费率成本 {money(result.feeCost)}</div>
                  </div>
                  {curveSummary && (
                    <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
                        <div className="text-white/55">定投盈亏</div>
                        <div className="data-number mt-1 text-sm font-semibold" style={{ color: curveSummary.dcaProfit >= 0 ? UP_COLOR : DOWN_COLOR }}>{money(curveSummary.dcaProfit)}</div>
                      </div>
                      <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
                        <div className="text-white/55">一次性盈亏</div>
                        <div className="data-number mt-1 text-sm font-semibold" style={{ color: curveSummary.benchmarkProfit >= 0 ? UP_COLOR : DOWN_COLOR }}>{money(curveSummary.benchmarkProfit)}</div>
                      </div>
                      <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
                        <div className="text-white/55">定投差额</div>
                        <div className="data-number mt-1 text-sm font-semibold" style={{ color: curveSummary.gap >= 0 ? UP_COLOR : DOWN_COLOR }}>{money(curveSummary.gap)}</div>
                      </div>
                    </div>
                  )}
                  <div className="h-72 md:h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={result.monthlyData || []} margin={{ top: 20, right: 16, left: 4, bottom: 0 }}>
                        <defs>
                          <linearGradient id="dcaValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={UP_COLOR} stopOpacity={0.22} />
                            <stop offset="100%" stopColor={UP_COLOR} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="investedValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={ACCENT_PRIMARY} stopOpacity={0.16} />
                            <stop offset="100%" stopColor={ACCENT_PRIMARY} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }} tickFormatter={(value) => String(value).slice(0, 7)} axisLine={false} tickLine={false} />
                        <YAxis width={64} domain={chartDomain} tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }} tickFormatter={(value) => `¥${(Number(value) / 10000).toFixed(1)}万`} axisLine={false} tickLine={false} />
                        <Tooltip
                          wrapperStyle={{ outline: "none" }}
                          contentStyle={{ background: "rgba(5,8,26,0.98)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.82)" }}
                          labelStyle={{ color: "rgba(255,255,255,0.55)" }}
                          formatter={(value: any, name: string) => [money(value), name === "invested" ? "累计投入本金" : name === "value" ? "定投账户市值" : "一次性买入市值"]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }} />
                        <Area type="stepAfter" dataKey="invested" name="累计投入本金" stroke={ACCENT_PRIMARY} strokeWidth={1.5} fill="url(#investedValue)" />
                        <Area type="monotone" dataKey="value" name="定投账户市值" stroke={UP_COLOR} strokeWidth={2} fill="url(#dcaValue)" />
                        <Area type="monotone" dataKey="benchmark" name="一次性买入市值" stroke="#FFD166" strokeWidth={2} fill="transparent" connectNulls />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="liquid-glass p-4 md:p-6">
                    <h2 className="mb-4 text-base font-medium text-white">策略横向比较</h2>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={strategyChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                          <XAxis dataKey="label" interval={0} tick={{ fill: "rgba(255,255,255,0.42)", fontSize: 10 }} axisLine={false} tickLine={false} height={42} />
                          <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }} tickFormatter={(value) => `${value}`} axisLine={false} tickLine={false} />
                          <Tooltip
                            wrapperStyle={{ outline: "none" }}
                            contentStyle={{ background: "rgba(5,8,26,0.98)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.82)" }}
                            labelStyle={{ color: "rgba(255,255,255,0.65)" }}
                            formatter={(value: any, name: string, item: any) => {
                              const raw = item?.payload || {};
                              if (name === "returnScore") return [`评分 ${Number(value).toFixed(0)} / 原值 ${pct(raw.annualizedReturn, false)}`, "年化收益"];
                              if (name === "drawdownScore") return [`评分 ${Number(value).toFixed(0)} / 原值 ${pct(raw.maxDrawdown, false)}`, "回撤控制"];
                              return [`评分 ${Number(value).toFixed(0)} / 原值 ${toNum(raw.sharpeRatio).toFixed(2)}`, "夏普比率"];
                            }}
                          />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.16)" />
                          <Bar dataKey="returnScore" name="年化收益" fill={UP_COLOR} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="drawdownScore" name="回撤控制" fill={RISK_COLOR} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="sharpeScore" name="夏普比率" fill={ACCENT_INFO} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 text-[11px] text-white/50">柱状图按 0-100 归一化：收益和夏普越高越好，回撤控制越高代表回撤越小。</div>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {(result.strategyResults || []).map((item: any) => (
                        <div key={item.key} className="rounded-lg border border-white/[0.06] bg-white/[0.035] p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-white/85">{strategyLabels[item.key] || item.key}</span>
                            <span className={`data-number text-sm ${getChangeTextClass(item.totalReturn)}`}>{pct(item.totalReturn)}</span>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                            <span className="data-number text-white/55">年化 {pct(item.annualizedReturn, false)}</span>
                            <span className="data-number" style={{ color: RISK_COLOR }}>回撤 {pct(item.maxDrawdown, false)}</span>
                            <span className="data-number" style={{ color: ACCENT_INFO }}>夏普 {toNum(item.sharpeRatio).toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="liquid-glass p-4 md:p-6">
                    <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-white">
                      <Brain className="h-5 w-5" style={{ color: ACCENT_INFO }} />
                      策略建议
                    </h2>
                    {advice && (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] p-3">
                          <div className="text-xs text-white/55">执行建议</div>
                          <div className="mt-2 text-sm leading-relaxed text-white/80">{advice.action}</div>
                        </div>
                        {advice.points.map((point) => (
                          <div key={point} className="flex gap-2 rounded-lg border border-white/[0.05] bg-white/[0.025] p-3 text-sm leading-relaxed text-white/65">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#00F0FF]" />
                            <span>{point}</span>
                          </div>
                        ))}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] p-3">
                            <div className="text-[11px] text-white/55">定投 vs 买入持有</div>
                            <div className="data-number mt-2 text-lg font-semibold" style={{ color: excessReturn >= 0 ? UP_COLOR : DOWN_COLOR }}>{pct(excessReturn)}</div>
                          </div>
                          <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] p-3">
                            <div className="text-[11px] text-white/55">买入持有回撤</div>
                            <div className="data-number mt-2 text-lg font-semibold" style={{ color: RISK_COLOR }}>{pct(result.benchmark?.maxDrawdown, false)}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="liquid-glass p-4 md:p-6">
                  <h2 className="mb-4 text-base font-medium text-white">组合拆解</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-left text-sm">
                      <thead className="text-xs text-white/55">
                        <tr className="border-b border-white/[0.06]">
                          <th className="py-2 font-normal">基金</th>
                          <th className="py-2 font-normal">权重</th>
                          <th className="py-2 font-normal">策略收益</th>
                          <th className="py-2 font-normal">年化</th>
                          <th className="py-2 font-normal">最大回撤</th>
                          <th className="py-2 font-normal">夏普</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.fundBreakdown || []).map((item: any) => (
                          <tr key={item.code} className="border-b border-white/[0.04] text-white/70">
                            <td className="py-3">
                              <div className="max-w-[260px] truncate text-white/85">{item.name}</div>
                              <div className="data-number text-xs text-white/55">{item.code}</div>
                            </td>
                            <td className="data-number py-3">{item.weight}%</td>
                            <td className={`data-number py-3 ${getChangeTextClass(item.strategyReturn)}`}>{pct(item.strategyReturn)}</td>
                            <td className={`data-number py-3 ${getChangeTextClass(item.annualizedReturn)}`}>{pct(item.annualizedReturn, false)}</td>
                            <td className="data-number py-3" style={{ color: RISK_COLOR }}>{pct(item.maxDrawdown, false)}</td>
                            <td className="data-number py-3" style={{ color: ACCENT_INFO }}>{toNum(item.sharpeRatio).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="liquid-glass p-4 md:p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-base font-medium text-white">
                      <Sparkles className="h-5 w-5" style={{ color: ACCENT_INFO }} />
                      智能专业复核
                    </h2>
                    <button onClick={handleLLMReview} disabled={llmLoading} className="h-9 rounded-lg border px-4 text-xs font-medium disabled:opacity-40" style={{ background: `${ACCENT_INFO}1A`, color: ACCENT_INFO, borderColor: `${ACCENT_INFO}40` }}>
                      {llmLoading ? "生成中..." : llmReview ? "重新生成" : "生成智能评价"}
                    </button>
                  </div>
                  {llmLoading && <div className="flex items-center gap-2 py-6 text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin" />正在分析组合定投表现...</div>}
                  {!llmLoading && !llmReview && <p className="text-sm text-white/40">点击按钮后，会结合本次回测指标、风险约束、基准表现和组合权重生成复核意见。</p>}
                  {!llmLoading && llmReview && (
                    <div className="space-y-3">
                      {llmReview.verdict && <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] p-3"><div className="text-xs" style={{ color: ACCENT_INFO }}>综合评级</div><div className="mt-1 text-sm font-medium text-white">{llmReview.verdict}</div></div>}
                      {llmReview.analysis && <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] p-3"><div className="text-xs" style={{ color: ACCENT_INFO }}>专业分析</div><div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{llmReview.analysis}</div></div>}
                      {Array.isArray(llmReview.suggestions) && llmReview.suggestions.length > 0 && <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] p-3"><div className="mb-2 text-xs" style={{ color: ACCENT_HIGHLIGHT }}>优化建议</div>{llmReview.suggestions.map((item: string) => <div key={item} className="mb-1.5 flex gap-2 text-sm text-white/70"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00F0FF]" /><span>{item}</span></div>)}</div>}
                      {Array.isArray(llmReview.risk_notes) && llmReview.risk_notes.length > 0 && <div className="rounded-lg border border-[#FFB800]/20 bg-[#FFB800]/[0.06] p-3"><div className="mb-2 text-xs" style={{ color: RISK_COLOR }}>风险提示</div>{llmReview.risk_notes.map((item: string) => <div key={item} className="mb-1.5 flex gap-2 text-sm text-white/70"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: RISK_COLOR }} /><span>{item}</span></div>)}</div>}
                      {llmReview.raw && <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/65">{llmReview.raw}</p>}
                    </div>
                  )}
                </div>

                {/* DCA 增强可视化 */}
                {result.monthlyData && result.monthlyData.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {/* 月度收益热力图 */}
                    <div className="liquid-glass p-4 md:p-6">
                      <h2 className="mb-4 text-base font-medium text-white">月度收益热力图</h2>
                      <div className="overflow-x-auto">
                        <MonthlyHeatmap monthlyData={result.monthlyData} />
                      </div>
                    </div>

                    {/* 滚动夏普比率 */}
                    <div className="liquid-glass p-4 md:p-6">
                      <h2 className="mb-4 text-base font-medium text-white">滚动夏普比率 (6月窗口)</h2>
                      <div className="h-52">
                        <RollingSharpeChart monthlyData={result.monthlyData} />
                      </div>
                    </div>
                  </div>
                )}

                {/* 策略雷达图 */}
                {result.strategyResults && result.strategyResults.length > 1 && (
                  <div className="liquid-glass p-4 md:p-6">
                    <h2 className="mb-4 text-base font-medium text-white">策略维度雷达图</h2>
                    <div className="h-72">
                      <StrategyRadarChart strategyResults={result.strategyResults} />
                    </div>
                  </div>
                )}

                <button onClick={() => { setResult(null); setLlmReview(null); }} className="flex items-center gap-2 text-sm text-white/55 transition-colors hover:text-white/65">
                  <RotateCcw className="h-4 w-4" />重新配置参数
                </button>
              </>
            ) : (
              <div className="liquid-glass flex min-h-[560px] flex-col items-center justify-center p-8 text-center">
                <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.035]">
                  <Calculator className="h-10 w-10 text-[#3B6CFF]/70" />
                </div>
                <h3 className="text-xl font-medium text-white/75">配置一套可执行的定投方案</h3>
                <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/38">
                  选择基金、设置权重、输入资金计划和风险预算后，系统会输出组合级曲线、策略横评、回撤约束和执行建议。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== DCA 增强组件 ====================

const MONTH_LABELS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

function MonthlyHeatmap({ monthlyData }: { monthlyData: any[] }) {
  const monthlyReturns: Record<string, Record<number, number>> = {};
  let prevValue = 0;
  monthlyData.forEach((pt: any, i: number) => {
    const date = pt.date || pt.month || '';
    const value = toNum(pt.value);
    if (i === 0) { prevValue = value; return; }
    const ret = prevValue > 0 ? (value - prevValue) / prevValue * 100 : 0;
    prevValue = value;
    const [y, m] = date.split('-');
    if (!y || !m) return;
    if (!monthlyReturns[y]) monthlyReturns[y] = {};
    monthlyReturns[y][parseInt(m) - 1] = ret;
  });

  const years = Object.keys(monthlyReturns).sort();
  if (years.length === 0) return <div className="text-xs text-white/50">数据不足</div>;

  const getColor = (v: number) => {
    if (v > 5) return 'bg-red-500/70';
    if (v > 2) return 'bg-red-500/40';
    if (v > 0) return 'bg-red-500/20';
    if (v > -2) return 'bg-green-500/20';
    if (v > -5) return 'bg-green-500/40';
    return 'bg-green-500/70';
  };

  return (
    <table className="w-full text-[10px]">
      <thead>
        <tr>
          <th className="py-1 text-left text-white/50 font-normal">年份</th>
          {MONTH_LABELS.map(m => <th key={m} className="py-1 text-center text-white/50 font-normal">{m}</th>)}
        </tr>
      </thead>
      <tbody>
        {years.map(y => (
          <tr key={y}>
            <td className="py-1 text-white/50">{y}</td>
            {Array.from({ length: 12 }, (_, i) => {
              const v = monthlyReturns[y]?.[i];
              return (
                <td key={i} className="py-1 px-0.5 text-center">
                  {v !== undefined ? (
                    <div className={`rounded px-1 py-0.5 ${getColor(v)} text-white/80`} title={`${y}-${String(i+1).padStart(2,'0')}: ${v.toFixed(1)}%`}>
                      {v.toFixed(1)}
                    </div>
                  ) : <div className="text-white/10">-</div>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RollingSharpeChart({ monthlyData }: { monthlyData: any[] }) {
  const WINDOW = 6;
  const returns: { date: string; ret: number }[] = [];
  let prevVal = 0;
  monthlyData.forEach((pt: any, i: number) => {
    const value = toNum(pt.value);
    if (i === 0) { prevVal = value; return; }
    const ret = prevVal > 0 ? (value - prevVal) / prevVal : 0;
    prevVal = value;
    returns.push({ date: pt.date || pt.month || '', ret });
  });

  const rollingData: { date: string; sharpe: number }[] = [];
  for (let i = WINDOW - 1; i < returns.length; i++) {
    const window = returns.slice(i - WINDOW + 1, i + 1);
    const mean = window.reduce((s, r) => s + r.ret, 0) / WINDOW;
    const std = Math.sqrt(window.reduce((s, r) => s + (r.ret - mean) ** 2, 0) / WINDOW);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(12) : 0;
    rollingData.push({ date: returns[i].date, sharpe: parseFloat(sharpe.toFixed(3)) });
  }

  if (rollingData.length < 3) return <div className="text-xs text-white/50">数据窗口不足</div>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rollingData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} tickFormatter={d => d.slice(0, 7)} interval="preserveStartEnd" />
        <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} />
        <Tooltip contentStyle={{ background: 'rgba(5,8,26,0.98)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'rgba(255,255,255,0.5)' }} formatter={(v: number) => [v.toFixed(3), '滚动夏普比率']} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
        <Line type="monotone" dataKey="sharpe" stroke="#5AA9FF" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const RADAR_COLORS = ['#5470C6', '#EE6666', '#FAC858', '#91CC75', '#73C0DE'];

function StrategyRadarChart({ strategyResults }: { strategyResults: any[] }) {
  const maxReturn = Math.max(0.01, ...strategyResults.map(s => Math.abs(toNum(s.annualizedReturn))));
  const maxSharpe = Math.max(0.01, ...strategyResults.map(s => Math.abs(toNum(s.sharpeRatio))));
  const maxDrawdown = Math.max(0.01, ...strategyResults.map(s => Math.abs(toNum(s.maxDrawdown))));

  const dimensions = ['收益', '夏普', '回撤控制', '稳定性', '综合'];
  const radarData = dimensions.map((dim, idx) => {
    const entry: Record<string, any> = { dimension: dim };
    strategyResults.forEach((s: any) => {
      const key = strategyLabels[s.key] || s.key;
      let val = 0;
      if (idx === 0) val = (toNum(s.annualizedReturn) / maxReturn) * 100;
      else if (idx === 1) val = (toNum(s.sharpeRatio) / maxSharpe) * 100;
      else if (idx === 2) val = (1 - Math.abs(toNum(s.maxDrawdown)) / maxDrawdown) * 100;
      else if (idx === 3) val = toNum(s.sharpeRatio) > 0 ? Math.min(100, toNum(s.sharpeRatio) / maxSharpe * 80 + 20) : 20;
      else val = ((toNum(s.annualizedReturn) / maxReturn) * 40 + (toNum(s.sharpeRatio) / maxSharpe) * 35 + (1 - Math.abs(toNum(s.maxDrawdown)) / maxDrawdown) * 25);
      entry[key] = Math.max(0, Math.min(100, val));
    });
    return entry;
  });

  const strategyNames = strategyResults.map(s => strategyLabels[s.key] || s.key);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
        <PolarGrid stroke="rgba(255,255,255,0.1)" />
        <PolarAngleAxis dataKey="dimension" tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }} />
        {strategyNames.map((name, i) => (
          <Radar key={name} name={name} dataKey={name} stroke={RADAR_COLORS[i % RADAR_COLORS.length]} fill={RADAR_COLORS[i % RADAR_COLORS.length]} fillOpacity={0.15} strokeWidth={1.5} />
        ))}
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Tooltip contentStyle={{ background: 'rgba(5,8,26,0.98)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
          formatter={(v: number, name: string) => [`${v.toFixed(0)}分`, name]} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
