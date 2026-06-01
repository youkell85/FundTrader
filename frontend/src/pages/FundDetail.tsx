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
type HorizonKey = "1w" | "1m" | "3m" | "6m" | "1y";
type RangeKey = "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "MAX";

const tabs: { key: TabKey; label: string }[] = [
  { key: "ability", label: "业绩能力" },
  { key: "risk", label: "抗风险性" },
  { key: "fundamental", label: "基本面诊断" },
  { key: "manager", label: "基金经理诊断" },
  { key: "company", label: "基金公司诊断" },
];

const rangeOptions: RangeKey[] = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"];
const horizonOptions: HorizonKey[] = ["1w", "1m", "3m", "6m", "1y"];

function n(v: unknown): number | null {
  const x = parseFloat(String(v ?? "").replace("%", ""));
  return Number.isFinite(x) ? x : null;
}

function pct(v: unknown, digits = 2): string {
  const x = n(v);
  return x === null ? "--" : `${x.toFixed(digits)}%`;
}

function num(v: unknown, digits = 2): string {
  const x = n(v);
  return x === null ? "--" : x.toFixed(digits);
}

function toDailyReturns(points: Array<{ nav: number }>): number[] {
  const returns: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].nav;
    const cur = points[i].nav;
    if (prev > 0) returns.push((cur - prev) / prev);
  }
  return returns;
}

function calcAnnualized(points: Array<{ d: string; nav: number }>): number | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const days = (new Date(last.d).getTime() - new Date(first.d).getTime()) / 86400000;
  if (days <= 30 || first.nav <= 0 || last.nav <= 0) return null;
  return (Math.pow(last.nav / first.nav, 365 / days) - 1) * 100;
}

function filterByRange(points: Array<{ d: string; nav: number }>, range: RangeKey) {
  if (range === "MAX" || points.length === 0) return points;
  const latest = new Date(points[points.length - 1].d).getTime();
  let from = latest;
  const day = 86400000;
  if (range === "1M") from = latest - 31 * day;
  if (range === "3M") from = latest - 92 * day;
  if (range === "6M") from = latest - 183 * day;
  if (range === "1Y") from = latest - 366 * day;
  if (range === "3Y") from = latest - 1096 * day;
  if (range === "5Y") from = latest - 1827 * day;
  if (range === "YTD") {
    const y = new Date(points[points.length - 1].d).getFullYear();
    from = new Date(`${y}-01-01`).getTime();
  }
  const filtered = points.filter((p) => new Date(p.d).getTime() >= from);
  return filtered.length >= 2 ? filtered : points;
}

function rollingReturns(
  points: Array<{ d: string; nav: number }>,
  horizon: HorizonKey,
): number[] {
  const daysMap: Record<HorizonKey, number> = { "1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365 };
  const days = daysMap[horizon];
  const result: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const t0 = new Date(points[i].d).getTime();
    const target = t0 + days * 86400000;
    let j = i + 1;
    while (j < points.length && new Date(points[j].d).getTime() < target) j += 1;
    if (j < points.length && points[i].nav > 0) {
      result.push(((points[j].nav - points[i].nav) / points[i].nav) * 100);
    }
  }
  return result;
}

function computeRisk(points: Array<{ d: string; nav: number }>) {
  if (points.length < 3) {
    return {
      sharpe: null as number | null,
      sortino: null as number | null,
      maxDrawdown: null as number | null,
      volatility: null as number | null,
      downsideRisk: null as number | null,
      winRate: null as number | null,
      var95: null as number | null,
      cvar95: null as number | null,
      worstMonth: null as number | null,
      dailyReturns: [] as number[],
      drawdownSeries: [] as Array<{ d: string; dd: number }>,
    };
  }

  const dailyReturns = toDailyReturns(points);
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252) * 100;
  const downside = dailyReturns.filter((r) => r < 0);
  const downsideMean = downside.length ? downside.reduce((a, b) => a + b, 0) / downside.length : 0;
  const downsideVar = downside.length
    ? downside.reduce((a, b) => a + (b - downsideMean) ** 2, 0) / Math.max(1, downside.length - 1)
    : 0;
  const downsideRisk = Math.sqrt(downsideVar) * Math.sqrt(252) * 100;

  const rfDaily = 0.02 / 252;
  const sharpe = vol > 0 ? ((mean - rfDaily) * 252) / (vol / 100) : null;
  const sortino = downsideRisk > 0 ? ((mean - rfDaily) * 252) / (downsideRisk / 100) : null;

  let peak = points[0].nav;
  const drawdownSeries = points.map((p) => {
    peak = Math.max(peak, p.nav);
    return { d: p.d, dd: peak > 0 ? ((p.nav - peak) / peak) * 100 : 0 };
  });
  const maxDrawdown = drawdownSeries.reduce((m, x) => Math.min(m, x.dd), 0);

  const sorted = [...dailyReturns].sort((a, b) => a - b);
  const idx95 = Math.floor(sorted.length * 0.05);
  const var95 = sorted.length ? sorted[idx95] * 100 : null;
  const tail = sorted.slice(0, Math.max(1, idx95 + 1));
  const cvar95 = tail.length ? (tail.reduce((a, b) => a + b, 0) / tail.length) * 100 : null;

  const winRate = (dailyReturns.filter((x) => x > 0).length / dailyReturns.length) * 100;

  const monthMap = new Map<string, { first: number; last: number }>();
  for (const p of points) {
    const key = p.d.slice(0, 7);
    const row = monthMap.get(key);
    if (!row) monthMap.set(key, { first: p.nav, last: p.nav });
    else row.last = p.nav;
  }
  const monthReturns = Array.from(monthMap.values())
    .filter((m) => m.first > 0)
    .map((m) => ((m.last - m.first) / m.first) * 100);
  const worstMonth = monthReturns.length ? Math.min(...monthReturns) : null;

  return {
    sharpe,
    sortino,
    maxDrawdown,
    volatility: vol,
    downsideRisk,
    winRate,
    var95,
    cvar95,
    worstMonth,
    dailyReturns,
    drawdownSeries,
  };
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
  const managerQ = trpc.fund.managerDetail.useQuery(
    { id: fund?.managerId || 0 },
    { enabled: Boolean(fund?.managerId) },
  );
  const companyFundsQ = trpc.fund.list.useQuery(
    { company: fund?.company, page: 1, pageSize: 1000, sortBy: "return1y", sortOrder: "desc", withMetrics: true },
    { enabled: Boolean(fund?.company) },
  );

  const [tab, setTab] = useState<TabKey>("ability");
  const [range, setRange] = useState<RangeKey>("1Y");
  const [horizon, setHorizon] = useState<HorizonKey>("1m");

  const navPoints = useMemo(
    () => ((fund?.navHistory || [])
      .map((x: any) => ({ d: String(x.navDate || ""), nav: n(x.nav) }))
      .filter((x: any) => x.d && x.nav !== null && x.nav > 0)
      .sort((a: any, b: any) => a.d.localeCompare(b.d)) as Array<{ d: string; nav: number }>),
    [fund?.navHistory],
  );
  const scopedPoints = useMemo(() => filterByRange(navPoints, range), [navPoints, range]);
  const risk = useMemo(() => computeRisk(scopedPoints), [scopedPoints]);

  const navSeries = useMemo(() => {
    if (!scopedPoints.length) return [];
    const base = scopedPoints[0].nav;
    return scopedPoints.map((x) => ({
      d: x.d.slice(5),
      fund: base > 0 ? ((x.nav / base) - 1) * 100 : 0,
      dd: risk.drawdownSeries.find((d) => d.d === x.d)?.dd ?? 0,
    }));
  }, [scopedPoints, risk.drawdownSeries]);

  const annualized = useMemo(() => calcAnnualized(scopedPoints), [scopedPoints]);
  const rolling = useMemo(() => rollingReturns(navPoints, horizon), [navPoints, horizon]);

  const profitBuckets = useMemo(() => {
    const buckets = [
      { key: "<0", label: "<0%", count: 0 },
      { key: "0-5", label: "0%-5%", count: 0 },
      { key: "5-10", label: "5%-10%", count: 0 },
      { key: "10+", label: "10%以上", count: 0 },
    ];
    rolling.forEach((r) => {
      if (r < 0) buckets[0].count += 1;
      else if (r < 5) buckets[1].count += 1;
      else if (r < 10) buckets[2].count += 1;
      else buckets[3].count += 1;
    });
    const total = Math.max(1, rolling.length);
    return buckets.map((b) => ({
      ...b,
      profitProb: ((b.count / total) * 100),
      lossProb: b.key === "<0" ? 100 - ((b.count / total) * 100) : ((buckets[0].count / total) * 100),
    }));
  }, [rolling]);

  const varHistogram = useMemo(() => {
    const values = risk.dailyReturns.map((r) => r * 100);
    if (!values.length) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const bins = 12;
    const step = (max - min) / bins || 1;
    const data = Array.from({ length: bins }, (_, i) => ({
      bucket: `${(min + i * step).toFixed(1)}~${(min + (i + 1) * step).toFixed(1)}%`,
      density: 0,
    }));
    values.forEach((v) => {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)));
      data[idx].density += 1;
    });
    return data.map((x) => ({ ...x, density: x.density / values.length }));
  }, [risk.dailyReturns]);

  const stressBars = useMemo(() => {
    const dd = [...risk.drawdownSeries].sort((a, b) => a.dd - b.dd).slice(0, 3);
    return dd.map((x, idx) => ({ name: `压力${idx + 1}`, date: x.d, fund: x.dd }));
  }, [risk.drawdownSeries]);

  const performanceRows = peerQ.data?.rows || [];
  const rowByKey = (key: string) => performanceRows.find((r: any) => r.key === key);
  const r1y = rowByKey("return1y");
  const r1m = rowByKey("return1m");
  const r3m = rowByKey("return3m");
  const r6m = rowByKey("return6m");

  const score = useMemo(() => {
    const ret1y = n(fund?.performance?.return1y) ?? r1y?.value ?? 0;
    const sharpe = n(fund?.performance?.sharpeRatio) ?? risk.sharpe ?? 0;
    const mdd = Math.abs(n(fund?.performance?.maxDrawdown) ?? risk.maxDrawdown ?? 0);
    return Math.max(1, Math.min(99, Math.round(55 + ret1y * 0.6 + sharpe * 8 - mdd)));
  }, [fund?.performance?.return1y, fund?.performance?.sharpeRatio, fund?.performance?.maxDrawdown, r1y?.value, risk.sharpe, risk.maxDrawdown]);

  const abilityRadar = useMemo(() => ([
    { k: "业绩能力", f: Math.max(0, Math.min(100, 50 + (n(fund?.performance?.return1y) ?? 0))), p: 50 },
    { k: "抗风险性", f: Math.max(0, Math.min(100, 90 - Math.abs(risk.maxDrawdown ?? 0) * 2)), p: 50 },
    { k: "基本面", f: Math.max(0, Math.min(100, 30 + (fund?.holdings?.length || 0) * 4)), p: 50 },
    { k: "基金经理", f: Math.max(0, Math.min(100, 30 + (n(fund?.manager?.manageYears) ?? 0) * 8)), p: 50 },
    { k: "基金公司", f: Math.max(0, Math.min(100, 30 + Math.log2((companyFundsQ.data?.funds?.length || 1) + 1) * 12)), p: 50 },
  ]), [fund?.performance?.return1y, risk.maxDrawdown, fund?.holdings?.length, fund?.manager?.manageYears, companyFundsQ.data?.funds?.length]);

  const holdingsByIndustry = useMemo(() => {
    const source = (fund?.industries || []).length
      ? fund.industries.map((x: any) => ({ k: x.industry, v: (n(x.ratio) ?? 0) * ((n(x.ratio) ?? 0) > 1 ? 1 : 100) }))
      : (fund?.holdings || []).map((x: any) => ({ k: x.industry || "其他", v: (n(x.ratio) ?? 0) * ((n(x.ratio) ?? 0) > 1 ? 1 : 100) }));
    const map = new Map<string, number>();
    source.forEach((x: any) => map.set(x.k, (map.get(x.k) || 0) + x.v));
    return Array.from(map.entries())
      .map(([k, f]) => ({ k, f: Number(f.toFixed(2)) }))
      .sort((a, b) => b.f - a.f)
      .slice(0, 12);
  }, [fund?.industries, fund?.holdings]);

  const industryHistory = useMemo(() => {
    const raw = fund?.industryHistory || [];
    const points = raw
      .map((x: any) => ({
        period: String(x.quarter || x.reportDate || x.date || ""),
        industry: String(x.industry || x.name || ""),
        ratio: (n(x.ratio) ?? 0) * ((n(x.ratio) ?? 0) > 1 ? 1 : 100),
      }))
      .filter((x: any) => x.period && x.industry);
    if (!points.length) return [];
    const topIndustries = Array.from(new Set(points.map((p: any) => p.industry))).slice(0, 6);
    const periods = Array.from(new Set(points.map((p: any) => p.period))).sort();
    return periods.map((period) => {
      const row: Record<string, string | number> = { period };
      topIndustries.forEach((ind) => {
        const found = points.find((p: any) => p.period === period && p.industry === ind);
        row[ind] = found ? Number(found.ratio.toFixed(2)) : 0;
      });
      return row;
    });
  }, [fund?.industryHistory]);

  const managerFunds = managerQ.data?.funds || [];
  const managerBars = useMemo(
    () => managerFunds
      .slice(0, 10)
      .map((f: any) => ({ name: (f.fundAbbr || f.fundName || f.fundCode || "").slice(0, 8), return1y: n(f.performance?.return1y) ?? 0 })),
    [managerFunds],
  );

  const companyFunds = companyFundsQ.data?.funds || [];
  const companyByType = useMemo(() => {
    const map = new Map<string, { returns: number[]; count: number }>();
    companyFunds.forEach((f: any) => {
      const key = String(f.category || f.fundType || "其他");
      const ret = n(f.performance?.return1y);
      const cur = map.get(key) || { returns: [], count: 0 };
      if (ret !== null) cur.returns.push(ret);
      cur.count += 1;
      map.set(key, cur);
    });
    return Array.from(map.entries()).map(([t, x]) => ({
      t,
      avgReturn1y: x.returns.length ? x.returns.reduce((a, b) => a + b, 0) / x.returns.length : 0,
      count: x.count,
    })).sort((a, b) => b.count - a.count);
  }, [companyFunds]);

  if (loading) return <div className="min-h-screen pt-16 text-center text-white/60">加载基金详情中...</div>;
  if (err || !fund) return <div className="min-h-screen pt-16 text-center text-white/60">基金详情加载失败</div>;

  const fundName = fund.fundName || fund.fundAbbr || "--";

  return (
    <div className="min-h-screen pb-8 pt-14">
      <div className="mx-auto max-w-[1800px] px-2">
        <div className="mb-2 flex items-center gap-2 text-sm text-white/60">
          <Link to={from} className="inline-flex items-center gap-1 hover:text-white"><ArrowLeft className="h-4 w-4" />返回</Link>
          <span>/</span><span>{fundName}</span>
        </div>

        <div className="rounded border border-white/[0.08] bg-[#11141d]">
          <div className="bg-[#3b6fb8] px-3 py-1.5 text-2xl font-semibold text-white">{fundName} ({fund.fundCode})</div>
          <div className="grid gap-3 p-3 md:grid-cols-3">
            <div>
              <div className="text-sm text-white/70">单位净值</div>
              <div className="text-5xl text-[#1fb156]">{num(fund.nav, 4)}<span className={`ml-2 text-3xl ${getChangeTextClass(fund.dailyChange)}`}>{pct(fund.dailyChange)}</span></div>
            </div>
            <div>
              <div className="text-sm text-white/70">累计净值</div>
              <div className="text-5xl text-[#ff3a57]">{num(fund.accumNav, 4)}</div>
            </div>
            <div className="space-y-1 text-sm text-white/80">
              <div>类型：<span className="text-[#8eb8ff]">{fund.category || fund.fundType || "--"}</span></div>
              <div>规模：{fund.totalScale || "--"} 亿元</div>
              <div>基金经理：<span className="text-[#8eb8ff]">{fund.manager?.name || "--"}</span></div>
              <div className="inline-flex items-center gap-1">基金评级：{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < (fund.stars || 4) ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 px-3 pb-3 text-lg md:grid-cols-6">
            {[["近1月", r1m?.value], ["近3月", r3m?.value], ["近6月", r6m?.value], ["近1年", r1y?.value], ["年化", annualized], ["最大回撤", risk.maxDrawdown]].map(([label, value]) => (
              <div key={String(label)}>{label}：<span className={getChangeTextClass(value)}>{pct(value)}</span></div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
          <main className="space-y-3">
            <div className="rounded border border-white/[0.08] bg-[#11141d] p-2">
              <div className="mb-2 flex items-center justify-between text-sm">
                <div className="flex gap-5">
                  {tabs.map((item) => (
                    <button key={item.key} className={`border-b-2 pb-0.5 ${tab === item.key ? "border-[#3f6cff] text-[#8fb4ff]" : "border-transparent text-white/75"}`} onClick={() => setTab(item.key)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <button className="rounded border border-white/[0.2] px-2 py-0.5">导出PDF</button>
              </div>

              {tab === "ability" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-[280px_1fr] gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3 text-center">
                      <div className="data-number text-8xl font-semibold">{score}</div>
                      <div className="text-5xl font-semibold">综合评分</div>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3">
                      <div className="mb-2 text-xl">诊断完毕，综合评价：<span className="text-[#ff3a57]">{score >= 85 ? "优秀" : score >= 70 ? "良好" : "一般"}</span></div>
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={abilityRadar}>
                            <PolarGrid />
                            <PolarAngleAxis dataKey="k" />
                            <PolarRadiusAxis domain={[0, 100]} />
                            <Radar dataKey="f" stroke="#5b6fb6" fill="#5b6fb6" fillOpacity={0.24} name="本基金" />
                            <Radar dataKey="p" stroke="#46c6c2" fill="#46c6c2" fillOpacity={0.12} name="基准" />
                            <Legend />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-2 flex items-center gap-2 text-sm">
                      <span>累计收益趋势</span>
                      {rangeOptions.map((r) => <button key={r} className={`rounded border px-1.5 py-0.5 ${range === r ? "border-[#4c7fff] text-[#9ec0ff]" : "border-white/[0.2] text-white/70"}`} onClick={() => setRange(r)}>{r}</button>)}
                    </div>
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={navSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="d" tick={{ fontSize: 10 }} />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line dataKey="fund" stroke="#5b6fb6" dot={false} name="本基金" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">业绩表现</div>
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-white/[0.1]"><th className="text-left">指标</th><th>本基金</th><th>同类平均</th><th>同类排名</th></tr></thead>
                      <tbody>
                        {performanceRows.map((row: any) => (
                          <tr key={row.key} className="border-b border-white/[0.06] text-center">
                            <td className="text-left">{row.label}</td>
                            <td>{pct(row.value)}</td>
                            <td>{pct(row.peerAverage)}</td>
                            <td>{row.rank && row.total ? `${row.rank}/${row.total}` : "--"}</td>
                          </tr>
                        ))}
                        <tr className="border-b border-white/[0.06] text-center"><td className="text-left">Sharpe(年化)</td><td>{num(fund.performance?.sharpeRatio ?? risk.sharpe)}</td><td>--</td><td>--</td></tr>
                        <tr className="border-b border-white/[0.06] text-center"><td className="text-left">最大回撤</td><td>{pct(fund.performance?.maxDrawdown ?? risk.maxDrawdown)}</td><td>--</td><td>--</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-2 flex items-center gap-2 text-sm">
                      <span>盈利预测（历史滚动窗口）</span>
                      {horizonOptions.map((h) => <button key={h} className={`rounded border px-1.5 py-0.5 ${horizon === h ? "border-[#4c7fff] text-[#9ec0ff]" : "border-white/[0.2] text-white/70"}`} onClick={() => setHorizon(h)}>{h}</button>)}
                    </div>
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-white/[0.1]"><th className="text-left">盈利区间</th><th>区间概率</th><th>亏损概率</th></tr></thead>
                      <tbody>{profitBuckets.map((b) => <tr key={b.key} className="border-b border-white/[0.06]"><td>{b.label}</td><td>{b.profitProb.toFixed(2)}%</td><td>{b.lossProb.toFixed(2)}%</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}

              {tab === "risk" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">风险分析</div>
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            ["最大回撤", pct(risk.maxDrawdown)],
                            ["下行风险(年化)", pct(risk.downsideRisk)],
                            ["年化波动率", pct(risk.volatility)],
                            ["Sharpe(年化)", num(risk.sharpe)],
                            ["Sortino", num(risk.sortino)],
                            ["VaR(95%)", pct(risk.var95)],
                            ["CVaR(95%)", pct(risk.cvar95)],
                            ["最差单月", pct(risk.worstMonth)],
                            ["日胜率", pct(risk.winRate)],
                          ].map((r) => <tr key={r[0]} className="border-b border-white/[0.06]"><td>{r[0]}</td><td className="text-right">{r[1]}</td></tr>)}
                        </tbody>
                      </table>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis type="number" dataKey="x" name="年化波动率" />
                            <YAxis type="number" dataKey="y" name="下行风险" />
                            <Tooltip />
                            <Scatter data={[{ x: risk.volatility ?? 0, y: risk.downsideRisk ?? 0 }]} fill="#5b6fb6" name="本基金" />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">动态回撤</div>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={navSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="d" tick={{ fontSize: 10 }} />
                          <YAxis />
                          <Tooltip />
                          <Line dataKey="dd" stroke="#5b6fb6" dot={false} name="本基金回撤" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">VaR 分布</div>
                      <div className="h-[230px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={varHistogram}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="density" fill="#5b6fb6" name="频率" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">历史压力区间</div>
                      <div className="h-[230px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stressBars}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="fund" fill="#5b6fb6" name="回撤(%)" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab === "fundamental" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">资产分布</div>
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Tooltip />
                            <Legend />
                            <Pie
                              data={(fund.assetAllocation || []).map((x: any) => ({
                                name: x.name,
                                value: (n(x.ratio) ?? 0) * ((n(x.ratio) ?? 0) > 1 ? 1 : 100),
                              }))}
                              dataKey="value"
                              nameKey="name"
                              outerRadius={80}
                              fill="#5b6fb6"
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">行业配置</div>
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart layout="vertical" data={holdingsByIndustry}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis type="number" />
                            <YAxis type="category" dataKey="k" width={90} />
                            <Tooltip />
                            <Bar dataKey="f" fill="#5b6fb6" name="占净值比例(%)" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">行业配置（历史）</div>
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={industryHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          {industryHistory.length > 0
                            ? Object.keys(industryHistory[0]).filter((k) => k !== "period").map((k, idx) => (
                              <Line key={k} dataKey={k} stroke={["#5b6fb6", "#46c6c2", "#e9ab60", "#5ca8df", "#dfca58", "#b07be3"][idx % 6]} dot={false} />
                            ))
                            : null}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">重仓股票 / 债券</div>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th>代码</th><th>名称</th><th>占比</th><th>行业/品类</th><th>近一日</th></tr></thead>
                        <tbody>
                          {(fund.holdings || []).slice(0, 12).map((h: any) => (
                            <tr key={`${h.stockCode}-${h.stockName}`} className="border-b border-white/[0.06] text-center">
                              <td>{h.stockCode}</td><td>{h.stockName}</td><td>{pct((n(h.ratio) ?? 0) * ((n(h.ratio) ?? 0) > 1 ? 1 : 100))}</td><td>{h.industry || "--"}</td><td className={(n(h.dailyChange) ?? 0) >= 0 ? "text-[#ff6b6b]" : "text-[#2ec27e]"}>{pct(h.dailyChange)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">分红记录</div>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th>除权日</th><th>派现(元)</th><th>支付日</th></tr></thead>
                        <tbody>
                          {(fund.dividends || []).slice(0, 12).map((d: any, idx: number) => (
                            <tr key={`${d.exDate}-${idx}`} className="border-b border-white/[0.06] text-center"><td>{d.exDate || "--"}</td><td>{num(d.cash, 4)}</td><td>{d.payDate || "--"}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {tab === "manager" && (
                <div className="space-y-3">
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">基金经理基本信息</div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>姓名：{managerQ.data?.name || fund.manager?.name || "--"}</div>
                      <div>从业年限：{managerQ.data?.manageYears || fund.manager?.manageYears || "--"}</div>
                      <div>在任基金数：{managerQ.data?.fundCount || managerFunds.length || "--"}</div>
                      <div>在管规模：{managerQ.data?.totalScale || fund.manager?.totalScale || "--"} 亿</div>
                      <div>平均1年回报：{managerQ.data?.avgReturn1y ? `${managerQ.data.avgReturn1y}%` : "--"}</div>
                      <div>平均Sharpe：{managerQ.data?.avgSharpe || "--"}</div>
                    </div>
                  </div>

                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">同花顺综合评分（数据映射）</div>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={abilityRadar}>
                          <PolarGrid />
                          <PolarAngleAxis dataKey="k" />
                          <PolarRadiusAxis domain={[0, 100]} />
                          <Radar dataKey="f" stroke="#5b6fb6" fill="#5b6fb6" fillOpacity={0.24} name="本基金" />
                          <Radar dataKey="p" stroke="#46c6c2" fill="#46c6c2" fillOpacity={0.12} name="基准" />
                          <Legend />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">经理在管基金（回报对比）</div>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={managerBars}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="return1y" fill="#5b6fb6" name="近1年(%)" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">在管基金明细</div>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th>代码</th><th>名称</th><th>近1年</th><th>夏普</th></tr></thead>
                        <tbody>
                          {managerFunds.slice(0, 12).map((f: any) => (
                            <tr key={f.fundCode} className="border-b border-white/[0.06] text-center"><td>{f.fundCode}</td><td>{f.fundAbbr || f.fundName}</td><td>{pct(f.performance?.return1y)}</td><td>{num(f.performance?.sharpeRatio)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {tab === "company" && (
                <div className="space-y-3">
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">旗下基金业绩（按类型聚合）</div>
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={companyByType}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="t" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="avgReturn1y" fill="#5b6fb6" name="平均1年收益(%)" />
                          <Bar dataKey="count" fill="#46c6c2" name="基金数量" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">基金公司样本明细</div>
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-white/[0.1]"><th>基金代码</th><th>基金简称</th><th>类型</th><th>近1年</th><th>夏普</th><th>最大回撤</th></tr></thead>
                      <tbody>
                        {companyFunds.slice(0, 20).map((f: any) => (
                          <tr key={f.fundCode} className="border-b border-white/[0.06] text-center"><td>{f.fundCode}</td><td>{f.fundAbbr || f.fundName}</td><td>{f.category || f.fundType || "--"}</td><td>{pct(f.performance?.return1y)}</td><td>{num(f.performance?.sharpeRatio)}</td><td>{pct(f.performance?.maxDrawdown)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">公司样本数：{companyFunds.length} 只</div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">可用风险数据：{companyFunds.filter((f: any) => n(f.performance?.sharpeRatio) !== null || n(f.performance?.maxDrawdown) !== null).length} 只</div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">平均近1年收益：{companyByType.length ? `${(companyByType.reduce((a, b) => a + b.avgReturn1y, 0) / companyByType.length).toFixed(2)}%` : "--"}</div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">基金类型覆盖：{companyByType.length} 类</div>
                  </div>
                </div>
              )}
            </div>
          </main>

          <aside className="space-y-3">
            <div className="rounded border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基金评级</div>
              <div className="space-y-2 p-3 text-sm">
                <div className="flex items-center justify-between"><span>基金评级3年</span><span className="inline-flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < Math.max(1, Math.round(score / 20)) ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</span></div>
                <div className="flex items-center justify-between"><span>基金评级5年</span><span className="inline-flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < Math.max(1, Math.round(score / 25)) ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</span></div>
              </div>
            </div>

            <div className="rounded border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基金业绩</div>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["近1年", pct(r1y?.value ?? fund.performance?.return1y)],
                    ["近3年", pct(fund.performance?.return3y)],
                    ["近5年", pct(fund.performance?.return5y)],
                    ["年化收益", annualized === null ? "--" : `${annualized.toFixed(2)}%`],
                    ["夏普", num(fund.performance?.sharpeRatio ?? risk.sharpe)],
                    ["Sortino", num(fund.performance?.sortinoRatio ?? risk.sortino)],
                    ["最大回撤", pct(fund.performance?.maxDrawdown ?? risk.maxDrawdown)],
                    ["综合得分", String(score)],
                  ].map((r) => (
                    <tr key={r[0]} className="border-b border-white/[0.06]"><td className="px-3 py-1">{r[0]}</td><td className="px-3 py-1 text-right text-[#9fbfff]">{r[1]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基本信息</div>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["成立日期", fund.establishDate || "--"],
                    ["基金状态", "正在运行"],
                    ["基金公司", fund.company || "--"],
                    ["基金经理", fund.manager?.name || "--"],
                    ["基金规模", `${fund.totalScale || "--"}亿`],
                    ["投资类型", fund.category || fund.fundType || "--"],
                    ["投资风格", fund.manager?.investmentStyle || "--"],
                    ["比较基准", fund.benchmark || "--"],
                  ].map((r) => (
                    <tr key={r[0]} className="border-b border-white/[0.06]"><td className="px-3 py-1">{r[0]}</td><td className="px-3 py-1 text-right">{r[1]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
