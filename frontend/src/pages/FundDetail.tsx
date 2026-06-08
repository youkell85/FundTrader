import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, RefreshCw, AlertCircle, Star, TrendingUp, Activity, BarChart3, Scale, Percent, ShieldAlert } from "lucide-react";
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
import { type DetailRowsPayload, missingReason, realRows, summarizeDetailCoverage, deriveStatus, type CoverageInput, type CoverageKey, type CoverageEntry, COVERAGE_LABELS, COVERAGE_ENDPOINTS, STATUS_LABELS, STATUS_TONES } from "@/lib/detail-status";
import { Panel } from "@/components/report/Panel";
import { ReportSection } from "@/components/report/ReportSection";
import { AnchorNav } from "@/components/report/AnchorNav";
import { MissingPanel } from "@/components/report/MissingPanel";
import { ChangeCell } from "@/components/report/ChangeCell";

// 沿用旧 range 切换（与 PDF 8 个区间一致）
const RANGE_OPTIONS = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number];
const DETAIL_STATIC_STALE_MS = 24 * 60 * 60 * 1000;
const DETAIL_QUARTERLY_STALE_MS = 6 * 60 * 60 * 1000;
const DETAIL_LLM_STALE_MS = 30 * 60 * 1000;

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
  { id: "perf", label: "业绩与回撤" },
  { id: "peer", label: "同类与基准" },
  { id: "risk", label: "风险画像" },
  { id: "alloc", label: "持仓与配置" },
  { id: "scale", label: "规模 · 换手 · 持有人" },
  { id: "manager", label: "经理与运作" },
  { id: "meta", label: "购买与评级" },
  { id: "gaps", label: "数据缺口" },
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

function PartialBanner({ code }: { code: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border border-[#FFB800]/30 bg-[#FFB800]/10 px-3 py-2 text-xs text-[#FFB800]">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span>该产品的持仓/历史净值尚未同步完成，已发起后台回填（约 30s）。</span>
      <span className="ml-auto font-mono text-[10px] text-white/40">{code}</span>
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
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="text-xs text-white/45">{label}</div>
      <div className={`mt-1 data-number text-lg font-semibold ${tone || "text-white/85"}`}>
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
    { enabled: /^\d{6}$/.test(code), staleTime: DETAIL_LLM_STALE_MS, refetchOnWindowFocus: false },
  );
  const fund = detailQuery.data;
  const loading = detailQuery.isLoading;
  const err = detailQuery.error;

  // === 详情页 9 个新接口（与 detailByCode 并行） ===
  const enabled = /^\d{6}$/.test(code);
  const ratingQ = trpc.fund.rating.useQuery(
    { code },
    { enabled, staleTime: DETAIL_STATIC_STALE_MS, refetchOnWindowFocus: false },
  );
  const purchaseInfoQ = trpc.fund.purchaseInfo.useQuery(
    { code },
    { enabled, staleTime: DETAIL_STATIC_STALE_MS, refetchOnWindowFocus: false },
  );
  const holderStructureQ = trpc.fund.holderStructure.useQuery(
    { code, periods: 40 },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );
  const yearReturnsQ = trpc.fund.yearReturns.useQuery(
    { code },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );
  const peerPerformanceQ = trpc.fund.peerPerformance.useQuery(
    { code },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );
  const scaleHistoryQ = trpc.fund.scaleHistory.useQuery(
    { code, periods: 40 },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );
  const turnoverHistoryQ = trpc.fund.turnoverHistory.useQuery(
    { code, periods: 40 },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );
  const managerHistoryQ = trpc.fund.managerHistory.useQuery(
    { code },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );
  const bondAllocationQ = trpc.fund.bondAllocation.useQuery(
    { code },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );
  const bondHoldingsQ = trpc.fund.bondHoldings.useQuery(
    { code },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );
  const detailCompletenessQ = trpc.fund.detailCompleteness.useQuery(
    { code },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );

  // 延后启动 LLM 类查询，避免阻塞首屏
  const [llmReady, setLlmReady] = useState(false);
  useEffect(() => {
    setLlmReady(false);
  }, [code]);

  useEffect(() => {
    if (!loading && fund && !llmReady) {
      const t = window.setTimeout(() => setLlmReady(true), 300);
      return () => window.clearTimeout(t);
    }
  }, [loading, fund, llmReady]);

  const managerReportQ = trpc.fund.managerReport.useQuery(
    { code },
    { enabled: enabled && llmReady, staleTime: DETAIL_LLM_STALE_MS, refetchOnWindowFocus: false },
  );
  const riskSummaryQ = trpc.fund.riskSummary.useQuery(
    { code },
    { enabled: enabled && llmReady, staleTime: DETAIL_LLM_STALE_MS, refetchOnWindowFocus: false },
  );

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

  // === 数据覆盖度 / 待补项摘要：13 个 trpc useQuery 状态聚合成统一摘要 ===
  const coverage = useMemo(() => {
    const build = (
      key: CoverageKey,
      q: { isLoading: boolean; isError: boolean; data?: unknown },
      reason: string,
    ): CoverageEntry => {
      const payload = q.data as
        | { dataStatus?: string; missingReason?: string | null; source?: string | null; asOf?: string | null; rows?: unknown[] }
        | undefined;
      // hasData 判定：rows 型接口用 rows.length，非 rows 型只要 payload 存在即可。
      // 注意：不要用 !payload.dataStatus 把"available"等明确状态排除掉，
      // dataStatus 留给 deriveStatus() 处理。
      const hasData = Boolean(
        payload && (Array.isArray(payload.rows) ? payload.rows.length > 0 : true),
      );
      return {
        key,
        label: COVERAGE_LABELS[key],
        endpoint: COVERAGE_ENDPOINTS[key],
        status: deriveStatus({
          isLoading: q.isLoading,
          isError: q.isError,
          hasData,
          dataStatus: payload?.dataStatus ?? null,
        }),
        reason: q.isError ? "tRPC 接口调用失败" : payload?.missingReason || reason,
        asOf: payload?.asOf ?? null,
        source: payload?.source ?? null,
      };
    };
    const entries: CoverageInput = {
      detailByCode: build("detailByCode", detailQuery, "基金主数据（基金主表 / 净值历史 / 持仓）"),
      rating: build("rating", ratingQ, "3 年 / 5 年评级（1~5 颗星）"),
      purchaseInfo: build("purchaseInfo", purchaseInfoQ, "申购 / 赎回 / 起购 / 费率"),
      holderStructure: build("holderStructure", holderStructureQ, "机构 / 个人 持有人比例（按季度）"),
      yearReturns: build("yearReturns", yearReturnsQ, "近 5 年本基金 / 沪深300 / 偏股混合 均值"),
      peerPerformance: build("peerPerformance", peerPerformanceQ, "近 N 月 / 近 N 年 同类对比"),
      scaleHistory: build("scaleHistory", scaleHistoryQ, "近 40 个季度 净资产"),
      turnoverHistory: build("turnoverHistory", turnoverHistoryQ, "近 40 个季度 换手率"),
      managerHistory: build("managerHistory", managerHistoryQ, "历任经理 / 任职 / 离职 / 回报 / 同类排名"),
      bondAllocation: build("bondAllocation", bondAllocationQ, "国家债券 / 央行票据 / 金融债券 / 可转债 等"),
      bondHoldings: build("bondHoldings", bondHoldingsQ, "前 N 大债券持仓（简称 / 净值比 / 票面利率 / 主体 / 评级）"),
      detailCompleteness: build("detailCompleteness", detailCompletenessQ, "后端按字段粒度统计的覆盖度"),
      managerReport: build("managerReport", managerReportQ, "基金定期报告全文（LLM 类，延后启动）"),
      riskSummary: build("riskSummary", riskSummaryQ, "风险等级 + 自然语言摘要（LLM 类，延后启动）"),
    };
    return summarizeDetailCoverage(entries);
  }, [
    detailQuery, ratingQ, purchaseInfoQ, holderStructureQ, yearReturnsQ, peerPerformanceQ,
    scaleHistoryQ, turnoverHistoryQ, managerHistoryQ, bondAllocationQ, bondHoldingsQ,
    detailCompletenessQ, managerReportQ, riskSummaryQ,
  ]);

  // === 业绩曲线：4 系列 ===
  //   - fund：本基金累计收益（前端从 navPoints 计算，或后端 series.fund 返回）
  //   - peer / index / bench：后端 peerPerformance.series 返回
  //   - 当后端 series 非空时使用后端数据，否则前端计算 fund 系列，其余走 emptyPeerSeries
  const series: PeerSeries[] = useMemo(() => {
    // 后端返回的 series 数据
    const ppSeries = (peerPerformanceQ.data as
      | { series?: { fund?: Array<{ date: string; return: number }>; peer?: Array<{ date: string; return: number }>; index?: Array<{ date: string; return: number }>; benchmark?: Array<{ date: string; return: number }> } }
      | undefined)?.series;

    // 本基金累计收益（前端计算）
    const fundData = !scopedPoints.length
      ? []
      : (() => {
          const base = scopedPoints[0].nav;
          return scopedPoints.map<{ d: string; value: number }>((x) => ({
            d: x.d.slice(5),
            value: base > 0 ? ((x.nav / base) - 1) * 100 : 0,
          }));
        })();
    // 映射后端 series 数据到 PeerSeries 格式
    const mapSeries = (raw: Array<{ date: string; return: number }> | undefined, fallbackData: Array<{ d: string; value: number }>) => {
      if (raw && raw.length > 0) {
        const mapped = raw.map<{ d: string; value: number }>((pt) => ({
          d: pt.date.slice(5),
          value: pt.return,
        }));
        const lastVal = mapped.length > 0 ? mapped[mapped.length - 1].value : null;
        return { data: mapped, rangeReturn: lastVal };
      }
      return { data: fallbackData, rangeReturn: null };
    };

    const fundSeries = mapSeries(ppSeries?.fund, fundData);
    // fundRangeReturn 优先使用后端数据，后端无数据时用前端计算值
    const finalFundRangeReturn = fundSeries.rangeReturn;
    const peerSeries = mapSeries(ppSeries?.peer, []);
    const indexSeries = mapSeries(ppSeries?.index, []);
    const benchSeries = mapSeries(ppSeries?.benchmark, []);

    return [
      { name: "本基金累计收益", data: fundSeries.data, rangeReturn: finalFundRangeReturn, color: SERIES_COLORS.fund },
      peerSeries.data.length > 0
        ? { name: "偏股混合均值", data: peerSeries.data, rangeReturn: peerSeries.rangeReturn, color: SERIES_COLORS.peer }
        : emptyPeerSeries("偏股混合均值", SERIES_COLORS.peer, peerSeries.rangeReturn),
      indexSeries.data.length > 0
        ? { name: "沪深300", data: indexSeries.data, rangeReturn: indexSeries.rangeReturn, color: SERIES_COLORS.index }
        : emptyPeerSeries("沪深300", SERIES_COLORS.index, indexSeries.rangeReturn),
      benchSeries.data.length > 0
        ? { name: "业绩比较基准", data: benchSeries.data, rangeReturn: benchSeries.rangeReturn, color: SERIES_COLORS.bench }
        : emptyPeerSeries("业绩比较基准", SERIES_COLORS.bench, benchSeries.rangeReturn),
    ];
  }, [scopedPoints, peerPerformanceQ.data]);

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
          fund?: Record<string, number | null>;
        }
      | undefined;
    // 优先使用 peerPerformance 返回的本基金数据（含 1y/3y 真实值），fallback 到 fund.performance
    const fundCells = pp?.fund || fundPerf;
    const rowFund: PerfRow = {
      key: "fund",
      label: "本基金",
      cells: {
        "3m": emptyPerfCell(num(fundCells.return3m)),
        "6m": emptyPerfCell(num(fundCells.return6m)),
        "1y": emptyPerfCell(num(fundCells.return1y)),
        "3y": emptyPerfCell(num(fundCells.return3y)),
        "5y": emptyPerfCell(num(fundCells.return5y)),
        since: emptyPerfCell(num(fundCells.returnSinceInception) ?? sinceReturn),
        annual: emptyPerfCell(num(fundCells.annualizedReturn)),
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

  // navSeries：用于单线模式（只画本基金）和动态回撤
  // 优先使用前端 navPoints（来自 fund.navHistory），当 navHistory 为空时降级使用后端 series.fund
  const navSeries = useMemo(() => {
    if (scopedPoints.length > 0) {
      const base = scopedPoints[0].nav;
      return scopedPoints.map((x) => ({
        d: x.d.slice(5),
        fund: base > 0 ? ((x.nav / base) - 1) * 100 : 0,
        dd: risk.drawdownSeries.find((dd) => dd.d === x.d)?.dd ?? 0,
      }));
    }
    // 降级：使用后端 peerPerformance.series.fund
    // 后端返回的是累计收益率（%），转换为虚拟净值（初始 1.0）使 drawdownSeries 能正确计算回撤
    const ppFund = (peerPerformanceQ.data as any)?.series?.fund as Array<{ date: string; return: number }> | undefined;
    const ppDrawdown = (peerPerformanceQ.data as any)?.series?.fund_drawdown as Array<{ date: string; drawdown: number }> | undefined;
    if (ppFund && ppFund.length > 0) {
      return ppFund.map((x, i) => ({
        d: x.date.slice(5),
        fund: x.return,
        dd: ppDrawdown?.[i]?.drawdown ?? 0,
      }));
    }
    return [];
  }, [scopedPoints, risk.drawdownSeries, peerPerformanceQ.data]);

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
  // 优先使用 yearReturnsQ API 数据，fallback 到全 null 默认值
  const yearReturns = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, index) => currentYear - 4 + index);
    const apiRows = (yearReturnsQ.data?.rows || []) as Array<{ year: number; fundReturn: number | null; hs300Return: number | null; peerReturn: number | null }>;
    return years.map((year) => {
      const apiRow = apiRows.find((r) => r.year === year);
      return {
        year: String(year),
        ytd: year === currentYear,
        fund: apiRow?.fundReturn ?? null,
        index: apiRow?.hs300Return ?? null,
        peer: apiRow?.peerReturn ?? null,
      };
    });
  }, [yearReturnsQ.data]);

  if (loading) {
    return <div className="min-h-screen pt-20 text-center text-muted-foreground">加载基金详情中...</div>;
  }
  if (err || !fund) {
    const errMessage = err instanceof Error ? err.message : String(err || "");
    return (
      <div className="min-h-screen pt-20 text-center">
        <div className="inline-flex flex-col items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-6 text-white/85">
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

        {/* === Research Header === */}
        <ResearchHeader
          fund={fund}
          fundName={fundName}
          code={code}
          navDate={navDate}
          isPartial={isPartial}
          coverage={coverage}
          onRefresh={() => detailQuery.refetch()}
        />

        {/* === Core KPI Strip === */}
        <KpiStrip
          fund={fund}
          risk={risk}
        />

        {/* === Coverage + Anchor Nav === */}
        <AnchorNav items={ANCHOR_ITEMS} />
        <CoverageSummary summary={coverage} />

        {isPartial && <PartialBanner code={code} />}

        {/* === Research Body === */}
        <div className="mt-3 space-y-6">
          {/* 1. 业绩与回撤 */}
          <ReportSection id="perf" title="业绩与回撤">
            <PerformanceSection
              series={series}
              navSeries={navSeries}
              range={range}
              setRange={setRange}
              performanceRows={performanceRows}
            />
            {/* 历史回报并入业绩 section */}
            <div className="mt-3">
              <HistorySection
                yearReturns={yearReturns}
                apiRows={(yearReturnsQ.data?.rows || []) as Array<{ year: number; fundReturn: number | null; hs300Return: number | null; peerReturn: number | null; rank: { rank: number; total: number } | null }>}
              />
            </div>
          </ReportSection>

          {/* 2. 同类与基准 */}
          <ReportSection id="peer" title="同类与基准对比">
            <PeerSection
              peerData={peerPerformanceQ.data}
              performanceRows={performanceRows}
            />
          </ReportSection>

          {/* 3. 风险画像 */}
          <ReportSection
            id="risk"
            title="风险画像"
            badge="后端补 ±同类对比表后升级"
          >
            <RiskSection risk={risk} navSeries={navSeries} riskSummary={riskSummaryQ.data} />
          </ReportSection>

          {/* 4. 持仓与资产配置 */}
          <ReportSection id="alloc" title="持仓与资产配置">
            <AllocationSection
              fund={fund}
              industryHistoryData={industryHistoryData}
              holderStructure={realRows(holderStructureQ.data as DetailRowsPayload<{ quarter: string; institution: number; individual: number }>)}
              holderStatus={holderStructureQ.data as DetailRowsPayload<{ quarter: string; institution: number; individual: number }>}
              bondAllocation={realRows(bondAllocationQ.data as DetailRowsPayload<{ bondType: string; ratio: number; changeRatio: number | null }>)}
              bondAllocationStatus={bondAllocationQ.data as DetailRowsPayload<{ bondType: string; ratio: number; changeRatio: number | null }>}
            />
            <div className="mt-3">
              <HoldingsSection
                fund={fund}
                bondHoldings={realRows(bondHoldingsQ.data as DetailRowsPayload<any>)}
                bondHoldingsStatus={bondHoldingsQ.data as DetailRowsPayload<any>}
              />
            </div>
          </ReportSection>

          {/* 5. 规模 · 换手 · 持有人 */}
          <ReportSection id="scale" title="规模 · 换手 · 持有人结构">
            <ScaleSection
              scaleRows={(scaleHistoryQ.data?.rows || []) as Array<{ quarter: string; totalScale: number; peer25Scale: number | null }>}
              turnoverRows={(turnoverHistoryQ.data?.rows || []) as Array<{ quarter: string; turnoverRate: number }>}
            />
          </ReportSection>

          {/* 6. 基金经理与运作分析 */}
          <ReportSection id="manager" title="基金经理与运作分析">
            <ManagerSection
              fund={fund}
              managerHistory={(managerHistoryQ.data?.rows || []) as Array<{ managerName: string; startDate: string; endDate: string | null; totalReturn: number | null; annualizedReturn: number | null; rank: { rank: number; total: number } | null }>}
              managerReport={managerReportQ.data}
            />
          </ReportSection>

          {/* 7. 购买信息 · 评级 · 数据覆盖 */}
          <ReportSection id="meta" title="购买信息 · 基金评级 · 数据覆盖">
            <MetaSection
              fund={fund}
              rating={ratingQ.data}
              purchaseInfo={purchaseInfoQ.data}
              completeness={detailCompletenessQ.data}
              navPoints={navPoints}
            />
          </ReportSection>

          {/* 8. 数据缺口清单 */}
          <ReportSection id="gaps" title="已知数据缺口">
            <DataGapsPanel items={coverage.items} />
          </ReportSection>
        </div>
      </div>
    </div>
  );
}

// ===================== 研究页头部 =====================

function ResearchHeader({
  fund,
  fundName,
  code,
  navDate,
  isPartial,
  coverage,
  onRefresh,
}: {
  fund: any;
  fundName: string;
  code: string;
  navDate: string;
  isPartial: boolean;
  coverage: CoverageSummary;
  onRefresh: () => void;
}) {
  const chips: string[] = [];
  if (fund.category || fund.fundType) chips.push(String(fund.category || fund.fundType));
  if (fund.investmentStyle) chips.push(String(fund.investmentStyle));

  const statusBadge =
    coverage.stale > 0
      ? { label: "部分陈旧", color: "text-[#E9AB60] border-[#E9AB60]/30 bg-[#E9AB60]/10" }
      : coverage.partial > 0
        ? { label: "部分数据", color: "text-[#FFB800] border-[#FFB800]/30 bg-[#FFB800]/10" }
        : coverage.missing > 0
          ? { label: "有缺失", color: "text-white/50 border-white/10 bg-white/[0.03]" }
          : { label: "数据完整", color: "text-[#16C784] border-[#16C784]/30 bg-[#16C784]/10" };

  return (
    <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] text-white/85">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-blue-700 text-base font-bold text-white">
            {fundName.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold md:text-2xl">{fundName}</h1>
              <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 font-mono text-sm text-white/65">
                {code}
              </span>
              {chips.map((c) => (
                <span
                  key={c}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs text-white/55"
                >
                  {c}
                </span>
              ))}
              <span className={`rounded border px-2 py-0.5 text-xs ${statusBadge.color}`}>
                {statusBadge.label}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="text-white/40">基金经理</span>{" "}
                <span className="text-white/70">{fund.manager?.name || "—"}</span>
              </span>
              <span>
                <span className="text-white/40">基金公司</span>{" "}
                <span className="text-white/70">{fund.company || "—"}</span>
              </span>
              <span>
                <span className="text-white/40">成立</span>{" "}
                <span className="text-white/70">{fund.establishDate || "—"}</span>
              </span>
              {isPartial ? (
                <button
                  onClick={onRefresh}
                  className="inline-flex items-center gap-1 text-[#5AA9FF] hover:underline"
                >
                  <RefreshCw className="h-3 w-3" />
                  补全中
                </button>
              ) : null}
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
            <div className="text-xs text-muted-foreground">净值日期</div>
            <div className="data-number text-sm">{String(navDate)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ===================== KPI 条 =====================

function KpiStrip({
  fund,
  risk,
}: {
  fund: any;
  risk: ReturnType<typeof computeRisk>;
}) {
  const perf = fund.performance || {};
  const items = [
    {
      icon: TrendingUp,
      label: "近3月",
      value: perf.return3m != null ? pct(perf.return3m) : null,
      reason: "暂无真实业绩数据",
    },
    {
      icon: TrendingUp,
      label: "近6月",
      value: perf.return6m != null ? pct(perf.return6m) : null,
      reason: "暂无真实业绩数据",
    },
    {
      icon: TrendingUp,
      label: "近1年",
      value: perf.return1y != null ? pct(perf.return1y) : null,
      reason: "暂无真实业绩数据",
    },
    {
      icon: TrendingUp,
      label: "近3年",
      value: perf.return3y != null ? pct(perf.return3y) : null,
      reason: "暂无真实业绩数据",
    },
    {
      icon: Activity,
      label: "最大回撤",
      value: risk.maxDrawdown != null ? pct(risk.maxDrawdown) : null,
      reason: "净值历史不足，无法计算回撤",
    },
    {
      icon: BarChart3,
      label: "年化波动",
      value: risk.volatility != null ? pct(risk.volatility) : null,
      reason: "净值历史不足，无法计算波动率",
    },
    {
      icon: ShieldAlert,
      label: "Sharpe",
      value: risk.sharpe != null ? numFmt(risk.sharpe, 2) : null,
      reason: "净值历史不足，无法计算Sharpe",
    },
    {
      icon: Scale,
      label: "规模",
      value: fund.totalScale != null ? `${fund.totalScale}亿` : null,
      reason: "暂无规模数据",
    },
    {
      icon: Percent,
      label: "管理费",
      value: fund.feeManage != null ? formatFee(fund.feeManage) : null,
      reason: "暂无费率数据",
    },
  ];

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
        >
          <div className="flex items-center gap-1.5 text-xs text-white/40">
            <it.icon className="h-3 w-3" />
            {it.label}
          </div>
          <div className="mt-1 text-sm font-semibold">
            {it.value != null ? (
              <span className="data-number">{it.value}</span>
            ) : (
              <span className="text-white/25" title={it.reason}>
                —
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ===================== 同类与基准 =====================

function PeerSection({
  peerData,
  performanceRows,
}: {
  peerData: any;
  performanceRows: PerfRow[];
}) {
  return (
    <>
      <Panel title="业绩对比矩阵">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-white/45">
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
            </tbody>
          </table>
        </div>
        {!peerData?.peer?.return1y && (
          <div className="mt-2 text-xs text-muted-foreground">
            🛈 同类均值 / 沪深300 / 业绩比较基准 对比数据待后端补齐。
          </div>
        )}
      </Panel>
    </>
  );
}

// ===================== 购买信息 · 评级 · 数据覆盖 =====================

function MetaSection({
  fund,
  rating,
  purchaseInfo,
  completeness,
  navPoints,
}: {
  fund: any;
  rating: { rating3y: number | null; rating5y: number | null; score: number | null; source: string | null } | null | undefined;
  purchaseInfo: {
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
  completeness?: { coverage?: number; available?: number; partial?: number; total?: number } | null;
  navPoints: Array<{ d: string; nav: number }>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
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
            <dt className="text-muted-foreground">管理费率</dt>
            <dd className="text-right">{purchaseInfo.managementFeeRate || "—"}</dd>
            <dt className="text-muted-foreground">托管费率</dt>
            <dd className="text-right">{purchaseInfo.custodyFeeRate || "—"}</dd>
            <dt className="text-muted-foreground">总费率(1年)</dt>
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

      {/* 数据覆盖快览 */}
      <Panel title="数据覆盖快览">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="净值点数" value={String(navPoints.length)} />
          <Metric label="持仓数" value={String(fund.holdings?.length || 0)} />
          <Metric label="资产项" value={String(fund.assetAllocation?.length || 0)} />
          <Metric
            label="真实覆盖"
            value={completeness?.total ? `${Math.round((completeness.coverage || 0) * 100)}%` : "—"}
          />
        </div>
      </Panel>
    </div>
  );
}

// ===================== 数据缺口清单 =====================

function DataGapsPanel({ items }: { items: CoverageEntry[] }) {
  const gaps = items.filter((it) => it.status === "missing" || it.status === "error" || it.status === "partial" || it.status === "stale");
  if (gaps.length === 0) {
    return (
      <div className="rounded-md border border-[#16C784]/20 bg-[#16C784]/5 px-4 py-3 text-sm text-[#16C784]">
        当前所有数据板块均已可用，无已知缺口。
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {gaps.map((it) => (
        <div
          key={it.key}
          className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${STATUS_TONES[it.status]}`}
        >
          <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-current opacity-60" />
          <span className="font-medium">{it.label}</span>
          <span className="ml-1 text-[11px] opacity-70">{STATUS_LABELS[it.status]}</span>
          {it.reason ? (
            <span className="ml-auto text-xs opacity-60">{it.reason}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ===================== 左侧栏 =====================

function formatFee(v: unknown): string {
  const x = num(v);
  if (x === null) return "—";
  return `${(x <= 1 ? x * 100 : x).toFixed(2)}%`;
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
  const comparisonChartData = hasAll
    ? series[0].data.map((point) => {
        const keys = ["fund", "peer", "index", "bench"] as const;
        const row: Record<string, string | number | null> = { d: point.d };
        series.forEach((s, index) => {
          const matched = s.data.find((item) => item.d === point.d);
          row[keys[index]] = matched?.value ?? null;
        });
        return row;
      })
    : navSeries;

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
              <ComposedChart data={comparisonChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [`${Number(value).toFixed(2)}%`, ""]} />
                <Line dataKey="fund" stroke={SERIES_COLORS.fund} dot={false} name="本基金" />
                <Line dataKey="peer" stroke={SERIES_COLORS.peer} dot={false} name="偏股混合均值" />
                <Line dataKey="index" stroke={SERIES_COLORS.index} dot={false} name="沪深300" />
                <Line dataKey="bench" stroke={SERIES_COLORS.bench} dot={false} name="业绩比较基准" />
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
              <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-white/45">
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
              <tr className="border-b border-white/[0.04] bg-white/[0.02] text-xs text-white/45">
                <td className="px-2 py-1.5">同类排名</td>
                {PERF_COLS.map((c) => (
                  <td key={c.key} className="px-2 py-1.5 text-right text-white/45">
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
  const hasData = hasApi
    ? apiRows.some((y) => y.fundReturn !== null || y.hs300Return !== null || y.peerReturn !== null)
    : yearReturns.some((y) => y.fund !== null || y.index !== null || y.peer !== null);
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
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-white/45">
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
          <code className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/45">
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
  scaleRows: Array<{ quarter: string; totalScale: number; peer25Scale: number | null }>;
  turnoverRows: Array<{ quarter: string; turnoverRate: number }>;
}) {
  const hasScale = scaleRows.length > 0;
  const hasTurnover = turnoverRows.length > 0;
  // 检查 peer25Scale 是否全为 null / 0
  const hasPeerScale = hasScale && scaleRows.some((r) => r.peer25Scale != null && r.peer25Scale !== 0);
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
                {hasPeerScale && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />}
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="totalScale" fill={chartColors[0]} name="净资产(亿元)" />
                {hasPeerScale && (
                  <Line yAxisId="right" dataKey="peer25Scale" stroke={chartColors[1]} dot={false} name="同类 25% 分位" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            {!hasPeerScale && (
              <div className="mt-1 text-xs text-muted-foreground">
                🛈 同类 25% 分位数据暂缺，仅展示本基金规模曲线。
              </div>
            )}
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
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3 text-sm leading-relaxed text-white/80">
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
            <code className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/45">
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
        title="同类风险对比"
        extra={
          <span className="rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            多窗口期
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-white/45">
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
                  <tr className="border-b border-white/[0.04] bg-white/[0.02] text-xs text-white/45">
                    <td className="px-2 py-1.5 pl-4">±同类</td>
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
  holderStatus,
  bondAllocation,
  bondAllocationStatus,
}: {
  fund: any;
  industryHistoryData: Array<Record<string, string | number>>;
  holderStructure: Array<{ quarter: string; institution: number; individual: number }>;
  holderStatus?: DetailRowsPayload<{ quarter: string; institution: number; individual: number }>;
  bondAllocation: Array<{ bondType: string; ratio: number; changeRatio: number | null }>;
  bondAllocationStatus?: DetailRowsPayload<{ bondType: string; ratio: number; changeRatio: number | null }>;
}) {
  const alloc = (fund.assetAllocation || []) as any[];
  const industries = (fund.industries || []) as Array<{ industry: string; ratio: number | string }>;
  const bondRows = bondAllocation
    .map((row) => ({ ...row, ratioPct: ratioPct(row.ratio) }))
    .filter((row) => row.bondType && row.ratioPct > 0)
    .sort((a, b) => b.ratioPct - a.ratioPct);
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
            <EmptyState label={missingReason(holderStatus, "持有人结构数据待补")} />
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

      {bondRows.length === 0 ? (
        <MissingPanel
          title="券种配置"
          reason={missingReason(
            bondAllocationStatus,
            "依赖 fund.bondAllocation（国家债券 / 央行票据 / 金融债券 / 可转债 / 同业存单等）",
          )}
          endpoint="trpc.fund.bondAllocation"
          height={200}
        />
      ) : (
        <Panel
          title="券种配置"
          extra={
            bondAllocationStatus?.asOf ? (
              <span className="text-xs text-muted-foreground">{bondAllocationStatus.asOf}</span>
            ) : null
          }
        >
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={bondRows}
                margin={{ left: 20, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="bondType" width={120} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => [`${Number(value).toFixed(2)}%`, "占净值比"]} />
                <Bar dataKey="ratioPct" fill={SERIES_COLORS.bench} name="占净值比(%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
    </>
  );
}

// ===================== 重仓明细 =====================

function HoldingsSection({
  fund,
  bondHoldings,
  bondHoldingsStatus,
}: {
  fund: any;
  bondHoldings: Array<{
    bondName?: string;
    marketValue?: number | null;
    navRatio?: number | null;
    couponRate?: number | null;
    issuer?: string | null;
    bondType?: string | null;
    creditRating?: string | null;
  }>;
  bondHoldingsStatus?: DetailRowsPayload<any>;
}) {
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
              <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-white/45">
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

      {bondHoldings.length === 0 ? (
        <MissingPanel
          title="重仓债券"
          reason={missingReason(
            bondHoldingsStatus,
            "依赖 fund.bondHoldings（证券简称 / 持仓市值 / 占净值比 / 票面利率 / 发行主体 / 债券类型 / 发行信用评级）",
          )}
          endpoint="trpc.fund.bondHoldings"
          height={140}
        />
      ) : (
        <Panel
          title="重仓债券"
          extra={
            bondHoldingsStatus?.asOf ? (
              <span className="text-xs text-muted-foreground">{bondHoldingsStatus.asOf}</span>
            ) : null
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-white/45">
                  <th className="px-2 py-2 text-left">证券简称</th>
                  <th className="px-2 py-2 text-right">持仓市值(万元)</th>
                  <th className="px-2 py-2 text-right">占净值比</th>
                  <th className="px-2 py-2 text-right">票面利率</th>
                  <th className="px-2 py-2 text-left">发行主体</th>
                  <th className="px-2 py-2 text-left">债券类型</th>
                  <th className="px-2 py-2 text-left">信用评级</th>
                </tr>
              </thead>
              <tbody>
                {bondHoldings.map((bond, index) => (
                  <tr key={`${bond.bondName || "bond"}-${index}`} className="border-b">
                    <td className="px-2 py-2">{bond.bondName || "—"}</td>
                    <td className="px-2 py-2 text-right">{numFmt(bond.marketValue)}</td>
                    <td className="px-2 py-2 text-right">
                      {bond.navRatio == null ? "—" : pct(bond.navRatio)}
                    </td>
                    <td className="px-2 py-2 text-right">{pct(bond.couponRate)}</td>
                    <td className="px-2 py-2 text-muted-foreground">{bond.issuer || "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground">{bond.bondType || "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground">{bond.creditRating || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
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
            <code className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/45">
              trpc.fund.managerHistory
            </code>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-white/45">
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
            <code className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/45">
              trpc.fund.managerReport
            </code>
          </div>
        )}
      </Panel>
    </>
  );
}

// ===================== 数据覆盖度摘要 =====================

type CoverageSummary = ReturnType<typeof summarizeDetailCoverage>;

function CoverageSummary({ summary }: { summary: CoverageSummary }) {
  const { items, total, available, partial, stale, missing, pending, error } = summary;
  if (total === 0) return null;
  const order: Array<keyof typeof STATUS_LABELS> = ["available", "partial", "stale", "pending", "missing", "error"];
  const counts: Record<string, number> = { available, partial, stale, pending, missing, error };
  return (
    <section className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-white/80">数据覆盖度</span>
        <span className="text-[11px] text-white/40">共 {total} 个数据源</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {order.map((k) => {
            const c = counts[k] || 0;
            if (c === 0) return null;
            return (
              <span
                key={k}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONES[k]}`}
              >
                <span className="font-semibold data-number">{c}</span>
                <span>{STATUS_LABELS[k]}</span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((it) => (
          <div
            key={it.key}
            className="flex min-w-0 items-center gap-2 text-xs"
            title={it.reason || it.label}
          >
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                it.status === "available"
                  ? "bg-[#16C784]"
                  : it.status === "partial"
                    ? "bg-[#FFB800]"
                    : it.status === "stale"
                      ? "bg-[#E9AB60]"
                      : it.status === "pending"
                        ? "bg-[#5AA9FF]"
                        : it.status === "error"
                          ? "bg-[#F5384B]"
                          : "bg-white/30"
              }`}
            />
            <span className="truncate text-white/65">{it.label}</span>
            <span className={`ml-auto shrink-0 text-[10px] ${STATUS_TONES[it.status].split(" ")[0]}`}>
              {STATUS_LABELS[it.status]}
            </span>
          </div>
        ))}
      </div>
      {error > 0 || partial > 0 || missing > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {items
            .filter((it) => it.status === "missing" || it.status === "error" || it.status === "partial")
            .slice(0, 6)
            .map((it) => (
              <span
                key={`miss-${it.key}`}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${STATUS_TONES[it.status]}`}
                title={it.reason || ""}
              >
                <span className="font-mono">trpc.fund.{it.key}</span>
                <span>· {STATUS_LABELS[it.status]}</span>
              </span>
            ))}
          {items.filter((it) => it.status === "missing" || it.status === "error" || it.status === "partial").length > 6 ? (
            <span className="text-[10px] text-white/40">…</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

