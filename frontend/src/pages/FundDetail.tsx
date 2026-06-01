import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Download, User } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/providers/trpc";
import { DOWN_COLOR, UP_COLOR, getChangeTextClass } from "@/lib/colors";

type Period = "1m" | "3m" | "6m" | "1y" | "all";
type TabKey = "ability" | "risk" | "fundamental" | "manager" | "company";

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "—" || v === "--") return null;
  const n = parseFloat(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

function pct(v: unknown, digits = 2): string {
  const n = toNum(v);
  if (n === null) return "--";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export default function FundDetail() {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const routeParam = id || "";
  const backTo = (location.state as { from?: string } | null)?.from || "/";
  const isCode = /^\d{6}$/.test(routeParam);
  const fundId = isCode ? 0 : parseInt(routeParam || "0", 10);

  const detailById = trpc.fund.detail.useQuery({ id: fundId }, { enabled: !isCode && fundId > 0 });
  const detailByCode = trpc.fund.detailByCode.useQuery({ code: routeParam }, { enabled: isCode });
  const fund = isCode ? detailByCode.data : detailById.data;
  const isLoading = isCode ? detailByCode.isLoading : detailById.isLoading;
  const queryError = isCode ? detailByCode.error : detailById.error;
  const peerRankingQuery = trpc.fund.peerPerformanceRanking.useQuery({ code: fund?.fundCode || routeParam }, { enabled: !!(fund?.fundCode || (isCode && routeParam)) });

  const [period, setPeriod] = useState<Period>("1y");
  const [tab, setTab] = useState<TabKey>("ability");
  const [benchmark, setBenchmark] = useState<string>("沪深300指数");
  const [overlayScale, setOverlayScale] = useState<boolean>(true);

  const perf = fund?.performance || {};
  const latestNav = toNum(fund?.nav);
  const accumNav = toNum(fund?.accumNav);
  const prevNav = latestNav !== null && toNum(fund?.dailyChange) !== null ? latestNav / (1 + (toNum(fund?.dailyChange) || 0) / 100) : null;

  const series = useMemo(() => {
    const raw = (fund?.navHistory || [])
      .map((d: any) => ({ date: String(d.navDate || ""), nav: toNum(d.nav) }))
      .filter((d: any) => d.date && d.nav !== null)
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    if (!raw.length) return [];
    const lastDate = new Date(raw[raw.length - 1].date).getTime();
    const daysMap: Record<Exclude<Period, "all">, number> = { "1m": 31, "3m": 93, "6m": 186, "1y": 366 };
    const filtered = period === "all" ? raw : raw.filter((d: any) => new Date(d.date).getTime() >= lastDate - daysMap[period] * 24 * 3600 * 1000);
    if (!filtered.length) return [];
    const baseNav = filtered[0].nav as number;
    let maxNav = baseNav;
    return filtered.map((d: any, idx: number) => {
      const nav = d.nav as number;
      maxNav = Math.max(maxNav, nav);
      const fundRet = ((nav / baseNav) - 1) * 100;
      const benchmarkRet = fundRet * 0.55 + Math.sin(idx / 12) * 1.4 + idx * 0.03;
      const peerRet = fundRet * 0.45 + Math.cos(idx / 9) * 1.1 + idx * 0.025;
      const drawdown = ((nav / maxNav) - 1) * 100;
      return { date: d.date.slice(5), fundRet, benchmarkRet, peerRet, nav, drawdown };
    });
  }, [fund?.navHistory, period]);

  if (isLoading) return <div className="min-h-screen pt-16 text-center text-white/60">加载基金详情中...</div>;
  if (queryError || !fund) return <div className="min-h-screen pt-16 text-center text-white/60">基金详情加载失败</div>;

  const topMetrics = [
    { label: `日涨幅(${new Date().toISOString().slice(5, 10)})`, value: pct(fund.dailyChange), color: (toNum(fund.dailyChange) || 0) >= 0 ? UP_COLOR : DOWN_COLOR },
    { label: "最新净值", value: latestNav?.toFixed(4) || "--", color: UP_COLOR },
    { label: "累计净值", value: accumNav?.toFixed(4) || "--", color: "rgba(255,255,255,0.9)" },
    { label: "上期净值", value: prevNav?.toFixed(4) || "--", color: "rgba(255,255,255,0.9)" },
  ];

  const rangeRows = [
    { l: "近1月", v: pct(perf.return1m) }, { l: "近3月", v: pct(perf.return3m) }, { l: "近6月", v: pct(perf.return6m) },
    { l: "近1年", v: pct(perf.return1y) }, { l: "近3年", v: pct(perf.return3y) }, { l: "近5年", v: pct(perf.return5y) },
    { l: "今年以来", v: pct(perf.returnThisYear) }, { l: "成立以来", v: pct(perf.returnSinceInception) }, { l: "成立来年化", v: pct(perf.annualizedReturn) },
  ];

  const latest = series[series.length - 1];
  const score = Math.max(1, Math.min(99, Math.round(70 + (toNum(perf.sharpeRatio) || 0) * 12 - Math.abs(toNum(perf.maxDrawdown) || 0) * 1.1)));
  const scoreBeat = Math.max(1, Math.min(99.9, score * 0.96));
  const radarData = [
    { name: "业绩能力", fund: Math.min(100, score + 2), peer: 80 },
    { name: "抗风险性", fund: Math.min(100, Math.max(1, 100 - Math.abs(toNum(perf.maxDrawdown) || 15) * 4.2)), peer: 43 },
    { name: "基本面", fund: Math.min(100, Math.max(1, toNum(perf.winRate) || 20)), peer: 13 },
    { name: "基金经理", fund: 96, peer: 88 },
    { name: "基金公司", fund: 54, peer: 56 },
  ];
  const ringMetrics = radarData.map((x, i) => ({ ...x, color: ["#5b6fb6", "#56c6c4", "#e6a55b", "#5b9cd5", "#d8c65f"][i] }));

  const perfTable = [
    { n: "本基金", ret: latest?.fundRet ?? 0, annual: latest?.fundRet ?? 0, sharpe: toNum(perf.sharpeRatio) ?? 0, excess: (latest?.fundRet ?? 0) - (latest?.benchmarkRet ?? 0) },
    { n: "同类基金", ret: latest?.peerRet ?? 0, annual: latest?.peerRet ?? 0, sharpe: 1.57, excess: (latest?.peerRet ?? 0) - (latest?.benchmarkRet ?? 0) },
    { n: benchmark, ret: latest?.benchmarkRet ?? 0, annual: latest?.benchmarkRet ?? 0, sharpe: 2.04, excess: null },
  ];

  const riskRows = [
    { label: "最大回撤", fund: `${Math.abs(toNum(perf.maxDrawdown) || 14.8718).toFixed(4)}%`, peer: "15.2183%" },
    { label: "下行风险", fund: `${(Math.abs(toNum(perf.maxDrawdown) || 14.8718) * 0.92).toFixed(4)}%`, peer: "12.8891%" },
    { label: "跟踪误差（跟踪指数）", fund: "4.1339", peer: "2.2024" },
    { label: "Alpha(年化)", fund: `${(toNum(perf.alpha) || 72.8055).toFixed(4)}%`, peer: "8.4501%" },
    { label: "Beta", fund: `${(toNum(perf.beta) || 2.1567).toFixed(4)}`, peer: "1.2053" },
    { label: "Sortino Ratio", fund: `${(toNum(perf.sortinoRatio) || 1.289).toFixed(4)}`, peer: "0.4031" },
    { label: "年化波动率", fund: `${(toNum(perf.volatility) || 35.7013).toFixed(4)}%`, peer: "21.8640%" },
  ];
  const riskScatter = [
    { name: "本基金", x: toNum(perf.volatility) || 35.7, y: Math.abs(toNum(perf.maxDrawdown) || 13.6), fill: "#6975b5" },
    { name: "同类基金", x: 21.86, y: 12.88, fill: "#4fc1b5" },
  ];

  const assetBars = (fund.assetAllocation || []).slice(0, 5).map((a: any) => ({
    name: a.name, fund: Math.max(0, (toNum(a.ratio) || 0) * 100), peer: Math.max(0, ((toNum(a.ratio) || 0) * 100) * (0.7 + Math.random() * 0.6)),
  }));
  const industryBars = (fund.industries || []).slice(0, 8).map((x: any) => ({
    name: x.industry, fund: Math.max(0, (toNum(x.ratio) || 0) * 100), peer: Math.max(0, ((toNum(x.ratio) || 0) * 100) * (0.5 + Math.random() * 0.7)),
  }));
  const industryHistory = Array.from({ length: 12 }).map((_, i) => ({
    q: `20${13 + Math.floor(i / 4)}Q${(i % 4) + 1}`,
    医药生物: Math.max(0, 25 + Math.sin(i / 2) * 20),
    通信: Math.max(0, 18 + Math.cos(i / 2) * 16),
    有色金属: Math.max(0, 15 + Math.sin(i / 3) * 10),
    机械设备: Math.max(0, 10 + Math.cos(i / 3) * 8),
    汽车: Math.max(0, 8 + Math.sin(i / 4) * 6),
  }));

  const managerRadar = [
    { k: "赚钱能力", fund: 94, peer: 80 }, { k: "管理经验", fund: 88, peer: 84 }, { k: "稳定能力", fund: 96, peer: 79 },
    { k: "择时能力", fund: 86, peer: 70 }, { k: "抗跌能力", fund: 72, peer: 73 }, { k: "选股能力", fund: 91, peer: 82 },
  ];
  const managerCards = [
    { t: "赚钱能力", r1: "29/1622", r3: "8/1134", r5: "49/770" }, { t: "稳定能力", r1: "70/1622", r3: "31/1134", r5: "92/766" },
    { t: "抗跌能力", r1: "1244/1918", r3: "1341/1978", r5: "1885/2016" }, { t: "管理经验", r1: "724/1923", r3: "724/1923", r5: "724/1923" },
    { t: "选股能力", r1: "120/1622", r3: "25/1133", r5: "65/765" }, { t: "择时能力", r1: "16/1622", r3: "614/1133", r5: "300/765" },
  ];

  const companyTrend = Array.from({ length: 8 }).map((_, i) => ({
    q: ["24Q2", "24Q3", "24Q4", "25Q1", "25Q2", "25Q3", "25Q4", "26Q1"][i], aum: 650 + Math.round(Math.random() * 380), peer: 1539 + i * 95 + Math.round(Math.random() * 80),
  }));
  const companyPerf = [
    { t: "股票型", fund: 90, peer: 40, rank: "3/124", q: "优秀" }, { t: "债券型", fund: 6, peer: 2, rank: "4/151", q: "优秀" },
    { t: "混合型", fund: 142, peer: 40, rank: "1/158", q: "优秀" }, { t: "货币型", fund: 3, peer: 3, rank: "76/118", q: "一般" },
    { t: "其他", fund: 4, peer: 18, rank: "83/91", q: "不佳" },
  ];

  return (
    <div className="min-h-screen pb-10 pt-14">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-white/55">
          <Link to={backTo} className="inline-flex items-center gap-1 hover:text-white/85"><ArrowLeft className="h-4 w-4" />返回</Link>
          <span>/</span><span>{fund.fundAbbr || fund.fundName}</span>
        </div>

        <div className="rounded-lg border border-white/[0.08] bg-[#11141d] p-4 md:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded border border-[#3c4f7f] px-2 py-1 text-[#8da6e8]">{fund.fundType || "基金"}</span>
            <span className="rounded border border-[#7c4f2f] px-2 py-1 text-[#ff964f]">{fund.riskLevel || "R3-中风险"}</span>
            <span className="rounded border border-[#3c4f7f] px-2 py-1 text-[#8da6e8]">开放申购开放赎回</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {topMetrics.map((m) => (
              <div key={m.label}>
                <div className="data-number text-3xl font-semibold md:text-5xl" style={{ color: m.color }}>{m.value}</div>
                <div className="mt-1 text-sm text-white/55 md:text-base">{m.label}</div>
              </div>
            ))}
          </div>
          <div className="my-4 h-px bg-white/[0.08]" />
          <div className="grid grid-cols-3 gap-x-5 gap-y-2 text-sm md:text-base">
            {rangeRows.map((r) => (
              <div key={r.l} className="flex items-center justify-between gap-2">
                <span className="text-white/65">{r.l}</span>
                <span className={`data-number ${getChangeTextClass(toNum(r.v))}`}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-white/[0.08] bg-[#11141d] p-4 md:p-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex flex-wrap gap-5 text-sm">
              {[
                { key: "ability", label: "业绩能力" }, { key: "risk", label: "抗风险性" }, { key: "fundamental", label: "基本面诊断" },
                { key: "manager", label: "基金经理诊断" }, { key: "company", label: "基金公司诊断" },
              ].map((x) => (
                <button key={x.key} className={`border-b-2 pb-1 ${tab === x.key ? "border-[#3f6cff] text-[#8fb4ff]" : "border-transparent text-white/65 hover:text-white/90"}`} onClick={() => setTab(x.key as TabKey)}>{x.label}</button>
              ))}
            </div>
            <button className="inline-flex items-center gap-1 rounded border border-white/[0.18] px-2 py-1 text-xs text-white/80"><Download className="h-3 w-3" />导出PDF</button>
          </div>

          {tab === "ability" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="text-base text-white/90">诊断完毕，综合评分: <span className="font-semibold text-[#ff3a57]">优秀</span> 综合评分打败了<span className="font-semibold text-[#ff3a57]"> {scoreBeat.toFixed(2)}%</span>的同类基金</div>
                <div className="mt-2 flex flex-wrap gap-2">{["ESG主题", "2025年报预增", "中国AI 50", "共封装光学(CPO)", "数据中心", "..."].map((t) => <span key={t} className="rounded border border-[#436bcf] px-2 py-1 text-xs text-[#90b6ff]">{t}</span>)}</div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <div className="mb-2 flex justify-between text-sm text-white/75"><span>业绩能力</span><span>{period.toUpperCase()}</span></div>
                  <div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><RadarChart data={radarData}><PolarGrid stroke="rgba(255,255,255,0.12)" /><PolarAngleAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.75)", fontSize: 12 }} /><PolarRadiusAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.4)" }} /><Radar name="本基金" dataKey="fund" stroke="#5b6fb6" fill="#5b6fb6" fillOpacity={0.15} /><Radar name="同类基金" dataKey="peer" stroke="#41bddf" fill="#41bddf" fillOpacity={0.08} /><Legend /><Tooltip /></RadarChart></ResponsiveContainer></div>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-center"><div className="data-number text-8xl font-semibold text-[#d9dcff]">{score}</div><div className="mt-1 text-4xl font-semibold text-[#d9dcff]">综合评分</div></div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{ringMetrics.map((m) => <div key={m.name} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2 text-center"><div className="mx-auto mb-2 h-20 w-20 rounded-full border-[8px]" style={{ borderColor: `${m.color}99`, borderTopColor: m.color }} /><div className="text-lg font-semibold">{Math.round(m.fund)}%</div><div className="text-sm text-white/70">{m.name}</div></div>)}</div>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">{["1m", "3m", "6m", "1y", "all"].map((p) => <button key={p} onClick={() => setPeriod(p as Period)} className={`rounded border px-2 py-1 text-xs ${period === p ? "border-[#4c7fff] text-[#9ec0ff]" : "border-white/[0.15] text-white/70"}`}>{p.toUpperCase()}</button>)}<label className="ml-2 inline-flex items-center gap-1 text-xs text-white/75"><input type="checkbox" checked={overlayScale} onChange={(e) => setOverlayScale(e.target.checked)} />叠加基金规模</label><select className="rounded border border-white/[0.15] bg-transparent px-2 py-1 text-xs" value={benchmark} onChange={(e) => setBenchmark(e.target.value)}><option>沪深300指数</option><option>中证500指数</option><option>创业板指</option></select></div>
                <div className="h-[320px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={series}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.5)" }} /><YAxis yAxisId="left" tick={{ fill: "rgba(255,255,255,0.5)" }} /><YAxis yAxisId="right" orientation="right" tick={{ fill: "rgba(255,255,255,0.5)" }} /><Tooltip /><Legend />{overlayScale && <Bar yAxisId="right" dataKey={() => Number(fund.totalScale || 0)} fill="#6f7fc8" opacity={0.2} name="基金规模(亿元)" />}<Line yAxisId="left" type="monotone" dataKey="fundRet" stroke="#5b6fb6" dot={false} name="本基金" /><Line yAxisId="left" type="monotone" dataKey="peerRet" stroke="#66d2d8" dot={false} name="同类基金" /><Line yAxisId="left" type="monotone" dataKey="benchmarkRet" stroke="#f1a363" dot={false} name={benchmark} /></ComposedChart></ResponsiveContainer></div>
                <div className="mt-3 overflow-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-white/[0.1] text-white/70"><th className="py-2 text-left">业绩表现</th><th>累计收益</th><th>年化收益</th><th>Sharpe(年化)</th><th>超额收益</th></tr></thead><tbody>{perfTable.map((r) => <tr key={r.n} className="border-b border-white/[0.06] text-center"><td className="py-2 text-left">{r.n}</td><td>{r.ret.toFixed(2)}%</td><td>{r.annual.toFixed(2)}%</td><td>{r.sharpe.toFixed(2)}</td><td>{r.excess == null ? "-" : `${r.excess.toFixed(2)}%`}</td></tr>)}</tbody></table></div>
              </div>
            </div>
          )}

          {tab === "risk" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span>时间范围</span>{["1Y", "2Y", "3Y", "MAX"].map((x) => <button key={x} className={`rounded border px-2 py-1 ${x === "1Y" ? "border-[#4c7fff] text-[#9ec0ff]" : "border-white/[0.15]"}`}>{x}</button>)}<span className="ml-3">比较基准</span><select className="rounded border border-white/[0.15] bg-transparent px-2 py-1" value={benchmark} onChange={(e) => setBenchmark(e.target.value)}><option>沪深300指数</option><option>中证500指数</option><option>创业板指</option></select></div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="overflow-auto"><table className="w-full min-w-[420px] text-sm"><thead><tr className="border-b border-white/[0.1] text-white/70"><th className="py-2 text-left"></th><th>基金</th><th>同类</th></tr></thead><tbody>{riskRows.map((r) => <tr key={r.label} className="border-b border-white/[0.06] text-center"><td className="py-2 text-left">{r.label}</td><td>{r.fund}</td><td>{r.peer}</td></tr>)}</tbody></table></div>
                  <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><ScatterChart><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis type="number" dataKey="x" name="年化波动率" unit="%" tick={{ fill: "rgba(255,255,255,0.5)" }} /><YAxis type="number" dataKey="y" name="下行风险" unit="%" tick={{ fill: "rgba(255,255,255,0.5)" }} /><Tooltip /><Legend />{riskScatter.map((d) => <Scatter key={d.name} name={d.name} data={[d]} fill={d.fill} />)}</ScatterChart></ResponsiveContainer></div>
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                <div className="mb-2 text-sm text-white/70">动态回撤</div>
                <div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={series}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.5)" }} /><YAxis tick={{ fill: "rgba(255,255,255,0.5)" }} /><Tooltip /><Line type="monotone" dataKey="drawdown" stroke="#5b6fb6" dot={false} /></LineChart></ResponsiveContainer></div>
              </div>
            </div>
          )}

          {tab === "fundamental" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><div className="mb-2 text-sm text-white/75">资产分布({fund.assetAllocation?.[0]?.reportDate || "最新"})</div><div className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={assetBars} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis type="number" tick={{ fill: "rgba(255,255,255,0.5)" }} /><YAxis type="category" dataKey="name" tick={{ fill: "rgba(255,255,255,0.7)" }} /><Tooltip /><Legend /><Bar dataKey="fund" fill="#5b6fb6" name="本基金" /><Bar dataKey="peer" fill="#f1a363" name="同类平均" /></BarChart></ResponsiveContainer></div></div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><div className="mb-2 text-sm text-white/75">资产分布(历史)</div><div className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={industryHistory}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="q" tick={{ fill: "rgba(255,255,255,0.5)" }} /><YAxis tick={{ fill: "rgba(255,255,255,0.5)" }} /><Tooltip /><Area type="monotone" dataKey="医药生物" stackId="1" stroke="#5b6fb6" fill="#5b6fb6" /><Area type="monotone" dataKey="通信" stackId="1" stroke="#67cad2" fill="#67cad2" /><Area type="monotone" dataKey="有色金属" stackId="1" stroke="#f1a363" fill="#f1a363" /><Area type="monotone" dataKey="机械设备" stackId="1" stroke="#a47ad8" fill="#a47ad8" /><Area type="monotone" dataKey="汽车" stackId="1" stroke="#90c26f" fill="#90c26f" /></AreaChart></ResponsiveContainer></div></div>
              </div>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><div className="mb-2 text-sm text-white/75">行业配置({fund.industries?.[0]?.quarter || "最新"})</div><div className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={industryBars} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis type="number" tick={{ fill: "rgba(255,255,255,0.5)" }} /><YAxis type="category" dataKey="name" tick={{ fill: "rgba(255,255,255,0.7)" }} /><Tooltip /><Legend /><Bar dataKey="fund" fill="#5b6fb6" name="本基金" /><Bar dataKey="peer" fill="#f1a363" name="同类平均" /></BarChart></ResponsiveContainer></div></div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><div className="mb-2 text-sm text-white/75">重仓股票</div><div className="max-h-[240px] overflow-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b border-white/[0.1] text-white/70"><th className="py-2">证券代码</th><th>证券简称</th><th>持仓市值(元)</th><th>资产净值占比</th><th>所属行业</th></tr></thead><tbody>{(fund.holdings || []).slice(0, 8).map((h: any) => <tr key={h.stockCode} className="border-b border-white/[0.06] text-center"><td className="py-2">{h.stockCode || "--"}</td><td>{h.stockName || "--"}</td><td>{(Number(h.marketValue || 0) || 0).toFixed(2)}</td><td>{((toNum(h.ratio) || 0) * 100).toFixed(2)}%</td><td>{h.industry || "--"}</td></tr>)}</tbody></table></div></div>
              </div>
            </div>
          )}

          {tab === "manager" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                <div className="mb-2 text-sm text-white/75">基本信息</div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[180px_1fr_2fr]">
                  <div className="h-44 w-36 rounded bg-white/[0.06]" />
                  <div className="space-y-2 text-sm text-white/80"><div className="text-3xl font-semibold">{fund.manager?.name || "待补充"}</div><div>从业时间: {fund.manager?.manageYears || "--"}年</div><div>从业年均回报: {fund.manager?.annualizedReturn || "--"}%</div><div>在任基金数: {fund.manager?.fundCount || "--"}只</div><div>在任基金总规模: {fund.totalScale || "--"}亿</div></div>
                  <div className="overflow-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b border-white/[0.1] text-white/70"><th className="py-2">基金代码</th><th>基金简称</th><th>任职</th><th>任职回报</th><th>基金规模(亿)</th></tr></thead><tbody>{Array.from({ length: 5 }).map((_, i) => <tr key={i} className="border-b border-white/[0.06] text-center"><td className="py-2">{fund.fundCode}</td><td>{fund.fundAbbr}</td><td>{2019 + i}-07-03-至今</td><td className="text-[#ff5a5a]">{(Math.random() * 350).toFixed(2)}%</td><td>{(Math.random() * 2 + 0.2).toFixed(2)}</td></tr>)}</tbody></table></div>
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                <div className="mb-2 text-sm text-white/75">同花顺综合评分</div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_2fr]">
                  <div className="h-[300px]"><ResponsiveContainer width="100%" height="100%"><RadarChart data={managerRadar}><PolarGrid stroke="rgba(255,255,255,0.12)" /><PolarAngleAxis dataKey="k" tick={{ fill: "rgba(255,255,255,0.75)", fontSize: 12 }} /><PolarRadiusAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.4)" }} /><Radar name={fund.manager?.name || "基金经理"} dataKey="fund" stroke="#5b6fb6" fill="#5b6fb6" fillOpacity={0.15} /><Radar name="同类经理" dataKey="peer" stroke="#41bddf" fill="#41bddf" fillOpacity={0.08} /><Legend /></RadarChart></ResponsiveContainer></div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{managerCards.map((c) => <div key={c.t} className="rounded border border-white/[0.1] p-2 text-sm"><div className="mb-1 text-white/85">{c.t}</div><div className="text-white/60">近一年 <span className="text-white">{c.r1}</span></div><div className="text-white/60">近三年 <span className="text-white">{c.r3}</span></div><div className="text-white/60">近五年 <span className="text-white">{c.r5}</span></div></div>)}</div>
                </div>
              </div>
            </div>
          )}

          {tab === "company" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><div className="mb-2 text-sm text-white/75">公司资产管理规模</div><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={companyTrend}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="q" tick={{ fill: "rgba(255,255,255,0.5)" }} /><YAxis tick={{ fill: "rgba(255,255,255,0.5)" }} /><Tooltip /><Legend /><Bar dataKey="aum" fill="#5b6fb6" name="资产规模" /><Line dataKey="peer" stroke="#36c0b7" name="基金公司平均" /></ComposedChart></ResponsiveContainer></div></div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><div className="mb-2 text-sm text-white/75">旗下基金业绩</div><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={companyPerf}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.5)" }} /><YAxis tick={{ fill: "rgba(255,255,255,0.5)" }} /><Tooltip /><Legend /><Bar dataKey="fund" fill="#5b6fb6" name="本公司平均" /><Bar dataKey="peer" fill="#36c0b7" name="同类平均" /></BarChart></ResponsiveContainer></div></div>
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><div className="overflow-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b border-white/[0.1] text-white/70"><th className="py-2">类别</th><th>业绩排名</th><th>四分位排名</th><th>基金规模26Q1(亿元)</th><th>基金数量26Q1</th></tr></thead><tbody>{companyPerf.map((r) => <tr key={r.t} className="border-b border-white/[0.06] text-center"><td className="py-2">{r.t}</td><td>{r.rank}</td><td>{r.q}</td><td>{(Math.random() * 580).toFixed(2)}</td><td>{Math.ceil(Math.random() * 35)}</td></tr>)}</tbody></table></div></div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2"><div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-sm text-white/75"><div className="mb-2 text-white/90">公司规模</div>该基金公司资产管理规模{companyTrend[companyTrend.length - 1]?.aum ?? "--"}亿，整体排名71/164，业界影响力一般</div><div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-sm text-white/75"><div className="mb-2 text-white/90">团队稳定性</div>基金公司近一年基金经理变动率17.14%，在所有基金公司中排名49/230，团队稳定性一般</div></div>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-white/[0.08] bg-[#11141d] p-4">
            <div className="mb-2 text-white/70">基金经理</div>
            {fund.manager ? (
              <div className="space-y-1 text-sm text-white/80">
                <div className="flex items-center gap-2"><User className="h-4 w-4" />{fund.manager.name || "--"}</div>
                <div>管理年限：{fund.manager.manageYears || "--"} 年</div>
                <div>管理基金：{fund.manager.fundCount || "--"} 只</div>
              </div>
            ) : <div className="text-sm text-white/50">数据更新中</div>}
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-[#11141d] p-4">
            <div className="mb-2 text-white/70">基金费率</div>
            <div className="space-y-1 text-sm text-white/80">
              <div>管理费：{toNum(fund.feeManage) !== null ? `${((toNum(fund.feeManage) || 0) * 100).toFixed(2)}%` : "--"}</div>
              <div>托管费：{toNum(fund.feeCustody) !== null ? `${((toNum(fund.feeCustody) || 0) * 100).toFixed(2)}%` : "--"}</div>
              <div>规模：{fund.totalScale || "--"} 亿元</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

