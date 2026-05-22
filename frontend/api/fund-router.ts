import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import {
  getFundList,
  getCategories as ftGetCategories,
  getFundAnalysis,
  getFundAnalysisBatch,
  runDcaBacktest,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist as ftRemoveFromWatchlist,
  getFundLLMReview,
  getDcaLLMReview,
  ftFetch,
} from "./lib/fundtrader-client";
import {
  mapFundItem,
  mapFundDetail,
  mapBacktestResult,
  mapMarketOverview,
} from "./lib/mapper";
import { fetchFundQuote } from "./lib/fund-quote";

const strategyMap: Record<string, string> = {
  compare: "compare",
  fixed_amount: "fixed",
  fixed_ratio: "ratio",
  value_averaging: "ma",
  smart_beta: "ma",
  martingale: "martingale",
};

function wrapError(err: unknown, message: string): never {
  console.error(`[fundRouter] ${message}:`, err);
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message,
    cause: err,
  });
}

// ========== BFF 层内存缓存 ==========
// 缓存分层设计（基于基金数据低频更新特性）
// L0 快照: 代码/名称/费率/经理 — 24h TTL，每日15:30后刷新
// L1 准静态: 持仓/行业/回撤/Sharpe — 1h TTL，季报级别6h
// L2 日频: 净值/日涨跌 — 15min TTL，交易时段实时

const bffCache = new Map<string, { expiresAt: number; data: any }>();

/** 默认缓存TTL按数据层级分级 */
const BFF_CACHE_TTL = 30 * 60 * 1000;                     // 默认 30分钟
const DAILY_PREWARM_HOUR = Number(process.env.FUNDTRADER_PREWARM_HOUR ?? 6);
const DAILY_PREWARM_MINUTE = Number(process.env.FUNDTRADER_PREWARM_MINUTE ?? 20);
const DAILY_CACHE_FLOOR_TTL = 60 * 60 * 1000;
const DAILY_CACHE_MAX_TTL = 24 * 60 * 60 * 1000;
const ANALYSIS_TTL = DAILY_CACHE_MAX_TTL;                  // 风险指标/净值历史日频更新
const HOLDINGS_TTL = 6 * 60 * 60 * 1000;                   // 持仓/行业 6小时（季报级别）

function msUntilDailyPrewarm(now = new Date()): number {
  const next = new Date(now);
  next.setHours(DAILY_PREWARM_HOUR, DAILY_PREWARM_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function dailyCacheTtl(now = new Date()): number {
  const ttl = msUntilDailyPrewarm(now);
  return Math.min(DAILY_CACHE_MAX_TTL, Math.max(DAILY_CACHE_FLOOR_TTL, ttl));
}

function getCached<T>(key: string): T | null {
  const entry = bffCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data as T;
  bffCache.delete(key); // 过期清理
  return null;
}

function setCache<T>(key: string, data: T, ttlMs = BFF_CACHE_TTL): void {
  bffCache.set(key, { expiresAt: Date.now() + ttlMs, data });
}

function invalidateCache(prefix: string): void {
  for (const key of bffCache.keys()) {
    if (key.startsWith(prefix)) bffCache.delete(key);
  }
}

function invalidateHomeCaches(): void {
  invalidateCache("homeFunds");
  invalidateCache("homeFundSummaries");
  invalidateCache("marketOverview");
  invalidateCache("analysis_");
}

function hasRiskMetrics(fund: any): boolean {
  const perf = fund?.performance || {};
  const hasMetric = (value: unknown) => (
    value !== undefined &&
    value !== null &&
    value !== "" &&
    value !== "—" &&
    value !== "鈥?"
  );
  return (
    hasMetric(perf.sharpeRatio) ||
    hasMetric(perf.maxDrawdown) ||
    hasMetric(fund?.sharpe_ratio) ||
    hasMetric(fund?.max_drawdown) ||
    (Array.isArray(fund?.nav_data) && fund.nav_data.length > 1)
  );
}

function hasAnyRiskMetrics(funds: any[]): boolean {
  return funds.some(hasRiskMetrics);
}

function isUsableFundName(name: unknown, code: string) {
  const value = String(name || "").trim();
  return Boolean(value) && value !== code && !/^\d{6}$/.test(value);
}

function chooseFundName(preferred: unknown, fallback: unknown, code: string) {
  if (isUsableFundName(preferred, code)) return String(preferred).trim();
  if (isUsableFundName(fallback, code)) return String(fallback).trim();
  return code;
}

function parseMetric(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === "—" || value === "暂无") return null;
  const num = parseFloat(String(value).replace("%", ""));
  return Number.isFinite(num) ? num : null;
}

function finiteAverage(values: Array<number | null>, options: { excludeZero?: boolean } = {}) {
  const valid = values.filter((value): value is number => (
    value !== null &&
    Number.isFinite(value) &&
    (!options.excludeZero || Math.abs(value) > 1e-8)
  ));
  return valid.length > 0
    ? (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2)
    : "—";
}

function buildMarketOverview(mappedFunds: any[]) {
  const totalFunds = mappedFunds.length;
  return {
    totalFunds,
    avgReturn: totalFunds > 0
      ? finiteAverage(mappedFunds.map((fund: any) => parseMetric(fund.performance?.annualizedReturn ?? fund.performance?.return1y)))
      : "0",
    avgSharpe: totalFunds > 0
      ? finiteAverage(mappedFunds.map((fund: any) => parseMetric(fund.performance?.sharpeRatio)), { excludeZero: true })
      : "—",
    avgMaxDD: totalFunds > 0
      ? finiteAverage(mappedFunds.map((fund: any) => parseMetric(fund.performance?.maxDrawdown)), { excludeZero: true })
      : "—",
    marketingCount: mappedFunds.filter((fund: any) => fund.isXinjihui || fund.isContinuousMarketing).length,
  };
}

// ========== 防并发锁（冷启动时 list + marketOverview 竞态问题） ==========
const inflightRequests = new Map<string, Promise<any>>();
let homeFundsPrewarmStartedAt = 0;

function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflightRequests.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => inflightRequests.delete(key));
  inflightRequests.set(key, promise);
  return promise;
}

function scheduleHomeFundsPrewarm() {
  const now = Date.now();
  if (getCached<any[]>("homeFunds")) return;
  if (now - homeFundsPrewarmStartedAt < 60 * 1000) return;
  homeFundsPrewarmStartedAt = now;
  setTimeout(() => {
    fetchHomeFunds().catch((err) => {
      console.error("[fundRouter] 预热首页风险指标失败:", err);
    });
  }, 100);
}

function refreshHomeCaches(reason: string) {
  invalidateCache("homeFunds");
  invalidateCache("homeFundSummaries");
  invalidateCache("marketOverview");
  fetchHomeFunds()
    .then((funds) => {
      const mapped = funds.map(mapFundItem).filter(Boolean);
      const overview = buildMarketOverview(mapped);
      setCache("marketOverview", overview, dailyCacheTtl());
    })
    .catch((err) => {
      console.error(`[fundRouter] 首页缓存刷新失败(${reason}):`, err);
    });
}

function scheduleDailyHomePrewarm() {
  const delay = Math.max(1000, msUntilDailyPrewarm());
  const timer = setTimeout(() => {
    refreshHomeCaches("daily");
    scheduleDailyHomePrewarm();
  }, delay);
  timer.unref?.();
}

async function fetchAllFundList(params: Record<string, any>) {
  const allFunds: any[] = [];
  let backendPage = 1;
  let backendTotal = Infinity;

  while (allFunds.length < backendTotal) {
    const pageResult = await getFundList({
      ...params,
      page: backendPage,
      page_size: 100,
    });
    const batch = Array.isArray(pageResult?.funds) ? pageResult.funds : [];
    if (batch.length === 0) break;
    allFunds.push(...batch);
    backendTotal = pageResult?.total ?? allFunds.length;
    backendPage++;
    if (backendPage > 100) break;
  }

  return allFunds;
}

/**
 * 轻量首页摘要：仅拉取基金列表+排名业绩+实时报价，不调用 /analysis/batch。
 * 避免首屏同时背上 100+ 只基金的深度分析（净值历史/持仓/经理/Sharpe）。
 * 首页表格需要的 净值/日涨跌/近1年 均已在排名数据中 → 首屏秒开。
 * 缺失的 夏普比/最大回撤 展示为 "—"，由后台预热后刷新。
 */
async function fetchHomeFundSummaries() {
  return dedupe("homeFundSummaries", async () => {
    const fundsByCode = new Map<string, any>();
    const watchlistCodes = new Set<string>();

    for (const fund of await fetchAllFundList({ guoyuan_only: true })) {
      if (fund?.code) fundsByCode.set(fund.code, { ...fund, _source: "xinjihui", is_xinjihui: true });
    }

    const watchlist = await getWatchlist().catch(() => null);
    const watchlistFunds = Array.isArray(watchlist?.funds) ? watchlist.funds : [];
    if (watchlistFunds.length > 0) {
      const watchlistResult = await fetchAllFundList({ use_watchlist: true }).catch((err) => {
        console.error("[fetchHomeFundSummaries] 获取自选基金失败，跳过自选合并:", err);
        return [] as any[];
      });
      for (const fund of watchlistResult) {
        if (fund?.code) {
          watchlistCodes.add(fund.code);
          fundsByCode.set(fund.code, { ...fund, _source: "watchlist" });
        }
      }
    }

    const funds = Array.from(fundsByCode.values());
    // 补充基金名称（对仍然缺少名称的基金用实时报价补全）
    const enriched = await Promise.all(funds.map(enrichFundSummary));

    // 短 TTL：15min（净值日频，排名数据下一个交易日才更新）
    setCache("homeFundSummaries", enriched, dailyCacheTtl());
    return enriched;
  });
}

/**
 * 完整首页数据：含深度分析（Sharpe/最大回撤/持仓/经理）。
 * 用于 marketOverview 统计聚合与后台预热，不阻塞首屏渲染。
 */
async function fetchHomeFunds() {
  const cached = getCached<any[]>("homeFunds");
  if (cached) return cached;

  return dedupe("homeFunds", async () => {
    // 从轻量摘要获取基金列表
    const summary = await fetchHomeFundSummaries();
    const fundsByCode = new Map<string, any>();
    const watchlistCodes = new Set<string>();
    for (const fund of summary) {
      if (fund?.code) {
        fundsByCode.set(fund.code, fund);
        if (fund._source === "watchlist") watchlistCodes.add(fund.code);
      }
    }

    // 使用批量接口获取所有基金的分析数据（1次HTTP请求替代N次）
    const codes = Array.from(fundsByCode.keys());
    const analysisMap = new Map<string, any>();
    if (codes.length > 0) {
      try {
        const batchResult = await getFundAnalysisBatch(codes);
        if (batchResult?.results) {
          for (const [code, analysis] of Object.entries(batchResult.results)) {
            analysisMap.set(code, analysis);
          }
        }
      } catch (e) {
        console.error("[fetchHomeFunds] 批量获取分析数据失败，回退到单个请求:", e);
        await Promise.all(
          codes.map(async (code) => {
            try {
              const analysis = await getFundAnalysis(code);
              if (analysis) analysisMap.set(code, analysis);
            } catch (err) {
              console.error(`[fetchHomeFunds] 获取 ${code} 分析数据失败:`, err);
            }
          })
        );
      }
    }

    // 合并分析数据到基金对象
    const withAnalysis = Array.from(fundsByCode.values()).map((fund) => {
      const analysis = analysisMap.get(fund.code);
      if (!analysis || analysis.error) return fund;
      return {
        ...fund,
        ...analysis,
        code: fund.code,
        _source: fund._source,
        is_xinjihui: fund.is_xinjihui,
        name: chooseFundName(analysis.name, fund.name, fund.code),
        nav: analysis.nav ?? fund.nav,
        nav_date: analysis.nav_date || fund.nav_date,
        day_growth: analysis.day_growth ?? fund.day_growth,
        nav_data: analysis.nav_data || [],
        manager_info: analysis.manager || fund.manager_info,
        holdings: analysis.holdings || fund.holdings,
        radar_scores: analysis.radar_scores,
        total_scale: analysis.total_scale,
      };
    });

    // L0+L1 快照：1小时 TTL（净值日频，分析准静态）
    setCache("homeFunds", withAnalysis, dailyCacheTtl());
    return withAnalysis;
  });
}

function needsFundName(fund: any, code: string) {
  const name = String(fund?.name || fund?.fundName || "").trim();
  return /^\d{6}$/.test(code) && (!name || name === code);
}

async function enrichFundSummary(fund: any) {
  const code = String(fund?.code || fund?.fundCode || "").trim();
  if (!needsFundName(fund, code)) return fund;

  const quote = await fetchFundQuote(code);
  if (!quote) return fund;

  return {
    ...fund,
    code,
    name: chooseFundName(fund?.name, quote.name, code),
    nav: fund?.nav ?? quote.nav,
    accum_nav: fund?.accum_nav ?? quote.accumNav,
    nav_date: fund?.nav_date ?? quote.navDate,
    day_growth: fund?.day_growth ?? quote.dayGrowth,
  };
}

async function enrichFundAnalysis(analysis: any, code: string) {
  if (!analysis || !needsFundName(analysis, code)) return analysis;

  const quote = await fetchFundQuote(code);
  if (!quote) return analysis;

  return {
    ...analysis,
    code,
    name: chooseFundName(analysis?.name, quote.name, code),
    nav: analysis?.nav ?? quote.nav,
    accum_nav: analysis?.accum_nav ?? quote.accumNav,
    nav_date: analysis?.nav_date ?? quote.navDate,
    day_growth: analysis?.day_growth ?? quote.dayGrowth,
  };
}

if (process.env.FUNDTRADER_DISABLE_AUTO_PREWARM !== "true") {
  const startupTimer = setTimeout(() => refreshHomeCaches("startup"), 1000);
  startupTimer.unref?.();
  scheduleDailyHomePrewarm();
}

export const fundRouter = createRouter({
  // 基金列表查询（支持筛选和排序）
  list: publicQuery
    .input(
      z.object({
        fundType: z.string().optional(),
        category: z.string().optional(),
        company: z.string().optional(),
        riskLevel: z.string().optional(),
        isContinuousMarketing: z.number().optional(),
        search: z.string().optional(),
        sortBy: z.string().optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      try {
        const opts = input || {};
        const page = opts.page ?? 1;
        const pageSize = opts.pageSize ?? 20;
        const sortBy = opts.sortBy ?? "dailyChange";
        const sortOrder = opts.sortOrder ?? "desc";

        // 首页优先返回已预热的完整缓存；冷启动时先返回轻量列表，后台继续预热风险指标。
        let rawFunds = getCached<any[]>("homeFunds");
        if (!rawFunds || !hasAnyRiskMetrics(rawFunds)) {
          rawFunds = await fetchHomeFundSummaries();
          scheduleHomeFundsPrewarm();
        }
        let result = rawFunds.map(mapFundItem).filter(Boolean);

        // 本地筛选
        if (opts.fundType) result = result.filter((f: any) => f.fundType === opts.fundType);
        if (opts.category) result = result.filter((f: any) => f.category?.includes(opts.category));
        if (opts.company) result = result.filter((f: any) => f.company?.includes(opts.company));
        if (opts.riskLevel) result = result.filter((f: any) => f.riskLevel === opts.riskLevel);
        if (opts.isContinuousMarketing !== undefined) result = result.filter((f: any) => f.isContinuousMarketing === opts.isContinuousMarketing);
        if (opts.search) {
          const s = opts.search.toLowerCase();
          result = result.filter((f: any) =>
            f.fundCode?.includes(s) || f.fundName?.toLowerCase().includes(s) || f.fundAbbr?.toLowerCase().includes(s) || f.manager?.name?.includes(s)
          );
        }

        // 排序
        const sortKey = sortBy;
        const sortDir = sortOrder;
        result.sort((a: any, b: any) => {
          const aPerf = a.performance || {};
          const bPerf = b.performance || {};
          const parseSortVal = (value: unknown) => {
            if (value === undefined || value === null || value === "" || value === "—" || value === "鈥?") return Number.NaN;
            const num = parseFloat(String(value).replace("%", ""));
            return Number.isFinite(num) ? num : Number.NaN;
          };
          const aVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
            ? parseSortVal(aPerf[sortKey])
            : parseSortVal(a[sortKey]);
          const bVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
            ? parseSortVal(bPerf[sortKey])
            : parseSortVal(b[sortKey]);
          if (Number.isNaN(aVal) && Number.isNaN(bVal)) return 0;
          if (Number.isNaN(aVal)) return 1;
          if (Number.isNaN(bVal)) return -1;
          return sortDir === "desc" ? bVal - aVal : aVal - bVal;
        });

        const total = result.length;
        const paginated = result.slice((page - 1) * pageSize, page * pageSize);

        return { funds: paginated, total, page, pageSize };
      } catch (err) {
        wrapError(err, "获取基金列表失败");
      }
    }),

  // 单只基金详情
  detail: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const rawFunds = getCached<any[]>("homeFunds") || await fetchHomeFundSummaries();
        const fund = rawFunds.find((f: any) => {
          const mapped = mapFundItem(f);
          return mapped?.id === input.id;
        });
        if (!fund) return null;

        // L1 准静态缓存命中：经理/持仓/回撤/Sharpe 1h 不变
        const cacheKey = `analysis_${fund.code}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return mapFundDetail(cached);

        if (hasRiskMetrics(fund) && Array.isArray(fund.nav_data)) {
          setCache(cacheKey, fund, ANALYSIS_TTL);
          return mapFundDetail(fund);
        }

        const analysis = await getFundAnalysis(fund.code);
        const enriched = await enrichFundAnalysis(analysis, fund.code);
        setCache(cacheKey, enriched, ANALYSIS_TTL);
        return mapFundDetail(enriched);
      } catch (err) {
        wrapError(err, "获取基金详情失败");
      }
    }),

  // 按基金代码获取详情。用于主页直接输入 6 位基金代码跳转。
  detailByCode: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ input }) => {
      try {
        const cacheKey = `analysis_${input.code}`;
        const cachedAnalysis = getCached<any>(cacheKey);
        if (cachedAnalysis) return mapFundDetail(cachedAnalysis);

        const cachedHomeFunds = getCached<any[]>("homeFunds");
        const cachedHomeFund = cachedHomeFunds?.find((fund: any) => fund?.code === input.code);
        if (cachedHomeFund && hasRiskMetrics(cachedHomeFund) && Array.isArray(cachedHomeFund.nav_data)) {
          setCache(cacheKey, cachedHomeFund, ANALYSIS_TTL);
          return mapFundDetail(cachedHomeFund);
        }

        const analysis = await getFundAnalysis(input.code);
        const enriched = await enrichFundAnalysis(analysis, input.code);
        setCache(cacheKey, enriched, ANALYSIS_TTL);
        return mapFundDetail(enriched);
      } catch (err) {
        wrapError(err, "按基金代码获取详情失败");
      }
    }),

  addByCode: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ input }) => {
      try {
        invalidateHomeCaches();
        const [quote, xinjihuiFunds] = await Promise.all([
          fetchFundQuote(input.code),
          fetchAllFundList({ guoyuan_only: true }).catch(() => [] as any[]),
        ]);
        const knownFund = xinjihuiFunds.find((fund: any) => fund?.code === input.code);
        const name = quote?.name || knownFund?.name || "";
        await addToWatchlist(input.code, name);
        return mapFundItem({
          code: input.code,
          name: name || input.code,
          type: knownFund?.type,
          tags: knownFund?.tags,
          nav: quote?.nav,
          accum_nav: quote?.accumNav,
          nav_date: quote?.navDate,
          day_growth: quote?.dayGrowth,
          _source: "watchlist",
        });
      } catch (err) {
        wrapError(err, "添加基金到首页列表失败");
      }
    }),

  // 移除自选基金
  removeFromWatchlist: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ input }) => {
      try {
        invalidateHomeCaches();
        await ftRemoveFromWatchlist(input.code);
        return { success: true, code: input.code };
      } catch (err) {
        wrapError(err, "移除自选基金失败");
      }
    }),

  // 基金经理详情
  managerDetail: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const rawFunds = getCached<any[]>("homeFunds") || await fetchHomeFunds();
        const allFunds = rawFunds.map(mapFundItem).filter(Boolean);
        const managerFund = allFunds.find((f: any) => f.managerId === input.id);
        if (!managerFund || !managerFund.manager) return null;

        const managedFunds = allFunds.filter((f: any) => f.managerId === input.id);
        const parse = (value: unknown) => {
          const num = parseFloat(String(value ?? "").replace("%", ""));
          return Number.isFinite(num) ? num : null;
        };
        const average = (values: Array<number | null>) => {
          const valid = values.filter((value): value is number => value !== null);
          return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
        };
        const avgReturn1y = average(managedFunds.map((fund: any) => parse(fund.performance?.return1y)));
        const avgSharpe = average(managedFunds.map((fund: any) => parse(fund.performance?.sharpeRatio)));
        const avgMaxDrawdown = average(managedFunds.map((fund: any) => parse(fund.performance?.maxDrawdown)));
        return {
          ...managerFund.manager,
          funds: managedFunds,
          fundCount: managedFunds.length,
          avgReturn1y: avgReturn1y == null ? "—" : avgReturn1y.toFixed(2),
          avgSharpe: avgSharpe == null ? "—" : avgSharpe.toFixed(2),
          avgMaxDrawdown: avgMaxDrawdown == null ? "—" : avgMaxDrawdown.toFixed(2),
        };
      } catch (err) {
        wrapError(err, "获取基金经理详情失败");
      }
    }),

  // 筛选选项
  filterOptions: publicQuery.query(async () => {
    try {
      const ftCats = await ftGetCategories();
      const categories = Array.isArray(ftCats?.categories)
        ? ftCats.categories
        : Object.values(ftCats?.categories || {}).flat();
      return {
        types: ["equity", "hybrid", "bond", "index", "qdii", "money", "fof"],
        categories,
        companies: [],
        riskLevels: ["low", "low_medium", "medium", "medium_high", "high"],
      };
    } catch (err) {
      wrapError(err, "获取筛选选项失败");
    }
  }),

  // 鑫基荟名单
  continuousMarketing: publicQuery.query(async () => {
    try {
      const ftResult = await getFundList({ guoyuan_only: true, page_size: 100 });
      const rawFunds = Array.isArray(ftResult?.funds) ? ftResult.funds : [];
      return rawFunds.map((fund: any) => mapFundItem({ ...fund, _source: "xinjihui", is_xinjihui: true })).filter((f: any) => f?.isXinjihui);
    } catch (err) {
      wrapError(err, "获取鑫基荟名单失败");
    }
  }),

  // 推荐配置列表
  recommendations: publicQuery
    .input(z.object({
      riskProfile: z.string().optional(),
      horizon: z.string().optional(),
      preferredTypes: z.array(z.string()).optional(),
      maxDrawdown: z.number().optional(),
      amount: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      try {
        const opts = input || {};
        const rawFunds = getCached<any[]>("homeFunds") || await fetchHomeFunds();
        let funds = rawFunds.map(mapFundItem).filter(Boolean);
        if (opts.preferredTypes?.length) {
          funds = funds.filter((fund: any) => opts.preferredTypes?.includes(fund.fundType));
        }
        const parseMetric = (value: unknown) => {
          const num = parseFloat(String(value ?? "").replace("%", ""));
          return Number.isFinite(num) ? num : 0;
        };
        const riskProfile = opts.riskProfile || "balanced";
        const maxDdLimit = opts.maxDrawdown ?? (riskProfile === "conservative" ? 12 : riskProfile === "aggressive" ? 35 : 22);
        const horizon = opts.horizon || "1年";
        const returnKey = horizon.includes("3个月") ? "return3m" : horizon.includes("6个月") ? "return6m" : horizon.includes("3年") ? "return3y" : "return1y";
        const templates: Record<string, Array<{ type: string; weight: number }>> = {
          conservative: [{ type: "bond", weight: 55 }, { type: "money", weight: 15 }, { type: "hybrid", weight: 20 }, { type: "index", weight: 10 }],
          balanced: [{ type: "bond", weight: 25 }, { type: "hybrid", weight: 35 }, { type: "index", weight: 25 }, { type: "equity", weight: 15 }],
          aggressive: [{ type: "equity", weight: 35 }, { type: "index", weight: 35 }, { type: "hybrid", weight: 20 }, { type: "qdii", weight: 10 }],
          moderate: [{ type: "bond", weight: 35 }, { type: "hybrid", weight: 35 }, { type: "index", weight: 20 }, { type: "equity", weight: 10 }],
        };
        let template = templates[riskProfile] || templates.balanced;
        if (horizon.includes("3个月")) {
          template = template.map((slot) => slot.type === "equity" || slot.type === "qdii" ? { ...slot, weight: Math.max(5, slot.weight - 10) } : slot.type === "bond" || slot.type === "money" ? { ...slot, weight: slot.weight + 8 } : slot);
        } else if (horizon.includes("3年")) {
          template = template.map((slot) => slot.type === "equity" || slot.type === "index" ? { ...slot, weight: slot.weight + 8 } : slot.type === "money" ? { ...slot, weight: Math.max(0, slot.weight - 10) } : slot);
        }
        const totalTemplateWeight = template.reduce((sum, slot) => sum + slot.weight, 0) || 100;
        template = template.map((slot) => ({ ...slot, weight: Math.round(slot.weight / totalTemplateWeight * 100) }));
        const drift = 100 - template.reduce((sum, slot) => sum + slot.weight, 0);
        if (template[0]) template[0].weight += drift;
        const usedCodes = new Set<string>();
        const scoreFund = (fund: any) => {
          const perf = fund.performance || {};
          const periodReturn = parseMetric(perf[returnKey]);
          const sharpe = parseMetric(perf.sharpeRatio);
          const maxDD = Math.abs(parseMetric(perf.maxDrawdown));
          const hasRisk = maxDD > 0 || sharpe > 0;
          const drawdownPenalty = maxDD > maxDdLimit ? (maxDD - maxDdLimit) * 2.5 : maxDD * 0.28;
          const missingRiskPenalty = hasRisk ? 0 : 8;
          const horizonBonus = horizon.includes("3年") ? parseMetric(perf.return3y) * 0.25 : 0;
          return periodReturn + horizonBonus + sharpe * 6 - drawdownPenalty - missingRiskPenalty;
        };
        const allocations = template.map((slot) => {
          const candidates = funds
            .filter((fund: any) => fund.fundType === slot.type && !usedCodes.has(fund.fundCode))
            .filter((fund: any) => {
              const maxDD = Math.abs(parseMetric(fund.performance?.maxDrawdown));
              return maxDD === 0 || maxDD <= maxDdLimit;
            })
            .sort((a: any, b: any) => scoreFund(b) - scoreFund(a));
          const fallback = funds
            .filter((item: any) => !usedCodes.has(item.fundCode))
            .filter((item: any) => {
              const maxDD = Math.abs(parseMetric(item.performance?.maxDrawdown));
              return maxDD === 0 || maxDD <= maxDdLimit;
            })
            .sort((a: any, b: any) => scoreFund(b) - scoreFund(a))[0];
          const fund = candidates[0] || fallback;
          if (fund) usedCodes.add(fund.fundCode);
          return fund ? {
            fundId: fund.id,
            weight: slot.weight,
            reason: `${fund.category}配置；${horizon}观察指标${fund.performance?.[returnKey] ?? "0"}%，最大回撤${fund.performance?.maxDrawdown ?? "—"}%，夏普${fund.performance?.sharpeRatio ?? "—"}，符合${maxDdLimit}%回撤约束下的综合得分。`,
            fund,
          } : null;
        }).filter(Boolean);
        const expectedReturn = allocations.length
          ? (allocations.reduce((sum: number, item: any) => sum + parseMetric(item.fund.performance?.[returnKey]) * item.weight, 0) / 100).toFixed(2)
          : "0";
        const expectedRisk = allocations.length
          ? (allocations.reduce((sum: number, item: any) => sum + Math.abs(parseMetric(item.fund.performance?.maxDrawdown)) * item.weight, 0) / 100).toFixed(2)
          : "0";
        return [{
          id: 1,
          name: `${riskProfile === "conservative" ? "稳健防守" : riskProfile === "aggressive" ? "进取成长" : "均衡配置"}组合`,
          description: `按${horizon}周期、最大回撤约束${maxDdLimit}%从鑫基荟池内生成`,
          riskProfile,
          marketCondition: horizon,
          expectedReturn,
          expectedRisk,
          rationale: `组合按风险档位先确定大类权重，再按${horizon}对应收益指标、最大回撤、夏普比率和缺失数据惩罚进行排序。最大回撤约束会先过滤不合规产品，周期改变会切换收益观察窗口，因此调参会真实影响产品和权重。`,
          tags: ["鑫基荟", "可调参数", "快速生成"],
          fundAllocations: allocations,
        }];
      } catch (err) {
        wrapError(err, "获取推荐配置失败");
      }
    }),

  // 回测记录列表
  backtests: publicQuery
    .input(z.object({ strategy: z.string().optional() }).optional())
    .query(async () => {
      // FundTrader 后端没有回测记录列表接口，返回空数组
      return [];
    }),

  // 执行回测计算
  runBacktest: publicQuery
    .input(
      z.object({
        fundIds: z.array(z.number()),
        weights: z.array(z.number()).optional(),
        strategy: z.enum(["compare", "fixed_amount", "fixed_ratio", "value_averaging", "smart_beta", "martingale"]),
        startDate: z.string(),
        endDate: z.string(),
        investAmount: z.number(),
        investFrequency: z.enum(["weekly", "biweekly", "monthly"]),
      })
    )
    .query(async ({ input }) => {
      try {
        // 同时获取国元基金和自选基金，与 list 查询保持一致
        const [rawGuoyuan, rawWatchlist] = await Promise.all([
          fetchAllFundList({ guoyuan_only: true }),
          fetchAllFundList({ use_watchlist: true }).catch(() => [] as any[]),
        ]);
        const codeMap = new Map<string, any>();
        [...rawGuoyuan, ...rawWatchlist].forEach((f: any) => { if (f?.code) codeMap.set(f.code, f); });
        const allFunds = Array.from(codeMap.values()).map(mapFundItem).filter(Boolean);
        const codes = input.fundIds.map((id) => {
          const f = allFunds.find((x: any) => x.id === id);
          if (!f) throw new Error(`Fund id ${id} not found`);
          return f.fundCode;
        });

        const backendStrategy = strategyMap[input.strategy];
        if (!backendStrategy) {
          throw new Error(`Unsupported strategy: ${input.strategy}`);
        }

        const ftResult = await runDcaBacktest({
          codes,
          amount: input.investAmount,
          frequency: input.investFrequency,
          strategy: backendStrategy,
          start_date: input.startDate,
          end_date: input.endDate,
        });

        return mapBacktestResult(ftResult);
      } catch (err) {
        wrapError(err, "执行回测失败");
      }
    }),

  // 行业分布统计（基于基金持仓聚合，抽样前30只基金）
  // 持仓数据季报级别更新（3/6/9/12月），缓存 6 小时
  industryStats: publicQuery.query(async () => {
    try {
      const cacheKey = "industryStats";
      const cached = getCached<any[]>(cacheKey);
      if (cached) return cached;

      const ftResult = await getFundList({ guoyuan_only: true, page_size: 100 });
      const rawFunds = Array.isArray(ftResult?.funds) ? ftResult.funds : [];
      const sample = rawFunds.slice(0, 30);
      const industryMap = new Map<string, number>();
      let totalRatio = 0;

      // 使用批量接口替代 N 次单独调用（30→1 次HTTP请求）
      const codes = sample.map((f: any) => f.code).filter(Boolean);
      const batchResult = await getFundAnalysisBatch(codes);
      const results = batchResult?.results || {};

      for (const code of codes) {
        const analysis = results[code];
        if (!analysis || analysis.error) continue;
        const holdings = Array.isArray(analysis.holdings) ? analysis.holdings : [];
        holdings.forEach((h: any) => {
          const ind = h.industry || "其他";
          const ratio = parseFloat(h.ratio || "0");
          if (ratio > 0) {
            industryMap.set(ind, (industryMap.get(ind) || 0) + ratio);
            totalRatio += ratio;
          }
        });
      }

      if (industryMap.size === 0) {
        return [{ industry: "暂无数据", totalRatio: "100.00" }];
      }

      // 归一化为百分比并排序
      const sorted = Array.from(industryMap.entries())
        .map(([industry, sum]) => ({
          industry,
          totalRatio: totalRatio > 0 ? ((sum / totalRatio) * 100).toFixed(2) : "0",
        }))
        .sort((a, b) => parseFloat(b.totalRatio) - parseFloat(a.totalRatio));

      const result = sorted.slice(0, 10);
      setCache(cacheKey, result, HOLDINGS_TTL);
      return result;
    } catch (err) {
      wrapError(err, "获取行业统计失败");
    }
  }),

  // 市场概览
  marketOverview: publicQuery.query(async () => {
    try {
      const cacheKey = "marketOverview";
      const cached = getCached<any>(cacheKey);
      if (cached) return cached;

      const funds = getCached<any[]>("homeFunds") || await fetchHomeFunds();
      const mapped = funds.map(mapFundItem).filter(Boolean);
      const result = buildMarketOverview(mapped);
      setCache(cacheKey, result, dailyCacheTtl());
      return result;
    } catch {
      return mapMarketOverview({});
    }
  }),

  // 基金评价 LLM 分析（详情页使用）
  analyzeFundLLM: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ input }) => {
      try {
        const cacheKey = `llm_review_v2_${input.code}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return cached;
        const data = await getFundLLMReview(input.code);
        // BFF 缓存 30 分钟（后端同时有 12 小时文件缓存）
        if (data && (data as any).review) setCache(cacheKey, data, 30 * 60 * 1000);
        return data;
      } catch (err) {
        wrapError(err, "获取基金 LLM 分析失败");
      }
    }),

  // 定投回测 LLM 评价
  analyzeDcaLLM: publicQuery
    .input(
      z.object({
        code: z.string(),
        name: z.string().optional(),
        dca: z.any(),
        benchmark: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const cacheKey = `llm_dca_${input.code}_${JSON.stringify(input.dca || {}).slice(0, 50)}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return cached;
        const data = await getDcaLLMReview({
          code: input.code,
          name: input.name || input.code,
          dca: input.dca,
          benchmark: input.benchmark || {},
        });
        if (data && (data as any).review) setCache(cacheKey, data, 30 * 60 * 1000);
        return data;
      } catch (err) {
        wrapError(err, "获取定投 LLM 评价失败");
      }
    }),

  // 图片识别基金
  imageSearch: publicQuery
    .input(z.object({ imageBase64: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const result = await ftFetch<any>(`/fund/image-search?image_base64=${encodeURIComponent(input.imageBase64)}`, {
          method: "POST",
        });
        if (!result.success) {
          throw new Error(result.error || "图片识别失败");
        }
        // 将后端原始基金数据映射为前端格式
        const mappedFunds = Array.isArray(result.funds)
          ? result.funds.map(mapFundItem).filter(Boolean)
          : [];
        return {
          summary: result.summary || "",
          recognizedCount: result.recognized_count || 0,
          matchedCount: result.matched_count || 0,
          funds: mappedFunds,
        };
      } catch (err) {
        wrapError(err, "图片识别基金失败");
      }
    }),
});
