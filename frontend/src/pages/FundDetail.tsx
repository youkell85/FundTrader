import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, RefreshCw, AlertCircle, Star } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/providers/trpc";
import { getChangeTextClass } from "@/lib/colors";
import {
  num,
  pct,
  numFmt,
  emptyPeerSeries,
  PERF_COLS,
  type PeerSeries,
  type PerfRow,
  emptyPerfCell,
  ratioPct,
} from "@/lib/fund-data";
import { Panel } from "@/components/report/Panel";
import { ReportLayout } from "@/components/report/ReportLayout";
import { ReportSection } from "@/components/report/ReportSection";
import { AnchorNav } from "@/components/report/AnchorNav";
import { MissingPanel } from "@/components/report/MissingPanel";
import { ChangeCell } from "@/components/report/ChangeCell";

// 沿用旧 range 切换（与 PDF 8 个区间一致）
const RANGE_OPTIONS = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number];

// 4 系列颜色：与 PDF 一致
const SERIES_COLORS = {
  fund: "#3B6CFF",
  peer: "#46C6C2",
  index: "#E9AB60",
  bench: "#5CA8DF",
};

// 多分类饼图/柱图色板
const chartColors = ["#3B6CFF", "#46C6C2", "#E9AB60", "#5CA8DF", "#9D7BFF", "#FFB800"];

// 统一 Tooltip 样式：半透明背景+紧凑
const TOOLTIP_STYLE = {
  backgroundColor: "rgba(255,255,255,0.95)",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 12,
  padding: "6px 10px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

const ANCHOR_ITEMS = [
  { id: "perf", label: "业绩表现" },
  { id: "history", label: "历史回报" },
  { id: "scale", label: "规模 · 换手" },
  { id: "risk", label: "风险分析" },
  { id: "alloc", label: "资产 · 行业" },
  { id: "holdings", label: "重仓明细" },
  { id: "manager", label: "基金经理" },
  { id: "report", label: "运作分析" },
];

// === 工具：日期范围过滤 ===
function filterByRange(
  points: Array<{ d: string; nav: number }>,
  range: RangeKey,
) {
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

// === 风险（基础 1y 窗口，front-end 可算） ===
function computeRisk(points: Array<{ d: string; nav: number }>) {
  if (points.length < 3) {
    return {
      sharpe: null as number | null,
      sortino: null as number | null,
      maxDrawdown: null as number | null,
      volatility: null as number | null,
      downsideRisk: null as number | null,
      monthWinRate: null as number | null,
      diagnosticScore: null as number | null,
      worstMonth: null as number | null,
      drawdownSeries: [] as Array<{ d: string; dd: number }>,
    };
  }
  const returns: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].nav;
    const cur = points[i].nav;
    if (prev > 0) returns.push((cur - prev) / prev);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252) * 100;
  let peak = points[0].nav;
  const drawdownSeries = points.map((p) => {
    peak = Math.max(peak, p.nav);
    return { d: p.d, dd: peak > 0 ? ((p.nav - peak) / peak) * 100 : 0 };
  });
  const maxDrawdown = drawdownSeries.reduce((m, x) => Math.min(m, x.dd), 0);
  const rfDaily = 0.02 / 252;
  const sharpe = vol > 0 ? ((mean - rfDaily) * 252) / (vol / 100) : null;
  // Sortino
  const downside = returns.filter((r) => r < 0);
  const dMean = downside.length ? downside.reduce((a, b) => a + b, 0) / downside.length : 0;
  const dVar = downside.length
    ? downside.reduce((a, b) => a + (b - dMean) ** 2, 0) / Math.max(1, downside.length - 1)
    : 0;
  const downsideRisk = Math.sqrt(dVar) * Math.sqrt(252) * 100;
  const sortino = downsideRisk > 0 ? ((mean - rfDaily) * 252) / (downsideRisk / 100) : null;
  // 月胜率
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
  const monthWinRate =
    monthReturns.length > 0
      ? (monthReturns.filter((r) => r > 0).length / monthReturns.length) * 100
      : null;
  const worstMonth = monthReturns.length ? Math.min(...monthReturns) : null;
  // 诊断得分（简化规则：60 + 年化收益*0.6 + 夏普*8 - |回撤|）
  let diagnosticScore: number | null = null;
  if (sharpe !== null) {
    const annRet = mean * 252 * 100;
    diagnosticScore = Math.max(
      1,
      Math.min(99, Math.round(60 + annRet * 0.6 + sharpe * 8 - Math.abs(maxDrawdown))),
    );
  }
  return {
    sharpe,
    sortino,
    maxDrawdown,
    volatility: vol,
    downsideRisk,
    monthWinRate,
    diagnosticScore,
    worstMonth,
    drawdownSeries,
  };
}

function EmptyState({ label = "暂无数据" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border bg-popover px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 data-number text-lg font-semibold ${tone || "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

/** 业绩块 / 风险块内单行 key-value 渲染：suffix 为 % 时自动涨跌着色。 */
function PerfRow({
  k,
  v,
  k2,
  suffix,
}: {
  k: string;
  v: unknown;
  k2?: string | null;
  suffix?: string;
}) {
  const n = num(v);
  const display = k2 !== undefined ? k2 : n === null ? "—" : suffix === "%" ? pct(n) : numFmt(n);
  const tone = k2 !== undefined || n === null || suffix !== "%" ? "" : getChangeTextClass(n);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className={`data-number font-semibold ${tone}`}>{display}</span>
    </div>
  );
}

export default function FundDetail() {
  const location = useLocation();
  const { code: codeParam } = useParams<{ code: string }>();
  const code = codeParam || "";
  const from = (location.state as { from?: string } | null)?.from || "/";

  const detailQuery = trpc.fund.detailByCode.useQuery(
    { code },
    { enabled: /^\d{6}$/.test(code) },
  );
  const fund = detailQuery.data;
  const loading = detailQuery.isLoading;
  const err = detailQuery.error;

  // === 详情页 9 个新接口（与 detailByCode 并行） ===
  const enabled = /^\d{6}$/.test(code);
  const ratingQ = trpc.fund.rating.useQuery({ code }, { enabled });
  const purchaseInfoQ = trpc.fund.purchaseInfo.useQuery({ code }, { enabled });
  const holderStructureQ = trpc.fund.holderStructure.useQuery(
    { code, periods: 40 },
    { enabled },
  );
  const yearReturnsQ = trpc.fund.yearReturns.useQuery({ code }, { enabled });
  const peerPerformanceQ = trpc.fund.peerPerformance.useQuery({ code }, { enabled });
  const scaleHistoryQ = trpc.fund.scaleHistory.useQuery(
    { code, periods: 40 },
    { enabled },
  );
  const turnoverHistoryQ = trpc.fund.turnoverHistory.useQuery(
    { code, periods: 40 },
    { enabled },
  );
  const managerHistoryQ = trpc.fund.managerHistory.useQuery({ code }, { enabled });
  const managerReportQ = trpc.fund.managerReport.useQuery({ code }, { enabled });
  const riskSummaryQ = trpc.fund.riskSummary.useQuery({ code }, { enabled });

  const [range, setRange] = useState<RangeKey>("1Y");
  const [partialRetries, setPartialRetries] = useState(0);

  useEffect(() => {
    if (!fund?._partial || partialRetries >= 6) return;
    const timer = window.setTimeout(() => {
      setPartialRetries((v) => v + 1);
      detailQuery.refetch();
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [detailQuery, fund?._partial, partialRetries]);

  const navPoints = useMemo<Array<{ d: string; nav: number }>>(
    () => {
      const arr: Array<{ d: string; nav: number }> = [];
      for (const x of (fund?.navHistory || []) as any[]) {
        const d = String(x.navDate || "");
        const n = num(x.nav);
        if (d && n !== null && n > 0) arr.push({ d, nav: n });
      }
      arr.sort((a, b) => a.d.localeCompare(b.d));
      return arr;
    },
    [fund?.navHistory],
  );
  const scopedPoints = useMemo(() => filterByRange(navPoints, range), [navPoints, range]);
  const risk = useMemo(() => computeRisk(scopedPoints), [scopedPoints]);

  // === 业绩曲线：4 系列 ===
  //   - fund：本基金累计收益（已有）
  //   - peer / index / bench：后端暂无，统一走 emptyPeerSeries 渲染空态图例
  //   - 当 series.data 为空时，chart 仍渲染单条本基金线，图例行展示 "—"
  const series: PeerSeries[] = useMemo(() => {
    if (!scopedPoints.length) {
      return [
        emptyPeerSeries("本基金累计收益", SERIES_COLORS.fund, null),
        emptyPeerSeries("偏股混合均值", SERIES_COLORS.peer, null),
        emptyPeerSeries("沪深300", SERIES_COLORS.index, null),
        emptyPeerSeries("业绩比较基准", SERIES_COLORS.bench, null),
      ];
    }
    const base = scopedPoints[0].nav;
    const fundSeries = scopedPoints.map<{ d: string; value: number }>((x) => ({
      d: x.d.slice(5),
      value: base > 0 ? ((x.nav / base) - 1) * 100 : 0,
    }));
    const last = fundSeries[fundSeries.length - 1]?.value ?? 0;
    return [
      { name: "本基金累计收益", data: fundSeries, rangeReturn: last, color: SERIES_COLORS.fund },
      emptyPeerSeries("偏股混合均值", SERIES_COLORS.peer),
      emptyPeerSeries("沪深300", SERIES_COLORS.index),
      emptyPeerSeries("业绩比较基准", SERIES_COLORS.bench),
    ];
  }, [scopedPoints]);

  // 把 peerPerformance 数据融合到 4 行矩阵
  // peer = 偏股混合均值 / index = 沪深300 / benchmark = 业绩比较基准
  const performanceRows: PerfRow[] = useMemo(() => {
    const fundPerf = (fund as any)?.performance || {};
    const accumNav = num((fund as any)?.accumNav);
    const sinceReturn = accumNav !== null ? (accumNav - 1) * 100 : null;
    const pp = peerPerformanceQ.data as
      | {
          peer?: Record<string, number | null>;
          index?: Record<string, number | null>;
          benchmark?: Record<string, number | null>;
        }
      | undefined;
    const rowFund: PerfRow = {
      key: "fund",
      label: "本基金",
      cells: {
        "3m": emptyPerfCell(num(fundPerf.return3m)),
        "6m": emptyPerfCell(num(fundPerf.return6m)),
        "1y": emptyPerfCell(num(fundPerf.return1y)),
        "3y": emptyPerfCell(num(fundPerf.return3y)),
        "5y": emptyPerfCell(num(fundPerf.return5y)),
        since: emptyPerfCell(sinceReturn),
        annual: emptyPerfCell(num(fundPerf.annualizedReturn)),
      },
    };
    const rowPeer: PerfRow = {
      key: "peer",
      label: "偏股混合均值",
      cells: {
        "3m": emptyPerfCell(pp?.peer?.return3m ?? null),
        "6m": emptyPerfCell(pp?.peer?.return6m ?? null),
        "1y": emptyPerfCell(pp?.peer?.return1y ?? null),
        "3y": emptyPerfCell(pp?.peer?.return3y ?? null),
        "5y": emptyPerfCell(pp?.peer?.return5y ?? null),
        since: emptyPerfCell(pp?.peer?.returnSinceInception ?? null),
        annual: emptyPerfCell(pp?.peer?.annualizedReturn ?? null),
      },
    };
    const rowIndex: PerfRow = {
      key: "index",
      label: "沪深300",
      cells: {
        "3m": emptyPerfCell(pp?.index?.return3m ?? null),
        "6m": emptyPerfCell(pp?.index?.return6m ?? null),
        "1y": emptyPerfCell(pp?.index?.return1y ?? null),
        "3y": emptyPerfCell(pp?.index?.return3y ?? null),
        "5y": emptyPerfCell(pp?.index?.return5y ?? null),
        since: emptyPerfCell(pp?.index?.returnSinceInception ?? null),
        annual: emptyPerfCell(pp?.index?.annualizedReturn ?? null),
      },
    };
    const rowBench: PerfRow = {
      key: "bench",
      label: "业绩比较基准",
      cells: {
        "3m": emptyPerfCell(pp?.benchmark?.return3m ?? null),
        "6m": emptyPerfCell(pp?.benchmark?.return6m ?? null),
        "1y": emptyPerfCell(pp?.benchmark?.return1y ?? null),
        "3y": emptyPerfCell(pp?.benchmark?.return3y ?? null),
        "5y": emptyPerfCell(pp?.benchmark?.return5y ?? null),
        since: emptyPerfCell(pp?.benchmark?.returnSinceInception ?? null),
        annual: emptyPerfCell(pp?.benchmark?.annualizedReturn ?? null),
      },
    };
    return [rowFund, rowPeer, rowIndex, rowBench];
  }, [fund, peerPerformanceQ.data]);

  const navSeries = useMemo(() => {
    if (!scopedPoints.length) return [];
    const base = scopedPoints[0].nav;
    return scopedPoints.map((x) => ({
      d: x.d.slice(5),
      fund: base > 0 ? ((x.nav / base) - 1) * 100 : 0,
      dd: risk.drawdownSeries.find((dd) => dd.d === x.d)?.dd ?? 0,
    }));
  }, [scopedPoints, risk.drawdownSeries]);

  // === 行业配置历史：取最近 8 个季度 × Top 6 行业 ===
  const industryHistoryData = useMemo(() => {
    const raw = ((fund as any)?.industryHistory || []) as Array<{
      period?: string;
      quarter?: string;
      industry?: string;
      ratio?: number | string;
    }>;
    if (!raw.length) return [] as Array<Record<string, string | number>>;
    // 按 period 升序
    const sorted = [...raw].sort((a, b) =>
      String(a.period || a.quarter || "").localeCompare(String(b.period || b.quarter || "")),
    );
    // 找到最近 8 个 period
    const allPeriods = Array.from(
      new Set(sorted.map((p) => String(p.period || p.quarter || ""))),
    );
    const recentPeriods = allPeriods.slice(-8);
    // 在最近 8 个 period 中，Top 6 行业（按 period 加权）
    const score = new Map<string, number>();
    for (const p of sorted) {
      const period = String(p.period || p.quarter || "");
      if (!recentPeriods.includes(period)) continue;
      const r = num(p.ratio) ?? 0;
      score.set(p.industry || "其他", (score.get(p.industry || "其他") || 0) + r);
    }
    const topIndustries = Array.from(score.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k]) => k);
    return recentPeriods.map((period) => {
      const row: Record<string, string | number> = { period: period.slice(0, 4) + "Q" + (Math.floor((parseInt(period.slice(4, 6)) - 1) / 3) + 1) };
      for (const ind of topIndustries) {
        const found = sorted.find(
          (p) =>
            String(p.period || p.quarter || "") === period &&
            (p.industry || "其他") === ind,
        );
        row[ind] = found ? Number(((num(found.ratio) ?? 0) * 100).toFixed(2)) : 0;
      }
      return row;
    });
  }, [fund]);

  // === 历史回报：5 年柱图 + 表格 ===
  // 数据：当前无 yearReturn 字段，统一走 0 占位；保留图表槽位。
  const yearReturns = useMemo(() => {
    const years = [2022, 2023, 2024, 2025, 2026];
    return years.map((year) => ({
      year: String(year),
      ytd: year === 2026,
      fund: 0 as number | null,
      index: 0 as number | null,
      peer: 0 as number | null,
    }));
  }, []);

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
          {errMessage ? <div className="max-w-md text-sm text-muted-foreground">{errMessage}</div> : null}
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
  const navDate =
    fund.navDate || fund.nav_date || navPoints[navPoints.length - 1]?.d || "—";

  // === Header chips ===
  const chips: string[] = [];
  if (fund.category || fund.fundType) chips.push(String(fund.category || fund.fundType));
  if ((fund as any).investmentStyle) chips.push(String((fund as any).investmentStyle));

  return (
    <div className="min-h-screen pb-12 pt-14">
      <div className="mx-auto max-w-[1440px] px-3 md:px-5">
        {/* Breadcrumb */}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link to={from} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <span>/</span>
          <span className="truncate">{fundName}</span>
          {isPartial ? (
            <button
              onClick={() => detailQuery.refetch()}
              className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-secondary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              补全数据中
            </button>
          ) : null}
        </div>

        {/* === 极简 Header === */}
        <section className="rounded-lg border bg-card text-card-foreground">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-blue-700 text-base font-bold text-white">
                iD
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-semibold md:text-2xl">{fundName}</h1>
                  <span className="rounded-md border px-2 py-0.5 font-mono text-sm text-muted-foreground">
                    {fund.fundCode}
                  </span>
                  {chips.map((c) => (
                    <span
                      key={c}
                      className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  数据来源：基金定期报告 · 公开行情 · 仅供研究参考
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">单位净值</div>
                <div className="data-number text-2xl font-semibold">{numFmt(fund.nav, 4)}</div>
              </div>
              <div className="h-10 w-px bg-border" />
              <div className="text-right">
                <div className="text-xs text-muted-foreground">日期</div>
                <div className="data-number text-base">{String(navDate)}</div>
              </div>
            </div>
          </div>
          {isPartial ? (
            <div className="border-t px-4 py-2 text-sm text-muted-foreground">
              已先展示本地快照，净值历史、持仓、行业和公司数据会在后台补全。
            </div>
          ) : null}
        </section>

        {/* === 锚点导航 === */}
        <AnchorNav items={ANCHOR_ITEMS} />

        {/* === 长页面布局 === */}
        <ReportLayout
          left={
            <LeftSidebar
              fund={fund}
              navPoints={navPoints}
              risk={risk}
              rating={ratingQ.data}
              purchaseInfo={purchaseInfoQ.data}
            />
          }
          right={
            <div className="space-y-6">
              <ReportSection id="perf" title="业绩表现">
                <PerformanceSection
                  series={series}
                  navSeries={navSeries}
                  range={range}
                  setRange={setRange}
                  performanceRows={performanceRows}
                />
              </ReportSection>

              <ReportSection id="history" title="历史回报">
                <HistorySection
                  yearReturns={yearReturns}
                  apiRows={(yearReturnsQ.data?.rows || []) as Array<{ year: number; fundReturn: number | null; hs300Return: number | null; peerReturn: number | null; rank: { rank: number; total: number } | null }>}
                />
              </ReportSection>

              <ReportSection id="scale" title="规模 · 换手">
                <ScaleSection
                  scaleRows={(scaleHistoryQ.data?.rows || []) as Array<{ quarter: string; totalScale: number; peer25Scale: number }>}
                  turnoverRows={(turnoverHistoryQ.data?.rows || []) as Array<{ quarter: string; turnoverRate: number }>}
                />
              </ReportSection>

              <ReportSection
                id="risk"
                title="风险分析"
                badge="后续后端补 ±同类对比表时再升级"
              >
                <RiskSection risk={risk} navSeries={navSeries} riskSummary={riskSummaryQ.data} />
              </ReportSection>

              <ReportSection id="alloc" title="资产 · 行业 · 持有人 · 券种">
                <AllocationSection
                  fund={fund}
                  industryHistoryData={industryHistoryData}
                  holderStructure={(holderStructureQ.data?.rows || []) as Array<{ quarter: string; institution: number; individual: number }>}
                />
              </ReportSection>

              <ReportSection id="holdings" title="重仓明细">
                <HoldingsSection fund={fund} />
              </ReportSection>

              <ReportSection id="manager" title="基金经理">
                <ManagerSection
                  fund={fund}
                  managerHistory={(managerHistoryQ.data?.rows || []) as Array<{ managerName: string; startDate: string; endDate: string | null; totalReturn: number | null; annualizedReturn: number | null; rank: { rank: number; total: number } | null }>}
                  managerReport={managerReportQ.data}
                />
              </ReportSection>
            </div>
          }
        />
      </div>
    </div>
  );
}

// ===================== 左侧栏 =====================

function LeftSidebar({
  fund,
  navPoints,
  risk,
  rating,
  purchaseInfo,
}: {
  fund: any;
  navPoints: Array<{ d: string; nav: number }>;
  risk: {
    sharpe: number | null;
    sortino: number | null;
    maxDrawdown: number | null;
    volatility: number | null;
    downsideRisk: number | null;
    monthWinRate: number | null;
    diagnosticScore: number | null;
    worstMonth: number | null;
  };
  rating?: { rating3y: number | null; rating5y: number | null; score: number | null; source: string | null } | null;
  purchaseInfo?: {
    purchaseStatus?: string | null;
    redeemStatus?: string | null;
    minPurchaseAmount?: number | string | null;
    subscriptionFeeRate?: string | null;
    redemptionFeeRate?: string | null;
    managementFeeRate?: string | null;
    custodyFeeRate?: string | null;
    serviceFeeRate?: string | null;
    totalFeeRate1y?: string | number | null;
  } | null;
}) {
  const rows: Array<[string, string]> = [
    ["成立日期", fund.establishDate || "—"],
    ["基金公司", fund.company || "—"],
    ["基金经理", fund.manager?.name || "—"],
    ["基金规模", fund.totalScale ? `${fund.totalScale} 亿元` : "—"],
    ["投资类型", fund.category || fund.fundType || "—"],
    ["比较基准", fund.benchmark || "—"],
    ["管理费", fund.feeManage != null ? formatFee(fund.feeManage) : "—"],
    ["托管费", fund.feeCustody != null ? formatFee(fund.feeCustody) : "—"],
  ];

  // 业绩块 9 指标：后端 8 个（return1y/3y/5y/2y/10y + annualizedReturn + sharpeRatio/sortinoRatio/calmarRatio + winRate/alpha/beta/maxDrawdown）+ 前端 1 个（diagnosticScore）
  // Treynor：需独立 Beta + 风险溢价计算
  return (
    <>
      {/* 基金评级 */}
      {rating && (rating.rating3y !== null || rating.rating5y !== null) ? (
        <Panel
          title="基金评级"
          extra={
            rating.source ? (
              <span className="text-xs text-muted-foreground">{rating.source}</span>
            ) : null
          }
        >
          <div className="space-y-2 text-sm">
            {[
              { k: "3 年", v: rating.rating3y },
              { k: "5 年", v: rating.rating5y },
            ].map((row) => (
              <div key={row.k} className="flex items-center justify-between">
                <span className="text-muted-foreground">{row.k}</span>
                <span className="inline-flex">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${i < (row.v ?? 0) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`}
                    />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ) : (
        <MissingPanel
          title="基金评级"
          reason="依赖 fund.rating 接口（3 年 / 5 年评级，1~5 颗星），后端 tRPC 已就绪但需数据库有 tushare fund_rating 数据"
          endpoint="trpc.fund.rating"
          height={120}
        />
      )}

      {/* 基金业绩 — 9 指标 */}
      <Panel
        title="基金业绩"
        extra={
          <span className="rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Treynor 待补
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <PerfRow k="一年回报" v={fund.performance?.return1y} suffix="%" />
          <PerfRow k="三年回报(年化)" v={fund.performance?.return3y} suffix="%" />
          <PerfRow k="五年回报(年化)" v={fund.performance?.return5y} suffix="%" />
          <PerfRow k="年化回报" v={fund.performance?.annualizedReturn} suffix="%" />
          <PerfRow k="夏普比率" v={fund.performance?.sharpeRatio} />
          <PerfRow k="Sortino" v={fund.performance?.sortinoRatio} />
          <PerfRow k="卡玛比率" v={fund.performance?.calmarRatio} />
          <PerfRow k="信息比率" v={fund.performance?.informationRatio} />
          <PerfRow k="月胜率" v={fund.performance?.winRate} suffix="%" />
          <PerfRow k="Alpha(年化)" v={fund.performance?.alpha} suffix="%" />
          <PerfRow k="Beta" v={fund.performance?.beta} />
          <PerfRow
            k="诊断得分"
            v={null}
            k2={risk.diagnosticScore === null ? null : `${risk.diagnosticScore}/100`}
          />
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground/80">
          🛈 Treynor：需独立 Beta + 风险溢价算法；后端无独立字段。
        </div>
      </Panel>

      {/* 基本信息 */}
      <Panel title="基本信息">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words text-right">{v}</dd>
            </Fragment>
          ))}
        </dl>
      </Panel>

      {/* 公司信息 */}
      {(() => {
        const ci = (fund.companyInfo || {}) as Record<string, unknown>;
        const ciName = ci.name as string | undefined;
        if (!ciName) return null;
        const ciRows: Array<[string, string]> = [
          ["公司名称", ciName],
          ["旗下基金数", ci.fund_count != null ? String(ci.fund_count) : "—"],
          ["基金经理数", ci.manager_count != null ? String(ci.manager_count) : "—"],
          ["公司总规模", ci.total_scale != null ? `${ci.total_scale} 亿元` : "—"],
        ];
        return (
          <Panel title="公司信息">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              {ciRows.map(([k, v]) => (
                <Fragment key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words text-right">{v}</dd>
                </Fragment>
              ))}
            </dl>
          </Panel>
        );
      })()}

      {/* 比较基准 */}
      <Panel title="比较基准">
        <BenchmarkStack benchmark={String(fund.benchmark || "—")} />
      </Panel>

      {/* 购买信息 */}
      {purchaseInfo && (purchaseInfo.purchaseStatus || purchaseInfo.minPurchaseAmount) ? (
        <Panel title="购买信息">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">申购状态</dt>
            <dd className="text-right">{purchaseInfo.purchaseStatus || "—"}</dd>
            <dt className="text-muted-foreground">赎回状态</dt>
            <dd className="text-right">{purchaseInfo.redeemStatus || "—"}</dd>
            <dt className="text-muted-foreground">起购金额</dt>
            <dd className="text-right">{purchaseInfo.minPurchaseAmount ?? "—"} 元</dd>
            <dt className="text-muted-foreground">申购费率</dt>
            <dd className="text-right">{purchaseInfo.subscriptionFeeRate || "—"}</dd>
            <dt className="text-muted-foreground">赎回费率</dt>
            <dd className="text-right">{purchaseInfo.redemptionFeeRate || "—"}</dd>
            <dt className="text-muted-foreground">管理费率</dt>
            <dd className="text-right">{purchaseInfo.managementFeeRate || "—"}</dd>
            <dt className="text-muted-foreground">托管费率</dt>
            <dd className="text-right">{purchaseInfo.custodyFeeRate || "—"}</dd>
            <dt className="text-muted-foreground">销售服务费率</dt>
            <dd className="text-right">{purchaseInfo.serviceFeeRate || "—"}</dd>
            <dt className="text-muted-foreground">总费率(持有 1 年)</dt>
            <dd className="text-right">
              {purchaseInfo.totalFeeRate1y != null ? `${purchaseInfo.totalFeeRate1y}%` : "—"}
            </dd>
          </dl>
        </Panel>
      ) : (
        <MissingPanel
          title="购买信息"
          reason="依赖 fund.purchaseInfo 接口（已实现但 fund_master 表缺 purchase_status / min_purchase / subscription_fee 等字段）"
          endpoint="trpc.fund.purchaseInfo"
          height={140}
        />
      )}

      {/* 数据覆盖快览 */}
      <Panel title="数据覆盖">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="净值点数" value={String(navPoints.length)} />
          <Metric label="持仓数" value={String(fund.holdings?.length || 0)} />
          <Metric label="资产项" value={String(fund.assetAllocation?.length || 0)} />
          <Metric label="Sharpe" value={pct(risk.sharpe)} />
        </div>
      </Panel>
    </>
  );
}

function formatFee(v: unknown): string {
  const x = num(v);
  if (x === null) return "—";
  return `${(x <= 1 ? x * 100 : x).toFixed(2)}%`;
}

/** 把 "80%沪深300指数+20%中证全债指数" / "沪深300指数 80.00%, 中证全债指数 20.00%" 解析为堆叠条。 */
function BenchmarkStack({ benchmark }: { benchmark: string }) {
  const items = useMemo(() => parseBenchmark(benchmark), [benchmark]);
  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground">{benchmark}</div>;
  }
  const colors = ["#3B6CFF", "#46C6C2", "#E9AB60", "#5CA8DF", "#9D7BFF"];
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded">
        {items.map((it, i) => (
          <div
            key={`${it.name}-${i}`}
            style={{ width: `${it.ratio}%`, background: colors[i % colors.length] }}
            title={`${it.name} ${it.ratio}%`}
          />
        ))}
      </div>
      <div className="space-y-1 text-sm">
        {items.map((it, i) => (
          <div key={`${it.name}-${i}`} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: colors[i % colors.length] }}
              />
              {it.name}
            </span>
            <span className="data-number text-muted-foreground">{it.ratio.toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseBenchmark(text: string): Array<{ name: string; ratio: number }> {
  if (!text || text === "—") return [];
  // 拆分尝试 1："+ 分隔"
  const parts = text.split(/[+;,，；]/).map((s) => s.trim()).filter(Boolean);
  const out: Array<{ name: string; ratio: number }> = [];
  for (const p of parts) {
    const m = p.match(/([\d.]+)\s*%/);
    if (m) {
      const ratio = parseFloat(m[1]);
      const name = p.replace(m[0], "").trim() || p.trim();
      if (Number.isFinite(ratio)) out.push({ name, ratio });
    } else {
      // 尝试"name + ratio"反过来
      const m2 = p.match(/(.+?)\s*([\d.]+)\s*%?/);
      if (m2) {
        const ratio = parseFloat(m2[2]);
        if (Number.isFinite(ratio)) out.push({ name: m2[1].trim(), ratio });
      }
    }
  }
  // 拆分尝试 2：原串没匹配到，就整体作为单一名字
  if (out.length === 0) out.push({ name: text, ratio: 100 });
  return out;
}

// ===================== 业绩表现 =====================

function PerformanceSection({
  series,
  navSeries,
  range,
  setRange,
  performanceRows,
}: {
  series: PeerSeries[];
  navSeries: Array<{ d: string; fund: number; dd: number }>;
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  performanceRows: PerfRow[];
}) {
  // 把 4 series 合并成 recharts 友好的长格式
  // 当一条 series.data 为空时（缺数），键仍存在但值为 null，recharts 会画"断点"
  // 这里我们仅当 4 条都有数据时才合并；否则只画本基金单线。
  const hasAll = series.every((s) => s.data.length > 0);

  return (
    <>
      <Panel
        title="累计收益趋势"
        extra={
          <div className="flex flex-wrap gap-1">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md border px-2 py-0.5 text-xs ${
                  range === r
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        }
      >
        {/* 顶部图例（含每条系列的区间收益） */}
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: s.color }}
              />
              <span>{s.name}</span>
              <span className="data-number text-muted-foreground">
                {s.rangeReturn === null ? "—" : pct(s.rangeReturn)}
              </span>
            </span>
          ))}
        </div>
        <div className="h-[320px]">
          {navSeries.length === 0 ? (
            <EmptyState />
          ) : hasAll ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={navSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [`${Number(value).toFixed(2)}%`, ""]} />
                <Line dataKey="fund" stroke={SERIES_COLORS.fund} dot={false} name="本基金" />
                <Line dataKey="fund" stroke={SERIES_COLORS.peer} dot={false} name="偏股混合均值" />
                <Line dataKey="fund" stroke={SERIES_COLORS.index} dot={false} name="沪深300" />
                <Line dataKey="fund" stroke={SERIES_COLORS.bench} dot={false} name="业绩比较基准" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={navSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [`${Number(value).toFixed(2)}%`, ""]} />
                <Line
                  dataKey="fund"
                  stroke={SERIES_COLORS.fund}
                  dot={false}
                  name="本基金累计收益(%)"
                  strokeWidth={2}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        {!hasAll ? (
          <div className="mt-2 text-xs text-muted-foreground">
            🛈 当前只绘制了本基金曲线。偏股混合均值 / 沪深300 / 业绩比较基准 3 条对比曲线
            需后端补充对应接口后展示。
          </div>
        ) : null}
      </Panel>

      <Panel title="业绩对比矩阵">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-blue-50/60 text-muted-foreground dark:bg-blue-950/30">
                <th className="px-2 py-2 text-left">指标</th>
                {PERF_COLS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {performanceRows.map((row) => (
                <tr key={row.key} className="border-b">
                  <td className="px-2 py-2">{row.label}</td>
                  {PERF_COLS.map((c) => {
                    const cell = row.cells[c.key];
                    return (
                      <td key={c.key} className="px-2 py-2 text-right">
                        {cell.value === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ChangeCell value={cell.value} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-secondary/30 text-xs">
                <td className="px-2 py-1.5 text-muted-foreground">同类排名</td>
                {PERF_COLS.map((c) => (
                  <td key={c.key} className="px-2 py-1.5 text-right text-muted-foreground">
                    —
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          🛈 同类排名 + 偏股混合均值 / 沪深300 / 业绩比较基准 列由后端补齐后展示。
        </div>
      </Panel>
    </>
  );
}

// ===================== 历史回报 =====================

function HistorySection({
  yearReturns,
  apiRows,
}: {
  yearReturns: Array<{ year: string; ytd: boolean; fund: number | null; index: number | null; peer: number | null }>;
  apiRows: Array<{ year: number; fundReturn: number | null; hs300Return: number | null; peerReturn: number | null; rank: { rank: number; total: number } | null }>;
}) {
  const hasApi = apiRows.length > 0;
  const hasData = hasApi || yearReturns.some((y) => y.fund !== 0 || y.index !== 0 || y.peer !== 0);
  const data = hasApi
    ? apiRows.map((r) => ({
        year: String(r.year),
        ytd: r.year === new Date().getFullYear(),
        fund: r.fundReturn,
        index: r.hs300Return,
        peer: r.peerReturn,
        rank: r.rank,
      }))
    : yearReturns;
  return (
    <Panel title="历年回报">
      {hasData ? (
        <>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [`${Number(value).toFixed(2)}%`, ""]} />
                <Legend />
                <Bar dataKey="fund" fill={SERIES_COLORS.fund} name="本基金">
                  {data.map((_y, i) => (
                    <Cell key={i} fill={SERIES_COLORS.fund} />
                  ))}
                </Bar>
                <Bar dataKey="index" fill={SERIES_COLORS.peer} name="沪深300" />
                <Bar dataKey="peer" fill={SERIES_COLORS.index} name="偏股混合均值" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-blue-50/60 text-muted-foreground dark:bg-blue-950/30">
                  <th className="px-2 py-2 text-left">年份</th>
                  <th className="px-2 py-2 text-right">本基金</th>
                  <th className="px-2 py-2 text-right">沪深300</th>
                  <th className="px-2 py-2 text-right">偏股混合均值</th>
                  <th className="px-2 py-2 text-right">同类排名</th>
                </tr>
              </thead>
              <tbody>
                {data.map((y) => (
                  <tr key={y.year} className="border-b">
                    <td className="px-2 py-2">
                      {y.year}
                      {y.ytd ? (
                        <span className="ml-1 text-xs text-muted-foreground">(YTD)</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right">{pct(y.fund)}</td>
                    <td className="px-2 py-2 text-right">{pct(y.index)}</td>
                    <td className="px-2 py-2 text-right">{pct(y.peer)}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {(y as any).rank ? `${(y as any).rank.rank}/${(y as any).rank.total}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <span aria-hidden className="text-2xl text-muted-foreground/40">🗄</span>
          <div className="text-sm text-muted-foreground">暂无 历年回报 数据</div>
          <div className="max-w-md text-xs text-muted-foreground/70">
            依赖 fund.yearReturns（年度本基金 / 沪深300 / 偏股混合均值 / 同类排名）
          </div>
          <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            trpc.fund.yearReturns
          </code>
        </div>
      )}
    </Panel>
  );
}

// ===================== 规模 · 换手 =====================

function ScaleSection({
  scaleRows,
  turnoverRows,
}: {
  scaleRows: Array<{ quarter: string; totalScale: number; peer25Scale: number }>;
  turnoverRows: Array<{ quarter: string; turnoverRate: number }>;
}) {
  const hasScale = scaleRows.length > 0;
  const hasTurnover = turnoverRows.length > 0;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel title="历年规模变化">
        {hasScale ? (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={scaleRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="quarter" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="totalScale" fill={chartColors[0]} name="净资产(亿元)" />
                <Line yAxisId="right" dataKey="peer25Scale" stroke={chartColors[1]} dot={false} name="同类 25% 分位" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState label="历年规模变化数据待补" />
        )}
      </Panel>
      <Panel title="基金换手率">
        {hasTurnover ? (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={turnoverRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="quarter" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="turnoverRate" stroke={chartColors[0]} dot={false} name="换手率(%)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState label="基金换手率数据待补" />
        )}
      </Panel>
    </div>
  );
}

// ===================== 风险分析 =====================

function RiskSection({
  risk,
  navSeries,
  riskSummary,
}: {
  risk: {
    sharpe: number | null;
    sortino: number | null;
    maxDrawdown: number | null;
    volatility: number | null;
    downsideRisk: number | null;
    monthWinRate: number | null;
    diagnosticScore: number | null;
    worstMonth: number | null;
  };
  navSeries: Array<{ d: string; fund: number; dd: number }>;
  riskSummary?: {
    level: "low" | "medium" | "high" | null;
    summary: string | null;
  } | null;
}) {
  // 基础风险指标（已有）
  const maxDD = risk.maxDrawdown;
  const vol = risk.volatility;
  // 简单映射：高/中/低（暂用纯前端阈值，可后续由后端覆盖）
  const level: "low" | "medium" | "high" =
    maxDD === null || vol === null
      ? "low"
      : maxDD > 30 || vol > 25
        ? "high"
        : maxDD > 15 || vol > 18
          ? "medium"
          : "low";
  const levelColor = {
    low: "#16C784",
    medium: "#FFB800",
    high: "#F5384B",
  }[level];

  // 1y 数据：前端可算
  // 3y / 5y / 成立以来：后端未提供
  const peerCols = [
    { key: "1y", label: "近 1 年" },
    { key: "3y", label: "近 3 年" },
    { key: "5y", label: "近 5 年" },
    { key: "inception", label: "成立以来" },
  ] as const;

  // 7 个核心风险指标；3y/5y/成立以来 全 null
  const rows: Array<{ label: string; values: Array<number | null> }> = [
    { label: "年化波动率", values: [vol, null, null, null] },
    { label: "最大回撤率", values: [maxDD, null, null, null] },
    { label: "下行风险", values: [risk.downsideRisk, null, null, null] },
    { label: "最低单月回报", values: [risk.worstMonth, null, null, null] },
    { label: "Alpha(年化)", values: [null, null, null, null] },
    { label: "Beta", values: [null, null, null, null] },
    { label: "回撤修复天数", values: [null, null, null, null] },
  ];

  return (
    <>
      <Panel title="风险等级">
        <div className="flex items-center gap-3">
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-gradient-to-r from-[#16C784] via-[#FFB800] to-[#F5384B]">
            <div
              className="absolute -top-1.5 h-5 w-5 rounded-full border-[3px] border-white shadow-lg"
              style={{
                left: level === "low" ? "15%" : level === "medium" ? "50%" : "85%",
                background: levelColor,
                transform: "translateX(-50%)",
              }}
            />
          </div>
          <div
            className="rounded-md border px-2 py-0.5 text-xs font-medium"
            style={{ color: levelColor, borderColor: levelColor }}
          >
            {level === "low" ? "低" : level === "medium" ? "中" : "高"}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
          <Metric label="最大回撤" value={pct(maxDD)} />
          <Metric label="年化波动" value={pct(vol)} />
          <Metric label="Sharpe" value={numFmt(risk.sharpe)} />
        </div>
      </Panel>

      <Panel
        title="风险摘要"
        extra={
          riskSummary?.level ? (
            <span
              className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                color:
                  riskSummary.level === "low"
                    ? "#16C784"
                    : riskSummary.level === "high"
                      ? "#F5384B"
                      : "#FFB800",
                borderColor:
                  riskSummary.level === "low"
                    ? "#16C784"
                    : riskSummary.level === "high"
                      ? "#F5384B"
                      : "#FFB800",
              }}
            >
              {riskSummary.level === "low"
                ? "低"
                : riskSummary.level === "medium"
                  ? "中"
                  : "高"}
            </span>
          ) : null
        }
      >
        {riskSummary?.summary ? (
          <div className="rounded-md border bg-popover p-3 text-sm leading-relaxed">
            {riskSummary.summary}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <span aria-hidden className="text-2xl text-muted-foreground/40">
              🗄
            </span>
            <div className="text-sm text-muted-foreground">暂无 风险摘要 数据</div>
            <div className="text-xs text-muted-foreground/70">
              依赖 fund.riskSummary（规则引擎生成的中文自然语言摘要）
            </div>
            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              trpc.fund.riskSummary
            </code>
          </div>
        )}
      </Panel>

      <Panel title="动态回撤">
        <div className="h-[280px]">
          {navSeries.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={navSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [`${Number(value).toFixed(2)}%`, ""]} />
                <defs>
                  <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES_COLORS.fund} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={SERIES_COLORS.fund} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area dataKey="dd" stroke={SERIES_COLORS.fund} fill="url(#ddGradient)" dot={false} name="回撤(%)" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      <Panel
        title="±同类风险对比（1y / 3y / 5y / 成立以来）"
        extra={
          <span className="rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ±同类待补
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-blue-50/60 text-muted-foreground dark:bg-blue-950/30">
                <th className="px-2 py-2 text-left">指标</th>
                {peerCols.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.label}>
                  <tr className="border-b">
                    <td className="px-2 py-2">{r.label}</td>
                    {r.values.map((v, i) => (
                      <td key={i} className="px-2 py-2 text-right">
                        {v === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ChangeCell value={v} />
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b bg-secondary/30 text-xs">
                    <td className="px-2 py-1.5 pl-4 text-muted-foreground">±同类</td>
                    {r.values.map((_, i) => (
                      <td
                        key={i}
                        className="px-2 py-1.5 text-right text-muted-foreground"
                      >
                        —
                      </td>
                    ))}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground/80">
          🛈 多周期窗口（3y / 5y / 成立以来）+ ±同类 全部依赖后端补全（fund.peerRisk）
        </div>
      </Panel>
    </>
  );
}

// ===================== 资产 · 行业 · 持有人 · 券种 =====================

function AllocationSection({
  fund,
  industryHistoryData,
  holderStructure,
}: {
  fund: any;
  industryHistoryData: Array<Record<string, string | number>>;
  holderStructure: Array<{ quarter: string; institution: number; individual: number }>;
}) {
  const alloc = (fund.assetAllocation || []) as any[];
  const industries = (fund.industries || []) as Array<{ industry: string; ratio: number | string }>;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="资产配置">
          <div className="h-[260px]">
            {alloc.length === 0 ? (
              <EmptyState label="资产配置数据待补" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                  />
                  <Legend verticalAlign="bottom" iconType="circle" />
                  <Pie
                    data={alloc.map((x, i) => ({
                      name: x.name,
                      value: ratioPct(x.ratio),
                      fill: chartColors[i % chartColors.length],
                    }))}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="45%"
                    outerRadius="80%"
                    paddingAngle={2}
                    label={({ name, value }: { name?: string; value?: number }) =>
                      name && value !== undefined ? `${name} ${value.toFixed(1)}%` : ""
                    }
                    labelLine={false}
                  >
                    {alloc.map((_, i) => (
                      <Cell key={i} fill={chartColors[i % chartColors.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel title="持有人结构">
          {holderStructure.length === 0 ? (
            <EmptyState label="持有人结构数据待补" />
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={holderStructure}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="quarter" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="institution" stackId="h" fill={chartColors[0]} name="机构占比(%)" />
                  <Bar dataKey="individual" stackId="h" fill={chartColors[1]} name="个人占比(%)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="行业配置">
        <div className="h-[260px]">
          {industries.length === 0 ? (
            <EmptyState label="行业配置数据待补" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={industries.map((x) => ({
                  k: x.industry,
                  v: ratioPct(x.ratio),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="k" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="v" fill={SERIES_COLORS.fund} name="占净值比(%)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      <Panel title="行业配置历史（最近 8 个季度 × Top 6 行业）">
        {industryHistoryData.length === 0 ? (
          <EmptyState label="行业配置历史数据待补" />
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={industryHistoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {Object.keys(industryHistoryData[0])
                  .filter((k) => k !== "period")
                  .map((key, idx) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="industry"
                      fill={chartColors[idx % chartColors.length]}
                    />
                  ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <MissingPanel
        title="券种配置"
        reason="依赖 fund.bondAllocation（国家债券 / 央行票据 / 金融债券 / 可转债 / 同业存单等）"
        endpoint="trpc.fund.bondAllocation"
        height={200}
      />
    </>
  );
}

// ===================== 重仓明细 =====================

function HoldingsSection({ fund }: { fund: any }) {
  const holdings = (fund.holdings || []) as any[];
  return (
    <>
      <Panel
        title="重仓股票"
        extra={
          <span className="rounded border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[11px] text-muted-foreground">
            🛈 5/8 已填
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-blue-50/60 text-muted-foreground dark:bg-blue-950/30">
                <th className="px-2 py-2 text-left">证券简称</th>
                <th className="px-2 py-2 text-right">持仓市值(万元)</th>
                <th className="px-2 py-2 text-right">持仓数量(股)</th>
                <th className="px-2 py-2 text-right">持仓数量环比</th>
                <th className="px-2 py-2 text-left">持仓趋势</th>
                <th className="px-2 py-2 text-right">占基金净值比</th>
                <th className="px-2 py-2 text-right">近三月涨跌</th>
                <th className="px-2 py-2 text-left">所属行业</th>
              </tr>
            </thead>
            <tbody>
              {holdings.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState />
                  </td>
                </tr>
              ) : (
                holdings.slice(0, 20).map((h: any, i: number) => {
                  const changeRatio = num(h.changeRatio);
                  return (
                    <tr key={`${h.stockCode}-${i}`} className="border-b">
                      <td className="px-2 py-2">{h.stockName || "—"}</td>
                      <td className="px-2 py-2 text-right text-muted-foreground">—</td>
                      <td className="px-2 py-2 text-right text-muted-foreground">—</td>
                      <td className="px-2 py-2 text-right">
                        {changeRatio === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ChangeCell value={changeRatio * 100} />
                        )}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {changeRatio === null
                          ? "—"
                          : changeRatio > 0
                            ? "增持"
                            : changeRatio < 0
                              ? "减持"
                              : "持平"}
                      </td>
                      <td className="px-2 py-2 text-right">{pct(ratioPct(h.ratio))}</td>
                      <td className="px-2 py-2 text-right text-muted-foreground">—</td>
                      <td className="px-2 py-2 text-muted-foreground">{h.industry || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <MissingPanel
        title="重仓债券"
        reason="依赖 fund.bondHoldings（证券简称 / 持仓市值 / 占净值比 / 票面利率 / 发行主体 / 债券类型 / 发行信用评级）"
        endpoint="trpc.fund.bondHoldings"
        height={140}
      />
    </>
  );
}

// ===================== 基金经理 =====================

function ManagerSection({
  fund,
  managerHistory,
  managerReport,
}: {
  fund: any;
  managerHistory: Array<{ managerName: string; startDate: string; endDate: string | null; totalReturn: number | null; annualizedReturn: number | null; rank: { rank: number; total: number } | null }>;
  managerReport: { report: string | null; period: string | null } | null | undefined;
}) {
  return (
    <>
      <Panel title="基金经理概览">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <Metric label="姓名" value={fund.manager?.name || "—"} />
          <Metric label="从业年限" value={String(fund.manager?.manageYears || "—")} />
          <Metric label="任职回报" value={pct(fund.manager?.returnSinceTenure)} />
          <Metric label="年化回报" value={pct(fund.manager?.annualizedReturn)} />
        </div>
      </Panel>

      <Panel
        title="基金经理变更"
        extra={
          <span className="rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {managerHistory.length} 人均
          </span>
        }
      >
        {managerHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <span aria-hidden className="text-2xl text-muted-foreground/40">🗄</span>
            <div className="text-sm text-muted-foreground">暂无 基金经理变更 数据</div>
            <div className="text-xs text-muted-foreground/70">
              依赖 fund.managerHistory（历任经理任职/离职/回报/同类排名）
            </div>
            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              trpc.fund.managerHistory
            </code>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-blue-50/60 text-muted-foreground dark:bg-blue-950/30">
                  <th className="px-2 py-2 text-left">基金经理</th>
                  <th className="px-2 py-2 text-left">任职日期</th>
                  <th className="px-2 py-2 text-left">离职日期</th>
                  <th className="px-2 py-2 text-right">任职总回报</th>
                  <th className="px-2 py-2 text-right">年化回报</th>
                  <th className="px-2 py-2 text-right">同类排名</th>
                </tr>
              </thead>
              <tbody>
                {managerHistory.map((m, i) => (
                  <tr key={`${m.managerName}-${i}`} className="border-b">
                    <td className="px-2 py-2">{m.managerName}</td>
                    <td className="px-2 py-2 text-muted-foreground">{m.startDate}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {m.endDate || <span className="text-emerald-400">在职</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {m.totalReturn === null ? "—" : <ChangeCell value={m.totalReturn} />}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {m.annualizedReturn === null ? "—" : <ChangeCell value={m.annualizedReturn} />}
                    </td>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {m.rank ? `${m.rank.rank}/${m.rank.total}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="运作分析"
        extra={
          managerReport?.period ? (
            <span className="text-xs text-muted-foreground">{managerReport.period}</span>
          ) : null
        }
      >
        {managerReport?.report ? (
          <div className="max-h-[400px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-popover p-3 text-sm leading-relaxed">
            {managerReport.report}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <span aria-hidden className="text-2xl text-muted-foreground/40">🗄</span>
            <div className="text-sm text-muted-foreground">暂无 运作分析 数据</div>
            <div className="max-w-md text-xs text-muted-foreground/70">
              依赖 fund.managerReport（基金定期报告全文：宏观展望 / 操作策略 / 后市观点 / 三大投资方向）
            </div>
            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              trpc.fund.managerReport
            </code>
          </div>
        )}
      </Panel>
    </>
  );
}

