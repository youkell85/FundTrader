import { useParams, Link, useLocation } from "react-router";
import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, User, BarChart3, PieChart, Layers, Target, Award, Zap, Loader2, Sparkles } from "lucide-react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, PieChart as RechartsPieChart, Pie, Cell } from "recharts";
import { trpc } from "@/providers/trpc";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  UP_COLOR,
  DOWN_COLOR,
  ACCENT_PRIMARY,
  ACCENT_INFO,
  ACCENT_HIGHLIGHT,
  RISK_COLOR,
  POSITIVE_METRIC_COLOR,
  getChangeTextClass,
} from "@/lib/colors";

const typeLabels: Record<string, string> = {
  equity: "股票型", hybrid: "混合型", bond: "债券型",
  index: "指数型", etf: "ETF", qdii: "QDII", money: "货币型", fof: "FOF", reits: "REITs",
};
const riskLabels: Record<string, string> = {
  low: "低风险", low_medium: "中低风险", medium: "中风险",
  medium_high: "中高风险", high: "高风险",
};

const riskMetricDescriptions: Record<string, string> = {
  年化收益率: "按当前净值历史折算到一年的收益水平，用于比较不同持有周期的收益表现。",
  年化波动率: "收益波动幅度的年化估计，数值越高代表净值起伏越大。",
  夏普比率: "每承担一单位波动风险获得的超额收益，通常越高越好。",
  最大回撤: "从历史高点下跌到低点的最大跌幅，用于衡量极端亏损风险。",
  卡玛比率: "年化收益与最大回撤的比值，衡量收益对回撤的补偿是否充分。",
  索提诺比率: "只关注下行波动的风险调整收益，越高说明下跌风险下的收益质量越好。",
  信息比率: "相对基准或波动风险获得超额收益的能力，越高代表主动收益更稳定。",
  Alpha: "剔除市场整体影响后的超额收益能力，正值代表相对市场有附加贡献。",
  Beta: "基金相对市场的敏感度，大于1通常波动更激进，小于1通常更防守。",
  日胜率: "历史交易日中上涨天数占比，反映短期上涨频率。",
  回撤修复: "从回撤低点恢复到前高大致经历的交易日数，越短说明修复效率越高。",
};

function parseReviewText(text: string): any | null {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    return JSON.parse(jsonText);
  } catch {
    const review: Record<string, any> = {};
    ["performance_review", "risk_review", "manager_review", "holdings_review", "investment_advice"].forEach((key) => {
      const match = jsonText.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
      if (!match) return;
      try {
        review[key] = JSON.parse(`"${match[1]}"`);
      } catch {
        review[key] = match[1];
      }
    });
    ["risk_warnings", "strengths"].forEach((key) => {
      const match = jsonText.match(new RegExp(`"${key}"\\s*:\\s*(\\[[\\s\\S]*?\\])`));
      if (!match) return;
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) review[key] = parsed;
      } catch {
        // LLM 偶尔会在数组处截断，此时展示前面已识别出的段落。
      }
    });
    return Object.keys(review).length ? { ...review, parseWarning: "AI 返回内容不完整，已展示可识别部分。可点击刷新重新生成。" } : null;
  }
}

function normalizeReview(review: any): any {
  if (typeof review === "string") return parseReviewText(review) || { raw: review };
  if (review?.raw && typeof review.raw === "string") return parseReviewText(review.raw) || review;
  return review || {};
}

function isJsonLikeText(value: unknown) {
  const text = String(value || "").trim();
  return text.startsWith("{") || text.startsWith("```json") || text.includes('"performance_review"');
}

function metricNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === "—" || value === "暂无") return null;
  const num = parseFloat(String(value).replace("%", ""));
  return Number.isFinite(num) ? num : null;
}

export default function FundDetail() {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const backTo = (location.state as { from?: string } | null)?.from || "/";
  const routeParam = id || "";
  const isFundCode = /^\d{6}$/.test(routeParam);
  const fundId = isFundCode ? 0 : parseInt(routeParam || "0");
  const [navPeriod, setNavPeriod] = useState<string>("1y");
  const [selectedRiskMetric, setSelectedRiskMetric] = useState<string | null>(null);
  const detailById = trpc.fund.detail.useQuery({ id: fundId }, { enabled: !isFundCode && fundId > 0 });
  const detailByCode = trpc.fund.detailByCode.useQuery({ code: routeParam }, { enabled: isFundCode });
  const fund = isFundCode ? detailByCode.data : detailById.data;
  const isLoading = isFundCode ? detailByCode.isLoading : detailById.isLoading;
  const queryError = isFundCode ? detailByCode.error : detailById.error;
  const refetchDetail = isFundCode ? detailByCode.refetch : detailById.refetch;
  const peerRankingQuery = trpc.fund.peerPerformanceRanking.useQuery(
    { code: fund?.fundCode || routeParam },
    { enabled: !!(fund?.fundCode || (isFundCode && routeParam)), staleTime: 6 * 60 * 60 * 1000, refetchOnWindowFocus: false }
  );

  // LLM 综合分析（懒加载）
  const [llmEnabled, setLlmEnabled] = useState(false);
  const llmQuery = trpc.fund.analyzeFundLLM.useQuery(
    { code: fund?.fundCode || "" },
    { enabled: llmEnabled && !!fund?.fundCode && /^\d{6}$/.test(fund?.fundCode || "") }
  );

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

  // 按周期裁剪净值数据
  const periodNavData = useMemo(() => {
    if (!fund?.navHistory || fund.navHistory.length === 0) return [];
    const all = fund.navHistory;
    if (navPeriod === "all") return all;
    const daysMap: Record<string, number> = { "3m": 90, "6m": 180, "1y": 365, "3y": 365 * 3, "5y": 365 * 5 };
    const days = daysMap[navPeriod] ?? 365;
    const latest = all[all.length - 1];
    const latestTime = new Date(latest.navDate).getTime();
    const targetTime = latestTime - days * 24 * 60 * 60 * 1000;
    // 找到起始点索引
    let startIdx = 0;
    for (let i = 0; i < all.length; i++) {
      if (new Date(all[i].navDate).getTime() >= targetTime) {
        startIdx = i;
        break;
      }
    }
    return all.slice(startIdx);
  }, [fund?.navHistory, navPeriod]);

  const performanceRows = peerRankingQuery.data?.rows ?? [];

  const assetChartData = useMemo(() => (
    (fund?.assetAllocation || []).map((item: any) => ({
      name: item.name,
      value: (metricNumber(item.ratio) || 0) * 100,
      reportDate: item.reportDate,
    })).filter((item: any) => item.value > 0)
  ), [fund?.assetAllocation]);

  const industryChartData = useMemo(() => (
    (fund?.industries || []).map((item: any) => ({
      name: item.industry,
      value: (metricNumber(item.ratio) || 0) * 100,
      quarter: item.quarter,
    })).filter((item: any) => item.value > 0).sort((a: any, b: any) => b.value - a.value).slice(0, 12)
  ), [fund?.industries]);

  if (isLoading) {
    return (
      <div className="min-h-screen pt-20 text-center text-white/30 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        正在获取基金详情...
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="min-h-screen pt-20 px-6">
        <div className="max-w-xl mx-auto liquid-glass p-6 text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-3" style={{ color: UP_COLOR }} />
          <h1 className="text-white text-lg font-medium mb-2">基金详情获取失败</h1>
          <p className="text-white/40 text-sm mb-5">
            {routeParam ? `基金代码/ID：${routeParam}` : "请返回首页重新输入基金代码"}
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => refetchDetail()}
              className="h-10 px-4 rounded-lg text-sm transition-all"
              style={{ background: `${ACCENT_PRIMARY}33`, color: ACCENT_INFO, border: `1px solid ${ACCENT_PRIMARY}55` }}
            >
              重试
            </button>
            <Link to={backTo} className="h-10 px-4 rounded-lg bg-white/[0.03] text-white/60 border border-white/[0.06] text-sm hover:bg-white/[0.06] transition-all flex items-center">
              返回上一页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!fund) return <div className="min-h-screen pt-20 text-center text-white/30">基金不存在</div>;

  const perf = fund.performance;
  const feeFallback = fund.fundType === "index" || /ETF|LOF/i.test(String(fund.fundName || fund.fundAbbr || ""))
    ? "场内交易费率以券商为准"
    : "待披露";
  const dailyChange = parseFloat(fund.dailyChange || "0");

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="flex items-center gap-2 py-4 text-sm">
          <Link to={backTo} className="text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />{backTo === "/recommend" ? "返回配置组合" : "返回列表"}
          </Link>
          <span className="text-white/10">/</span>
          <span className="text-white/50 truncate">{fund.fundAbbr}</span>
        </div>

        <div className="liquid-glass p-4 md:p-6 mb-4 md:mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                <h1 className="text-xl md:text-2xl font-semibold text-white">{fund.fundAbbr || fund.fundName}</h1>
                <span className="data-number text-white/40 text-sm">{fund.fundCode}</span>
                {fund.isContinuousMarketing === 1 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border" style={{ background: `${ACCENT_PRIMARY}26`, color: ACCENT_INFO, borderColor: `${ACCENT_PRIMARY}55` }}>鑫基荟</span>
                )}
              </div>
              <div className="flex items-center gap-3 md:gap-4 mt-2 text-xs text-white/40 flex-wrap">
                <span>{fund.company}</span>
                <span>{typeLabels[fund.fundType] || fund.fundType}</span>
                <span>{riskLabels[fund.riskLevel || ""] || fund.riskLevel}</span>
                <span>规模: <span className="data-number text-white/60">{fund.totalScale}亿</span></span>
              </div>
            </div>
            <div className="flex items-center gap-4 md:gap-6">
              <div className="text-right">
                <div className="data-number text-2xl md:text-3xl font-medium text-white">{fund.nav}</div>
                <div className={`data-number text-sm font-medium ${getChangeTextClass(dailyChange)}`}>
                  {dailyChange >= 0 ? "+" : ""}{fund.dailyChange}%
                </div>
              </div>
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Award key={i} className={`w-5 h-5 ${i < (fund.stars || 0) ? "fill-current" : "text-white/10"}`} style={i < (fund.stars || 0) ? { color: ACCENT_HIGHLIGHT } : undefined} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            <div className="liquid-glass p-4 md:p-6">
              <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />业绩表现
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-6">
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
                    <div key={r.label} className="liquid-glass-sm p-2 md:p-3 text-center">
                      <div className="text-white/30 text-[10px] md:text-xs mb-1">{r.label}</div>
                      <div className={`data-number text-sm md:text-base font-medium ${getChangeTextClass(val)}`}>
                        {val >= 0 ? "+" : ""}{r.value}%
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mb-6 overflow-hidden rounded-lg border border-white/[0.06]">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr] bg-white/[0.035] px-3 py-2 text-xs text-white/40">
                  <span>周期</span><span className="text-right">本基金</span><span className="text-right">同类平均</span><span className="text-right">同类排名</span>
                </div>
                {peerRankingQuery.isLoading && (
                  <div className="px-3 py-3 text-xs text-white/35 border-t border-white/[0.04]">正在计算全市场同类排名...</div>
                )}
                {!peerRankingQuery.isLoading && performanceRows.length === 0 && (
                  <div className="px-3 py-3 text-xs text-white/35 border-t border-white/[0.04]">暂无全市场同类排名数据</div>
                )}
                {performanceRows.map((row: any) => (
                  <div key={row.label} className="grid grid-cols-[1fr_1fr_1fr_1fr] px-3 py-2 text-xs border-t border-white/[0.04]">
                    <span className="text-white/55">{row.label}</span>
                    <span className={`data-number text-right ${row.value == null ? "text-white/30" : getChangeTextClass(row.value)}`}>{row.value == null ? "—" : `${row.value >= 0 ? "+" : ""}${row.value.toFixed(2)}%`}</span>
                    <span className={`data-number text-right ${row.peerAverage == null ? "text-white/30" : getChangeTextClass(row.peerAverage)}`}>{row.peerAverage == null ? "—" : `${row.peerAverage >= 0 ? "+" : ""}${row.peerAverage.toFixed(2)}%`}</span>
                    <span className="data-number text-right text-white/55">{row.rank == null || row.total === 0 ? "—" : `${row.rank}/${row.total}`}</span>
                  </div>
                ))}
                {peerRankingQuery.data && (
                  <div className="px-3 py-2 text-[11px] text-white/30 border-t border-white/[0.04]">
                    口径：{peerRankingQuery.data.peerType} / {peerRankingQuery.data.source}
                  </div>
                )}
              </div>

              {fund.navHistory && fund.navHistory.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h3 className="text-sm text-white/40">净值走势</h3>
                    <div className="flex gap-1 flex-wrap">
                      {[ 
                        { key: "3m", label: "近3月", days: 90 },
                        { key: "6m", label: "近6月", days: 180 },
                        { key: "1y", label: "近1年", days: 365 },
                        { key: "3y", label: "近3年", days: 365 * 3 },
                        { key: "5y", label: "近5年", days: 365 * 5 },
                        { key: "all", label: "成立以来", days: Infinity },
                      ].map((p) => (
                        <button key={p.key}
                          onClick={() => setNavPeriod(p.key)}
                          className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${navPeriod === p.key ? "bg-[#3B6CFF]/15 text-[#5AA9FF]" : "text-white/30 hover:text-white/60 hover:bg-white/[0.04]"}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-56 md:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={periodNavData}>
                        <defs>
                          <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={ACCENT_PRIMARY} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={ACCENT_PRIMARY} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="navDate" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickFormatter={(v) => v?.slice(5) || ""}
                          axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
                        <YAxis domain={["auto", "auto"]} tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} width={50} />
                        <Tooltip contentStyle={{ background: "rgba(5, 8, 26, 0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }}
                          labelStyle={{ color: "rgba(255,255,255,0.4)" }} itemStyle={{ color: ACCENT_INFO }}
                          formatter={(v: any) => [`${parseFloat(v).toFixed(4)}`, "净值"]} />
                        <Area type="monotone" dataKey="nav" stroke={ACCENT_PRIMARY} strokeWidth={1.5} fill="url(#navGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>

            <div className="liquid-glass p-4 md:p-6">
              <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                <Target className="w-5 h-5" style={{ color: RISK_COLOR }} />风险指标
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                {[
                  { label: "年化收益率", value: perf?.annualizedReturn, suffix: "%", color: parseFloat(perf?.annualizedReturn || "0") >= 0 ? UP_COLOR : DOWN_COLOR },
                  { label: "年化波动率", value: perf?.annualizedVolatility, suffix: "%", color: RISK_COLOR },
                  { label: "夏普比率", value: perf?.sharpeRatio, suffix: "", color: POSITIVE_METRIC_COLOR },
                  { label: "最大回撤", value: perf?.maxDrawdown, suffix: "%", color: RISK_COLOR },
                  { label: "卡玛比率", value: perf?.calmarRatio, suffix: "", color: POSITIVE_METRIC_COLOR },
                  { label: "索提诺比率", value: perf?.sortinoRatio, suffix: "", color: POSITIVE_METRIC_COLOR },
                  { label: "信息比率", value: perf?.informationRatio, suffix: "", color: POSITIVE_METRIC_COLOR },
                  { label: "Alpha", value: perf?.alpha, suffix: "", color: POSITIVE_METRIC_COLOR },
                  { label: "Beta", value: perf?.beta, suffix: "", color: ACCENT_PRIMARY },
                  { label: "日胜率", value: perf?.winRate, suffix: "%", color: POSITIVE_METRIC_COLOR },
                  { label: "回撤修复", value: perf?.recoveryPeriod, suffix: "天", color: RISK_COLOR },
                ].map((m) => (
                  <UiTooltip key={m.label}>
                    <TooltipTrigger asChild>
                      <div
                        tabIndex={0}
                        onClick={() => setSelectedRiskMetric(selectedRiskMetric === m.label ? null : m.label)}
                        aria-label={`${m.label}：${riskMetricDescriptions[m.label]}`}
                        className="liquid-glass-sm p-2 md:p-3 text-center group hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 transition-all cursor-help"
                      >
                        <div className="text-white/30 text-[10px] md:text-xs mb-1">{m.label}</div>
                        <div className="data-number text-base md:text-lg font-medium" style={{ color: m.color }}>{m.value}{m.suffix}</div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="max-w-64 border border-white/[0.08] bg-[#05081A]/95 px-3 py-2 text-xs leading-relaxed text-white/80 shadow-xl"
                    >
                      {riskMetricDescriptions[m.label]}
                    </TooltipContent>
                  </UiTooltip>
                ))}
              </div>
              {selectedRiskMetric && (
                <div className="md:hidden mt-3 rounded-lg border border-white/[0.08] bg-white/[0.04] p-3">
                  <div className="text-white/80 text-xs font-medium mb-1">{selectedRiskMetric}</div>
                  <div className="text-white/60 text-xs leading-relaxed">{riskMetricDescriptions[selectedRiskMetric]}</div>
                </div>
              )}
            </div>

            {/* AI 综合分析 LLM 卡片 */}
            <div className="liquid-glass p-4 md:p-6">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                <h2 className="text-base md:text-lg font-medium text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5" style={{ color: ACCENT_INFO }} />AI综合分析
                </h2>
                <button onClick={() => { setLlmEnabled(true); llmQuery.refetch(); }}
                  disabled={llmQuery.isLoading || llmQuery.isFetching}
                  className="h-9 px-4 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                  style={{ background: `${ACCENT_INFO}1A`, color: ACCENT_INFO, border: `1px solid ${ACCENT_INFO}40` }}>
                  {(llmQuery.isLoading || llmQuery.isFetching) ? "AI 分析中..." : (llmQuery.data ? "刷新分析" : "调用 MiniMax M2.7 生成专业报告")}
                </button>
              </div>
              {!llmEnabled && (
                <p className="text-white/40 text-sm">点击上方按钮调用 MiniMax M2.7，对本基金业绩、基金经理、重仓持股进行专业评价。</p>
              )}
              {llmEnabled && (llmQuery.isLoading || llmQuery.isFetching) && (
                <div className="flex items-center gap-2 text-white/40 text-sm py-6">
                  <Loader2 className="w-4 h-4 animate-spin" />MiniMax M2.7 正在生成专业分析报告...
                </div>
              )}
              {llmEnabled && !llmQuery.isLoading && llmQuery.data && (() => {
                const review: any = normalizeReview((llmQuery.data as any).review);
                return (
                  <div className="space-y-3">
                    {review.parseWarning && (
                      <div className="rounded-lg border border-[#FFB800]/20 bg-[#FFB800]/[0.06] px-3 py-2 text-xs leading-relaxed" style={{ color: RISK_COLOR }}>
                        {review.parseWarning}
                      </div>
                    )}
                    {review.performance_review && (
                      <div className="liquid-glass-sm p-3">
                        <div className="text-xs mb-1" style={{ color: ACCENT_INFO }}>业绩评价</div>
                        <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{review.performance_review}</div>
                      </div>
                    )}
                    {review.risk_review && (
                      <div className="liquid-glass-sm p-3">
                        <div className="text-xs mb-1" style={{ color: RISK_COLOR }}>风控指标分析</div>
                        <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{review.risk_review}</div>
                      </div>
                    )}
                    {review.manager_review && (
                      <div className="liquid-glass-sm p-3">
                        <div className="text-xs mb-1" style={{ color: ACCENT_HIGHLIGHT }}>基金经理分析</div>
                        <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{review.manager_review}</div>
                      </div>
                    )}
                    {review.holdings_review && (
                      <div className="liquid-glass-sm p-3">
                        <div className="text-xs mb-1" style={{ color: POSITIVE_METRIC_COLOR }}>持仓分析</div>
                        <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{review.holdings_review}</div>
                      </div>
                    )}
                    {review.investment_advice && (
                      <div className="liquid-glass-sm p-3">
                        <div className="text-xs mb-1" style={{ color: ACCENT_PRIMARY }}>投资建议</div>
                        <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{review.investment_advice}</div>
                      </div>
                    )}
                    {Array.isArray(review.strengths) && review.strengths.length > 0 && (
                      <div className="liquid-glass-sm p-3">
                        <div className="text-xs mb-2" style={{ color: UP_COLOR }}>优势</div>
                        <ul className="space-y-1.5">
                          {review.strengths.map((s: string, i: number) => (
                            <li key={i} className="text-white/70 text-sm flex gap-2"><span style={{ color: UP_COLOR }}>•</span><span>{s}</span></li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(review.risk_warnings) && review.risk_warnings.length > 0 && (
                      <div className="liquid-glass-sm p-3">
                        <div className="text-xs mb-2" style={{ color: RISK_COLOR }}>风险提示</div>
                        <ul className="space-y-1.5">
                          {review.risk_warnings.map((s: string, i: number) => (
                            <li key={i} className="text-white/70 text-sm flex gap-2"><span style={{ color: RISK_COLOR }}>!</span><span>{s}</span></li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {review.raw && !isJsonLikeText(review.raw) && (
                      <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">{review.raw}</p>
                    )}
                    {review.raw && isJsonLikeText(review.raw) && (
                      <div className="rounded-lg border border-[#FFB800]/20 bg-[#FFB800]/[0.06] px-3 py-2 text-xs leading-relaxed" style={{ color: RISK_COLOR }}>
                        AI 返回了未完整的 JSON，暂无法结构化展示。请点击“刷新分析”重新生成。
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="space-y-4 md:space-y-6">
            <div className="liquid-glass p-4 md:p-6">
              <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                <PieChart className="w-5 h-5" style={{ color: POSITIVE_METRIC_COLOR }} />综合评分
              </h2>
              <div className="h-56 md:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="rgba(255,255,255,0.06)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} />
                    <PolarRadiusAxis tick={false} axisLine={false} />
                    <Radar name="本基金" dataKey="value" stroke={ACCENT_INFO} fill={ACCENT_INFO} fillOpacity={0.18} strokeWidth={1.5} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {radarData.map((r: any) => (
                  <div key={r.metric} className="flex justify-between text-xs">
                    <span className="text-white/40">{r.metric}</span>
                    <span className="data-number text-white/70">{parseFloat(r.raw || "0").toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {assetChartData.length > 0 && (
              <div className="liquid-glass p-4 md:p-6">
                <h2 className="text-base md:text-lg font-medium text-white mb-4">资产配置</h2>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPieChart>
                      <Pie data={assetChartData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={2}>
                        {assetChartData.map((_: any, index: number) => (
                          <Cell key={index} fill={[ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT][index % 4]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "rgba(5, 8, 26, 0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }} formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "占比"]} />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {assetChartData.map((item: any, index: number) => (
                    <div key={item.name} className="flex items-center justify-between gap-2">
                      <span className="text-white/50 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT][index % 4] }} />{item.name}</span>
                      <span className="data-number text-white/70">{item.value.toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-white/30">报告期：{assetChartData[0]?.reportDate || "未标明"}</div>
              </div>
            )}

            {industryChartData.length > 0 && (
              <div className="liquid-glass p-4 md:p-6">
                <h2 className="text-base md:text-lg font-medium text-white mb-4">行业分布</h2>
                <div className="space-y-3">
                  {industryChartData.map((ind: any, i: number) => {
                    const ratio = ind.value;
                    // 中性色阶：主色【蓝】×不同透明度 + 辅助【象牙金】
                    const palette = [ACCENT_PRIMARY, ACCENT_INFO, POSITIVE_METRIC_COLOR, ACCENT_HIGHLIGHT, "#9D7BFF", "#5AA9FF", "#3B6CFF"];
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-white/60">{ind.name}</span>
                          <span className="data-number text-white/70">{ratio.toFixed(1)}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(ratio * 2, 100)}%`, backgroundColor: palette[i % palette.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {fund.manager && (
              <div className="liquid-glass p-4 md:p-6">
                <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <User className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />基金经理
                </h2>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-semibold text-lg" style={{ background: `linear-gradient(135deg, ${ACCENT_PRIMARY}, ${ACCENT_INFO})` }}>
                    {fund.manager.name?.[0] ?? "?"}
                  </div>
                  <div>
                    <div className="text-white font-medium">{fund.manager.name ?? "未知"}</div>
                    {(fund.manager.company !== "—" || fund.manager.education) && (
                      <div className="text-white/40 text-xs">{fund.manager.company !== "—" ? fund.manager.company : ""}{fund.manager.education ? ` · ${fund.manager.education}` : ""}</div>
                    )}
                    {fund.manager.manageYears !== "5.00" && (
                      <div className="text-white/40 text-xs">从业{fund.manager.manageYears}年 · 管理{fund.manager.fundCount}只基金</div>
                    )}
                  </div>
                </div>

                {fund.manager.styleDescription && (
                  <div className="mb-4">
                    <h3 className="text-xs mb-2 flex items-center gap-1" style={{ color: ACCENT_INFO }}>
                      <Zap className="w-3 h-3" />AI 投资风格分析
                    </h3>
                    <p className="text-white/60 text-xs leading-relaxed">{fund.manager.styleDescription}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="liquid-glass-sm p-2 text-center">
                    <div className="data-number text-sm font-medium" style={{ color: fund.manager.bestReturn !== "—" ? UP_COLOR : "rgba(255,255,255,0.3)" }}>
                      {fund.manager.bestReturn !== "—" ? `+${fund.manager.bestReturn}%` : "—"}
                    </div>
                    <div className="text-white/30 text-[10px]">最佳年度</div>
                  </div>
                  <div className="liquid-glass-sm p-2 text-center">
                    <div className="data-number text-sm font-medium" style={{ color: fund.manager.worstReturn !== "—" ? DOWN_COLOR : "rgba(255,255,255,0.3)" }}>
                      {fund.manager.worstReturn !== "—" ? `${fund.manager.worstReturn}%` : "—"}
                    </div>
                    <div className="text-white/30 text-[10px]">最差年度</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs text-white/40 mb-2">投资风格标签</div>
                  <div className="flex gap-1 flex-wrap">
                    {fund.manager.investmentStyle?.split(",").map((s: string) => (
                      <span key={s} className="px-2 py-0.5 rounded text-[10px] bg-white/[0.05] text-white/60">{s.trim()}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="liquid-glass p-4 md:p-6">
              <h2 className="text-sm font-medium text-white/50 mb-3">基金信息</h2>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between gap-3"><span className="text-white/40">管理费率</span><span className="data-number text-white/70 text-right">{fund.feeManage != null && !isNaN(parseFloat(fund.feeManage)) ? (parseFloat(fund.feeManage) * 100).toFixed(2) + "%" : feeFallback}</span></div>
                <div className="flex justify-between gap-3"><span className="text-white/40">托管费率</span><span className="data-number text-white/70 text-right">{fund.feeCustody != null && !isNaN(parseFloat(fund.feeCustody)) ? (parseFloat(fund.feeCustody) * 100).toFixed(2) + "%" : feeFallback}</span></div>
                <div className="flex justify-between"><span className="text-white/40">基金规模</span><span className="data-number text-white/70">{fund.totalScale}亿元</span></div>
                <div className="flex justify-between"><span className="text-white/40">累计净值</span><span className="data-number text-white/70">{fund.accumNav}</span></div>
              </div>
            </div>

            {fund.dividends && fund.dividends.length > 0 && (
              <div className="liquid-glass p-4 md:p-6">
                <h2 className="text-base md:text-lg font-medium text-white mb-4">基金分红</h2>
                <div className="space-y-2">
                  {fund.dividends.slice(0, 8).map((item: any, index: number) => (
                    <div key={`${item.exDate || item.annDate}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-white/[0.05] bg-white/[0.025] px-3 py-2 text-xs">
                      <div>
                        <div className="text-white/65">除息日 {item.exDate || "—"}</div>
                        <div className="text-white/30 mt-0.5">派息日 {item.payDate || "—"} / 公告 {item.annDate || "—"}</div>
                      </div>
                      <div className="data-number text-white/75">{item.cash ? `${item.cash}元/份` : "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(fund.holdings && fund.holdings.length > 0) ? (
              <div className="liquid-glass p-4 md:p-6">
                <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5" style={{ color: ACCENT_INFO }} />重仓持股
                </h2>
                {(() => {
                  const firstHolding = fund.holdings[0] || {};
                  const source = firstHolding.source || "公开季报/F10/数据源聚合";
                  const quarter = firstHolding.quarter || "未标明";
                  const updatedAt = firstHolding.updatedAt || firstHolding.quarter || "随数据源更新";
                  const missingDailyCount = fund.holdings.filter((item: any) => item.dailyChange == null || Number.isNaN(parseFloat(item.dailyChange))).length;
                  return (
                    <div className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs text-white/50 leading-relaxed">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mb-1.5">
                        <div><span className="text-white/30">数据源：</span>{source}</div>
                        <div><span className="text-white/30">报告期：</span>{quarter}</div>
                        <div><span className="text-white/30">更新：</span>{updatedAt}</div>
                      </div>
                      重仓持股属于公开披露的季度/定期报告数据，不是实时仓位；日涨跌为按股票代码额外匹配的最新行情。
                      {missingDailyCount > 0 && <span style={{ color: RISK_COLOR }}> 其中 {missingDailyCount} 只暂未匹配到当日涨跌幅。</span>}
                    </div>
                  );
                })()}
                <div className="space-y-2">
                  {fund.holdings.map((h: any, i: number) => {
                    const ratio = parseFloat(h.ratio || "0") * 100;
                    const dailyChange = h.dailyChange == null ? null : parseFloat(h.dailyChange);
                    return (
                      <div key={i} className="flex items-center gap-2 md:gap-3 py-2 border-b border-white/[0.03]">
                        <span className="data-number text-white/30 text-xs w-4">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm truncate">{h.stockName}</div>
                          <div className="text-white/30 text-xs data-number truncate">{h.stockCode}{h.quoteCode ? ` / ${h.quoteCode}` : ""} · {h.industry}</div>
                        </div>
                        <div className="hidden md:block w-24 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(ratio * 3, 100)}%`, background: `linear-gradient(90deg, ${ACCENT_PRIMARY}, ${ACCENT_INFO})` }} />
                        </div>
                        <div className="text-right w-20 md:w-24 shrink-0">
                          <div className="data-number text-white/70 text-sm">{ratio.toFixed(2)}%</div>
                          <div className={`data-number text-[10px] ${dailyChange == null || Number.isNaN(dailyChange) ? "text-white/30" : getChangeTextClass(dailyChange)}`}>
                            {dailyChange == null || Number.isNaN(dailyChange) ? "未取到行情" : `${dailyChange >= 0 ? "+" : ""}${dailyChange.toFixed(2)}%`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (/ETF|LOF/i.test(String(fund.fundName || fund.fundAbbr || "")) || fund.fundType === "etf" || fund.fundType === "index") && (
              <div className="liquid-glass p-4 md:p-6">
                <h2 className="text-base md:text-lg font-medium text-white mb-3 flex items-center gap-2">
                  <Layers className="w-5 h-5" style={{ color: ACCENT_INFO }} />持仓披露
                </h2>
                <div className="rounded-lg border border-[#FFB800]/20 bg-[#FFB800]/[0.06] px-3 py-2 text-xs leading-relaxed" style={{ color: RISK_COLOR }}>
                  暂未从 Tushare/东方财富F10 获取到该 ETF 的前十大持仓。ETF 持仓通常来自定期报告或申购赎回清单，债券、黄金、货币、跨境 ETF 也可能不披露为“重仓股票”。后续可接入指数成分股或 PCF 清单作为 ETF 专属展示口径。
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
