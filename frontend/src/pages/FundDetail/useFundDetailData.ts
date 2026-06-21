import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import {
  backendReturnSeries,
  navPointsToReturnSeries,
  resolveFundReturnSeries,
  type NavPoint,
  type ReturnSeriesPoint,
  type ReturnSeriesResult,
} from "@/lib/fund-detail-chart";
import { num, emptyPeerSeries, type PeerSeries, type PerfRow, emptyPerfCell } from "@/lib/fund-data";
import {
  summarizeDetailCoverage,
  deriveStatus,
  type DetailDataStatus,
  type CoverageInput,
  type CoverageKey,
  type CoverageEntry,
  COVERAGE_LABELS,
  COVERAGE_ENDPOINTS,
} from "@/lib/detail-status";
import { DETAIL_STATIC_STALE_MS, DETAIL_QUARTERLY_STALE_MS, DETAIL_LLM_STALE_MS, SERIES_COLORS, type RangeKey } from "./constants";
import { computeRisk, filterByRange } from "./utils";

type DetailFieldSource = {
  source?: string | null;
  status?: string | null;
  dataStatus?: string | null;
  missingReason?: string | null;
  asOf?: string | null;
  coverage?: number | null;
};

type ProviderStatus = {
  name?: string;
  status?: string | null;
  available?: boolean;
  capabilities?: string[];
  lastError?: string | null;
  last_error?: string | null;
  cooldownUntil?: string | null;
  cooldown_until?: string | null;
  failureCount?: number | null;
  failure_count?: number | null;
  circuitOpen?: boolean | null;
  circuit_open?: boolean | null;
  priority?: number | null;
};

function normalizeFieldStatus(value: unknown): DetailDataStatus {
  if (value === "available" || value === "partial" || value === "stale" || value === "pending" || value === "error") {
    return value;
  }
  return "missing";
}

export function useFundDetailData() {
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
  const peerRiskQ = trpc.fund.peerRisk.useQuery(
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
  const detailFieldsQ = trpc.fund.detailFields.useQuery(
    { code },
    { enabled, staleTime: DETAIL_QUARTERLY_STALE_MS, refetchOnWindowFocus: false },
  );
  const dataSourcesStatusQ = trpc.fund.dataSourcesStatus.useQuery(
    undefined,
    { enabled, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const marketContextQ = trpc.fund.marketContext.useQuery(
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

  const navPoints = useMemo<NavPoint[]>(
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
        reason: q.isError ? "接口调用失败" : payload?.missingReason || reason,
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
      managerReport: build("managerReport", managerReportQ, "基金定期报告全文（智能分析类，延后启动）"),
      riskSummary: build("riskSummary", riskSummaryQ, "风险等级 + 自然语言摘要（智能分析类，延后启动）"),
    };
    return summarizeDetailCoverage(entries);
  }, [
    detailQuery, ratingQ, purchaseInfoQ, holderStructureQ, yearReturnsQ, peerPerformanceQ,
    scaleHistoryQ, turnoverHistoryQ, managerHistoryQ, bondAllocationQ, bondHoldingsQ,
    detailCompletenessQ, managerReportQ, riskSummaryQ,
  ]);

  const sourceCoverage = useMemo(() => {
    const fieldPayload = (detailFieldsQ.data || detailCompletenessQ.data) as
      | { fieldSources?: Record<string, DetailFieldSource>; coverage?: number; fieldCoverage?: number }
      | undefined;
    const fieldSources = fieldPayload?.fieldSources && typeof fieldPayload.fieldSources === "object"
      ? fieldPayload.fieldSources
      : {};
    const fieldEntries = Object.entries(fieldSources).map(([field, value]) => {
      const status = normalizeFieldStatus(value?.dataStatus || value?.status);
      return {
        field,
        status,
        source: value?.source ?? null,
        missingReason: value?.missingReason ?? null,
        asOf: value?.asOf ?? null,
        coverage: typeof value?.coverage === "number" ? value.coverage : null,
      };
    });

    const sourceMap = new Map<string, { source: string; count: number; available: number; partial: number; missing: number }>();
    for (const entry of fieldEntries) {
      const source = entry.source || "unattributed";
      const current = sourceMap.get(source) || { source, count: 0, available: 0, partial: 0, missing: 0 };
      current.count += 1;
      if (entry.status === "available") current.available += 1;
      else if (entry.status === "partial" || entry.status === "stale") current.partial += 1;
      else current.missing += 1;
      sourceMap.set(source, current);
    }

    const providersPayload = dataSourcesStatusQ.data as
      | { status?: string; providers?: ProviderStatus[]; availableCount?: number; totalCount?: number; updatedAt?: string | null }
      | undefined;
    const providers = Array.isArray(providersPayload?.providers) ? providersPayload.providers : [];
    const availableProviders =
      typeof providersPayload?.availableCount === "number"
        ? providersPayload.availableCount
        : providers.filter((provider) => provider.available).length;
    const totalProviders =
      typeof providersPayload?.totalCount === "number"
        ? providersPayload.totalCount
        : providers.length;

    const statusRank: Record<DetailDataStatus, number> = {
      error: 0,
      missing: 1,
      stale: 2,
      partial: 3,
      pending: 4,
      simulated: 5,
      available: 6,
    };

    return {
      fieldCoverage: typeof fieldPayload?.coverage === "number" ? fieldPayload.coverage : fieldPayload?.fieldCoverage ?? null,
      totalFields: fieldEntries.length,
      availableFields: fieldEntries.filter((entry) => entry.status === "available").length,
      partialFields: fieldEntries.filter((entry) => entry.status === "partial" || entry.status === "stale").length,
      missingFields: fieldEntries.filter((entry) => entry.status === "missing" || entry.status === "error").length,
      topSources: Array.from(sourceMap.values()).sort((a, b) => b.count - a.count).slice(0, 6),
      problemFields: [...fieldEntries]
        .filter((entry) => entry.status !== "available")
        .sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9))
        .slice(0, 6),
      providers: providers
        .slice()
        .sort((a, b) => Number(b.available) - Number(a.available) || (b.priority ?? 0) - (a.priority ?? 0))
        .slice(0, 8),
      providerStatus: providersPayload?.status || (availableProviders > 0 ? "available" : "missing"),
      availableProviders,
      totalProviders,
      updatedAt: providersPayload?.updatedAt ?? null,
      loading: detailFieldsQ.isLoading || dataSourcesStatusQ.isLoading,
      error: detailFieldsQ.isError || dataSourcesStatusQ.isError,
    };
  }, [dataSourcesStatusQ.data, dataSourcesStatusQ.isError, dataSourcesStatusQ.isLoading, detailCompletenessQ.data, detailFieldsQ.data, detailFieldsQ.isError, detailFieldsQ.isLoading]);

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
    const fundSeries = resolveFundReturnSeries(scopedPoints, ppSeries?.fund);
    // 映射后端 series 数据到 PeerSeries 格式
    const mapSeries = (
      raw: Array<{ date: string; return: number }> | undefined,
      fallbackData: ReturnSeriesPoint[] = [],
    ): ReturnSeriesResult => {
      const mapped = backendReturnSeries(raw);
      if (mapped.data.length > 0) return mapped;
      return { data: fallbackData, rangeReturn: null };
    };

    // fundRangeReturn follows the selected fund series: navHistory first, backend series as fallback.
    const finalFundRangeReturn = fundSeries.rangeReturn;
    const peerSeries = mapSeries(ppSeries?.peer);
    const indexSeries = mapSeries(ppSeries?.index);
    const benchSeries = mapSeries(ppSeries?.benchmark);

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
      return navPointsToReturnSeries(scopedPoints).data.map((x) => ({
        d: x.d,
        fund: x.value,
        dd: risk.drawdownSeries.find((dd) => dd.d === x.d)?.dd ?? 0,
      }));
    }
    // 降级：使用后端 peerPerformance.series.fund
    // 后端返回的是累计收益率（%），转换为虚拟净值（初始 1.0）使 drawdownSeries 能正确计算回撤
    const ppFund = (peerPerformanceQ.data as any)?.series?.fund as Array<{ date: string; return: number }> | undefined;
    const ppDrawdown = (peerPerformanceQ.data as any)?.series?.fund_drawdown as Array<{ date: string; drawdown: number }> | undefined;
    if (ppFund && ppFund.length > 0) {
      return ppFund.map((x, i) => ({
        d: x.date,
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

  return {
    code,
    from,
    detailQuery,
    fund,
    loading,
    err,
    ratingQ,
    purchaseInfoQ,
    holderStructureQ,
    yearReturnsQ,
    peerPerformanceQ,
    peerRiskQ,
    scaleHistoryQ,
    turnoverHistoryQ,
    managerHistoryQ,
    bondAllocationQ,
    bondHoldingsQ,
    detailCompletenessQ,
    detailFieldsQ,
    dataSourcesStatusQ,
    marketContextQ,
    managerReportQ,
    riskSummaryQ,
    range,
    setRange,
    navPoints,
    scopedPoints,
    risk,
    coverage,
    sourceCoverage,
    series,
    performanceRows,
    navSeries,
    industryHistoryData,
    yearReturns,
  };
}

export type FundDetailViewModel = ReturnType<typeof useFundDetailData>;
