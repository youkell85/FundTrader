import { useMemo, useState } from "react";
import { Link } from "react-router";
import { TrendingUp, Search, BrainCircuit, User, ArrowRight, Loader2, PieChart, Activity, Shield } from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, PieChart as RePie, Pie, Cell, Tooltip as ReTooltip } from "recharts";
import { trpc } from "@/providers/trpc";
import {
  UP_COLOR,
  DOWN_COLOR,
  ACCENT_PRIMARY,
  ACCENT_INFO,
  ACCENT_HIGHLIGHT,
  POSITIVE_METRIC_COLOR,
  RISK_COLOR,
  getChangeTextClass,
} from "@/lib/colors";

const COLORS = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF", "#5AA9FF", "#7B9BFF", "#3B6CFF"];

function LoadingScreen({ text = "数据加载中..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-white/35">
      <Loader2 className="w-8 h-8 animate-spin mb-3" />
      <span className="text-sm">{text}</span>
    </div>
  );
}

function num(value: unknown): number | null {
  const parsed = parseFloat(String(value ?? "").replace("%", ""));
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

export default function Analysis() {
  const { data: listData, isLoading: listLoading } = trpc.fund.list.useQuery({ pageSize: 1000 });
  const { data: industryStatsData } = trpc.fund.industryStats.useQuery();
  const { data: overviewData } = trpc.fund.marketOverview.useQuery();

  const allFunds = listData?.funds ?? [];
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [searchManager, setSearchManager] = useState("");

  const { data: managerDetail } = trpc.fund.managerDetail.useQuery(
    { id: selectedManagerId! },
    { enabled: selectedManagerId != null }
  );

  const managers = useMemo(() => {
    const byId = new Map<number, any>();
    allFunds.forEach((fund: any) => {
      if (fund.manager?.id && !byId.has(fund.manager.id)) byId.set(fund.manager.id, fund.manager);
    });
    return Array.from(byId.values());
  }, [allFunds]);

  const filteredManagers = useMemo(() => {
    const keyword = searchManager.trim().toLowerCase();
    if (!keyword) return managers;
    return managers.filter((manager: any) => manager?.name?.toLowerCase().includes(keyword));
  }, [managers, searchManager]);

  const topFunds = useMemo(() => [...allFunds]
    .sort((a: any, b: any) => (num(b.performance?.return1y) ?? -999) - (num(a.performance?.return1y) ?? -999))
    .slice(0, 10), [allFunds]);

  const localOverview = useMemo(() => {
    const avgReturn = average(allFunds.map((fund: any) => num(fund.performance?.annualizedReturn ?? fund.performance?.return1y)));
    const avgSharpe = average(allFunds.map((fund: any) => num(fund.performance?.sharpeRatio)).filter((value) => value !== 0));
    const avgMaxDD = average(allFunds.map((fund: any) => num(fund.performance?.maxDrawdown)).filter((value) => value !== 0));
    return {
      totalFunds: allFunds.length,
      avgReturn,
      avgSharpe,
      avgMaxDD,
      marketingCount: allFunds.filter((fund: any) => fund.isXinjihui || fund.isContinuousMarketing).length,
    };
  }, [allFunds]);

  const overview = {
    totalFunds: overviewData?.totalFunds || localOverview.totalFunds,
    avgReturn: fmt(localOverview.avgReturn, 2, "%"),
    avgSharpe: fmt(localOverview.avgSharpe, 2),
    avgMaxDD: fmt(localOverview.avgMaxDD, 2, "%"),
    marketingCount: localOverview.marketingCount,
  };

  const distribution = useMemo(() => {
    if (Array.isArray(industryStatsData) && industryStatsData.length > 0) {
      return industryStatsData.map((item: any) => ({
        ...item,
        totalRatio: Number(item.totalRatio) || 0,
      }));
    }
    const groups = new Map<string, number>();
    allFunds.forEach((fund: any) => {
      const label = fund.category || fund.fundType || "其他";
      groups.set(label, (groups.get(label) || 0) + 1);
    });
    return Array.from(groups.entries())
      .map(([industry, count]) => ({ industry, totalRatio: allFunds.length ? Number(((count / allFunds.length) * 100).toFixed(2)) : 0 }))
      .sort((a, b) => b.totalRatio - a.totalRatio);
  }, [allFunds, industryStatsData]);

  const radarData = useMemo(() => {
    const funds = managerDetail?.funds || [];
    if (funds.length === 0) {
      return [
        { metric: "收益能力", value: 50, avg: 55 },
        { metric: "风控能力", value: 50, avg: 60 },
        { metric: "稳定性", value: 50, avg: 58 },
        { metric: "回撤修复", value: 50, avg: 56 },
        { metric: "规模适配", value: 50, avg: 60 },
      ];
    }
    const avgReturn1y = average(funds.map((fund: any) => num(fund.performance?.return1y))) ?? 0;
    const avgSharpe = average(funds.map((fund: any) => num(fund.performance?.sharpeRatio))) ?? 0;
    const avgMaxDD = average(funds.map((fund: any) => num(fund.performance?.maxDrawdown))) ?? 0;
    return [
      { metric: "收益能力", value: Math.min(100, Math.max(0, 50 + avgReturn1y / 4)), avg: 55 },
      { metric: "风控能力", value: Math.min(100, Math.max(0, 95 + avgMaxDD * 2)), avg: 60 },
      { metric: "稳定性", value: Math.min(100, Math.max(0, 50 + avgSharpe * 18)), avg: 58 },
      { metric: "回撤修复", value: Math.min(100, Math.max(0, 65 - Math.abs(avgMaxDD))), avg: 56 },
      { metric: "规模适配", value: 62, avg: 60 },
    ];
  }, [managerDetail]);

  const marketInsight = localOverview.avgReturn !== null
    ? `当前池内 ${overview.totalFunds} 只产品，平均年化/近一年收益约 ${overview.avgReturn}，平均最大回撤 ${overview.avgMaxDD}，夏普 ${overview.avgSharpe}。组合筛选宜先按大类分散，再用回撤、夏普和近一年表现交叉验证，避免只按收益排名追高。`
    : "当前市场概览数据仍在生成，建议先使用首页和基金详情页的单基金指标交叉查看。";

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-8 md:pt-12 pb-6 md:pb-8">
          <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight">深度分析中心</h1>
          <p className="mt-2 text-white/45 text-sm md:text-base">聚合基金经理、风险收益、配置分布和市场洞察，帮助快速缩小研究范围。</p>
        </div>

        {listLoading ? <LoadingScreen /> : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            <div className="lg:col-span-2 space-y-4 md:space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                {[
                  { label: "基金总数", value: overview.totalFunds, color: ACCENT_PRIMARY },
                  { label: "鑫基荟产品", value: overview.marketingCount, color: ACCENT_INFO },
                  { label: "平均年化/近1年", value: overview.avgReturn, color: (localOverview.avgReturn ?? 0) >= 0 ? UP_COLOR : DOWN_COLOR },
                  { label: "平均夏普", value: overview.avgSharpe, color: POSITIVE_METRIC_COLOR },
                ].map((item) => (
                  <div key={item.label} className="liquid-glass-sm p-3 md:p-4">
                    <div className="text-white/30 text-xs">{item.label}</div>
                    <div className="data-number text-lg md:text-xl font-medium mt-1" style={{ color: item.color }}>{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="liquid-glass p-4 md:p-6">
                <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" style={{ color: POSITIVE_METRIC_COLOR }} />收益排行（近1年）
                </h2>
                <div className="space-y-2">
                  {topFunds.map((fund: any, i: number) => {
                    const ret = num(fund.performance?.return1y) ?? 0;
                    const maxRet = Math.max(1, num(topFunds[0]?.performance?.return1y) ?? 1);
                    return (
                      <Link key={fund.id} to={`/${fund.fundCode}`}
                        className="grid grid-cols-[28px_1fr_80px] md:grid-cols-[28px_1fr_120px_80px] items-center gap-3 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.03] transition-all group px-2 rounded-lg">
                        <span className={`data-number text-xs text-center font-medium ${i === 0 ? "text-[#FFB800]" : i === 1 ? "text-[#C0C0C0]" : i === 2 ? "text-[#CD7F32]" : "text-white/30"}`}>{i + 1}</span>
                        <div className="min-w-0">
                          <div className="text-white text-sm truncate group-hover:text-[#5AA9FF] transition-colors">{fund.fundAbbr}</div>
                          <div className="text-white/30 text-xs truncate">{fund.manager?.name || "—"} · {fund.category}</div>
                        </div>
                        <div className="hidden md:block h-1.5 rounded-full bg-white/[0.03] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(0, (ret / maxRet) * 100)}%`, background: `linear-gradient(90deg, ${ACCENT_PRIMARY}, ${ACCENT_INFO})` }} />
                        </div>
                        <div className={`data-number text-sm font-medium text-right ${getChangeTextClass(ret)}`}>{ret >= 0 ? "+" : ""}{fund.performance?.return1y}%</div>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="liquid-glass p-4 md:p-6">
                <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <PieChart className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />行业/类型配置分布
                </h2>
                <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
                  <div className="w-44 h-44 md:w-52 md:h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <RePie>
                        <Pie data={distribution} cx="50%" cy="50%" innerRadius={48} outerRadius={82} paddingAngle={2} dataKey="totalRatio">
                          {distribution.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <ReTooltip
                          contentStyle={{ background: "rgba(5, 8, 26, 0.96)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }}
                          formatter={(value: any) => [`${Number(value).toFixed(2)}%`, "占比"]}
                        />
                      </RePie>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                    {distribution.slice(0, 10).map((item: any, i: number) => (
                      <div key={item.industry} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-white/55 text-xs flex-1 truncate">{item.industry}</span>
                        <span className="data-number text-white/70 text-xs">{item.totalRatio}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="liquid-glass p-4 md:p-6">
                <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <BrainCircuit className="w-5 h-5" style={{ color: ACCENT_INFO }} />AI 市场洞察
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2 liquid-glass-sm p-4">
                    <h3 className="text-sm mb-2" style={{ color: ACCENT_INFO }}>市场状态研判</h3>
                    <p className="text-white/60 text-sm leading-relaxed">{marketInsight}</p>
                  </div>
                  <div className="liquid-glass-sm p-4">
                    <h3 className="text-sm mb-2" style={{ color: POSITIVE_METRIC_COLOR }}>筛选建议</h3>
                    <p className="text-white/60 text-sm leading-relaxed">优先比较同类基金的三项指标：近一年收益、最大回撤、夏普。若夏普缺失，以净值曲线回撤和波动稳定性作为替代判断。</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4 md:space-y-6">
              <div className="liquid-glass p-4 md:p-5">
                <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <User className="w-5 h-5" style={{ color: ACCENT_HIGHLIGHT }} />基金经理分析
                </h2>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
                  <input type="text" value={searchManager} onChange={(e) => setSearchManager(e.target.value)}
                    placeholder="搜索基金经理..."
                    className="w-full h-9 pl-8 pr-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-xs placeholder:text-white/25 focus:outline-none focus:border-[#3B6CFF]/50" />
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {filteredManagers.map((manager: any) => (
                    <button key={manager.id} onClick={() => setSelectedManagerId(manager.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${selectedManagerId === manager.id ? "bg-[#3B6CFF]/15 text-[#00F0FF]" : "text-white/55 hover:bg-white/[0.03] hover:text-white/80"}`}>
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center text-white text-[10px] font-medium">{manager.name?.[0] ?? "?"}</div>
                      <span className="flex-1 text-left truncate">{manager.name ?? "未知"}</span>
                      <ArrowRight className="w-3 h-3 opacity-35" />
                    </button>
                  ))}
                </div>
              </div>

              {managerDetail && (
                <div className="liquid-glass p-4 md:p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center text-white font-semibold text-lg">{managerDetail.name?.[0] ?? "?"}</div>
                    <div>
                      <div className="text-white font-medium">{managerDetail.name ?? "未知"}</div>
                      <div className="text-white/35 text-xs">{managerDetail.company}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {[
                      { label: "管理年限", value: `${managerDetail.manageYears}年`, color: "white" },
                      { label: "在管规模", value: `${managerDetail.totalScale}亿`, color: "white" },
                      { label: "最佳年度", value: managerDetail.bestReturn ? `+${managerDetail.bestReturn}%` : "—", color: UP_COLOR },
                      { label: "最差年度", value: managerDetail.worstReturn ? `${managerDetail.worstReturn}%` : "—", color: DOWN_COLOR },
                    ].map((item) => (
                      <div key={item.label} className="liquid-glass-sm p-2 text-center">
                        <div className="text-white/28 text-[10px]">{item.label}</div>
                        <div className="data-number text-sm" style={{ color: item.color }}>{item.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mb-4 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
                    <div className="text-xs text-white/30 mb-2">履历与风格</div>
                    <div className="space-y-1.5 text-xs text-white/58 leading-relaxed">
                      <div>任职起点：<span className="data-number text-white/75">{managerDetail.careerStart || "—"}</span></div>
                      <div>投资风格：{managerDetail.investmentStyle || "暂无明确风格标签"}</div>
                      <div>投资理念：{managerDetail.philosophy || "暂无公开履历摘要，可结合在管基金表现继续观察。"}</div>
                    </div>
                  </div>

                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="rgba(255,255,255,0.06)" />
                        <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(255,255,255,0.38)", fontSize: 10 }} />
                        <PolarRadiusAxis tick={false} axisLine={false} />
                        <Radar name={managerDetail.name} dataKey="value" stroke="#00F0FF" fill="#00F0FF" fillOpacity={0.15} strokeWidth={1.5} />
                        <Radar name="同类平均" dataKey="avg" stroke="rgba(255,255,255,0.22)" fill="rgba(255,255,255,0.05)" strokeWidth={1} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>

                  {managerDetail.styleDescription && (
                    <div className="mt-4 liquid-glass-sm p-3">
                      <h3 className="text-xs mb-1 flex items-center gap-1" style={{ color: ACCENT_INFO }}><BrainCircuit className="w-3 h-3" />风格画像</h3>
                      <p className="text-white/58 text-xs leading-relaxed">{managerDetail.styleDescription}</p>
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-white/[0.06]">
                    <div className="text-xs text-white/30 mb-2">在管基金</div>
                    <div className="space-y-1.5">
                      {managerDetail.funds?.map((fund: any) => {
                        const ret = num(fund.performance?.return1y) ?? 0;
                        return (
                          <Link key={fund.id} to={`/${fund.fundCode}`}
                            className="grid grid-cols-[1fr_56px_56px] gap-2 items-center py-2 px-2 rounded hover:bg-white/[0.04] transition-all">
                            <span className="text-white/65 text-xs truncate">{fund.fundAbbr}</span>
                            <span className={`data-number text-xs text-right ${getChangeTextClass(ret)}`}>{ret >= 0 ? "+" : ""}{fund.performance?.return1y}%</span>
                            <span className="data-number text-xs text-right" style={{ color: RISK_COLOR }}>{fund.performance?.maxDrawdown ?? "—"}%</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="liquid-glass p-4 md:p-5">
                <h2 className="text-sm font-medium text-white/45 mb-3 flex items-center gap-2"><Activity className="w-4 h-4" />风险概览</h2>
                <div className="space-y-3">
                  {[
                    { label: "平均最大回撤", value: overview.avgMaxDD, color: RISK_COLOR },
                    { label: "平均夏普", value: overview.avgSharpe, color: POSITIVE_METRIC_COLOR },
                    { label: "数据覆盖", value: `${allFunds.length}只`, color: ACCENT_PRIMARY },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-white/35 text-xs">{item.label}</span>
                      <span className="data-number text-sm font-medium" style={{ color: item.color }}>{item.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2 text-xs text-white/45 leading-relaxed">
                  <Shield className="w-4 h-4 shrink-0 mt-0.5" style={{ color: ACCENT_INFO }} />
                  <span>若某基金夏普或回撤为空，说明当前摘要数据不足，需要进入详情页用净值历史重新计算。</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
