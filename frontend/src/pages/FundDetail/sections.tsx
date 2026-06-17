import { Fragment, useState } from "react";
import { AlertCircle, Star, TrendingUp, Activity, BarChart3, Scale, Percent, ShieldAlert, RefreshCw } from "lucide-react";
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
import { getChangeTextClass } from "@/lib/colors";
import { chartDateTick, mergeReturnSeriesByDate } from "@/lib/fund-detail-chart";
import {
  num,
  pct,
  numFmt,
  PERF_COLS,
  type PeerSeries,
  type PerfRow,
  ratioPct,
} from "@/lib/fund-data";
import { type DetailRowsPayload, missingReason } from "@/lib/detail-status";
import type { CoverageSummary as DetailCoverageSummary } from "@/components/fund-detail/types";
import { Panel } from "@/components/report/Panel";
import { MissingPanel } from "@/components/report/MissingPanel";
import { ChangeCell } from "@/components/report/ChangeCell";
import { RANGE_OPTIONS, SERIES_COLORS, TOOLTIP_STYLE, chartColors, type RangeKey } from "./constants";
import { computeRisk } from "./utils";

export function EmptyState({ label = "暂无数据" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function PartialBanner({ code }: { code: string }) {
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

// ===================== 研究页头部 =====================

export function ResearchHeader({
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
  coverage: DetailCoverageSummary;
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

export function KpiStrip({
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
      label: "夏普比率",
      value: risk.sharpe != null ? numFmt(risk.sharpe, 2) : null,
      reason: "净值历史不足，无法计算夏普比率",
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

export function PeerSection({
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

export function MetaSection({
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
      {purchaseInfo && (
        purchaseInfo.purchaseStatus
        || purchaseInfo.redeemStatus
        || purchaseInfo.minPurchaseAmount
        || purchaseInfo.managementFeeRate
        || purchaseInfo.custodyFeeRate
        || purchaseInfo.totalFeeRate1y != null
      ) ? (
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
          reason="依赖基金评级接口（3 年 / 5 年评级，1~5 颗星），后端接口已就绪但需数据库有基金评级数据"
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

// ===================== 左侧栏 =====================

function formatFee(v: unknown): string {
  const x = num(v);
  if (x === null) return "—";
  return `${(x <= 1 ? x * 100 : x).toFixed(2)}%`;
}


// ===================== 业绩表现 =====================

export function PerformanceSection({
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
  // 使用日期并集做横轴；基金和指数交易日不完全一致时，通过 connectNulls 连成各自曲线。
  const seriesKeys = ["fund", "peer", "index", "bench"] as const;
  const hasAnyComparison = series.slice(1).some((s) => s.data.length > 0);
  const comparisonChartData = hasAnyComparison ? mergeReturnSeriesByDate(series, seriesKeys) : navSeries;
  const missingComparisonNames = series.slice(1).filter((s) => s.data.length === 0).map((s) => s.name);

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
          {comparisonChartData.length === 0 ? (
            <EmptyState />
          ) : hasAnyComparison ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={comparisonChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} tickFormatter={chartDateTick} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [`${Number(value).toFixed(2)}%`, ""]} />
                <Line dataKey="fund" stroke={SERIES_COLORS.fund} dot={false} name="本基金" connectNulls />
                <Line dataKey="peer" stroke={SERIES_COLORS.peer} dot={false} name="偏股混合均值" connectNulls />
                <Line dataKey="index" stroke={SERIES_COLORS.index} dot={false} name="沪深300" connectNulls />
                <Line dataKey="bench" stroke={SERIES_COLORS.bench} dot={false} name="业绩比较基准" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={navSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} tickFormatter={chartDateTick} />
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
        {!hasAnyComparison ? (
          <div className="mt-2 text-xs text-muted-foreground">
            🛈 当前只绘制了本基金曲线。偏股混合均值 / 沪深300 / 业绩比较基准 3 条对比曲线
            需后端补充对应接口后展示。
          </div>
        ) : missingComparisonNames.length > 0 ? (
          <div className="mt-2 text-xs text-muted-foreground">
            🛈 已展示可用对比曲线；{missingComparisonNames.join(" / ")} 暂无序列数据。
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

export function HistorySection({
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

export type TurnoverRow = {
  quarter: string;
  turnoverRate: number | null;
  buyStockAmount?: number | null;
  sellStockAmount?: number | null;
  calculationStatus?: string | null;
};

export function ScaleSection({
  scaleRows,
  turnoverRows,
}: {
  scaleRows: Array<{ quarter: string; totalScale: number; peer25Scale: number | null }>;
  turnoverRows: TurnoverRow[];
}) {
  const hasScale = scaleRows.length > 0;
  const turnoverRateRows = turnoverRows.filter((r) => typeof r.turnoverRate === "number");
  const hasTurnover = turnoverRateRows.length > 0;
  const tradingActivity = !hasTurnover
    ? turnoverRows.find((r) => r.buyStockAmount != null || r.sellStockAmount != null)
    : null;
  // 检查 peer25Scale 是否全为 null / 0
  const hasPeerScale = hasScale && scaleRows.some((r) => r.peer25Scale != null && r.peer25Scale !== 0);
  const formatCnyYi = (value?: number | null) =>
    value == null ? "—" : `${numFmt(value / 100000000, 2)}亿`;
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
              <ComposedChart data={turnoverRateRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="quarter" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="turnoverRate" stroke={chartColors[0]} dot={false} name="换手率(%)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : tradingActivity ? (
          <div className="flex h-[260px] flex-col justify-center gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Metric label="年报买入股票成本" value={formatCnyYi(tradingActivity.buyStockAmount)} />
              <Metric label="年报卖出股票收入" value={formatCnyYi(tradingActivity.sellStockAmount)} />
            </div>
            <div className="rounded-md border border-[#FFB800]/25 bg-[#FFB800]/10 px-3 py-2 text-xs leading-relaxed text-[#FFD98A]">
              定期报告披露了买卖成交额，但缺少有股票持仓交易日日均股票市值，暂不计算股票换手率。
            </div>
            <div className="text-xs text-muted-foreground">
              {tradingActivity.quarter || "最新定期报告"} · eastmoney:periodic_report_pdf
            </div>
          </div>
        ) : (
          <EmptyState label="基金换手率数据待补" />
        )}
      </Panel>
    </div>
  );
}

// ===================== 风险分析 =====================

export function RiskSection({
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
    { label: "阿尔法（年化）", values: [null, null, null, null] },
    { label: "贝塔", values: [null, null, null, null] },
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
          <Metric label="夏普比率" value={numFmt(risk.sharpe)} />
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
                <XAxis dataKey="d" tick={{ fontSize: 11 }} tickFormatter={chartDateTick} />
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

export function AllocationSection({
  fund,
  industryHistoryData,
  holderStructure,
  holderStatus,
  bondAllocation,
  bondAllocationStatus,
}: {
  fund: any;
  industryHistoryData: Array<Record<string, string | number>>;
  holderStructure: Array<{ quarter: string; institution: number; individual: number; linkedFund?: number | null }>;
  holderStatus?: DetailRowsPayload<{ quarter: string; institution: number; individual: number; linkedFund?: number | null }>;
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
                  {holderStructure.some((row) => Number(row.linkedFund || 0) > 0) ? (
                    <Bar dataKey="linkedFund" stackId="h" fill={chartColors[2]} name="联接基金占比(%)" />
                  ) : null}
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

export function HoldingsSection({
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
  const [showAllStockRows, setShowAllStockRows] = useState(false);
  const [showAllBondRows, setShowAllBondRows] = useState(false);
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
                (() => {
                  const VISIBLE = 10;
                  const visibleRows = holdings.slice(0, showAllStockRows ? 20 : VISIBLE);
                  const hiddenRows = showAllStockRows ? [] : holdings.slice(VISIBLE, 20);
                  const row = (h: any, i: number) => {
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
                  };
                  return (
                    <>
                      {visibleRows.map((h, i) => row(h, i))}
                      {hiddenRows.length > 0 ? (
                        <tr>
                          <td colSpan={8} className="px-2 py-1">
                            <button
                              type="button"
                              className="text-xs text-white/40 hover:text-white/60"
                              onClick={() => setShowAllStockRows(true)}
                            >
                              展开其余 {hiddenRows.length} 项持仓
                            </button>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })()
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
                {(() => {
                  const VISIBLE = 10;
                  const visibleBonds = bondHoldings.slice(0, showAllBondRows ? undefined : VISIBLE);
                  const hiddenBonds = showAllBondRows ? [] : bondHoldings.slice(VISIBLE);
                  const row = (bond: typeof bondHoldings[number], index: number) => (
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
                  );
                  return (
                    <>
                      {visibleBonds.map((bond, i) => row(bond, i))}
                      {hiddenBonds.length > 0 ? (
                        <tr>
                          <td colSpan={7} className="px-2 py-1">
                            <button
                              type="button"
                              className="text-xs text-white/40 hover:text-white/60"
                              onClick={() => setShowAllBondRows(true)}
                            >
                              展开其余 {hiddenBonds.length} 项债券持仓
                            </button>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

// ===================== 基金经理 =====================

export function ManagerSection({
  fund,
  managerHistory,
  managerReport,
}: {
  fund: any;
  managerHistory: Array<{ managerName: string; startDate: string; endDate: string | null; totalReturn: number | null; annualizedReturn: number | null; rank: { rank: number; total: number } | null }>;
  managerReport: { report: string | null; period: string | null } | null | undefined;
}) {
  const [showAllManagers, setShowAllManagers] = useState(false);
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
                {(() => {
                  const VISIBLE = 5;
                  const visibleMgrs = managerHistory.slice(0, showAllManagers ? undefined : VISIBLE);
                  const hiddenMgrs = showAllManagers ? [] : managerHistory.slice(VISIBLE);
                  const row = (m: typeof managerHistory[number], i: number) => (
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
                  );
                  return (
                    <>
                      {visibleMgrs.map((m, i) => row(m, i))}
                      {hiddenMgrs.length > 0 ? (
                        <tr>
                          <td colSpan={6} className="px-2 py-1">
                            <button
                              type="button"
                              className="text-xs text-white/40 hover:text-white/60"
                              onClick={() => setShowAllManagers(true)}
                            >
                              展开其余 {hiddenMgrs.length} 位经理
                            </button>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })()}
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
