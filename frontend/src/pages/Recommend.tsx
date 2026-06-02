import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  Check,
  Gauge,
  Layers3,
  Loader2,
  PieChart,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  ACCENT_HIGHLIGHT,
  ACCENT_INFO,
  ACCENT_PRIMARY,
  POSITIVE_METRIC_COLOR,
  RISK_COLOR,
  UP_COLOR,
  getChangeTextClass,
} from "@/lib/colors";

const riskProfiles = [
  { value: "conservative", label: "保守型", desc: "债券和现金权重最高，默认回撤上限12%，权益仓位最低。", icon: Shield, maxDrawdown: 12, equityCap: "约15%" },
  { value: "moderate", label: "稳健型", desc: "固收打底、混合增强，默认回撤上限18%，适合稳中求进。", icon: Users, maxDrawdown: 18, equityCap: "约30%" },
  { value: "balanced", label: "均衡型", desc: "股债均衡，默认回撤上限24%，更重视收益风险比。", icon: Target, maxDrawdown: 24, equityCap: "约45%" },
  { value: "aggressive", label: "进取型", desc: "权益和指数权重最高，默认回撤上限35%，追求长期弹性。", icon: TrendingUp, maxDrawdown: 35, equityCap: "约65%" },
];

const horizons = ["6个月", "1年", "3年", "5年", "10年"];

const fundTypes = [
  { value: "bond", label: "债券" },
  { value: "hybrid", label: "混合" },
  { value: "index", label: "指数" },
  { value: "etf", label: "ETF" },
  { value: "reits", label: "REITs" },
  { value: "equity", label: "股票" },
  { value: "qdii", label: "QDII" },
  { value: "money", label: "货币" },
];

const optimizationGoals = [
  { value: "balanced", label: "平衡", desc: "兼顾收益、回撤和波动" },
  { value: "risk", label: "控波动", desc: "优先压低回撤与CVaR" },
  { value: "return", label: "收益弹性", desc: "提高长期进攻性" },
];

const focusThemes = [
  { value: "all", label: "全市场" },
  { value: "income", label: "固收收益" },
  { value: "dividend", label: "红利低波" },
  { value: "defensive", label: "防守均衡" },
  { value: "growth", label: "科技成长" },
  { value: "consumption", label: "消费医药" },
  { value: "manufacturing", label: "高端制造" },
  { value: "diversified", label: "宽基配置" },
  { value: "overseas", label: "海外QDII" },
];

type SourceMode = "xinjihui" | "watchlist" | "custom";

type RecommendParams = {
  sourceMode: SourceMode;
  includeXinjihui: boolean;
  includeWatchlist: boolean;
  riskProfile: string;
  horizon: string;
  maxDrawdown: number;
  amount: number;
  preferredTypes: string[];
  optimizationGoal: string;
  focusTheme: string;
  selectedFundCodes: string[];
  manualFundCodes: string[];
};

const sourceModes: Array<{ value: SourceMode; label: string; desc: string }> = [
  { value: "xinjihui", label: "鑫基荟", desc: "从优选池中生成" },
  { value: "watchlist", label: "自选基金", desc: "只使用用户自选池" },
  { value: "custom", label: "指定产品", desc: "手工选择候选基金" },
];

const defaultParams: RecommendParams = {
  sourceMode: "xinjihui",
  includeXinjihui: true,
  includeWatchlist: false,
  riskProfile: "balanced",
  horizon: "1年",
  maxDrawdown: 24,
  amount: 100000,
  preferredTypes: ["bond", "hybrid", "index", "etf", "equity", "reits"],
  optimizationGoal: "balanced",
  focusTheme: "all",
  selectedFundCodes: [] as string[],
  manualFundCodes: [] as string[],
};

const barColors = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF", "#16C784"];

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-white/55">
      <Loader2 className="w-8 h-8 animate-spin mb-3" />
      <span className="text-sm">正在生成配置...</span>
    </div>
  );
}

function metricValue(value: unknown) {
  const num = parseFloat(String(value ?? "0").replace("%", ""));
  return Number.isFinite(num) ? num : 0;
}

function metricText(value: unknown, digits = 2) {
  if (value === undefined || value === null || value === "" || value === "—") return "—";
  const num = metricValue(value);
  return Number.isFinite(num) ? num.toFixed(digits) : "—";
}

function yuan(value: number) {
  return Math.round(value).toLocaleString("zh-CN");
}

function PanelTitle({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-2 text-white font-medium">
      <Icon className="w-4 h-4" style={{ color: ACCENT_INFO }} />
      {title}
    </div>
  );
}

function MetricTile({ label, value, color, suffix = "" }: { label: string; value: string | number; color?: string; suffix?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-3">
      <div className="text-white/55 text-xs">{label}</div>
      <div className="data-number mt-1 text-lg font-medium" style={{ color }}>{value}{suffix}</div>
    </div>
  );
}

export default function Recommend() {
  const [draft, setDraft] = useState(defaultParams);
  const [applied, setApplied] = useState(defaultParams);
  const [activePlanId, setActivePlanId] = useState<number | null>(null);
  const [expandedFundCode, setExpandedFundCode] = useState<string | null>(null);
  const [fundSearch, setFundSearch] = useState("");
  const [manualCode, setManualCode] = useState("");

  const { data: listData } = trpc.fund.list.useQuery(
    { page: 1, pageSize: 300, withMetrics: false },
    { staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const { data: recommendationsData, isLoading, isFetching } = trpc.fund.recommendations.useQuery(
    applied,
    { enabled: applied.includeXinjihui || applied.includeWatchlist || applied.selectedFundCodes.length > 0 || applied.manualFundCodes.length > 0 }
  );

  const allFunds = listData?.funds ?? [];
  const availableFunds = useMemo(() => {
    const bySource = allFunds.filter((fund: any) => {
      const inXinjihui = draft.includeXinjihui && fund.isXinjihui;
      const inWatchlist = draft.includeWatchlist && (fund.source === "watchlist" || !fund.isXinjihui);
      return inXinjihui || inWatchlist || draft.selectedFundCodes.includes(String(fund.fundCode));
    });
    const keyword = fundSearch.trim().toLowerCase();
    const searched = keyword
      ? bySource.filter((fund: any) => `${fund.fundCode}${fund.fundName}${fund.fundAbbr}${fund.category}`.toLowerCase().includes(keyword))
      : bySource;
    return searched.slice(0, 36);
  }, [allFunds, draft.includeXinjihui, draft.includeWatchlist, draft.selectedFundCodes, fundSearch]);
  const selectedFunds = useMemo(
    () => allFunds.filter((fund: any) => draft.selectedFundCodes.includes(String(fund.fundCode))),
    [allFunds, draft.selectedFundCodes]
  );
  const recommendations = recommendationsData ?? [];
  const activePlan = recommendations.find((item: any) => item.id === activePlanId) ?? recommendations[0];
  const allocations = (activePlan as any)?.fundAllocations || [];
  const totalWeight = allocations.reduce((sum: number, item: any) => sum + (item.weight || 0), 0) || 100;
  const pendingChanges = JSON.stringify(draft) !== JSON.stringify(applied);
  const canGenerate = draft.includeXinjihui || draft.includeWatchlist || draft.selectedFundCodes.length > 0 || draft.manualFundCodes.length > 0;

  const updateDraft = (patch: Partial<typeof defaultParams>) => setDraft((prev) => ({ ...prev, ...patch }));
  const updateRiskProfile = (value: string) => {
    const profile = riskProfiles.find((item) => item.value === value);
    updateDraft({ riskProfile: value, maxDrawdown: profile?.maxDrawdown ?? draft.maxDrawdown });
  };
  const toggleType = (value: string) => {
    updateDraft({
      preferredTypes: draft.preferredTypes.includes(value)
        ? draft.preferredTypes.filter((item) => item !== value)
        : [...draft.preferredTypes, value],
    });
  };
  const toggleFundCode = (code: string) => {
    updateDraft({
      selectedFundCodes: draft.selectedFundCodes.includes(code)
        ? draft.selectedFundCodes.filter((item) => item !== code)
        : [...draft.selectedFundCodes, code],
    });
  };
  const toggleSource = (key: "includeXinjihui" | "includeWatchlist") => {
    const next = { ...draft, [key]: !draft[key] };
    next.sourceMode = next.includeXinjihui && !next.includeWatchlist && next.manualFundCodes.length === 0 && next.selectedFundCodes.length === 0
      ? "xinjihui"
      : next.includeWatchlist && !next.includeXinjihui && next.manualFundCodes.length === 0 && next.selectedFundCodes.length === 0
        ? "watchlist"
        : "custom";
    setDraft(next);
  };
  const addManualCode = () => {
    const code = manualCode.trim();
    if (!/^\d{6}$/.test(code)) return;
    updateDraft({
      sourceMode: "custom",
      manualFundCodes: draft.manualFundCodes.includes(code) ? draft.manualFundCodes : [...draft.manualFundCodes, code],
    });
    setManualCode("");
  };
  const applySettings = () => {
    setApplied(draft);
    setActivePlanId(null);
    setExpandedFundCode(null);
  };

  return (
    <div className="min-h-screen pt-14 pb-20 md:pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-7 md:pt-10 pb-5 md:pb-6">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
            <div>
              <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight">配置组合</h1>
              <p className="mt-2 max-w-3xl text-white/48 text-sm md:text-base leading-relaxed">
                先设定资金、产品池、风险档位和投资方向，再一次性生成组合，避免参数未定时反复刷新结果。
              </p>
            </div>
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${pendingChanges ? "border-[#FFB800]/25 bg-[#FFB800]/[0.06] text-white/70" : "border-white/[0.07] bg-white/[0.03] text-white/45"}`}>
              <RefreshCw className="w-4 h-4" style={{ color: pendingChanges ? RISK_COLOR : ACCENT_INFO }} />
              {pendingChanges ? "设置有改动，点击生成后生效" : "当前结果已按设置生成"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[390px_1fr] gap-4 md:gap-6 items-start">
          <aside className="liquid-glass p-4 md:p-5 xl:sticky xl:top-20">
            <div className="flex items-center justify-between gap-3 mb-4">
              <PanelTitle icon={SlidersHorizontal} title="组合设置" />
              <span className="text-[11px] text-white/55 data-number">{draft.preferredTypes.length}类已选</span>
            </div>

            <div className="space-y-5">
              <section className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
                <div className="flex items-center gap-2 text-white/75 text-sm mb-3">
                  <Wallet className="w-4 h-4" style={{ color: ACCENT_INFO }} />计划配置金额
                </div>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={draft.amount}
                  onChange={(event) => updateDraft({ amount: Number(event.target.value) || 0 })}
                  className="w-full h-11 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-base data-number focus:outline-none focus:border-[#3B6CFF]/50"
                />
              </section>

              <section>
                <div className="text-xs text-white/55 mb-2">产品来源</div>
                <div className="grid grid-cols-3 gap-2">
                  {sourceModes.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => updateDraft({
                        sourceMode: item.value,
                        includeXinjihui: item.value === "xinjihui",
                        includeWatchlist: item.value === "watchlist",
                      })}
                      className={`min-h-14 rounded-lg border px-2 text-left transition-all ${
                        draft.sourceMode === item.value ? "bg-[#3B6CFF]/16 border-[#3B6CFF]/35 text-white" : "bg-white/[0.03] border-white/[0.07] text-white/50 hover:text-white/75"
                      }`}
                    >
                      <div className="text-sm">{item.label}</div>
                      <div className="mt-1 text-[10px] text-white/55 leading-tight">{item.desc}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button onClick={() => toggleSource("includeXinjihui")} className={`h-9 rounded-lg border text-xs ${draft.includeXinjihui ? "bg-[#00F0FF]/10 border-[#00F0FF]/30 text-[#00F0FF]" : "bg-white/[0.02] border-white/[0.06] text-white/40"}`}>
                    {draft.includeXinjihui ? "已纳入" : "纳入"}鑫基荟
                  </button>
                  <button onClick={() => toggleSource("includeWatchlist")} className={`h-9 rounded-lg border text-xs ${draft.includeWatchlist ? "bg-[#00F0FF]/10 border-[#00F0FF]/30 text-[#00F0FF]" : "bg-white/[0.02] border-white/[0.06] text-white/40"}`}>
                    {draft.includeWatchlist ? "已纳入" : "纳入"}自选池
                  </button>
                </div>
              </section>

              {(
                <section className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs text-white/45">指定候选基金</div>
                    <button onClick={() => updateDraft({ selectedFundCodes: [], manualFundCodes: [] })} className="text-[11px] text-white/55 hover:text-white/65">清空</button>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input
                      value={manualCode}
                      onChange={(event) => setManualCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      onKeyDown={(event) => { if (event.key === "Enter") addManualCode(); }}
                      placeholder="输入6位代码"
                      className="min-w-0 flex-1 h-9 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-[#3B6CFF]/50"
                    />
                    <button onClick={addManualCode} disabled={!/^\d{6}$/.test(manualCode)} className="h-9 px-3 rounded-lg border border-[#3B6CFF]/35 bg-[#3B6CFF]/12 text-[#5AA9FF] text-xs disabled:opacity-35">
                      添加
                    </button>
                  </div>
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/50" />
                    <input
                      value={fundSearch}
                      onChange={(event) => setFundSearch(event.target.value)}
                      placeholder="搜索代码、名称、类型"
                      className="w-full h-9 pl-9 pr-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-[#3B6CFF]/50"
                    />
                  </div>
                  {(selectedFunds.length > 0 || draft.manualFundCodes.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {draft.manualFundCodes.map((code) => (
                        <button key={code} onClick={() => updateDraft({ manualFundCodes: draft.manualFundCodes.filter((item) => item !== code) })} className="rounded-md border border-[#00F0FF]/25 bg-[#00F0FF]/10 px-2 py-1 text-[11px] text-[#00F0FF] data-number">
                          {code}
                        </button>
                      ))}
                      {selectedFunds.map((fund: any) => (
                        <button key={fund.fundCode} onClick={() => toggleFundCode(String(fund.fundCode))} className="rounded-md border border-[#3B6CFF]/25 bg-[#3B6CFF]/10 px-2 py-1 text-[11px] text-[#5AA9FF]">
                          {fund.fundAbbr || fund.fundName}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                    {availableFunds.map((fund: any) => {
                      const selected = draft.selectedFundCodes.includes(String(fund.fundCode));
                      return (
                        <button
                          key={fund.fundCode}
                          onClick={() => toggleFundCode(String(fund.fundCode))}
                          className={`w-full rounded-lg px-2.5 py-2 text-left border transition-all ${selected ? "border-[#00F0FF]/30 bg-[#00F0FF]/[0.08]" : "border-white/[0.05] bg-white/[0.025] hover:bg-white/[0.05]"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs text-white/75 truncate">{fund.fundAbbr || fund.fundName}</div>
                              <div className="text-[10px] text-white/32 data-number">{fund.fundCode} · {fund.category}</div>
                            </div>
                            {selected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: ACCENT_INFO }} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <section>
                <div className="text-xs text-white/55 mb-2">风险承受能力</div>
                <div className="space-y-2">
                  {riskProfiles.map((rp) => {
                    const Icon = rp.icon;
                    const active = draft.riskProfile === rp.value;
                    return (
                      <button
                        key={rp.value}
                        onClick={() => updateRiskProfile(rp.value)}
                        className={`w-full rounded-lg border p-3 text-left transition-all ${
                          active ? "bg-[#3B6CFF]/18 border-[#3B6CFF]/35 text-white" : "bg-white/[0.03] border-white/[0.07] text-white/55 hover:text-white/80"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm">
                            <Icon className="w-4 h-4" />{rp.label}
                          </div>
                          <div className="text-[11px] text-white/50 data-number">回撤{rp.maxDrawdown}% · 权益{rp.equityCap}</div>
                        </div>
                        <div className="mt-1 text-[11px] text-white/38 leading-relaxed">{rp.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="text-xs text-white/55 mb-2">投资周期</div>
                <div className="grid grid-cols-5 gap-2">
                  {horizons.map((item) => (
                    <button
                      key={item}
                      onClick={() => updateDraft({ horizon: item })}
                      className={`h-9 rounded-lg text-xs border transition-all ${
                        draft.horizon === item ? "bg-[#00F0FF]/12 border-[#00F0FF]/35 text-[#00F0FF]" : "bg-white/[0.03] border-white/[0.07] text-white/45 hover:text-white/70"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-white/55">最大回撤约束</span>
                  <span className="data-number" style={{ color: RISK_COLOR }}>{draft.maxDrawdown}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={45}
                  step={1}
                  value={draft.maxDrawdown}
                  onChange={(event) => updateDraft({ maxDrawdown: Number(event.target.value) })}
                  className="w-full accent-[#3B6CFF]"
                />
              </section>

              <section>
                <div className="text-xs text-white/55 mb-2">优化目标</div>
                <div className="grid grid-cols-3 gap-2">
                  {optimizationGoals.map((item) => (
                    <button
                      key={item.value}
                      title={item.desc}
                      onClick={() => updateDraft({ optimizationGoal: item.value })}
                      className={`h-10 rounded-lg text-xs border transition-all ${
                        draft.optimizationGoal === item.value ? "bg-[#3B6CFF]/15 border-[#3B6CFF]/35 text-[#5AA9FF]" : "bg-white/[0.03] border-white/[0.07] text-white/45 hover:text-white/70"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="text-xs text-white/55 mb-2">投资方向</div>
                <div className="flex flex-wrap gap-2">
                  {focusThemes.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => updateDraft({ focusTheme: item.value })}
                      className={`h-8 px-3 rounded-lg text-xs border transition-all ${
                        draft.focusTheme === item.value ? "bg-[#00F0FF]/12 border-[#00F0FF]/30 text-[#00F0FF]" : "bg-white/[0.03] border-white/[0.06] text-white/50 hover:text-white/70"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="text-xs text-white/55 mb-2">基金大类</div>
                <div className="flex flex-wrap gap-2">
                  {fundTypes.map((item) => {
                    const active = draft.preferredTypes.includes(item.value);
                    return (
                      <button
                        key={item.value}
                        onClick={() => toggleType(item.value)}
                        className={`h-8 px-3 rounded-lg text-xs border flex items-center gap-1.5 transition-all ${
                          active ? "bg-white/[0.08] border-white/[0.16] text-white" : "bg-white/[0.02] border-white/[0.06] text-white/55"
                        }`}
                      >
                        {active && <Check className="w-3 h-3" />}{item.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <button
                onClick={applySettings}
                disabled={!pendingChanges || !canGenerate}
                className="w-full h-11 rounded-lg bg-gradient-to-r from-[#3B6CFF] to-[#2A52CC] text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-4 h-4" />生成组合
              </button>
              {!canGenerate && <div className="text-xs text-[#FFB800]">请至少纳入一个产品池，或手工添加一只基金。</div>}
            </div>
          </aside>

          <main className="min-w-0">
            {isLoading || isFetching ? <LoadingScreen /> : !activePlan ? (
              <div className="liquid-glass p-8 text-center text-white/45">当前产品池暂无可配置产品，请调整来源、指定产品或基金大类。</div>
            ) : (
              <div className="space-y-4 md:space-y-6">
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {recommendations.map((rec: any) => {
                    const active = activePlan.id === rec.id;
                    return (
                      <button
                        key={rec.id}
                        onClick={() => setActivePlanId(rec.id)}
                        className={`rounded-lg border p-4 text-left transition-all ${
                          active ? "bg-[#3B6CFF]/14 border-[#3B6CFF]/35" : "bg-white/[0.025] border-white/[0.06] hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-white font-medium">{rec.name}</div>
                            <div className="mt-1 text-xs text-white/38 leading-relaxed">{rec.description}</div>
                          </div>
                          <div className="text-right">
                            <div className="data-number text-sm" style={{ color: active ? ACCENT_INFO : "rgba(255,255,255,0.38)" }}>{rec.score}</div>
                            <div className="text-[10px] text-white/50">综合分</div>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                          <div>
                            <div className="text-[10px] text-white/50">年化</div>
                            <div className={`data-number text-sm ${getChangeTextClass(rec.expectedReturn)}`}>{Number(rec.expectedReturn) >= 0 ? "+" : ""}{rec.expectedReturn}%</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-white/50">回撤</div>
                            <div className="data-number text-sm" style={{ color: RISK_COLOR }}>{rec.expectedRisk}%</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-white/50">夏普</div>
                            <div className="data-number text-sm" style={{ color: POSITIVE_METRIC_COLOR }}>{rec.sharpe}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </section>

                <section className="liquid-glass p-4 md:p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_0.75fr] gap-5">
                    <div>
                      <div className="flex items-center gap-2 text-white/45 text-xs mb-2">
                        <PieChart className="w-4 h-4" style={{ color: ACCENT_INFO }} />
                        当前组合
                      </div>
                      <h2 className="text-2xl md:text-3xl text-white font-medium">{activePlan.name}</h2>
                      <p className="mt-2 text-sm text-white/48 leading-relaxed">{activePlan.rationale}</p>
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {activePlan.tags?.map((tag: string) => (
                          <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium border" style={{ background: `${ACCENT_PRIMARY}1A`, color: ACCENT_INFO, borderColor: `${ACCENT_PRIMARY}33` }}>{tag}</span>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="text-sm text-white/70">资金分布</div>
                        <div className="text-xs text-white/55 data-number">{yuan(applied.amount)}</div>
                      </div>
                      <div className="flex items-center gap-1 h-3 rounded-full overflow-hidden bg-white/[0.04]">
                        {allocations.map((fd: any, index: number) => (
                          <div
                            key={`${fd.fund?.fundCode || fd.fundId}-${index}`}
                            className="h-full transition-all"
                            style={{ width: `${(fd.weight / totalWeight) * 100}%`, backgroundColor: barColors[index % barColors.length] }}
                          />
                        ))}
                      </div>
                      <div className="mt-3 space-y-2">
                        {allocations.map((fd: any, index: number) => (
                          <div key={`${fd.fund?.fundCode || fd.fundId}-mini`} className="flex items-center justify-between gap-2 text-xs">
                            <div className="min-w-0 flex items-center gap-2 text-white/55">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: barColors[index % barColors.length] }} />
                              <span className="truncate">{fd.role}</span>
                            </div>
                            <span className="data-number text-white/75">{fd.weight}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 my-5">
                    <MetricTile label="预估年化" value={`${Number(activePlan.expectedReturn) >= 0 ? "+" : ""}${activePlan.expectedReturn}`} suffix="%" color={UP_COLOR} />
                    <MetricTile label="组合回撤" value={activePlan.expectedRisk} suffix="%" color={RISK_COLOR} />
                    <MetricTile label="估算波动" value={activePlan.volatility} suffix="%" color={ACCENT_INFO} />
                    <MetricTile label="夏普" value={activePlan.sharpe} color={POSITIVE_METRIC_COLOR} />
                    <MetricTile label="CVaR95" value={activePlan.cvar95} suffix="%" color={ACCENT_HIGHLIGHT} />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <PanelTitle icon={Gauge} title="约束检查" />
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {activePlan.constraints?.map((item: any) => (
                          <div key={item.label} className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm text-white/65">
                              <span className={`w-2 h-2 rounded-full ${item.passed ? "bg-[#16C784]" : "bg-[#FFB800]"}`} />
                              {item.label}
                            </div>
                            <span className="data-number text-xs text-white/45">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <PanelTitle icon={Zap} title="压力情景" />
                      <div className="mt-3 space-y-2">
                        {activePlan.stressTests?.map((item: any) => (
                          <div key={item.label} className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm text-white/65">{item.label}</span>
                              <span className="data-number text-sm" style={{ color: RISK_COLOR }}>{item.loss}%</span>
                            </div>
                            <div className="mt-1 text-[11px] text-white/55 leading-relaxed">{item.note}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="liquid-glass p-4 md:p-6">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <PanelTitle icon={Layers3} title="产品明细" />
                    <span className="text-xs text-white/55">配置金额 {yuan(applied.amount)}</span>
                  </div>

                  <div className="space-y-2">
                    {allocations.map((fd: any, index: number) => {
                      const fund = fd.fund || {};
                      const code = String(fund.fundCode || fd.fundId || index);
                      const expanded = expandedFundCode === code;
                      const perf = fund.performance || {};
                      return (
                        <div key={code} className="rounded-lg border border-white/[0.06] bg-white/[0.025] overflow-hidden">
                          <button
                            onClick={() => setExpandedFundCode(expanded ? null : code)}
                            className="w-full grid grid-cols-[1fr_auto] md:grid-cols-[1fr_72px_92px_92px_96px] gap-3 items-center p-3 text-left hover:bg-white/[0.035] transition-colors"
                          >
                            <div className="min-w-0 flex items-center gap-3">
                              <div className="w-2.5 h-10 rounded-full shrink-0" style={{ backgroundColor: barColors[index % barColors.length] }} />
                              <div className="min-w-0">
                                <div className="text-white text-sm truncate">{fund.fundAbbr || fund.fundName}</div>
                                <div className="text-white/55 text-xs data-number truncate">{fund.fundCode} · {fund.category} · {fd.role}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="data-number text-white text-sm">{fd.weight}%</div>
                              <div className="data-number text-white/55 text-xs">{yuan(applied.amount * fd.weight / 100)}</div>
                            </div>
                            <div className={`hidden md:block data-number text-sm ${getChangeTextClass(perf?.return1y)}`}>
                              {metricValue(perf?.return1y) >= 0 ? "+" : ""}{metricValue(perf?.return1y).toFixed(2)}%
                            </div>
                            <div className="hidden md:block data-number text-sm" style={{ color: RISK_COLOR }}>
                              {metricText(perf?.maxDrawdown)}{metricText(perf?.maxDrawdown) === "—" ? "" : "%"}
                            </div>
                            <div className="hidden md:flex items-center justify-end gap-2">
                              <span className="data-number text-sm" style={{ color: POSITIVE_METRIC_COLOR }}>{metricValue(perf?.sharpeRatio).toFixed(2)}</span>
                              <ArrowRight className={`w-4 h-4 text-white/50 transition-transform ${expanded ? "rotate-90" : ""}`} />
                            </div>
                          </button>
                          {expanded && (
                            <div className="border-t border-white/[0.05] px-3 py-3">
                              <div className="grid grid-cols-3 gap-2 md:hidden mb-3">
                                <MetricTile label="近1年" value={`${metricValue(perf?.return1y) >= 0 ? "+" : ""}${metricValue(perf?.return1y).toFixed(2)}`} suffix="%" color={UP_COLOR} />
                                <MetricTile label="回撤" value={metricText(perf?.maxDrawdown)} suffix={metricText(perf?.maxDrawdown) === "—" ? "" : "%"} color={RISK_COLOR} />
                                <MetricTile label="夏普" value={metricValue(perf?.sharpeRatio).toFixed(2)} color={POSITIVE_METRIC_COLOR} />
                              </div>
                              <p className="text-white/55 text-sm leading-relaxed">{fd.reason}</p>
                              <Link to={`/fund/${fund.fundCode || fd.fundId}`} state={{ from: "/recommend" }} className="mt-3 inline-flex items-center gap-1 text-sm" style={{ color: ACCENT_INFO }}>
                                查看基金详情 <ArrowRight className="w-3.5 h-3.5" />
                              </Link>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
