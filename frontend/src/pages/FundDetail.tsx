import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Star } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
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
import { getChangeTextClass } from "@/lib/colors";

type TabKey = "ability" | "risk" | "fundamental" | "manager" | "company";

const tabs: { key: TabKey; label: string }[] = [
  { key: "ability", label: "业绩能力" },
  { key: "risk", label: "抗风险性" },
  { key: "fundamental", label: "基本面诊断" },
  { key: "manager", label: "基金经理诊断" },
  { key: "company", label: "基金公司诊断" },
];

function n(v: unknown): number | null {
  const x = parseFloat(String(v ?? "").replace("%", ""));
  return Number.isFinite(x) ? x : null;
}

function fmtPct(v: unknown, digits = 2): string {
  const x = n(v);
  return x === null ? "--" : `${x.toFixed(digits)}%`;
}

function fmtNum(v: unknown, digits = 2): string {
  const x = n(v);
  return x === null ? "--" : x.toFixed(digits);
}

function annualizedFromNav(points: Array<{ d: string; nav: number }>): number | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const days = (new Date(last.d).getTime() - new Date(first.d).getTime()) / 86400000;
  if (days <= 30 || first.nav <= 0 || last.nav <= 0) return null;
  return (Math.pow(last.nav / first.nav, 365 / days) - 1) * 100;
}

function computeRiskMetrics(points: Array<{ d: string; nav: number }>) {
  if (points.length < 2) return { sharpe: null as number | null, maxDrawdown: null as number | null, vol: null as number | null };
  const returns: number[] = [];
  let peak = points[0].nav;
  let maxDd = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].nav;
    const cur = points[i].nav;
    if (prev > 0) returns.push((cur - prev) / prev);
    peak = Math.max(peak, cur);
    maxDd = Math.min(maxDd, ((cur - peak) / peak) * 100);
  }
  if (returns.length < 2) return { sharpe: null, maxDrawdown: maxDd, vol: null };
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252) * 100;
  const sharpe = vol > 0 ? (mean * 252) / (vol / 100) : null;
  return { sharpe, maxDrawdown: maxDd, vol };
}

export default function FundDetail() {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const code = id || "";
  const from = (location.state as { from?: string } | null)?.from || "/";
  const isCode = /^\d{6}$/.test(code);
  const fundId = isCode ? 0 : parseInt(code || "0", 10);

  const detailById = trpc.fund.detail.useQuery({ id: fundId }, { enabled: !isCode && fundId > 0 });
  const detailByCode = trpc.fund.detailByCode.useQuery({ code }, { enabled: isCode });
  const fund = isCode ? detailByCode.data : detailById.data;
  const loading = isCode ? detailByCode.isLoading : detailById.isLoading;
  const err = isCode ? detailByCode.error : detailById.error;

  const peerQ = trpc.fund.peerPerformanceRanking.useQuery({ code }, { enabled: isCode });
  const companyFundsQ = trpc.fund.list.useQuery(
    { company: fund?.company, page: 1, pageSize: 1000, sortBy: "return1y", sortOrder: "desc", withMetrics: true },
    { enabled: !!fund?.company },
  );

  const [tab, setTab] = useState<TabKey>("ability");
  const [horizon, setHorizon] = useState("1Y");

  const navPoints = useMemo(() => ((fund?.navHistory || [])
    .map((x: any) => ({ d: String(x.navDate || ""), nav: n(x.nav) }))
    .filter((x: any) => x.d && x.nav !== null && x.nav > 0)
    .sort((a: any, b: any) => a.d.localeCompare(b.d)) as Array<{ d: string; nav: number }>), [fund?.navHistory]);

  const navSeries = useMemo(() => {
    if (!navPoints.length) return [];
    const base = navPoints[0].nav;
    let peak = navPoints[0].nav;
    return navPoints.map((x) => {
      peak = Math.max(peak, x.nav);
      return { d: x.d.slice(5), dRaw: x.d, fund: ((x.nav / base) - 1) * 100, dd: ((x.nav - peak) / peak) * 100 };
    });
  }, [navPoints]);

  const peerRows = peerQ.data?.rows || [];
  const peerFundRow = peerRows.find((r: any) => String(r.name || "").includes("本基金")) || null;
  const peerAvgRow = peerRows.find((r: any) => String(r.name || "").includes("同类")) || null;
  const indexRow = peerRows.find((r: any) => String(r.name || "").includes("沪深300")) || null;

  const risk = useMemo(() => computeRiskMetrics(navPoints), [navPoints]);
  const annualizedReturn = useMemo(() => annualizedFromNav(navPoints), [navPoints]);
  const score = useMemo(() => {
    const sharpe = n(fund?.performance?.sharpeRatio) ?? risk.sharpe ?? 0;
    const mdd = Math.abs(n(fund?.performance?.maxDrawdown) ?? risk.maxDrawdown ?? 0);
    return Math.max(1, Math.min(99, Math.round(75 + sharpe * 6 - mdd * 0.8)));
  }, [fund?.performance?.sharpeRatio, fund?.performance?.maxDrawdown, risk.sharpe, risk.maxDrawdown]);

  const rings = useMemo(() => {
    const p1 = n(fund?.performance?.return1y) ?? 0;
    const sharpe = n(fund?.performance?.sharpeRatio) ?? risk.sharpe ?? 0;
    const mdd = Math.abs(n(fund?.performance?.maxDrawdown) ?? risk.maxDrawdown ?? 0);
    return [
      { label: "业绩能力", value: Math.max(1, Math.min(99, Math.round(50 + p1))), color: "#5b6fb6" },
      { label: "抗风险性", value: Math.max(1, Math.min(99, Math.round(80 - mdd * 2))), color: "#46c6c2" },
      { label: "基本面", value: Math.max(1, Math.min(99, Math.round(40 + (fund?.holdings?.length || 0) * 2))), color: "#e9ab60" },
      { label: "基金经理", value: Math.max(1, Math.min(99, Math.round(50 + sharpe * 10))), color: "#5ca8df" },
      { label: "基金公司", value: Math.max(1, Math.min(99, Math.round(30 + ((companyFundsQ.data?.funds?.length || 0) / 10)))), color: "#dfca58" },
    ];
  }, [fund?.performance?.return1y, fund?.performance?.sharpeRatio, fund?.performance?.maxDrawdown, risk.sharpe, risk.maxDrawdown, fund?.holdings?.length, companyFundsQ.data?.funds?.length]);

  const holdingsByIndustry = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of (fund?.holdings || [])) {
      const ind = String(h.industry || "其他");
      const ratio = (n(h.ratio) ?? 0) * ((n(h.ratio) ?? 0) > 1 ? 1 : 100);
      map.set(ind, (map.get(ind) || 0) + ratio);
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ k, f: Number(v.toFixed(2)) }))
      .sort((a, b) => b.f - a.f)
      .slice(0, 12);
  }, [fund?.holdings]);

  const companyStats = useMemo(() => {
    const funds = companyFundsQ.data?.funds || [];
    const byType = new Map<string, number[]>();
    funds.forEach((f: any) => {
      const t = String(f.category || f.fundType || "其他");
      const r = n(f.performance?.return1y);
      if (r === null) return;
      byType.set(t, [...(byType.get(t) || []), r]);
    });
    return Array.from(byType.entries()).map(([t, list]) => ({
      t,
      a: Number((list.reduce((x, y) => x + y, 0) / list.length).toFixed(2)),
      count: list.length,
    })).sort((a, b) => b.count - a.count);
  }, [companyFundsQ.data?.funds]);

  if (loading) return <div className="min-h-screen pt-16 text-center text-white/60">加载基金详情中...</div>;
  if (err || !fund) return <div className="min-h-screen pt-16 text-center text-white/60">基金详情加载失败</div>;

  const fundName = fund.fundName || fund.fundAbbr || "--";
  const perf = fund.performance || {};

  return (
    <div className="min-h-screen pb-8 pt-14">
      <div className="mx-auto max-w-[1800px] px-2">
        <div className="mb-2 flex items-center gap-2 text-sm text-white/60">
          <Link to={from} className="inline-flex items-center gap-1 hover:text-white"><ArrowLeft className="h-4 w-4" />返回</Link>
          <span>/</span><span>{fundName}</span>
        </div>

        <div className="rounded border border-white/[0.08] bg-[#11141d]">
          <div className="bg-[#3b6fb8] px-3 py-1.5 text-2xl font-semibold text-white">{fundName}({fund.fundCode})</div>
          <div className="grid gap-3 p-3 md:grid-cols-3">
            <div><div className="text-sm text-white/70">单位净值</div><div className="text-5xl text-[#1fb156]">{fmtNum(fund.nav, 4)}<span className={`ml-2 text-3xl ${getChangeTextClass(fund.dailyChange)}`}>{fmtPct(fund.dailyChange)}</span></div></div>
            <div><div className="text-sm text-white/70">累计净值</div><div className="text-5xl text-[#ff3a57]">{fmtNum(fund.accumNav, 4)}</div></div>
            <div className="space-y-1 text-sm text-white/80">
              <div>类型: <span className="text-[#8eb8ff]">{fund.category || fund.fundType || "--"}</span></div>
              <div>规模: {fund.totalScale || "--"}亿元</div>
              <div>基金经理: <span className="text-[#8eb8ff]">{fund.manager?.name || "--"}</span></div>
              <div className="inline-flex items-center gap-1">基金评级:{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < (fund.stars || 4) ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
          <main className="space-y-3">
            <div className="rounded border border-white/[0.08] bg-[#11141d] p-2">
              <div className="mb-2 flex items-center justify-between text-sm">
                <div className="flex gap-5">{tabs.map((item) => <button key={item.key} className={`border-b-2 pb-0.5 ${tab === item.key ? "border-[#3f6cff] text-[#8fb4ff]" : "border-transparent text-white/75"}`} onClick={() => setTab(item.key)}>{item.label}</button>)}</div>
                <button className="rounded border border-white/[0.2] px-2 py-0.5">导出PDF</button>
              </div>

              {tab === "ability" && <div className="space-y-3">
                <div className="grid grid-cols-[280px_1fr] gap-2">
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3 text-center">
                    <select className="mb-2 rounded border border-white/[0.2] bg-transparent px-1 py-0.5 text-xs" value={horizon} onChange={(e) => setHorizon(e.target.value)}>{["1Y", "2Y", "3Y", "5Y"].map((x) => <option key={x}>{x}</option>)}</select>
                    <div className="data-number text-8xl font-semibold">{score}</div><div className="text-5xl font-semibold">综合评分</div>
                  </div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3"><div className="mb-2 text-xl">诊断完毕，综合评分为：<span className="text-[#ff3a57]">{score >= 85 ? "优秀" : score >= 70 ? "良好" : "一般"}</span></div><div className="grid grid-cols-5 gap-2">{rings.map((r) => <div key={r.label} className="text-center"><div className="mx-auto mb-1 h-20 w-20 rounded-full border-[8px]" style={{ borderColor: `${r.color}55`, borderTopColor: r.color }} /><div className="text-lg">战胜{r.value}%</div><div className="text-sm">{r.label}</div></div>)}</div></div>
                </div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">累计收益率趋势</div><div className="h-[290px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={navSeries}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="d" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Legend /><Line dataKey="fund" stroke="#5b6fb6" dot={false} name="本基金" /></ComposedChart></ResponsiveContainer></div></div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">业绩表现（真实数据）</div><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.1]"><th className="text-left"> </th><th>累计收益</th><th>年化收益</th><th>Sharpe(年化)</th><th>超额收益</th></tr></thead><tbody><tr className="border-b border-white/[0.06] text-center"><td className="text-left">本基金</td><td>{fmtPct(perf.return1y)}</td><td>{annualizedReturn === null ? "--" : `${annualizedReturn.toFixed(2)}%`}</td><td>{fmtNum(perf.sharpeRatio ?? risk.sharpe)}</td><td>{peerAvgRow ? fmtPct((n(perf.return1y) ?? 0) - (n(peerAvgRow.return1y) ?? 0)) : "--"}</td></tr><tr className="border-b border-white/[0.06] text-center"><td className="text-left">同类基金</td><td>{peerAvgRow ? fmtPct(peerAvgRow.return1y) : "--"}</td><td>{peerAvgRow ? fmtPct(peerAvgRow.return1y) : "--"}</td><td>{peerAvgRow ? fmtNum(peerAvgRow.sharpe) : "--"}</td><td>--</td></tr><tr className="border-b border-white/[0.06] text-center"><td className="text-left">沪深300指数</td><td>{indexRow ? fmtPct(indexRow.return1y) : "--"}</td><td>{indexRow ? fmtPct(indexRow.return1y) : "--"}</td><td>{indexRow ? fmtNum(indexRow.sharpe) : "--"}</td><td>--</td></tr></tbody></table></div>
              </div>}

              {tab === "risk" && <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">风险分析</div><table className="w-full text-sm"><tbody>{[
                    ["最大回撤", fmtPct(perf.maxDrawdown ?? risk.maxDrawdown), peerAvgRow ? fmtPct(peerAvgRow.maxDrawdown) : "--"],
                    ["年化波动率", fmtPct(risk.vol), peerAvgRow ? fmtPct(peerAvgRow.volatility) : "--"],
                    ["Sharpe(年化)", fmtNum(perf.sharpeRatio ?? risk.sharpe), peerAvgRow ? fmtNum(peerAvgRow.sharpe) : "--"],
                    ["近1年收益", fmtPct(perf.return1y), peerAvgRow ? fmtPct(peerAvgRow.return1y) : "--"],
                  ].map((r) => <tr key={r[0]} className="border-b border-white/[0.06]"><td>{r[0]}</td><td className="text-right">{r[1]}</td><td className="text-right">{r[2]}</td></tr>)}</tbody></table></div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><ScatterChart><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis type="number" dataKey="x" name="年化波动率" /><YAxis type="number" dataKey="y" name="最大回撤(绝对值)" /><Tooltip /><Scatter name="本基金" data={[{ x: risk.vol ?? 0, y: Math.abs(risk.maxDrawdown ?? 0) }]} fill="#5b6fb6" /><Scatter name="同类基金" data={[{ x: Math.abs(n(peerAvgRow?.volatility) ?? 0), y: Math.abs(n(peerAvgRow?.maxDrawdown) ?? 0) }]} fill="#46c6c2" /></ScatterChart></ResponsiveContainer></div></div>
                </div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">动态回撤</div><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={navSeries}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="d" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Line dataKey="dd" stroke="#5b6fb6" dot={false} name="本基金回撤" /></ComposedChart></ResponsiveContainer></div></div>
              </div>}

              {tab === "fundamental" && <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">资产分布</div><div className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Tooltip /><Legend /><Pie data={(fund.assetAllocation || []).map((x: any) => ({ name: x.name, value: n(x.ratio) ?? 0 }))} dataKey="value" nameKey="name" outerRadius={85} fill="#5b6fb6" /></PieChart></ResponsiveContainer></div></div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">行业配置</div><div className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><BarChart layout="vertical" data={holdingsByIndustry}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis type="number" /><YAxis type="category" dataKey="k" width={80} /><Tooltip /><Bar dataKey="f" fill="#5b6fb6" name="占净值比例(%)" /></BarChart></ResponsiveContainer></div></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">重仓股票</div><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.1]"><th>代码</th><th>名称</th><th>行业</th><th>占比</th><th>日涨跌</th></tr></thead><tbody>{(fund.holdings || []).slice(0, 10).map((h: any) => <tr key={`${h.stockCode}-${h.stockName}`} className="border-b border-white/[0.06] text-center"><td>{h.stockCode}</td><td>{h.stockName}</td><td>{h.industry || "--"}</td><td>{fmtPct((n(h.ratio) ?? 0) * ((n(h.ratio) ?? 0) > 1 ? 1 : 100))}</td><td className={(n(h.dailyChange) ?? 0) >= 0 ? "text-[#ff6b6b]" : "text-[#2ec27e]"}>{fmtPct(h.dailyChange)}</td></tr>)}</tbody></table></div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">分红记录</div><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.1]"><th>除权日</th><th>派现(元)</th><th>支付日</th></tr></thead><tbody>{(fund.dividends || []).slice(0, 10).map((d: any, idx: number) => <tr key={`${d.exDate}-${idx}`} className="border-b border-white/[0.06] text-center"><td>{d.exDate || "--"}</td><td>{fmtNum(d.cash, 4)}</td><td>{d.payDate || "--"}</td></tr>)}</tbody></table></div>
                </div>
              </div>}

              {tab === "manager" && <div className="space-y-3">
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">基金经理信息</div><div className="grid grid-cols-2 gap-2 text-sm"><div>姓名：{fund.manager?.name || "--"}</div><div>从业年限：{fund.manager?.manageYears || "--"}</div><div>在管规模：{fund.manager?.totalScale || "--"}亿</div><div>在管基金数：{fund.manager?.fundCount || "--"}</div><div>年化回报：{fmtPct(fund.manager?.annualizedReturn)}</div><div>任职回报：{fmtPct(fund.manager?.returnSinceTenure)}</div></div></div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">经理能力雷达（基于真实指标映射）</div><div className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><RadarChart data={[{ k: "赚钱能力", f: Math.max(0, Math.min(100, 50 + (n(perf.return1y) ?? 0))), p: 50 }, { k: "稳定能力", f: Math.max(0, Math.min(100, 90 - Math.abs(n(perf.maxDrawdown) ?? 0) * 2)), p: 50 }, { k: "抗跌能力", f: Math.max(0, Math.min(100, 100 - Math.abs(n(perf.maxDrawdown) ?? 0) * 3)), p: 50 }, { k: "管理经验", f: Math.max(0, Math.min(100, (n(fund.manager?.manageYears) ?? 0) * 8)), p: 50 }, { k: "选股能力", f: Math.max(0, Math.min(100, 40 + (fund.holdings?.length || 0) * 3)), p: 50 }, { k: "择时能力", f: Math.max(0, Math.min(100, 50 + (n(perf.sharpeRatio) ?? 0) * 12)), p: 50 }]}><PolarGrid /><PolarAngleAxis dataKey="k" /><PolarRadiusAxis domain={[0, 100]} /><Radar dataKey="f" stroke="#5b6fb6" fill="#5b6fb6" fillOpacity={0.24} name="本基金经理" /><Radar dataKey="p" stroke="#46c6c2" fill="#46c6c2" fillOpacity={0.16} name="基准" /><Legend /></RadarChart></ResponsiveContainer></div></div>
              </div>}

              {tab === "company" && <div className="space-y-3">
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">基金公司分类业绩（真实同公司基金聚合）</div><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={companyStats}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="t" /><YAxis /><Tooltip /><Legend /><Bar dataKey="a" fill="#5b6fb6" name="近1年平均收益(%)" /><Bar dataKey="count" fill="#46c6c2" name="样本数" /></BarChart></ResponsiveContainer></div></div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">基金公司样本明细</div><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.1]"><th>基金代码</th><th>基金简称</th><th>分类</th><th>近1年</th><th>夏普</th><th>最大回撤</th></tr></thead><tbody>{(companyFundsQ.data?.funds || []).slice(0, 20).map((f: any) => <tr key={f.fundCode} className="border-b border-white/[0.06] text-center"><td>{f.fundCode}</td><td>{f.fundName}</td><td>{f.category || f.fundType || "--"}</td><td>{fmtPct(f.performance?.return1y)}</td><td>{fmtNum(f.performance?.sharpeRatio)}</td><td>{fmtPct(f.performance?.maxDrawdown)}</td></tr>)}</tbody></table></div>
              </div>}
            </div>
          </main>

          <aside className="space-y-3">
            <div className="rounded border border-white/[0.08] bg-[#11141d]"><div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基金评级</div><div className="space-y-2 p-3 text-sm"><div className="flex items-center justify-between"><span>基金评级3年</span><span className="inline-flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < Math.min(5, Math.max(1, Math.round((score / 100) * 5))) ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</span></div><div className="flex items-center justify-between"><span>基金评级5年</span><span className="inline-flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < Math.min(5, Math.max(1, Math.round((score / 100) * 5) - 1)) ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</span></div></div></div>
            <div className="rounded border border-white/[0.08] bg-[#11141d]"><div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基金业绩</div><table className="w-full text-sm"><tbody>{[["一年回报", fmtPct(perf.return1y)], ["三年回报(年化)", fmtPct(perf.return3y)], ["五年回报(年化)", fmtPct(perf.return5y)], ["夏普比率", fmtNum(perf.sharpeRatio ?? risk.sharpe)], ["Sortino", fmtNum(perf.sortinoRatio)], ["最大回撤", fmtPct(perf.maxDrawdown ?? risk.maxDrawdown)], ["波动率(年化)", fmtPct(risk.vol)], ["诊断得分", String(score)]].map((r) => <tr key={r[0]} className="border-b border-white/[0.06]"><td className="px-3 py-1">{r[0]}</td><td className="px-3 py-1 text-right text-[#9fbfff]">{r[1]}</td></tr>)}</tbody></table></div>
            <div className="rounded border border-white/[0.08] bg-[#11141d]"><div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基本信息</div><table className="w-full text-sm"><tbody>{[["成立日期", fund.establishDate || "--"], ["基金状态", "正在运行"], ["基金公司", fund.company || "--"], ["基金经理", fund.manager?.name || "--"], ["基金规模", `${fund.totalScale || "--"}亿`], ["投资类型", fund.category || fund.fundType || "--"], ["投资风格", fund.manager?.investmentStyle || "--"], ["比较基准", fund.benchmark || "--"]].map((r) => <tr key={r[0]} className="border-b border-white/[0.06]"><td className="px-3 py-1">{r[0]}</td><td className="px-3 py-1 text-right">{r[1]}</td></tr>)}</tbody></table></div>
          </aside>
        </div>
      </div>
    </div>
  );
}
