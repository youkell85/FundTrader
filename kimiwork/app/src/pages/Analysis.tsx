import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { TrendingUp, PieChart, Search, BrainCircuit, User, ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, PieChart as RePie, Pie, Cell } from "recharts";

const COLORS = ["#3B6CFF", "#00F0FF", "#A3FF12", "#FFB800", "#FF3366", "#8B5CF6", "#EC4899", "#14B8A6"];

export default function Analysis() {
  const { data: fundList } = trpc.fund.list.useQuery({ pageSize: 50 });
  const { data: industryStats } = trpc.fund.industryStats.useQuery();
  const { data: overview } = trpc.fund.marketOverview.useQuery();

  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [searchManager, setSearchManager] = useState("");

  const { data: managerDetail } = trpc.fund.managerDetail.useQuery(
    { id: selectedManagerId || 0 },
    { enabled: !!selectedManagerId }
  );

  // Get unique managers from fund list
  const managers = fundList?.funds
    ?.map((f: any) => f.manager)
    ?.filter(Boolean)
    ?.filter((m: any, i: number, arr: any[]) => arr.findIndex((t: any) => t?.id === m?.id) === i) || [];

  const filteredManagers = managers.filter((m: any) =>
    m?.name?.toLowerCase().includes(searchManager.toLowerCase())
  );

  // Top performers
  const topFunds = [...(fundList?.funds || [])]
    .sort((a: any, b: any) => parseFloat(b.performance?.return1y || 0) - parseFloat(a.performance?.return1y || 0))
    .slice(0, 10);

  const radarData = [
    { metric: "选股能力", value: 85, avg: 60 },
    { metric: "择时能力", value: 72, avg: 55 },
    { metric: "风控能力", value: 90, avg: 65 },
    { metric: "稳定性", value: 88, avg: 70 },
    { metric: "超额收益", value: 78, avg: 58 },
    { metric: "规模适应", value: 70, avg: 62 },
  ];

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="pt-12 pb-8">
          <h1 className="text-4xl font-semibold text-white tracking-tight" style={{ letterSpacing: "-1.2px" }}>
            深度分析中心
          </h1>
          <p className="mt-2 text-white/40 text-base">多维度公募基金分析工具，洞察市场趋势与基金表现</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Top Performers */}
            <div className="liquid-glass p-6">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#A3FF12]" />
                收益排行榜 (近1年)
              </h2>
              <div className="space-y-2">
                {topFunds.map((f: any, i: number) => {
                  const ret = parseFloat(f.performance?.return1y || 0);
                  const maxRet = parseFloat(topFunds[0]?.performance?.return1y || "1");
                  return (
                    <Link
                      key={f.id}
                      to={`/fund/${f.id}`}
                      className="flex items-center gap-3 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.03] transition-all group px-2 rounded-lg"
                    >
                      <span className={`data-number text-xs w-5 text-center font-medium ${
                        i === 0 ? "text-[#FFB800]" : i === 1 ? "text-[#C0C0C0]" : i === 2 ? "text-[#CD7F32]" : "text-white/20"
                      }`}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm truncate group-hover:text-[#00F0FF] transition-colors">{f.fundAbbr}</div>
                        <div className="text-white/20 text-xs">{f.manager?.name} · {f.category}</div>
                      </div>
                      <div className="w-24 h-1.5 rounded-full bg-white/[0.03] overflow-hidden mr-3">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#3B6CFF] to-[#00F0FF]" style={{ width: `${(ret / maxRet) * 100}%` }} />
                      </div>
                      <div className={`data-number text-sm font-medium ${ret >= 0 ? "text-[#00F0FF]" : "text-[#FF3366]"}`}>
                        {ret >= 0 ? "+" : ""}{f.performance?.return1y}%
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Industry Distribution */}
            <div className="liquid-glass p-6">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <PieChart className="w-5 h-5 text-[#3B6CFF]" />
                行业配置分布
              </h2>
              <div className="flex items-center gap-6">
                <div className="w-48 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePie>
                      <Pie
                        data={industryStats || []}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                        dataKey="totalRatio"
                      >
                        {(industryStats || []).map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                    </RePie>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  {(industryStats || []).slice(0, 8).map((ind: any, i: number) => (
                    <div key={ind.industry} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-white/40 text-xs">{ind.industry}</span>
                      <span className="data-number text-white/60 text-xs">{ind.totalRatio}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Analysis Summary */}
            <div className="liquid-glass p-6">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-[#00F0FF]" />
                AI 市场洞察
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="liquid-glass-sm p-4">
                  <h3 className="text-sm text-[#00F0FF] mb-2">市场趋势研判</h3>
                  <p className="text-white/50 text-sm leading-relaxed">
                    当前A股市场处于结构性震荡整理期，消费与医药板块估值已回归合理区间，具备中长期配置价值。
                    新能源与高端制造领域持续受益于政策支持和产业升级，但需关注短期拥挤度风险。
                    建议采用均衡配置策略，以低估值价值型产品作为底仓，辅以成长性赛道基金增强收益。
                  </p>
                </div>
                <div className="liquid-glass-sm p-4">
                  <h3 className="text-sm text-[#A3FF12] mb-2">基金经理优选逻辑</h3>
                  <p className="text-white/50 text-sm leading-relaxed">
                    基于多维度量化评估体系，重点考察基金经理的夏普比率、信息比率、最大回撤修复能力等指标。
                    朱少醒、谢治宇等均衡型选手在震荡市中表现稳健，适合作为核心配置。
                    刘格菘、赵诣等成长型选手在结构性行情中弹性充足，可作为卫星仓位。
                    建议关注管理规模适中、风格稳定的产品。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Manager Analysis */}
          <div className="space-y-6">
            {/* Manager Selector */}
            <div className="liquid-glass p-5">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-[#FFB800]" />
                基金经理分析
              </h2>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20" />
                <input
                  type="text"
                  value={searchManager}
                  onChange={(e) => setSearchManager(e.target.value)}
                  placeholder="搜索基金经理..."
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-xs placeholder:text-white/20 focus:outline-none focus:border-[#3B6CFF]/50"
                />
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {filteredManagers.map((m: any) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedManagerId(m.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                      selectedManagerId === m.id
                        ? "bg-[#3B6CFF]/15 text-[#00F0FF]"
                        : "text-white/50 hover:bg-white/[0.03] hover:text-white/70"
                    }`}
                  >
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center text-white text-[10px] font-medium">
                      {m.name[0]}
                    </div>
                    <span className="flex-1 text-left">{m.name}</span>
                    <ArrowRight className="w-3 h-3 opacity-30" />
                  </button>
                ))}
              </div>
            </div>

            {/* Manager Detail */}
            {managerDetail && (
              <div className="liquid-glass p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center text-white font-semibold text-lg">
                    {managerDetail.name[0]}
                  </div>
                  <div>
                    <div className="text-white font-medium">{managerDetail.name}</div>
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
                    <div className="text-white/25 text-[10px]">最佳年度</div>
                    <div className="data-number text-[#A3FF12] text-sm">+{managerDetail.bestReturn}%</div>
                  </div>
                  <div className="liquid-glass-sm p-2 text-center">
                    <div className="text-white/25 text-[10px]">最差年度</div>
                    <div className="data-number text-[#FF3366] text-sm">{managerDetail.worstReturn}%</div>
                  </div>
                </div>

                {managerDetail.styleDescription && (
                  <div className="mb-4">
                    <h3 className="text-xs text-[#00F0FF] mb-2 flex items-center gap-1">
                      <BrainCircuit className="w-3 h-3" />
                      AI 风格画像
                    </h3>
                    <p className="text-white/50 text-xs leading-relaxed">{managerDetail.styleDescription}</p>
                  </div>
                )}

                {/* Manager Radar */}
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

                {/* Style Tags */}
                <div className="mt-3">
                  <div className="text-xs text-white/20 mb-1.5">风格标签</div>
                  <div className="flex flex-wrap gap-1">
                    {managerDetail.investmentStyle?.split(",").map((s: string) => (
                      <span key={s} className="px-2 py-0.5 rounded text-[10px] bg-white/[0.05] text-white/40">{s.trim()}</span>
                    ))}
                  </div>
                </div>

                {/* Managed Funds */}
                <div className="mt-4 pt-3 border-t border-white/[0.06]">
                  <div className="text-xs text-white/20 mb-2">在管基金</div>
                  <div className="space-y-1.5">
                    {managerDetail.funds?.map((f: any) => (
                      <Link
                        key={f.id}
                        to={`/fund/${f.id}`}
                        className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/[0.03] transition-all"
                      >
                        <span className="text-white/50 text-xs">{f.fundAbbr}</span>
                        <span className={`data-number text-xs ${parseFloat(f.performance?.return1y || 0) >= 0 ? "text-[#00F0FF]" : "text-[#FF3366]"}`}>
                          {parseFloat(f.performance?.return1y || 0) >= 0 ? "+" : ""}{f.performance?.return1y}%
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Quick Stats */}
            <div className="liquid-glass p-5">
              <h2 className="text-sm font-medium text-white/40 mb-3">市场概览</h2>
              <div className="space-y-3">
                {[
                  { label: "基金总数", value: overview?.totalFunds || 0, color: "#3B6CFF" },
                  { label: "持续营销", value: overview?.marketingCount || 0, color: "#00F0FF" },
                  { label: "平均年化", value: `${overview?.avgReturn || 0}%`, color: "#A3FF12" },
                  { label: "平均夏普", value: overview?.avgSharpe || 0, color: "#FFB800" },
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
      </div>
    </div>
  );
}
