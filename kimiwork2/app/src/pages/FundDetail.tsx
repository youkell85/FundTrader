import { useParams, Link } from "react-router";
import { useMemo } from "react";
import { ArrowLeft, User, BarChart3, PieChart, Layers, Target, Award, Zap } from "lucide-react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import { getFundDetail } from "@/hooks/useFundData";

const typeLabels: Record<string, string> = {
  equity: "股票型", hybrid: "混合型", bond: "债券型",
  index: "指数型", qdii: "QDII", money: "货币型", fof: "FOF", reits: "REITs",
};
const riskLabels: Record<string, string> = {
  low: "低风险", low_medium: "中低风险", medium: "中风险",
  medium_high: "中高风险", high: "高风险",
};

export default function FundDetail() {
  const { id } = useParams<{ id: string }>();
  const fundId = parseInt(id || "0");
  const fund = useMemo(() => getFundDetail(fundId), [fundId]);

  const radarData = useMemo(() => {
    if (!fund?.performance) return [];
    const p = fund.performance;
    const maxSharpe = 2;
    const maxCalmar = 2;
    return [
      { metric: "收益率", value: Math.min(parseFloat(p.return1y || "0") + 50, 100), raw: p.return1y },
      { metric: "夏普比率", value: Math.min((parseFloat(p.sharpeRatio || "0") / maxSharpe) * 100, 100), raw: p.sharpeRatio },
      { metric: "卡玛比率", value: Math.min((parseFloat(p.calmarRatio || "0") / maxCalmar) * 100, 100), raw: p.calmarRatio },
      { metric: "胜率", value: parseFloat(p.winRate || "50"), raw: p.winRate },
      { metric: "抗回撤", value: Math.min(100 + parseFloat(p.maxDrawdown || "0") * 2, 100), raw: p.maxDrawdown },
      { metric: "Alpha", value: Math.min(parseFloat(p.alpha || "0") * 5 + 50, 100), raw: p.alpha },
    ];
  }, [fund]);

  if (!fund) return <div className="min-h-screen pt-20 text-center text-white/30">基金不存在</div>;

  const perf = fund.performance;
  const dailyChange = parseFloat(fund.dailyChange || "0");

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-2 py-4 text-sm">
          <Link to="/" className="text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />返回列表
          </Link>
          <span className="text-white/10">/</span>
          <span className="text-white/50">{fund.fundAbbr}</span>
        </div>

        <div className="liquid-glass p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-white">{fund.fundAbbr || fund.fundName}</h1>
                <span className="data-number text-white/30 text-sm">{fund.fundCode}</span>
                {fund.isContinuousMarketing === 1 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#3B6CFF]/15 text-[#00F0FF] border border-[#3B6CFF]/20">持续营销</span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-white/40">
                <span>{fund.company}</span>
                <span>{typeLabels[fund.fundType] || fund.fundType}</span>
                <span>{riskLabels[fund.riskLevel || ""] || fund.riskLevel}</span>
                <span>规模: <span className="data-number text-white/60">{fund.totalScale}亿</span></span>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="data-number text-3xl font-medium text-white">{fund.nav}</div>
                <div className={`data-number text-sm font-medium ${dailyChange >= 0 ? "text-[#00F0FF]" : "text-[#FF3366]"}`}>
                  {dailyChange >= 0 ? "+" : ""}{fund.dailyChange}%
                </div>
              </div>
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Award key={i} className={`w-5 h-5 ${i < (fund.stars || 0) ? "text-[#FFB800] fill-[#FFB800]" : "text-white/10"}`} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="liquid-glass p-6">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[#3B6CFF]" />业绩表现
              </h2>
              <div className="grid grid-cols-4 gap-3 mb-6">
                {[
                  { label: "近1月", value: perf?.return1m },
                  { label: "近3月", value: perf?.return3m },
                  { label: "近6月", value: perf?.return6m },
                  { label: "近1年", value: perf?.return1y },
                  { label: "近2年", value: perf?.return2y },
                  { label: "近3年", value: perf?.return3y },
                  { label: "近5年", value: perf?.return5y },
                  { label: "今年来", value: perf?.returnThisYear },
                ].map((r) => {
                  const val = parseFloat(r.value || "0");
                  return (
                    <div key={r.label} className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/30 text-xs mb-1">{r.label}</div>
                      <div className={`data-number text-base font-medium ${val >= 0 ? "text-[#00F0FF]" : "text-[#FF3366]"}`}>
                        {val >= 0 ? "+" : ""}{r.value}%
                      </div>
                    </div>
                  );
                })}
              </div>

              {fund.navHistory && fund.navHistory.length > 0 && (
                <div>
                  <h3 className="text-sm text-white/40 mb-3">净值走势 (近2年)</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={fund.navHistory}>
                        <defs>
                          <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3B6CFF" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#3B6CFF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="navDate" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 11 }} tickFormatter={(v) => v?.slice(5) || ""}
                          axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
                        <YAxis domain={["auto", "auto"]} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 11 }} axisLine={false} tickLine={false} width={55} />
                        <Tooltip contentStyle={{ background: "rgba(5, 8, 26, 0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }}
                          labelStyle={{ color: "rgba(255,255,255,0.4)" }} itemStyle={{ color: "#00F0FF" }}
                          formatter={(v: any) => [`${parseFloat(v).toFixed(4)}`, "净值"]} />
                        <Area type="monotone" dataKey="nav" stroke="#3B6CFF" strokeWidth={1.5} fill="url(#navGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>

            <div className="liquid-glass p-6">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-[#FF3366]" />风险指标
              </h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "年化收益率", value: perf?.annualizedReturn, suffix: "%", color: "#00F0FF" },
                  { label: "年化波动率", value: perf?.annualizedVolatility, suffix: "%", color: "#FFB800" },
                  { label: "夏普比率", value: perf?.sharpeRatio, suffix: "", color: "#A3FF12" },
                  { label: "最大回撤", value: perf?.maxDrawdown, suffix: "%", color: "#FF3366" },
                  { label: "卡玛比率", value: perf?.calmarRatio, suffix: "", color: "#00F0FF" },
                  { label: "索提诺比率", value: perf?.sortinoRatio, suffix: "", color: "#3B6CFF" },
                  { label: "信息比率", value: perf?.informationRatio, suffix: "", color: "#A3FF12" },
                  { label: "Alpha", value: perf?.alpha, suffix: "", color: "#00F0FF" },
                  { label: "Beta", value: perf?.beta, suffix: "", color: "#FFB800" },
                  { label: "日胜率", value: perf?.winRate, suffix: "%", color: "#3B6CFF" },
                  { label: "回撤修复", value: perf?.recoveryPeriod, suffix: "天", color: "#A3FF12" },
                ].map((m) => (
                  <div key={m.label} className="liquid-glass-sm p-3 text-center group hover:bg-white/[0.06] transition-all">
                    <div className="text-white/30 text-xs mb-1">{m.label}</div>
                    <div className="data-number text-lg font-medium" style={{ color: m.color }}>{m.value}{m.suffix}</div>
                  </div>
                ))}
              </div>
            </div>

            {fund.holdings && fund.holdings.length > 0 && (
              <div className="liquid-glass p-6">
                <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-[#00F0FF]" />重仓持股
                </h2>
                <div className="space-y-2">
                  {fund.holdings.map((h: any, i: number) => {
                    const ratio = parseFloat(h.ratio || "0") * 100;
                    return (
                      <div key={i} className="flex items-center gap-3 py-2 border-b border-white/[0.03]">
                        <span className="data-number text-white/20 text-xs w-4">{i + 1}</span>
                        <div className="flex-1">
                          <div className="text-white text-sm">{h.stockName}</div>
                          <div className="text-white/25 text-xs data-number">{h.stockCode} · {h.industry}</div>
                        </div>
                        <div className="w-24 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-[#3B6CFF] to-[#00F0FF]" style={{ width: `${Math.min(ratio * 3, 100)}%` }} />
                        </div>
                        <div className="data-number text-white/60 text-sm w-16 text-right">{ratio.toFixed(2)}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="liquid-glass p-6">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <PieChart className="w-5 h-5 text-[#A3FF12]" />综合评分
              </h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="rgba(255,255,255,0.06)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} />
                    <PolarRadiusAxis tick={false} axisLine={false} />
                    <Radar name="本基金" dataKey="value" stroke="#00F0FF" fill="#00F0FF" fillOpacity={0.15} strokeWidth={1.5} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {radarData.map((r: any) => (
                  <div key={r.metric} className="flex justify-between text-xs">
                    <span className="text-white/30">{r.metric}</span>
                    <span className="data-number text-white/60">{parseFloat(r.raw || "0").toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {fund.industries && fund.industries.length > 0 && (
              <div className="liquid-glass p-6">
                <h2 className="text-lg font-medium text-white mb-4">行业分布</h2>
                <div className="space-y-3">
                  {fund.industries.map((ind: any, i: number) => {
                    const ratio = parseFloat(ind.ratio || "0") * 100;
                    const colors = ["#3B6CFF", "#00F0FF", "#A3FF12", "#FFB800", "#FF3366", "#8B5CF6", "#EC4899"];
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-white/50">{ind.industry}</span>
                          <span className="data-number text-white/60">{ratio.toFixed(1)}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${ratio * 2}%`, backgroundColor: colors[i % colors.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {fund.manager && (
              <div className="liquid-glass p-6">
                <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <User className="w-5 h-5 text-[#3B6CFF]" />基金经理
                </h2>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center text-white font-semibold text-lg">
                    {fund.manager.name[0]}
                  </div>
                  <div>
                    <div className="text-white font-medium">{fund.manager.name}</div>
                    <div className="text-white/30 text-xs">{fund.manager.company} · {fund.manager.education}</div>
                    <div className="text-white/30 text-xs">从业{fund.manager.manageYears}年 · 管理{fund.manager.fundCount}只基金</div>
                  </div>
                </div>

                {fund.manager.styleDescription && (
                  <div className="mb-4">
                    <h3 className="text-xs text-[#00F0FF] mb-2 flex items-center gap-1">
                      <Zap className="w-3 h-3" />AI 投资风格分析
                    </h3>
                    <p className="text-white/50 text-xs leading-relaxed">{fund.manager.styleDescription}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="liquid-glass-sm p-2 text-center">
                    <div className="text-[#A3FF12] data-number text-sm font-medium">+{fund.manager.bestReturn}%</div>
                    <div className="text-white/25 text-[10px]">最佳年度</div>
                  </div>
                  <div className="liquid-glass-sm p-2 text-center">
                    <div className="text-[#FF3366] data-number text-sm font-medium">{fund.manager.worstReturn}%</div>
                    <div className="text-white/25 text-[10px]">最差年度</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs text-white/30 mb-2">投资风格标签</div>
                  <div className="flex gap-1 flex-wrap">
                    {fund.manager.investmentStyle?.split(",").map((s: string) => (
                      <span key={s} className="px-2 py-0.5 rounded text-[10px] bg-white/[0.05] text-white/50">{s.trim()}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="liquid-glass p-6">
              <h2 className="text-sm font-medium text-white/40 mb-3">基金信息</h2>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-white/30">管理费率</span><span className="data-number text-white/60">{(parseFloat(fund.feeManage || "0") * 100).toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-white/30">托管费率</span><span className="data-number text-white/60">{(parseFloat(fund.feeCustody || "0") * 100).toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-white/30">基金规模</span><span className="data-number text-white/60">{fund.totalScale}亿元</span></div>
                <div className="flex justify-between"><span className="text-white/30">累计净值</span><span className="data-number text-white/60">{fund.accumNav}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
