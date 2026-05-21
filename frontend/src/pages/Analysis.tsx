import { useState, useMemo } from "react";
import { Link } from "react-router";
import { TrendingUp, Search, BrainCircuit, User, ArrowRight, Loader2 } from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, PieChart as RePie, Pie, Cell } from "recharts";
import { trpc } from "@/providers/trpc";
import {
  UP_COLOR,
  DOWN_COLOR,
  ACCENT_PRIMARY,
  ACCENT_INFO,
  ACCENT_HIGHLIGHT,
  POSITIVE_METRIC_COLOR,
  getChangeTextClass,
} from "@/lib/colors";

function LoadingScreen({ text = "数据加载中..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-white/30">
      <Loader2 className="w-8 h-8 animate-spin mb-3" />
      <span className="text-sm">{text}</span>
    </div>
  );
}

const COLORS = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF", "#5AA9FF", "#7B9BFF", "#3B6CFF"];

export default function Analysis() {
  const { data: listData, isLoading: listLoading } = trpc.fund.list.useQuery({ pageSize: 1000 });
  const { data: industryStatsData } = trpc.fund.industryStats.useQuery();
  const { data: overviewData } = trpc.fund.marketOverview.useQuery();

  const allFunds = listData?.funds ?? [];
  const industryStats = industryStatsData ?? [];
  const overview = overviewData ?? { totalFunds: 0, avgReturn: "0", avgSharpe: "0", avgMaxDD: "0", marketingCount: 0 };

  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [searchManager, setSearchManager] = useState("");

  const { data: managerDetail } = trpc.fund.managerDetail.useQuery(
    { id: selectedManagerId! },
    { enabled: selectedManagerId != null }
  );

  const managers = useMemo(() => {
    const mgrs = allFunds.map((f: any) => f.manager).filter(Boolean);
    return mgrs.filter((m: any, i: number, arr: any[]) => arr.findIndex((t: any) => t?.id === m?.id) === i);
  }, [allFunds]);

  const filteredManagers = managers.filter((m: any) => m?.name?.toLowerCase().includes(searchManager.toLowerCase()));

  const topFunds = useMemo(() => [...allFunds].sort(
    (a: any, b: any) => parseFloat(b.performance?.return1y || "0") - parseFloat(a.performance?.return1y || "0")
  ).slice(0, 10), [allFunds]);

  // 动态雷达图数据：从选中基金经理的在管基金业绩计算
  const radarData = useMemo(() => {
    if (!managerDetail?.funds || managerDetail.funds.length === 0) {
      return [
        { metric: "选股能力", value: 50, avg: 50 },
        { metric: "择时能力", value: 50, avg: 50 },
        { metric: "风控能力", value: 50, avg: 50 },
        { metric: "稳定性", value: 50, avg: 50 },
        { metric: "超额收益", value: 50, avg: 50 },
        { metric: "规模适应", value: 50, avg: 50 },
      ];
    }
    const funds = managerDetail.funds;
    const avgReturn1y = funds.reduce((s: number, f: any) => s + parseFloat(f.performance?.return1y || "0"), 0) / funds.length;
    const avgSharpe = funds.reduce((s: number, f: any) => s + parseFloat(f.performance?.sharpeRatio || "0"), 0) / funds.length;
    const avgMaxDD = funds.reduce((s: number, f: any) => s + parseFloat(f.performance?.maxDrawdown || "0"), 0) / funds.length;

    return [
      { metric: "选股能力", value: Math.min(100, Math.max(0, 50 + avgSharpe * 20)), avg: 50 },
      { metric: "择时能力", value: Math.min(100, Math.max(0, 50 + avgReturn1y / 5)), avg: 55 },
      { metric: "风控能力", value: Math.min(100, Math.max(0, 100 + avgMaxDD * 2)), avg: 65 },
      { metric: "稳定性", value: Math.min(100, Math.max(0, 50 + avgSharpe * 15)), avg: 70 },
      { metric: "超额收益", value: Math.min(100, Math.max(0, 50 + avgReturn1y / 4)), avg: 58 },
      { metric: "规模适应", value: Math.min(100, Math.max(0, 60 - Math.abs(avgMaxDD))), avg: 62 },
    ];
  }, [managerDetail]);

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-8 md:pt-12 pb-6 md:pb-8">
          <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight" style={{ letterSpacing: "-1.2px" }}>深度分析中心</h1>
          <p className="mt-2 text-white/40 text-sm md:text-base">多维度公募基金分析工具，洞察市场趋势与基金表现</p>
        </div>

        {listLoading ? <LoadingScreen /> : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            <div className="liquid-glass p-4 md:p-6">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" style={{ color: POSITIVE_METRIC_COLOR }} />收益排行榜 (近1年)
              </h2>
              <div className="space-y-2">
                {topFunds.map((f: any, i: number) => {
                  const ret = parseFloat(f.performance?.return1y || "0");
                  const maxRet = parseFloat(topFunds[0]?.performance?.return1y || "1");
                  return (
                    <Link key={f.id} to={`/${f.id}`}
                      className="flex items-center gap-3 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.03] transition-all group px-2 rounded-lg">
                      <span className={`data-number text-xs w-5 text-center font-medium ${i === 0 ? "text-[#FFB800]" : i === 1 ? "text-[#C0C0C0]" : i === 2 ? "text-[#CD7F32]" : "text-white/30"}`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm truncate group-hover:text-[#5AA9FF] transition-colors">{f.fundAbbr}</div>
                        <div className="text-white/30 text-xs">{f.manager?.name} · {f.category}</div>
                      </div>
                      <div className="w-24 h-1.5 rounded-full bg-white/[0.03] overflow-hidden mr-3">
                        <div className="h-full rounded-full" style={{ width: `${(ret / maxRet) * 100}%`, background: `linear-gradient(90deg, ${ACCENT_PRIMARY}, ${ACCENT_INFO})` }} />
                      </div>
                      <div className={`data-number text-sm font-medium ${getChangeTextClass(ret)}`}>{ret >= 0 ? "+" : ""}{f.performance?.return1y}%</div>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="liquid-glass p-4 md:p-6">
              <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />行业配置分布
              </h2>
              <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
                <div className="w-40 h-40 md:w-48 md:h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePie>
                      <Pie data={industryStats} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} dataKey="totalRatio">
                        {industryStats.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                    </RePie>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  {industryStats.slice(0, 8).map((ind: any, i: number) => (
                    <div key={ind.industry} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-white/40 text-xs">{ind.industry}</span>
                      <span className="data-number text-white/60 text-xs">{ind.totalRatio}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="liquid-glass p-4 md:p-6">
              <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                <BrainCircuit className="w-5 h-5" style={{ color: ACCENT_INFO }} />AI 市场洞察
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="liquid-glass-sm p-4">
                  <h3 className="text-sm mb-2" style={{ color: ACCENT_INFO }}>市场趋势研判</h3>
                  <p className="text-white/50 text-sm leading-relaxed">
                    {overview.totalFunds > 0
                      ? `当前基金池共 ${overview.totalFunds} 只产品，鑫基荟产品 ${overview.marketingCount} 只。市场平均年化收益 ${overview.avgReturn}%，平均夏普比率 ${overview.avgSharpe}。建议关注近1年收益率排名前20%的基金，结合行业配置分散风险。`
                      : "数据加载中，请稍候..."}
                  </p>
                </div>
                <div className="liquid-glass-sm p-4">
                  <h3 className="text-sm mb-2" style={{ color: POSITIVE_METRIC_COLOR }}>基金经理优选逻辑</h3>
                  <p className="text-white/50 text-sm leading-relaxed">
                    {topFunds.length > 0
                      ? `基于近1年收益排行榜，${topFunds[0]?.fundAbbr ?? "—"} 以 ${topFunds[0]?.performance?.return1y ?? "0"}% 的收益率位居榜首。优选基金经理时，建议重点关注任职年限超过5年、管理规模稳定、历史最大回撤控制在20%以内的选手。`
                      : "数据加载中，请稍候..."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="liquid-glass p-4 md:p-5">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <User className="w-5 h-5" style={{ color: ACCENT_HIGHLIGHT }} />基金经理分析
              </h2>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20" />
                <input type="text" value={searchManager} onChange={(e) => setSearchManager(e.target.value)}
                  placeholder="搜索基金经理..."
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-xs placeholder:text-white/20 focus:outline-none focus:border-[#3B6CFF]/50" />
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {filteredManagers.map((m: any) => (
                  <button key={m.id} onClick={() => setSelectedManagerId(m.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${selectedManagerId === m.id ? "bg-[#3B6CFF]/15 text-[#00F0FF]" : "text-white/50 hover:bg-white/[0.03] hover:text-white/70"}`}>
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center text-white text-[10px] font-medium">{m.name?.[0] ?? "?"}</div>
                    <span className="flex-1 text-left">{m.name ?? "未知"}</span>
                    <ArrowRight className="w-3 h-3 opacity-30" />
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
                    <div className="text-white/30 text-xs">{managerDetail.company}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="liquid-glass-sm p-2 text-center">
                    <div className="text-white/25 text-[10px]">管理年限</div>
                    <div className="data-number text-white text-sm">{managerDetail.manageYears}年</div>
                  </div>
                  <div className="liquid-glass-sm p-2 text-center">
                    <div className="text-white/25 text-[10px]">在管规模</div>
                    <div className="data-number text-white text-sm">{managerDetail.totalScale}亿</div>
                  </div>
                  <div className="liquid-glass-sm p-2 text-center">
                    <div className="text-white/30 text-[10px]">最佳年度</div>
                    <div className="data-number text-sm" style={{ color: managerDetail.bestReturn !== "—" ? UP_COLOR : "rgba(255,255,255,0.3)" }}>
                      {managerDetail.bestReturn !== "—" ? `+${managerDetail.bestReturn}%` : "—"}
                    </div>
                  </div>
                  <div className="liquid-glass-sm p-2 text-center">
                    <div className="text-white/30 text-[10px]">最差年度</div>
                    <div className="data-number text-sm" style={{ color: managerDetail.worstReturn !== "—" ? DOWN_COLOR : "rgba(255,255,255,0.3)" }}>
                      {managerDetail.worstReturn !== "—" ? `${managerDetail.worstReturn}%` : "—"}
                    </div>
                  </div>
                </div>
                {managerDetail.styleDescription && (
                  <div className="mb-4">
                    <h3 className="text-xs mb-2 flex items-center gap-1" style={{ color: ACCENT_INFO }}><BrainCircuit className="w-3 h-3" />AI 风格画像</h3>
                    <p className="text-white/50 text-xs leading-relaxed">{managerDetail.styleDescription}</p>
                  </div>
                )}
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="rgba(255,255,255,0.06)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} />
                      <PolarRadiusAxis tick={false} axisLine={false} />
                      <Radar name={managerDetail.name} dataKey="value" stroke="#00F0FF" fill="#00F0FF" fillOpacity={0.15} strokeWidth={1.5} />
                      <Radar name="同类平均" dataKey="avg" stroke="rgba(255,255,255,0.2)" fill="rgba(255,255,255,0.05)" strokeWidth={1} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3">
                  <div className="text-xs text-white/20 mb-1.5">风格标签</div>
                  <div className="flex flex-wrap gap-1">
                    {managerDetail.investmentStyle?.split(",").map((s: string) => (
                      <span key={s} className="px-2 py-0.5 rounded text-[10px] bg-white/[0.05] text-white/40">{s.trim()}</span>
                    ))}
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-white/[0.06]">
                  <div className="text-xs text-white/20 mb-2">在管基金</div>
                  <div className="space-y-1.5">
                    {managerDetail.funds?.map((f: any) => (
                      <Link key={f.id} to={`/${f.id}`}
                        className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/[0.03] transition-all">
                        <span className="text-white/60 text-xs">{f.fundAbbr}</span>
                        <span className={`data-number text-xs ${getChangeTextClass(parseFloat(f.performance?.return1y || "0"))}`}>
                          {parseFloat(f.performance?.return1y || "0") >= 0 ? "+" : ""}{f.performance?.return1y}%
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="liquid-glass p-4 md:p-5">
              <h2 className="text-sm font-medium text-white/40 mb-3">市场概览</h2>
              <div className="space-y-3">
                {[
                  { label: "基金总数", value: overview.totalFunds, color: ACCENT_PRIMARY },
                  { label: "鑫基荟", value: overview.marketingCount, color: ACCENT_INFO },
                  { label: "平均年化", value: `${overview.avgReturn}%`, color: parseFloat(overview.avgReturn) >= 0 ? UP_COLOR : DOWN_COLOR },
                  { label: "平均夏普", value: overview.avgSharpe, color: POSITIVE_METRIC_COLOR },
                ].map((s) => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="text-white/30 text-xs">{s.label}</span>
                    <span className="data-number text-sm font-medium" style={{ color: s.color }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
