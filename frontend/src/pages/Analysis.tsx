import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  ChevronDown,
  Layers,
  Loader2,
  PieChart,
  Shield,
  TrendingUp,
  User,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RePieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/providers/trpc";
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

const COLORS = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF", "#5AA9FF", "#7B9BFF", "#22C55E"];

const typeLabels: Record<string, string> = {
  equity: "股票型",
  hybrid: "混合型",
  bond: "债券型",
  index: "指数型",
  qdii: "QDII",
  money: "货币型",
  fof: "FOF",
  reits: "REITs",
  other: "其他",
};

function num(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === "—" || value === "鈥?") return null;
  const parsed = parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function fmt(value: number | null | undefined, digits = 2, suffix = "") {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function fundName(fund: any) {
  return fund?.fundAbbr || fund?.fundName || fund?.fundCode || "—";
}

function typeName(fund: any) {
  return typeLabels[fund?.fundType] || fund?.category || fund?.fundType || "其他";
}

function metric(fund: any, key: "annualizedReturn" | "return1y" | "sharpeRatio" | "maxDrawdown") {
  const perf = fund?.performance || {};
  if (key === "annualizedReturn") return num(perf.annualizedReturn ?? perf.return1y);
  return num(perf[key]);
}

function formatDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || raw === "2010-01-01" || raw === "—") return "待补充";
  const normalized = raw.replace(/[./]/g, "-");
  const match = normalized.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw;
}

function calcStats(funds: any[]) {
  const avgAnnual = average(funds.map((fund) => metric(fund, "annualizedReturn")).filter((value) => value !== 0));
  const avgReturn1y = average(funds.map((fund) => metric(fund, "return1y")));
  const avgSharpe = average(funds.map((fund) => metric(fund, "sharpeRatio")).filter((value) => value !== 0));
  const avgMaxDD = average(funds.map((fund) => metric(fund, "maxDrawdown")).filter((value) => value !== 0));
  const positiveCount = funds.filter((fund) => (metric(fund, "return1y") ?? -999) > 0).length;
  const riskCoverage = funds.filter((fund) => metric(fund, "sharpeRatio") !== null && metric(fund, "maxDrawdown") !== null).length;
  return {
    count: funds.length,
    avgAnnual,
    avgReturn1y,
    avgSharpe,
    avgMaxDD,
    positiveRatio: funds.length ? positiveCount / funds.length * 100 : null,
    riskCoverage: funds.length ? riskCoverage / funds.length * 100 : null,
  };
}

function buildGroups(funds: any[]) {
  const groups = new Map<string, any[]>();
  funds.forEach((fund) => {
    const label = typeName(fund);
    groups.set(label, [...(groups.get(label) || []), fund]);
  });
  return Array.from(groups.entries())
    .map(([label, groupFunds]) => ({ label, funds: groupFunds, stats: calcStats(groupFunds) }))
    .sort((a, b) => b.funds.length - a.funds.length);
}

function scoreFund(fund: any) {
  const annual = metric(fund, "annualizedReturn") ?? metric(fund, "return1y") ?? -999;
  const sharpe = metric(fund, "sharpeRatio") ?? 0;
  const maxDD = Math.abs(metric(fund, "maxDrawdown") ?? 35);
  return annual + sharpe * 8 - maxDD * 0.35;
}

function typeDistribution(groups: ReturnType<typeof buildGroups>, total: number) {
  return groups.map((group) => ({
    name: group.label,
    count: group.funds.length,
    ratio: total ? Number((group.funds.length / total * 100).toFixed(2)) : 0,
    avgReturn: group.stats.avgReturn1y ?? 0,
    avgAnnual: group.stats.avgAnnual ?? group.stats.avgReturn1y ?? 0,
    avgSharpe: group.stats.avgSharpe ?? 0,
    avgMaxDD: Math.abs(group.stats.avgMaxDD ?? 0),
    coverage: group.stats.riskCoverage ?? 0,
  }));
}

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-white/35">
      <Loader2 className="w-8 h-8 animate-spin mb-3" />
      <span className="text-sm">正在加载深度指标...</span>
    </div>
  );
}

function DistributionTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="rounded-lg border border-white/[0.08] bg-[#05081A]/95 px-3 py-2 text-xs shadow-xl">
      <div className="text-white/85 font-medium mb-1">{item.name}</div>
      <div className="text-white/50">数量：<span className="data-number text-white/80">{item.count} 只</span></div>
      <div className="text-white/50">占比：<span className="data-number text-white/80">{item.ratio.toFixed(2)}%</span></div>
      <div className="text-white/50">近1年均值：<span className="data-number" style={{ color: item.avgReturn >= 0 ? UP_COLOR : DOWN_COLOR }}>{item.avgReturn.toFixed(2)}%</span></div>
      <div className="text-white/50">平均回撤：<span className="data-number" style={{ color: RISK_COLOR }}>{item.avgMaxDD.toFixed(2)}%</span></div>
    </div>
  );
}

type Mode = "overall" | "type" | "manager";

export default function Analysis() {
  const { data: listData, isLoading } = trpc.fund.list.useQuery(
    { pageSize: 1000, withMetrics: true },
    { staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const allFunds = listData?.funds ?? [];

  const [mode, setMode] = useState<Mode>("overall");
  const [selectedType, setSelectedType] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [openPicker, setOpenPicker] = useState<"type" | "manager" | null>(null);

  const groups = useMemo(() => buildGroups(allFunds), [allFunds]);
  const managers = useMemo(() => {
    const byId = new Map<number, any>();
    allFunds.forEach((fund: any) => {
      if (!fund.manager?.id) return;
      const current = byId.get(fund.manager.id) || { ...fund.manager, funds: [] };
      current.funds = [...current.funds, fund];
      byId.set(fund.manager.id, current);
    });
    return Array.from(byId.values()).map((manager: any) => {
      const company = manager.company && manager.company !== "—"
        ? manager.company
        : manager.funds.find((fund: any) => fund.company && fund.company !== "—")?.company || "基金公司待补充";
      return { ...manager, company, stats: calcStats(manager.funds || []) };
    }).sort((a: any, b: any) => (b.stats.avgReturn1y ?? -999) - (a.stats.avgReturn1y ?? -999));
  }, [allFunds]);

  const { data: managerDetail } = trpc.fund.managerDetail.useQuery(
    { id: selectedManagerId! },
    { enabled: mode === "manager" && selectedManagerId != null }
  );

  const scopeFunds = useMemo(() => {
    if (mode === "type" && selectedType) return groups.find((group) => group.label === selectedType)?.funds || [];
    if (mode === "manager" && selectedManagerId != null) return allFunds.filter((fund: any) => fund.managerId === selectedManagerId);
    return allFunds;
  }, [allFunds, groups, mode, selectedManagerId, selectedType]);

  const poolStats = useMemo(() => calcStats(allFunds), [allFunds]);
  const scopeStats = useMemo(() => calcStats(scopeFunds), [scopeFunds]);
  const scopeGroups = useMemo(() => buildGroups(scopeFunds), [scopeFunds]);
  const distribution = useMemo(() => typeDistribution(mode === "overall" ? groups : scopeGroups, mode === "overall" ? allFunds.length : scopeFunds.length), [allFunds.length, groups, mode, scopeFunds.length, scopeGroups]);
  const diagnostics = useMemo(() => typeDistribution(groups, allFunds.length).filter((item) => item.count > 0).slice(0, 8), [allFunds.length, groups]);

  const scopeName = mode === "type" && selectedType
    ? selectedType
    : mode === "manager" && selectedManagerId
      ? managers.find((manager: any) => manager.id === selectedManagerId)?.name || "基金经理"
      : "鑫基荟全池";

  const radarRows = [
    { metric: "收益能力", raw: scopeStats.avgAnnual, suffix: "%", scope: Math.max(0, Math.min(100, 50 + (scopeStats.avgAnnual ?? 0) * 1.4)), pool: Math.max(0, Math.min(100, 50 + (poolStats.avgAnnual ?? 0) * 1.4)) },
    { metric: "抗风险性", raw: scopeStats.avgMaxDD, suffix: "%", scope: Math.max(0, Math.min(100, 100 - Math.abs(scopeStats.avgMaxDD ?? 45) * 2.2)), pool: Math.max(0, Math.min(100, 100 - Math.abs(poolStats.avgMaxDD ?? 45) * 2.2)) },
    { metric: "夏普质量", raw: scopeStats.avgSharpe, suffix: "", scope: Math.max(0, Math.min(100, 45 + (scopeStats.avgSharpe ?? 0) * 22)), pool: Math.max(0, Math.min(100, 45 + (poolStats.avgSharpe ?? 0) * 22)) },
    { metric: "正收益率", raw: scopeStats.positiveRatio, suffix: "%", scope: Math.max(0, Math.min(100, scopeStats.positiveRatio ?? 0)), pool: Math.max(0, Math.min(100, poolStats.positiveRatio ?? 0)) },
    { metric: "数据覆盖", raw: scopeStats.riskCoverage, suffix: "%", scope: Math.max(0, Math.min(100, scopeStats.riskCoverage ?? 0)), pool: Math.max(0, Math.min(100, poolStats.riskCoverage ?? 0)) },
  ];
  const radarData = radarRows.map((item) => ({ metric: item.metric, scope: item.scope, pool: item.pool }));

  const ranked = useMemo(() => {
    const sorted = [...scopeFunds].sort((a, b) => scoreFund(b) - scoreFund(a));
    return {
      best: sorted.slice(0, 8),
      risk: [...scopeFunds].sort((a, b) => Math.abs(metric(b, "maxDrawdown") ?? 0) - Math.abs(metric(a, "maxDrawdown") ?? 0)).slice(0, 6),
    };
  }, [scopeFunds]);

  const activeManager = managerDetail || (selectedManagerId != null ? managers.find((manager: any) => manager.id === selectedManagerId) : null);
  const bestCategory = diagnostics.filter((item) => item.count >= 3).sort((a, b) => b.avgReturn - a.avgReturn)[0];
  const stableCategory = diagnostics.filter((item) => item.avgMaxDD > 0).sort((a, b) => a.avgMaxDD - b.avgMaxDD)[0];
  const topManager = managers[0];

  const insight = [
    `${scopeName}覆盖 ${scopeStats.count} 只产品，近1年均值 ${fmt(scopeStats.avgReturn1y, 2, "%")}，年化均值 ${fmt(scopeStats.avgAnnual, 2, "%")}，平均夏普 ${fmt(scopeStats.avgSharpe, 2)}，平均最大回撤 ${fmt(scopeStats.avgMaxDD, 2, "%")}。`,
    bestCategory ? `子类别中 ${bestCategory.name} 的近1年均值较突出，样本 ${bestCategory.count} 只，均值 ${bestCategory.avgReturn.toFixed(2)}%。` : "",
    stableCategory ? `${stableCategory.name} 当前回撤均值相对更稳，平均最大回撤约 ${stableCategory.avgMaxDD.toFixed(2)}%。` : "",
    topManager ? `基金经理维度中，${topManager.name} 在管产品近1年均值 ${fmt(topManager.stats.avgReturn1y, 2, "%")}。` : "",
  ].filter(Boolean).join("");

  if (isLoading) return <LoadingScreen />;

  const modeButtons: Array<{ key: Mode; label: string; icon: any }> = [
    { key: "overall", label: "全池", icon: Layers },
    { key: "type", label: selectedType || "子类别", icon: PieChart },
    { key: "manager", label: activeManager?.name || "基金经理", icon: User },
  ];

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-8 md:pt-12 pb-5 md:pb-7">
          <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight">鑫基荟深度分析</h1>
          <p className="mt-2 text-white/45 text-sm md:text-base">按全池、子类别和基金经理拆解收益、回撤、夏普、分布和履职质量。</p>
        </div>

        <div className="liquid-glass p-3 md:p-4 mb-4 md:mb-6 overflow-visible relative z-[70]">
          <div className="flex flex-wrap gap-2 relative z-[80]">
            {modeButtons.map((item) => {
              const Icon = item.icon;
              const active = mode === item.key;
              const isPicker = item.key === "type" || item.key === "manager";
              return (
                <div key={item.key} className="relative">
                  <button
                    onClick={() => {
                      setMode(item.key);
                      setOpenPicker(isPicker ? (openPicker === item.key ? null : item.key as "type" | "manager") : null);
                    }}
                    className={`h-10 px-3 rounded-lg border text-xs flex items-center gap-1.5 transition-all ${active ? "bg-[#3B6CFF]/18 border-[#3B6CFF]/35 text-[#00F0FF]" : "bg-white/[0.03] border-white/[0.07] text-white/45 hover:text-white/75"}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="max-w-[120px] truncate">{item.label}</span>
                    {isPicker && <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openPicker === item.key ? "rotate-180" : ""}`} />}
                  </button>

                  {openPicker === "type" && item.key === "type" && (
                    <div className="absolute z-[90] left-0 top-12 w-64 max-h-80 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#070B18]/98 shadow-2xl p-2">
                      <button onClick={() => { setSelectedType(""); setOpenPicker(null); }} className="w-full text-left rounded-lg px-3 py-2 text-xs text-white/65 hover:bg-white/[0.06]">全部子类别</button>
                      {groups.map((group) => (
                        <button key={group.label} onClick={() => { setSelectedType(group.label); setOpenPicker(null); }} className="w-full text-left rounded-lg px-3 py-2 text-xs hover:bg-white/[0.06]">
                          <span className="text-white/80">{group.label}</span>
                          <span className="data-number float-right text-white/35">{group.funds.length} 只</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {openPicker === "manager" && item.key === "manager" && (
                    <div className="absolute z-[90] left-0 top-12 w-80 max-h-96 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#070B18]/98 shadow-2xl p-2">
                      <button onClick={() => { setSelectedManagerId(null); setOpenPicker(null); }} className="w-full text-left rounded-lg px-3 py-2 text-xs text-white/65 hover:bg-white/[0.06]">全部基金经理</button>
                      {managers.slice(0, 120).map((manager: any) => (
                        <button key={manager.id} onClick={() => { setSelectedManagerId(manager.id); setOpenPicker(null); }} className="w-full text-left rounded-lg px-3 py-2 hover:bg-white/[0.06]">
                          <span className="block text-white/80 text-xs truncate">{manager.name}</span>
                          <span className="block text-white/35 text-[10px] truncate">{manager.company} · {manager.funds.length} 只 · 近1年 {fmt(manager.stats.avgReturn1y, 1, "%")}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 mb-4 md:mb-6">
          {[
            { label: "样本数量", value: String(scopeStats.count), suffix: "只", color: ACCENT_PRIMARY },
            { label: "平均年化收益", value: fmt(scopeStats.avgAnnual, 2), suffix: scopeStats.avgAnnual == null ? "" : "%", color: (scopeStats.avgAnnual ?? 0) >= 0 ? UP_COLOR : DOWN_COLOR },
            { label: "近1年均值", value: fmt(scopeStats.avgReturn1y, 2), suffix: scopeStats.avgReturn1y == null ? "" : "%", color: (scopeStats.avgReturn1y ?? 0) >= 0 ? UP_COLOR : DOWN_COLOR },
            { label: "平均夏普比例", value: fmt(scopeStats.avgSharpe, 2), suffix: "", color: POSITIVE_METRIC_COLOR },
            { label: "平均最大回撤", value: fmt(scopeStats.avgMaxDD, 2), suffix: scopeStats.avgMaxDD == null ? "" : "%", color: RISK_COLOR },
          ].map((item) => (
            <div key={item.label} className="liquid-glass-sm p-3 md:p-4">
              <div className="text-white/30 text-xs">{item.label}</div>
              <div className="data-number text-lg md:text-xl font-medium mt-1" style={{ color: item.color }}>{item.value}<span className="text-xs text-white/35 ml-0.5">{item.suffix}</span></div>
            </div>
          ))}
        </div>

        <div className={`grid grid-cols-1 gap-4 md:gap-6 ${mode === "manager" ? "xl:grid-cols-[1fr_420px]" : "xl:grid-cols-3"}`}>
          <main className={`${mode === "manager" ? "" : "xl:col-span-2"} space-y-4 md:space-y-6`}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <section className="liquid-glass p-4 md:p-5">
                <h2 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5" style={{ color: ACCENT_INFO }} />多维能力雷达
                </h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="rgba(255,255,255,0.06)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(255,255,255,0.42)", fontSize: 11 }} />
                      <PolarRadiusAxis tick={false} axisLine={false} />
                      <Radar name={scopeName} dataKey="scope" stroke={ACCENT_INFO} fill={ACCENT_INFO} fillOpacity={0.18} strokeWidth={1.5} />
                      <Radar name="全池" dataKey="pool" stroke="rgba(255,255,255,0.28)" fill="rgba(255,255,255,0.05)" strokeWidth={1} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {radarRows.map((item) => (
                    <div key={item.metric} className="rounded-lg bg-white/[0.03] border border-white/[0.05] px-3 py-2">
                      <div className="text-white/30 text-[10px]">{item.metric}</div>
                      <div className="data-number text-sm text-white/80">{fmt(item.raw, item.metric.includes("率") || item.metric.includes("覆盖") ? 0 : 2, item.suffix)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="liquid-glass p-4 md:p-5">
                <h2 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                  <PieChart className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />类型配置分布
                </h2>
                {distribution.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4 items-center">
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <RePieChart>
                          <Pie data={distribution} cx="50%" cy="50%" innerRadius={42} outerRadius={72} paddingAngle={2} dataKey="ratio" nameKey="name">
                            {distribution.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                          </Pie>
                          <ReTooltip content={<DistributionTooltip />} />
                        </RePieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      {distribution.slice(0, 8).map((item, index) => (
                        <div key={item.name} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                          <span className="text-white/65 text-xs flex-1">{item.name}</span>
                          <span className="data-number text-white/80 text-xs">{item.count}只</span>
                          <span className="data-number text-white/45 text-xs">{item.ratio.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="py-16 text-center text-white/35 text-sm">暂无可用于配置分布的数据</div>
                )}
              </section>
            </div>

            {mode === "type" && (
              <section className="liquid-glass p-4 md:p-5">
                <h2 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" style={{ color: POSITIVE_METRIC_COLOR }} />子类别诊断排行
                </h2>
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={diagnostics} layout="vertical" margin={{ left: 14, right: 16, top: 4, bottom: 4 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                        <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.32)", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" width={70} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <ReTooltip contentStyle={{ background: "rgba(5,8,26,0.96)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }} formatter={(value: any, name: any) => [`${Number(value).toFixed(2)}${name === "平均夏普" ? "" : "%"}`, name]} />
                        <Bar dataKey="avgAnnual" name="平均年化" fill={ACCENT_PRIMARY} radius={[0, 4, 4, 0]} />
                        <Bar dataKey="avgSharpe" name="平均夏普" fill={POSITIVE_METRIC_COLOR} radius={[0, 4, 4, 0]} />
                        <Bar dataKey="avgMaxDD" name="回撤绝对值" fill={RISK_COLOR} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {diagnostics.slice(0, 6).map((item, index) => (
                      <button key={item.name} onClick={() => { setMode("type"); setSelectedType(item.name); }} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-left hover:bg-white/[0.06]">
                        <div className="flex items-center gap-2">
                          <span className="data-number text-white/35 text-xs">{index + 1}</span>
                          <span className="text-white/75 text-sm flex-1">{item.name}</span>
                          <span className="data-number text-white/35 text-xs">{item.count}只</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                          <span className="text-white/35">年化 <b className="data-number text-white/75">{item.avgAnnual.toFixed(1)}%</b></span>
                          <span className="text-white/35">回撤 <b className="data-number" style={{ color: RISK_COLOR }}>{item.avgMaxDD.toFixed(1)}%</b></span>
                          <span className="text-white/35">夏普 <b className="data-number" style={{ color: POSITIVE_METRIC_COLOR }}>{item.avgSharpe.toFixed(2)}</b></span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" style={{ color: ACCENT_HIGHLIGHT }} />范围内优选与风险观察
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-white/35 mb-2">综合表现靠前</div>
                  <div className="space-y-1.5">
                    {ranked.best.map((fund: any, index: number) => {
                      const ret = metric(fund, "annualizedReturn") ?? metric(fund, "return1y") ?? 0;
                      return (
                        <Link key={fund.fundCode} to={`/${fund.fundCode}`} className="grid grid-cols-[24px_1fr_64px_54px] gap-2 items-center rounded-lg px-2 py-2 hover:bg-white/[0.04] transition-all">
                          <span className="data-number text-xs text-white/35">{index + 1}</span>
                          <span className="text-white/75 text-xs truncate">{fundName(fund)}</span>
                          <span className={`data-number text-xs text-right ${getChangeTextClass(ret)}`}>{ret >= 0 ? "+" : ""}{ret.toFixed(2)}%</span>
                          <span className="data-number text-xs text-right" style={{ color: POSITIVE_METRIC_COLOR }}>{fmt(metric(fund, "sharpeRatio"), 2)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/35 mb-2">回撤风险靠前</div>
                  <div className="space-y-1.5">
                    {ranked.risk.map((fund: any, index: number) => (
                      <Link key={fund.fundCode} to={`/${fund.fundCode}`} className="grid grid-cols-[24px_1fr_64px_54px] gap-2 items-center rounded-lg px-2 py-2 hover:bg-white/[0.04] transition-all">
                        <span className="data-number text-xs text-white/35">{index + 1}</span>
                        <span className="text-white/75 text-xs truncate">{fundName(fund)}</span>
                        <span className="data-number text-xs text-right" style={{ color: RISK_COLOR }}>{fmt(metric(fund, "maxDrawdown"), 2, "%")}</span>
                        <span className="data-number text-xs text-right text-white/35">{fmt(metric(fund, "annualizedReturn"), 1, "%")}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {mode === "overall" && (
              <section className="liquid-glass p-4 md:p-5">
                <h2 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                  <User className="w-5 h-5" style={{ color: ACCENT_HIGHLIGHT }} />基金经理排行
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {managers.slice(0, 10).map((manager: any, index: number) => (
                    <button key={manager.id} onClick={() => { setMode("manager"); setSelectedManagerId(manager.id); }} className="grid grid-cols-[24px_1fr_68px_50px] gap-2 items-center rounded-lg px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] transition-all text-left">
                      <span className="data-number text-xs text-white/35">{index + 1}</span>
                      <span className="text-white/75 text-xs truncate">{manager.name}</span>
                      <span className={`data-number text-xs text-right ${getChangeTextClass(manager.stats.avgReturn1y ?? 0)}`}>{fmt(manager.stats.avgReturn1y, 1, "%")}</span>
                      <span className="data-number text-xs text-right" style={{ color: POSITIVE_METRIC_COLOR }}>{fmt(manager.stats.avgSharpe, 2)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </main>

          <aside className="space-y-4 md:space-y-6">
            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-3 flex items-center gap-2">
                <BrainCircuit className="w-5 h-5" style={{ color: ACCENT_INFO }} />分析结论
              </h2>
              <p className="text-white/62 text-sm leading-relaxed">{insight}</p>
            </section>

            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-3 flex items-center gap-2">
                <BriefcaseBusiness className="w-5 h-5" style={{ color: ACCENT_HIGHLIGHT }} />基金经理履职
              </h2>
              {activeManager ? (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center text-white font-semibold">{activeManager.name?.[0] ?? "?"}</div>
                    <div className="min-w-0">
                      <div className="text-white font-medium truncate">{activeManager.name ?? "未知"}</div>
                      <div className="text-white/35 text-xs truncate">{activeManager.company || "基金公司待补充"}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[
                      { label: "管理年限", value: `${activeManager.manageYears ?? "—"}年` },
                      { label: "在管数量", value: `${activeManager.fundCount ?? activeManager.funds?.length ?? 0}只` },
                      { label: "近1年均值", value: `${activeManager.avgReturn1y ?? activeManager.stats?.avgReturn1y?.toFixed?.(2) ?? "—"}%` },
                      { label: "平均回撤", value: `${activeManager.avgMaxDrawdown ?? activeManager.stats?.avgMaxDD?.toFixed?.(2) ?? "—"}%` },
                    ].map((item) => (
                      <div key={item.label} className="liquid-glass-sm p-2 text-center">
                        <div className="text-white/28 text-[10px]">{item.label}</div>
                        <div className="data-number text-sm text-white/80">{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-xs text-white/58 leading-relaxed">
                    <div>基金公司：<span className="text-white/78">{activeManager.company || "基金公司待补充"}</span></div>
                    <div>任职起点：<span className="data-number text-white/78">{formatDate(activeManager.careerStart)}</span></div>
                    <div>投资风格：{activeManager.investmentStyle || "暂无明确风格标签"}</div>
                    <div>代表产品：{activeManager.funds?.slice(0, 3).map((fund: any) => fundName(fund)).join("、") || "—"}</div>
                  </div>
                </div>
              ) : (
                <p className="text-white/45 text-sm leading-relaxed">点击“基金经理”并在附近下拉面板选择经理后，可查看基金公司、任职起点、在管产品、平均收益与回撤表现。</p>
              )}
            </section>

            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-3 flex items-center gap-2">
                <ArrowRight className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />快速入口
              </h2>
              <div className="space-y-2">
                {ranked.best.slice(0, 4).map((fund: any) => (
                  <Link key={fund.fundCode} to={`/${fund.fundCode}`} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 hover:bg-white/[0.06] transition-all">
                    <span className="text-white/70 text-xs truncate">{fundName(fund)}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-white/25" />
                  </Link>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <section className="liquid-glass p-4 md:p-5 mt-4 md:mt-6">
          <h2 className="text-base font-medium text-white mb-3 flex items-center gap-2">
            <Shield className="w-5 h-5" style={{ color: RISK_COLOR }} />风险提示
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-white/58 leading-relaxed">
            <p>当前范围内正收益产品占比 {fmt(scopeStats.positiveRatio, 0, "%")}，风险指标覆盖率 {fmt(scopeStats.riskCoverage, 0, "%")}。</p>
            <p>收益、夏普和回撤来自服务器融合层缓存；若个别产品仍缺少净值历史，会显示为“—”，不会用 0 冒充有效风险数据。</p>
            <p>高收益产品需同时观察最大回撤、波动和经理履职稳定性，避免只按短期收益做配置判断。</p>
          </div>
        </section>
      </div>
    </div>
  );
}
