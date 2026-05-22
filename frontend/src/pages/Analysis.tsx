import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Activity, ArrowRight, BarChart3, BrainCircuit, Layers, Loader2, PieChart, Search, Shield, Target, TrendingUp, User } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RePie,
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

const COLORS = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF", "#5AA9FF", "#7B9BFF", "#3B6CFF"];

const typeLabels: Record<string, string> = {
  equity: "股票型",
  hybrid: "混合型",
  bond: "债券型",
  index: "指数型",
  qdii: "QDII",
  money: "货币型",
  fof: "FOF",
  reits: "REITs",
};

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-white/35">
      <Loader2 className="w-8 h-8 animate-spin mb-3" />
      <span className="text-sm">深度指标加载中...</span>
    </div>
  );
}

function num(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === "—") return null;
  const parsed = parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((item): item is number => item !== null && Number.isFinite(item));
  if (valid.length === 0) return null;
  return valid.reduce((sum, item) => sum + item, 0) / valid.length;
}

function fmt(value: number | null, digits = 2, suffix = "") {
  return value === null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function fundName(fund: any) {
  return fund?.fundAbbr || fund?.fundName || fund?.fundCode || "—";
}

function calcStats(funds: any[]) {
  const avgReturn = average(funds.map((fund) => num(fund.performance?.annualizedReturn ?? fund.performance?.return1y)));
  const avgReturn1y = average(funds.map((fund) => num(fund.performance?.return1y)));
  const avgSharpe = average(funds.map((fund) => num(fund.performance?.sharpeRatio)).filter((value) => value !== 0));
  const avgMaxDD = average(funds.map((fund) => num(fund.performance?.maxDrawdown)).filter((value) => value !== 0));
  const positiveCount = funds.filter((fund) => (num(fund.performance?.return1y) ?? -999) > 0).length;
  const riskCoverage = funds.filter((fund) => num(fund.performance?.sharpeRatio) !== null && num(fund.performance?.maxDrawdown) !== null).length;
  return {
    count: funds.length,
    avgReturn,
    avgReturn1y,
    avgSharpe,
    avgMaxDD,
    positiveRatio: funds.length ? positiveCount / funds.length * 100 : null,
    riskCoverage: funds.length ? riskCoverage / funds.length * 100 : null,
  };
}

function getTypeLabel(fund: any) {
  return typeLabels[fund.fundType] || fund.category || fund.fundType || "其他";
}

export default function Analysis() {
  const { data: listData, isLoading } = trpc.fund.list.useQuery(
    { pageSize: 1000 },
    { staleTime: 10 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const allFunds = listData?.funds ?? [];

  const [mode, setMode] = useState<"overall" | "type" | "manager" | "fund">("overall");
  const [selectedType, setSelectedType] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [selectedFundCode, setSelectedFundCode] = useState("");
  const [keyword, setKeyword] = useState("");

  const { data: managerDetail } = trpc.fund.managerDetail.useQuery(
    { id: selectedManagerId! },
    { enabled: mode === "manager" && selectedManagerId != null }
  );

  const typeGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    allFunds.forEach((fund: any) => {
      const label = getTypeLabel(fund);
      groups.set(label, [...(groups.get(label) || []), fund]);
    });
    return Array.from(groups.entries())
      .map(([label, funds]) => ({ label, funds, stats: calcStats(funds) }))
      .sort((a, b) => b.funds.length - a.funds.length);
  }, [allFunds]);

  const managers = useMemo(() => {
    const byId = new Map<number, any>();
    allFunds.forEach((fund: any) => {
      if (!fund.manager?.id) return;
      const existing = byId.get(fund.manager.id) || { ...fund.manager, funds: [] };
      existing.funds = [...existing.funds, fund];
      byId.set(fund.manager.id, existing);
    });
    return Array.from(byId.values())
      .map((manager: any) => ({ ...manager, stats: calcStats(manager.funds || []) }))
      .sort((a: any, b: any) => (b.stats.avgReturn1y ?? -999) - (a.stats.avgReturn1y ?? -999));
  }, [allFunds]);

  const filteredFundsForSearch = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return allFunds.slice(0, 40);
    return allFunds.filter((fund: any) => [
      fund.fundCode,
      fund.fundName,
      fund.fundAbbr,
      fund.manager?.name,
      fund.category,
    ].some((item) => String(item || "").toLowerCase().includes(key))).slice(0, 40);
  }, [allFunds, keyword]);

  const selectedFund = useMemo(() => {
    if (!selectedFundCode) return null;
    return allFunds.find((fund: any) => fund.fundCode === selectedFundCode) || null;
  }, [allFunds, selectedFundCode]);

  const scopeFunds = useMemo(() => {
    if (mode === "type" && selectedType) return typeGroups.find((group) => group.label === selectedType)?.funds || [];
    if (mode === "manager" && selectedManagerId != null) return allFunds.filter((fund: any) => fund.managerId === selectedManagerId);
    if (mode === "fund" && selectedFund) return [selectedFund];
    return allFunds;
  }, [allFunds, mode, selectedFund, selectedManagerId, selectedType, typeGroups]);

  const poolStats = useMemo(() => calcStats(allFunds), [allFunds]);
  const scopeStats = useMemo(() => calcStats(scopeFunds), [scopeFunds]);

  const typeDistribution = useMemo(() => typeGroups.map((group) => ({
    name: group.label,
    count: group.funds.length,
    ratio: allFunds.length ? Number((group.funds.length / allFunds.length * 100).toFixed(2)) : 0,
    avgReturn: group.stats.avgReturn1y ?? 0,
    avgSharpe: group.stats.avgSharpe ?? 0,
    avgMaxDD: Math.abs(group.stats.avgMaxDD ?? 0),
  })), [allFunds.length, typeGroups]);

  const radarData = useMemo(() => {
    const toScore = {
      return: (value: number | null) => Math.max(0, Math.min(100, 50 + (value ?? 0) * 1.2)),
      sharpe: (value: number | null) => Math.max(0, Math.min(100, 45 + (value ?? 0) * 20)),
      drawdown: (value: number | null) => Math.max(0, Math.min(100, 100 - Math.abs(value ?? 50) * 2)),
      coverage: (value: number | null) => Math.max(0, Math.min(100, value ?? 0)),
    };
    return [
      { metric: "收益", scope: toScore.return(scopeStats.avgReturn1y), pool: toScore.return(poolStats.avgReturn1y) },
      { metric: "年化", scope: toScore.return(scopeStats.avgReturn), pool: toScore.return(poolStats.avgReturn) },
      { metric: "夏普", scope: toScore.sharpe(scopeStats.avgSharpe), pool: toScore.sharpe(poolStats.avgSharpe) },
      { metric: "回撤", scope: toScore.drawdown(scopeStats.avgMaxDD), pool: toScore.drawdown(poolStats.avgMaxDD) },
      { metric: "覆盖", scope: toScore.coverage(scopeStats.riskCoverage), pool: toScore.coverage(poolStats.riskCoverage) },
    ];
  }, [poolStats, scopeStats]);

  const rankedFunds = useMemo(() => {
    const sorted = [...scopeFunds].sort((a: any, b: any) => {
      const scoreA = (num(a.performance?.return1y) ?? -999) + (num(a.performance?.sharpeRatio) ?? 0) * 8 - Math.abs(num(a.performance?.maxDrawdown) ?? 30) * 0.35;
      const scoreB = (num(b.performance?.return1y) ?? -999) + (num(b.performance?.sharpeRatio) ?? 0) * 8 - Math.abs(num(b.performance?.maxDrawdown) ?? 30) * 0.35;
      return scoreB - scoreA;
    });
    return {
      best: sorted.slice(0, 8),
      risk: [...scopeFunds]
        .sort((a: any, b: any) => Math.abs(num(b.performance?.maxDrawdown) ?? 0) - Math.abs(num(a.performance?.maxDrawdown) ?? 0))
        .slice(0, 6),
    };
  }, [scopeFunds]);

  const categoryLeader = typeDistribution
    .filter((item) => item.count >= 3)
    .sort((a, b) => b.avgReturn - a.avgReturn)[0];
  const riskLeader = typeDistribution
    .filter((item) => item.count >= 3 && item.avgMaxDD > 0)
    .sort((a, b) => a.avgMaxDD - b.avgMaxDD)[0];
  const topManager = managers[0];
  const scopeName = mode === "type" && selectedType
    ? selectedType
    : mode === "manager" && selectedManagerId != null
      ? managers.find((item: any) => item.id === selectedManagerId)?.name || "基金经理"
      : mode === "fund" && selectedFund
        ? fundName(selectedFund)
        : "鑫基荟全池";

  const insight = [
    `当前分析范围为${scopeName}，覆盖 ${scopeStats.count} 只产品，近一年平均收益 ${fmt(scopeStats.avgReturn1y, 2, "%")}，平均最大回撤 ${fmt(scopeStats.avgMaxDD, 2, "%")}，平均夏普 ${fmt(scopeStats.avgSharpe, 2)}。`,
    categoryLeader ? `${categoryLeader.name}在大类中近一年均值更突出，样本 ${categoryLeader.count} 只，均值 ${categoryLeader.avgReturn.toFixed(2)}%。` : "",
    riskLeader ? `${riskLeader.name}当前回撤均值相对更稳，平均最大回撤约 -${riskLeader.avgMaxDD.toFixed(2)}%。` : "",
    topManager ? `基金经理维度中，${topManager.name} 近一年在管产品均值 ${fmt(topManager.stats.avgReturn1y, 2, "%")}，可结合其在管数量和回撤继续筛选。` : "",
  ].filter(Boolean).join("");

  if (isLoading) return <LoadingScreen />;

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-8 md:pt-12 pb-5 md:pb-7">
          <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight">鑫基荟深度分析</h1>
          <p className="mt-2 text-white/45 text-sm md:text-base">按全池、子类别、单只基金和基金经理拆解收益、风险、配置与履职表现。</p>
        </div>

        <div className="liquid-glass p-3 md:p-4 mb-4 md:mb-6">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <div className="flex gap-2 flex-wrap">
              {[
                { key: "overall", label: "全池", icon: Layers },
                { key: "type", label: "子类别", icon: PieChart },
                { key: "fund", label: "单只基金", icon: Target },
                { key: "manager", label: "基金经理", icon: User },
              ].map((item) => {
                const Icon = item.icon;
                const active = mode === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setMode(item.key as any)}
                    className={`h-9 px-3 rounded-lg border text-xs flex items-center gap-1.5 transition-all ${
                      active ? "bg-[#3B6CFF]/18 border-[#3B6CFF]/35 text-[#00F0FF]" : "bg-white/[0.03] border-white/[0.07] text-white/45 hover:text-white/75"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />{item.label}
                  </button>
                );
              })}
            </div>

            {mode === "type" && (
              <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}
                className="h-9 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-xs focus:outline-none focus:border-[#3B6CFF]/50">
                <option value="">全部类别</option>
                {typeGroups.map((group) => <option key={group.label} value={group.label}>{group.label}</option>)}
              </select>
            )}

            {mode === "manager" && (
              <select value={selectedManagerId ?? ""} onChange={(e) => setSelectedManagerId(e.target.value ? Number(e.target.value) : null)}
                className="h-9 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-xs focus:outline-none focus:border-[#3B6CFF]/50">
                <option value="">选择基金经理</option>
                {managers.slice(0, 80).map((manager: any) => <option key={manager.id} value={manager.id}>{manager.name} · {manager.funds.length}只</option>)}
              </select>
            )}

            {mode === "fund" && (
              <div className="relative w-full lg:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
                <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索基金名称或代码"
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-xs placeholder:text-white/25 focus:outline-none focus:border-[#3B6CFF]/50" />
                <div className="mt-2 grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
                  {filteredFundsForSearch.slice(0, keyword ? 12 : 4).map((fund: any) => (
                    <button key={fund.fundCode} onClick={() => { setSelectedFundCode(fund.fundCode); setKeyword(fundName(fund)); }}
                      className={`text-left px-2 py-1.5 rounded text-xs transition-all ${selectedFundCode === fund.fundCode ? "bg-[#3B6CFF]/18 text-[#00F0FF]" : "text-white/55 hover:bg-white/[0.04]"}`}>
                      {fundName(fund)} <span className="data-number text-white/30">{fund.fundCode}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 mb-4 md:mb-6">
          {[
            { label: "样本数量", value: scopeStats.count, suffix: "只", color: ACCENT_PRIMARY },
            { label: "近1年均值", value: fmt(scopeStats.avgReturn1y, 2), suffix: scopeStats.avgReturn1y == null ? "" : "%", color: (scopeStats.avgReturn1y ?? 0) >= 0 ? UP_COLOR : DOWN_COLOR },
            { label: "平均夏普", value: fmt(scopeStats.avgSharpe, 2), suffix: "", color: POSITIVE_METRIC_COLOR },
            { label: "平均回撤", value: fmt(scopeStats.avgMaxDD, 2), suffix: scopeStats.avgMaxDD == null ? "" : "%", color: RISK_COLOR },
            { label: "风险覆盖", value: fmt(scopeStats.riskCoverage, 0), suffix: scopeStats.riskCoverage == null ? "" : "%", color: ACCENT_INFO },
          ].map((item) => (
            <div key={item.label} className="liquid-glass-sm p-3 md:p-4">
              <div className="text-white/30 text-xs">{item.label}</div>
              <div className="data-number text-lg md:text-xl font-medium mt-1" style={{ color: item.color }}>{item.value}<span className="text-xs text-white/35 ml-0.5">{item.suffix}</span></div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-6">
          <div className="xl:col-span-2 space-y-4 md:space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <section className="liquid-glass p-4 md:p-5">
                <h2 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5" style={{ color: ACCENT_INFO }} />多维能力雷达
                </h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="rgba(255,255,255,0.06)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(255,255,255,0.42)", fontSize: 11 }} />
                      <PolarRadiusAxis tick={false} axisLine={false} />
                      <Radar name={scopeName} dataKey="scope" stroke={ACCENT_INFO} fill={ACCENT_INFO} fillOpacity={0.18} strokeWidth={1.5} />
                      <Radar name="全池" dataKey="pool" stroke="rgba(255,255,255,0.26)" fill="rgba(255,255,255,0.05)" strokeWidth={1} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="liquid-glass p-4 md:p-5">
                <h2 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                  <PieChart className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />类型配置分布
                </h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePie>
                      <Pie data={typeDistribution} cx="50%" cy="50%" innerRadius={58} outerRadius={92} paddingAngle={2} dataKey="ratio" nameKey="name">
                        {typeDistribution.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                      </Pie>
                      <ReTooltip
                        contentStyle={{ background: "rgba(5,8,26,0.96)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }}
                        formatter={(value: any) => [`${Number(value).toFixed(2)}%`, "占比"]}
                      />
                    </RePie>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5" style={{ color: POSITIVE_METRIC_COLOR }} />子类别收益与回撤
              </h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={typeDistribution.filter((item) => item.count > 0).slice(0, 8)}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.38)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <ReTooltip contentStyle={{ background: "rgba(5,8,26,0.96)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }} />
                    <Bar dataKey="avgReturn" name="近1年均值" fill={UP_COLOR} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="avgMaxDD" name="平均回撤绝对值" fill={RISK_COLOR} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" style={{ color: ACCENT_HIGHLIGHT }} />范围内优选与风险观察
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-white/35 mb-2">综合得分靠前</div>
                  <div className="space-y-1.5">
                    {rankedFunds.best.map((fund: any, index: number) => {
                      const ret = num(fund.performance?.return1y) ?? 0;
                      return (
                        <Link key={fund.fundCode} to={`/${fund.fundCode}`} className="grid grid-cols-[24px_1fr_64px_54px] gap-2 items-center rounded-lg px-2 py-2 hover:bg-white/[0.04] transition-all">
                          <span className="data-number text-xs text-white/35">{index + 1}</span>
                          <span className="text-white/75 text-xs truncate">{fundName(fund)}</span>
                          <span className={`data-number text-xs text-right ${getChangeTextClass(ret)}`}>{ret >= 0 ? "+" : ""}{fund.performance?.return1y}%</span>
                          <span className="data-number text-xs text-right" style={{ color: POSITIVE_METRIC_COLOR }}>{fund.performance?.sharpeRatio ?? "—"}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/35 mb-2">回撤风险靠前</div>
                  <div className="space-y-1.5">
                    {rankedFunds.risk.map((fund: any, index: number) => (
                      <Link key={fund.fundCode} to={`/${fund.fundCode}`} className="grid grid-cols-[24px_1fr_64px_54px] gap-2 items-center rounded-lg px-2 py-2 hover:bg-white/[0.04] transition-all">
                        <span className="data-number text-xs text-white/35">{index + 1}</span>
                        <span className="text-white/75 text-xs truncate">{fundName(fund)}</span>
                        <span className="data-number text-xs text-right" style={{ color: RISK_COLOR }}>{fund.performance?.maxDrawdown ?? "—"}%</span>
                        <span className="data-number text-xs text-right text-white/35">{fund.performance?.return1y ?? "—"}%</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-4 md:space-y-6">
            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-3 flex items-center gap-2">
                <BrainCircuit className="w-5 h-5" style={{ color: ACCENT_INFO }} />分析结论
              </h2>
              <p className="text-white/62 text-sm leading-relaxed">{insight}</p>
            </section>

            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-3 flex items-center gap-2">
                <User className="w-5 h-5" style={{ color: ACCENT_HIGHLIGHT }} />基金经理履职
              </h2>
              {managerDetail ? (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center text-white font-semibold">{managerDetail.name?.[0] ?? "?"}</div>
                    <div className="min-w-0">
                      <div className="text-white font-medium truncate">{managerDetail.name ?? "未知"}</div>
                      <div className="text-white/35 text-xs truncate">{managerDetail.company || "—"}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[
                      { label: "管理年限", value: `${managerDetail.manageYears ?? "—"}年` },
                      { label: "在管数量", value: `${managerDetail.fundCount ?? managerDetail.funds?.length ?? 0}只` },
                      { label: "近1年均值", value: `${managerDetail.avgReturn1y ?? "—"}%` },
                      { label: "平均回撤", value: `${managerDetail.avgMaxDrawdown ?? "—"}%` },
                    ].map((item) => (
                      <div key={item.label} className="liquid-glass-sm p-2 text-center">
                        <div className="text-white/28 text-[10px]">{item.label}</div>
                        <div className="data-number text-sm text-white/80">{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-xs text-white/58 leading-relaxed">
                    <div>任职起点：<span className="data-number text-white/78">{managerDetail.careerStart || "—"}</span></div>
                    <div>投资风格：{managerDetail.investmentStyle || "暂无明确风格标签"}</div>
                    <div>代表产品：{managerDetail.funds?.slice(0, 3).map((fund: any) => fundName(fund)).join("、") || "—"}</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {managers.slice(0, 8).map((manager: any, index: number) => (
                    <button key={manager.id} onClick={() => { setMode("manager"); setSelectedManagerId(manager.id); }}
                      className="w-full grid grid-cols-[24px_1fr_58px_46px] gap-2 items-center rounded-lg px-2 py-2 text-left hover:bg-white/[0.04] transition-all">
                      <span className="data-number text-xs text-white/35">{index + 1}</span>
                      <span className="text-white/72 text-xs truncate">{manager.name}</span>
                      <span className={`data-number text-xs text-right ${getChangeTextClass(manager.stats.avgReturn1y ?? 0)}`}>{fmt(manager.stats.avgReturn1y, 1, "%")}</span>
                      <span className="data-number text-xs text-right" style={{ color: POSITIVE_METRIC_COLOR }}>{fmt(manager.stats.avgSharpe, 2)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-3 flex items-center gap-2">
                <Shield className="w-5 h-5" style={{ color: RISK_COLOR }} />风险提示
              </h2>
              <div className="space-y-3 text-sm text-white/58 leading-relaxed">
                <p>当前范围内正收益产品占比 {fmt(scopeStats.positiveRatio, 0, "%")}，风险指标覆盖率 {fmt(scopeStats.riskCoverage, 0, "%")}。</p>
                <p>若单只基金收益高但回撤同步放大，应优先与同类别均值比较，避免只按收益排序追高。</p>
              </div>
            </section>

            <section className="liquid-glass p-4 md:p-5">
              <h2 className="text-base font-medium text-white mb-3 flex items-center gap-2">
                <Target className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />快速入口
              </h2>
              <div className="space-y-2">
                {(selectedFund ? [selectedFund] : rankedFunds.best.slice(0, 4)).map((fund: any) => (
                  <Link key={fund.fundCode} to={`/${fund.fundCode}`} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 hover:bg-white/[0.06] transition-all">
                    <span className="text-white/70 text-xs truncate">{fundName(fund)}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-white/25" />
                  </Link>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
