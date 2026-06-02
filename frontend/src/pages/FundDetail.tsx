import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, BarChart3, Building2, RefreshCw, ShieldAlert, Star, UserRound, AlertCircle } from "lucide-react";
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
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/providers/trpc";
import { getChangeTextClass } from "@/lib/colors";

type TabKey = "overview" | "risk" | "fundamental" | "manager" | "company";
type HorizonKey = "1w" | "1m" | "3m" | "6m" | "1y";
type RangeKey = "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "MAX";

const tabs: { key: TabKey; label: string }[] = [
  { key: "overview", label: "业绩能力" },
  { key: "risk", label: "风险控制" },
  { key: "fundamental", label: "持仓与资产" },
  { key: "manager", label: "基金经理" },
  { key: "company", label: "基金公司" },
];

const rangeOptions: RangeKey[] = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"];
const horizonOptions: HorizonKey[] = ["1w", "1m", "3m", "6m", "1y"];
const chartColors = ["hsl(var(--primary))", "#46c6c2", "#e9ab60", "#5ca8df", "#dfca58", "#b07be3"];

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "—" || v === "--") return null;
  const x = parseFloat(String(v).replace("%", ""));
  return Number.isFinite(x) ? x : null;
}

function pct(v: unknown, digits = 2): string {
  const x = n(v);
  return x === null ? "—" : `${x.toFixed(digits)}%`;
}

function num(v: unknown, digits = 2): string {
  const x = n(v);
  return x === null ? "—" : x.toFixed(digits);
}

function ratioPct(v: unknown): number {
  const x = n(v) ?? 0;
  return x > 1 ? x : x * 100;
}

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === "" || v === "—" || v === "--";
}

function formatFee(v: unknown): string {
  const x = n(v);
  if (x === null) return "—";
  return `${(x <= 1 ? x * 100 : x).toFixed(2)}%`;
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
  if (range === "YTD") from = new Date(`${new Date(latest).getFullYear()}-01-01`).getTime();
  const filtered = points.filter((p) => new Date(p.d).getTime() >= from);
  return filtered.length >= 2 ? filtered : points;
}

function rollingReturns(points: Array<{ d: string; nav: number }>, horizon: HorizonKey): number[] {
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

  return { sharpe, sortino, maxDrawdown, volatility: vol, downsideRisk, winRate, var95, cvar95, worstMonth, dailyReturns, drawdownSeries };
}

function EmptyState({ label = "暂无数据" }: { label?: string }) {
  return <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-muted-foreground">{label}</div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card text-card-foreground">
      <div className="border-b px-4 py-3 text-sm font-medium">{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border bg-popover px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 data-number text-lg font-semibold ${tone || "text-foreground"}`}>{value}</div>
    </div>
  );
}

export default function FundDetail() {
  const location = useLocation();
  const { code: codeParam } = useParams<{ code: string }>();
  const code = codeParam || "";
  const from = (location.state as { from?: string } | null)?.from || "/";

  const detailQuery = trpc.fund.detailByCode.useQuery({ code }, { enabled: /^\d{6}$/.test(code) });
  const fund = detailQuery.data;
  const loading = detailQuery.isLoading;
  const err = detailQuery.error;

  const [tab, setTab] = useState<TabKey>("overview");
  const [range, setRange] = useState<RangeKey>("1Y");
  const [horizon, setHorizon] = useState<HorizonKey>("1m");
  const [partialRetries, setPartialRetries] = useState(0);

  useEffect(() => {
    if (!fund?._partial || partialRetries >= 6) return;
    const timer = window.setTimeout(() => {
      setPartialRetries((value) => value + 1);
      detailQuery.refetch();
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [detailQuery, fund?._partial, partialRetries]);

  const peerQ = trpc.fund.peerPerformanceRanking.useQuery(
    { code },
    { enabled: Boolean(fund) && /^\d{6}$/.test(code) && tab === "overview" },
  );
  const managerQ = trpc.fund.managerDetail.useQuery(
    { id: fund?.managerId || 0 },
    { enabled: Boolean(fund?.managerId) && tab === "manager" },
  );
  const companyFundsQ = trpc.fund.list.useQuery(
    { company: fund?.company, page: 1, pageSize: 300, sortBy: "return1y", sortOrder: "desc", withMetrics: true },
    { enabled: Boolean(fund?.company) && tab === "company" },
  );

  const navPoints = useMemo(
    () => ((fund?.navHistory || [])
      .map((x: any) => ({ d: String(x.navDate || ""), nav: n(x.nav) }))
      .filter((x: any) => x.d && x.nav !== null && x.nav > 0)
      .sort((a: any, b: any) => a.d.localeCompare(b.d)) as Array<{ d: string; nav: number }>),
    [fund?.navHistory],
  );
  const scopedPoints = useMemo(() => filterByRange(navPoints, range), [navPoints, range]);
  const risk = useMemo(() => computeRisk(scopedPoints), [scopedPoints]);
  const annualized = useMemo(() => calcAnnualized(scopedPoints), [scopedPoints]);
  const rolling = useMemo(() => rollingReturns(navPoints, horizon), [navPoints, horizon]);

  const navSeries = useMemo(() => {
    if (!scopedPoints.length) return [];
    const base = scopedPoints[0].nav;
    return scopedPoints.map((x) => ({
      d: x.d.slice(5),
      fund: base > 0 ? ((x.nav / base) - 1) * 100 : 0,
      dd: risk.drawdownSeries.find((d) => d.d === x.d)?.dd ?? 0,
    }));
  }, [scopedPoints, risk.drawdownSeries]);

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
    { k: "收益", value: Math.max(0, Math.min(100, 50 + (n(fund?.performance?.return1y) ?? 0))), base: 50 },
    { k: "回撤", value: Math.max(0, Math.min(100, 90 - Math.abs(n(fund?.performance?.maxDrawdown) ?? risk.maxDrawdown ?? 0) * 2)), base: 50 },
    { k: "波动", value: Math.max(0, Math.min(100, 90 - (risk.volatility ?? 0))), base: 50 },
    { k: "持仓", value: Math.max(0, Math.min(100, 35 + (fund?.holdings?.length || 0) * 5)), base: 50 },
    { k: "经理", value: Math.max(0, Math.min(100, 35 + (n(fund?.manager?.manageYears) ?? 0) * 8)), base: 50 },
  ]), [fund?.performance?.return1y, fund?.performance?.maxDrawdown, risk.maxDrawdown, risk.volatility, fund?.holdings?.length, fund?.manager?.manageYears]);

  const holdingsByIndustry = useMemo(() => {
    const source = (fund?.industries || []).length
      ? fund.industries.map((x: any) => ({ k: x.industry, v: ratioPct(x.ratio) }))
      : (fund?.holdings || []).map((x: any) => ({ k: x.industry || "其他", v: ratioPct(x.ratio) }));
    const map = new Map<string, number>();
    source.forEach((x: any) => map.set(x.k, (map.get(x.k) || 0) + x.v));
    return Array.from(map.entries())
      .map(([k, value]) => ({ k, value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [fund?.industries, fund?.holdings]);

  const industryHistory = useMemo(() => {
    const raw = fund?.industryHistory || [];
    const points = raw
      .map((x: any) => ({
        period: String(x.quarter || x.period || x.reportDate || x.date || ""),
        industry: String(x.industry || x.name || ""),
        ratio: ratioPct(x.ratio),
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
    return buckets.map((b) => ({ ...b, probability: (b.count / total) * 100 }));
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
    return data.map((x) => ({ ...x, density: Number((x.density / values.length).toFixed(3)) }));
  }, [risk.dailyReturns]);

  const stressBars = useMemo(
    () => [...risk.drawdownSeries].sort((a, b) => a.dd - b.dd).slice(0, 3).map((x, idx) => ({ name: `压力${idx + 1}`, date: x.d, drawdown: x.dd })),
    [risk.drawdownSeries],
  );

  const managerFunds = managerQ.data?.funds || [];
  const managerBars = useMemo(
    () => managerFunds.slice(0, 10).map((f: any) => ({ name: (f.fundAbbr || f.fundName || f.fundCode || "").slice(0, 8), return1y: n(f.performance?.return1y) ?? 0 })),
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
    return Array.from(map.entries()).map(([type, x]) => ({
      type,
      avgReturn1y: x.returns.length ? x.returns.reduce((a, b) => a + b, 0) / x.returns.length : 0,
      count: x.count,
    })).sort((a, b) => b.count - a.count);
  }, [companyFunds]);

  if (loading) {
    return <div className="min-h-screen pt-20 text-center text-muted-foreground">加载基金详情中...</div>;
  }
  if (err || !fund) {
    const errMessage = err instanceof Error ? err.message : String(err || "");
    return (
      <div className="min-h-screen pt-20 text-center">
        <div className="inline-flex flex-col items-center gap-3 rounded-lg border bg-card p-6 text-card-foreground">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div className="text-lg font-medium">基金详情加载失败</div>
          {errMessage && (
            <div className="max-w-md text-sm text-muted-foreground">{errMessage}</div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => detailQuery.refetch()}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              重试
            </button>
            <Link
              to={from}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-secondary"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const fundName = fund.fundName || fund.fundAbbr || fund.fundCode || "--";
  const isPartial = Boolean((fund as any)?._partial);
  const navDate = fund.navDate || fund.nav_date || navPoints[navPoints.length - 1]?.d || "—";
  const basicRows = [
    ["成立日期", fund.establishDate || "—"],
    ["基金公司", fund.company || "—"],
    ["基金经理", fund.manager?.name || "—"],
    ["基金规模", `${fund.totalScale || "—"} 亿元`],
    ["投资类型", fund.category || fund.fundType || "—"],
    ["比较基准", fund.benchmark || "—"],
    ["管理费", formatFee(fund.feeManage)],
    ["托管费", formatFee(fund.feeCustody)],
  ];

  return (
    <div className="min-h-screen pb-8 pt-14">
      <div className="mx-auto max-w-[1440px] px-3 md:px-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link to={from} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <span>/</span>
          <span className="truncate">{fundName}</span>
          {isPartial && (
            <button
              onClick={() => detailQuery.refetch()}
              className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-secondary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              补全数据中
            </button>
          )}
        </div>

        <section className="rounded-lg border bg-card text-card-foreground">
          <div className="grid gap-4 p-4 xl:grid-cols-[1fr_440px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold md:text-3xl">{fundName}</h1>
                <span className="rounded-md border px-2 py-1 data-number text-sm text-muted-foreground">{fund.fundCode}</span>
                <span className="rounded-md bg-secondary px-2 py-1 text-xs">{fund.category || fund.fundType || "其他"}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric label="单位净值" value={num(fund.nav, 4)} />
                <Metric label="日涨跌" value={pct(fund.dailyChange)} tone={getChangeTextClass(fund.dailyChange)} />
                <Metric label="累计净值" value={num(fund.accumNav, 4)} />
                <Metric label="净值日期" value={String(navDate)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label="近1月" value={pct(r1m?.value ?? fund.performance?.return1m)} tone={getChangeTextClass(r1m?.value ?? fund.performance?.return1m)} />
              <Metric label="近3月" value={pct(r3m?.value ?? fund.performance?.return3m)} tone={getChangeTextClass(r3m?.value ?? fund.performance?.return3m)} />
              <Metric label="近6月" value={pct(r6m?.value ?? fund.performance?.return6m)} tone={getChangeTextClass(r6m?.value ?? fund.performance?.return6m)} />
              <Metric label="近1年" value={pct(r1y?.value ?? fund.performance?.return1y)} tone={getChangeTextClass(r1y?.value ?? fund.performance?.return1y)} />
              <Metric label="年化收益" value={annualized === null ? pct(fund.performance?.annualizedReturn) : `${annualized.toFixed(2)}%`} tone={getChangeTextClass(annualized ?? fund.performance?.annualizedReturn)} />
              <Metric label="最大回撤" value={pct(fund.performance?.maxDrawdown ?? risk.maxDrawdown)} tone={getChangeTextClass(-(Math.abs(n(fund.performance?.maxDrawdown) ?? risk.maxDrawdown ?? 0)))} />
            </div>
          </div>
          {isPartial && (
            <div className="border-t px-4 py-2 text-sm text-muted-foreground">
              已先展示本地快照，净值历史、持仓、行业和公司数据会在后台补全。
            </div>
          )}
        </section>

        <div className="mt-3 flex gap-2 overflow-x-auto rounded-lg border bg-card p-2">
          {tabs.map((item) => (
            <button
              key={item.key}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${tab === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0 space-y-3">
            {tab === "overview" && (
              <>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
                  <Panel title="综合评分">
                    <div className="flex h-[220px] flex-col items-center justify-center">
                      <div className="data-number text-7xl font-semibold">{score}</div>
                      <div className="mt-2 text-sm text-muted-foreground">{score >= 85 ? "表现优秀" : score >= 70 ? "表现良好" : "需要观察"}</div>
                    </div>
                  </Panel>
                  <Panel title="能力雷达">
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={abilityRadar}>
                          <PolarGrid stroke="hsl(var(--border))" />
                          <PolarAngleAxis dataKey="k" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                          <Radar dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} name="本基金" />
                          <Radar dataKey="base" stroke="#46c6c2" fill="#46c6c2" fillOpacity={0.1} name="基准" />
                          <Legend />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </Panel>
                </div>

                <Panel title="累计收益趋势">
                  <div className="mb-3 flex flex-wrap gap-2">
                    {rangeOptions.map((item) => (
                      <button key={item} className={`rounded-md border px-2 py-1 text-xs ${range === item ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`} onClick={() => setRange(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="h-[320px]">
                    {navSeries.length === 0 ? <EmptyState /> : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={navSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="d" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend />
                          <Line dataKey="fund" stroke="hsl(var(--primary))" dot={false} name="累计收益(%)" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Panel>

                <Panel title="同类业绩表现">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="text-muted-foreground">
                        <tr className="border-b"><th className="py-2 text-left">指标</th><th className="text-right">本基金</th><th className="text-right">同类平均</th><th className="text-right">同类排名</th></tr>
                      </thead>
                      <tbody>
                        {performanceRows.length === 0 ? (
                          <tr><td colSpan={4}><EmptyState label={peerQ.isLoading ? "同类数据加载中..." : "暂无同类数据"} /></td></tr>
                        ) : performanceRows.map((row: any) => (
                          <tr key={row.key} className="border-b">
                            <td className="py-2">{row.label}</td>
                            <td className={`text-right ${getChangeTextClass(row.value)}`}>{pct(row.value)}</td>
                            <td className="text-right">{pct(row.peerAverage)}</td>
                            <td className="text-right">{row.rank && row.total ? `${row.rank}/${row.total}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                <Panel title="滚动收益分布">
                  <div className="mb-3 flex flex-wrap gap-2">
                    {horizonOptions.map((item) => (
                      <button key={item} className={`rounded-md border px-2 py-1 text-xs ${horizon === item ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`} onClick={() => setHorizon(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {profitBuckets.map((bucket) => (
                      <Metric key={bucket.key} label={bucket.label} value={`${bucket.probability.toFixed(1)}%`} />
                    ))}
                  </div>
                </Panel>
              </>
            )}

            {tab === "risk" && (
              <>
                <Panel title="风险指标">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <Metric label="最大回撤" value={pct(fund.performance?.maxDrawdown ?? risk.maxDrawdown)} />
                    <Metric label="年化波动" value={pct(risk.volatility)} />
                    <Metric label="下行风险" value={pct(risk.downsideRisk)} />
                    <Metric label="Sharpe" value={num(fund.performance?.sharpeRatio ?? risk.sharpe)} />
                    <Metric label="Sortino" value={num(fund.performance?.sortinoRatio ?? risk.sortino)} />
                    <Metric label="日胜率" value={pct(risk.winRate)} />
                    <Metric label="VaR 95%" value={pct(risk.var95)} />
                    <Metric label="CVaR 95%" value={pct(risk.cvar95)} />
                    <Metric label="最差单月" value={pct(risk.worstMonth)} />
                  </div>
                </Panel>
                <Panel title="动态回撤">
                  <div className="h-[300px]">
                    {navSeries.length === 0 ? <EmptyState /> : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={navSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="d" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Line dataKey="dd" stroke="hsl(var(--primary))" dot={false} name="回撤(%)" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Panel>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <Panel title="VaR 分布">
                    <div className="h-[260px]">
                      {varHistogram.length === 0 ? <EmptyState /> : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={varHistogram}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="density" fill="hsl(var(--primary))" name="频率" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </Panel>
                  <Panel title="历史压力区间">
                    <div className="h-[260px]">
                      {stressBars.length === 0 ? <EmptyState /> : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stressBars}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="drawdown" fill="#e9ab60" name="回撤(%)" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </Panel>
                </div>
              </>
            )}

            {tab === "fundamental" && (
              <>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <Panel title="资产分布">
                    <div className="h-[260px]">
                      {(!fund.assetAllocation || fund.assetAllocation.length === 0) ? <EmptyState /> : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Tooltip />
                            <Legend />
                            <Pie data={(fund.assetAllocation || []).map((x: any) => ({ name: x.name, value: ratioPct(x.ratio) }))} dataKey="value" nameKey="name" outerRadius={90} fill="hsl(var(--primary))" />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </Panel>
                  <Panel title="行业配置">
                    <div className="h-[260px]">
                      {holdingsByIndustry.length === 0 ? <EmptyState /> : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart layout="vertical" data={holdingsByIndustry}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="k" width={92} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="value" fill="hsl(var(--primary))" name="占比(%)" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </Panel>
                </div>
                <Panel title="行业配置历史">
                  <div className="h-[300px]">
                    {industryHistory.length === 0 ? <EmptyState /> : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={industryHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend />
                          {Object.keys(industryHistory[0]).filter((k) => k !== "period").map((key, idx) => (
                            <Line key={key} dataKey={key} stroke={chartColors[idx % chartColors.length]} dot={false} />
                          ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Panel>
                <Panel title="重仓明细">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                      <thead className="text-muted-foreground">
                        <tr className="border-b"><th className="py-2 text-left">代码</th><th className="text-left">名称</th><th className="text-right">占比</th><th className="text-left">行业/品类</th><th className="text-right">近一日</th></tr>
                      </thead>
                      <tbody>
                        {(!fund.holdings || fund.holdings.length === 0) ? (
                          <tr><td colSpan={5}><EmptyState /></td></tr>
                        ) : fund.holdings.slice(0, 20).map((h: any) => (
                          <tr key={`${h.stockCode}-${h.stockName}`} className="border-b">
                            <td className="py-2 data-number">{h.stockCode || "—"}</td>
                            <td>{h.stockName || "—"}</td>
                            <td className="text-right">{pct(ratioPct(h.ratio))}</td>
                            <td>{h.industry || "—"}</td>
                            <td className={`text-right ${getChangeTextClass(h.dailyChange)}`}>{isMissing(h.dailyChange) ? "—" : pct(h.dailyChange)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            )}

            {tab === "manager" && (
              <>
                <Panel title="基金经理概览">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <Metric label="姓名" value={managerQ.data?.name || fund.manager?.name || "—"} />
                    <Metric label="从业年限" value={String(managerQ.data?.manageYears || fund.manager?.manageYears || "—")} />
                    <Metric label="在管基金" value={String(managerQ.data?.fundCount || managerFunds.length || "—")} />
                    <Metric label="在管规模" value={`${managerQ.data?.totalScale || fund.manager?.totalScale || "—"} 亿元`} />
                    <Metric label="任职回报" value={pct(fund.manager?.returnSinceTenure)} />
                    <Metric label="年化回报" value={pct(fund.manager?.annualizedReturn)} />
                  </div>
                </Panel>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <Panel title="在管基金回报">
                    <div className="h-[280px]">
                      {managerBars.length === 0 ? <EmptyState label={managerQ.isLoading ? "经理数据加载中..." : "暂无数据"} /> : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={managerBars}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="return1y" fill="hsl(var(--primary))" name="近1年(%)" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </Panel>
                  <Panel title="经理在管明细">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[460px] text-sm">
                        <thead className="text-muted-foreground"><tr className="border-b"><th className="py-2 text-left">代码</th><th className="text-left">名称</th><th className="text-right">近1年</th><th className="text-right">Sharpe</th></tr></thead>
                        <tbody>
                          {managerFunds.length === 0 ? <tr><td colSpan={4}><EmptyState /></td></tr> : managerFunds.slice(0, 12).map((f: any) => (
                            <tr key={f.fundCode} className="border-b"><td className="py-2 data-number">{f.fundCode}</td><td>{f.fundAbbr || f.fundName}</td><td className="text-right">{pct(f.performance?.return1y)}</td><td className="text-right">{num(f.performance?.sharpeRatio)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                </div>
              </>
            )}

            {tab === "company" && (
              <>
                <Panel title="公司产品结构">
                  <div className="h-[300px]">
                    {companyByType.length === 0 ? <EmptyState label={companyFundsQ.isLoading ? "公司数据加载中..." : "暂无数据"} /> : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={companyByType}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="avgReturn1y" fill="hsl(var(--primary))" name="平均近1年(%)" />
                          <Bar dataKey="count" fill="#46c6c2" name="基金数量" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Panel>
                <Panel title="公司样本明细">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="text-muted-foreground"><tr className="border-b"><th className="py-2 text-left">代码</th><th className="text-left">简称</th><th className="text-left">类型</th><th className="text-right">近1年</th><th className="text-right">Sharpe</th><th className="text-right">最大回撤</th></tr></thead>
                      <tbody>
                        {companyFunds.length === 0 ? <tr><td colSpan={6}><EmptyState /></td></tr> : companyFunds.slice(0, 30).map((f: any) => (
                          <tr key={f.fundCode} className="border-b"><td className="py-2 data-number">{f.fundCode}</td><td>{f.fundAbbr || f.fundName}</td><td>{f.category || f.fundType || "—"}</td><td className="text-right">{pct(f.performance?.return1y)}</td><td className="text-right">{num(f.performance?.sharpeRatio)}</td><td className="text-right">{pct(f.performance?.maxDrawdown)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            )}
          </main>

          <aside className="space-y-3">
            <Panel title="核心信息">
              <div className="space-y-2">
                {basicRows.map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 border-b pb-2 text-sm last:border-b-0 last:pb-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="max-w-[210px] text-right">{value}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="基金评级">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">综合评分</span>
                  <span className="data-number text-lg font-semibold">{score}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">星级</span>
                  <span className="inline-flex">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`h-4 w-4 ${i < Math.max(1, Math.round(score / 20)) ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                    ))}
                  </span>
                </div>
              </div>
            </Panel>
            <Panel title="数据覆盖">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="净值点数" value={String(navPoints.length)} />
                <Metric label="持仓数" value={String(fund.holdings?.length || 0)} />
                <Metric label="资产项" value={String(fund.assetAllocation?.length || 0)} />
                <Metric label="分红数" value={String(fund.dividends?.length || 0)} />
              </div>
            </Panel>
            <Panel title="快捷状态">
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4" />{navPoints.length > 20 ? "净值历史可用" : "净值历史待补全"}</div>
                <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" />{risk.maxDrawdown !== null ? "风险指标已计算" : "风险指标待计算"}</div>
                <div className="flex items-center gap-2"><UserRound className="h-4 w-4" />{fund.manager?.name ? "经理信息可用" : "经理信息待补全"}</div>
                <div className="flex items-center gap-2"><Building2 className="h-4 w-4" />{fund.company ? "公司信息可用" : "公司信息待补全"}</div>
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
