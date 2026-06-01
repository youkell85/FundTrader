import { parseReviewText } from "@/utils/llm-review";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import {
  getFundAnalysis,
  getFundSnapshot,
  getFundCategoryMetrics,
  getFundSnapshotList,
  getCategories as ftGetCategories,
  runDcaBacktest,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist as ftRemoveFromWatchlist,
  getFundLLMReview,
  getDcaLLMReview,
  ftFetch,
  generateAllocation,
  requestFundBackfill,
} from "./lib/fundtrader-client";
import {
  mapFundItem,
  mapFundDetail,
  mapBacktestResult,
  mapMarketOverview,
} from "./lib/mapper";
import { fetchFundQuote, isExchangeFundCode } from "./lib/fund-quote";
import { buildPeerPerformanceRows } from "./lib/peer-rankings";
import { getUserState, updateUserState } from "./lib/user-store";

const strategyMap: Record<string, string> = {
  compare: "compare",
  fixed_amount: "fixed",
  fixed_ratio: "ratio",
  value_averaging: "ma",
  smart_beta: "ma",
  martingale: "martingale",
};

function wrapError(err: unknown, message: string): never {
  const causeMessage = err instanceof Error ? err.message : String(err);
  console.error(`[fundRouter] ${message}:`, err);
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `${message}（${causeMessage}）`,
    cause: err,
  });
}

// ========== BFF 层内存缓存 ==========
// 缓存分层设计（基于基金数据低频更新特性）
// L0 快照: 代码/名称/费率/经理 ?24h TTL，每?5:30后刷新
// L1 准静态 持仓/行业/回撤/Sharpe ?1h TTL，季报级 ?h
// L2 日频: 净值日涨跌幅 ?15min TTL，交易时段实时

const bffCache = new Map<string, { expiresAt: number; data: any }>();
const MAX_BFF_CACHE_SIZE = 5000; // Maximum cache entries to prevent memory leak
const BFF_CACHE_SIZE_LIMIT = 10000; // Hard limit before emergency cleanup
const DETAIL_ANALYSIS_TIMEOUT_MS = Number(process.env.FUNDTRADER_DETAIL_TIMEOUT_MS ?? 20_000);
/** LLM 分析超时独立配置 — MiniMax 等第三方模型需 30-60s，不能与数据查询共享 12s 限制 */
const LLM_ANALYSIS_TIMEOUT_MS = Number(process.env.FUNDTRADER_LLM_TIMEOUT_MS ?? 60_000);

/** 默认缓存TTL按数据层级分配*/
const BFF_CACHE_TTL = 30 * 60 * 1000;                     // 默认 30分钟
const DAILY_PREWARM_HOUR = Number(process.env.FUNDTRADER_PREWARM_HOUR ?? 6);
const DAILY_PREWARM_MINUTE = Number(process.env.FUNDTRADER_PREWARM_MINUTE ?? 20);
const DAILY_CACHE_FLOOR_TTL = 60 * 60 * 1000;
const DAILY_CACHE_MAX_TTL = 24 * 60 * 60 * 1000;
const HOME_ANALYSIS_LIMIT = Number(process.env.FUNDTRADER_HOME_ANALYSIS_LIMIT ?? 80);
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
  // LRU eviction: remove oldest entries when cache grows too large
  if (bffCache.size >= MAX_BFF_CACHE_SIZE) {
    const oldestKey = bffCache.keys().next().value;
    if (oldestKey) bffCache.delete(oldestKey);
  }
  // Emergency cleanup if cache exceeds hard limit
  if (bffCache.size >= BFF_CACHE_SIZE_LIMIT) {
    const keysToDelete = Array.from(bffCache.keys()).slice(0, Math.floor(bffCache.size * 0.3));
    keysToDelete.forEach(k => bffCache.delete(k));
  }
  bffCache.set(key, { expiresAt: Date.now() + ttlMs, data });
}

function normalizeLlmReview(data: any): any {
  const review = data?.review;
  if (typeof review === "string") {
    const parsed = parseReviewText(review);
    return parsed ? { ...data, review: parsed } : data;
  }
  if (review?.raw && typeof review.raw === "string") {
    const parsed = parseReviewText(review.raw);
    if (parsed) return { ...data, review: parsed };
  }
  return data;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: () => Promise<T> | T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(async () => resolve(await fallback()), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function concurrentMap<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>, limit = 6): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch { results[i] = undefined as unknown as R; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
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
    value !== "-"
  );
  return (
    hasMetric(perf.sharpeRatio) ||
    hasMetric(perf.maxDrawdown) ||
    hasMetric(fund?.sharpe_ratio) ||
    hasMetric(fund?.max_drawdown) ||
    (Array.isArray(fund?.nav_data) && fund.nav_data.length > 1)
  );
}

function hasDetailPayload(fund: any): boolean {
  if (!fund || typeof fund !== "object") return false;
  const hasNavSeries = Array.isArray(fund?.nav_data) && fund.nav_data.length > 20;
  const hasManager = !!(
    (typeof fund?.manager === "string" && fund.manager.trim()) ||
    (fund?.manager && typeof fund.manager === "object" && (fund.manager.name || fund.manager.manager_name))
  );
  const hasFee = fund?.feeManage != null || fund?.feeCustody != null;
  return hasNavSeries || hasManager || hasFee;
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

function calcNearReturnFromNav(navData: any[], days: number): number | null {
  const points = (navData || [])
    .map((item) => ({
      date: String(item?.date || item?.navDate || "").slice(0, 10),
      nav: parseMetric(item?.nav ?? item?.nav_value ?? item?.单位净值),
    }))
    .filter((item) => item.date && item.nav !== null && item.nav > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const latestTime = new Date(latest.date).getTime();
  const targetTime = latestTime - days * 24 * 60 * 60 * 1000;
  let start = points[0];
  for (const point of points) {
    if (new Date(point.date).getTime() <= targetTime) start = point;
    else break;
  }
  if (!start || start.nav <= 0 || start.date === latest.date) return null;
  return Number((((latest.nav - start.nav) / start.nav) * 100).toFixed(2));
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

function toSnapshotSortField(sortBy: string) {
  const map: Record<string, string> = {
    dailyChange: "day_growth",
    return1m: "near_1m",
    return3m: "near_3m",
    return6m: "near_6m",
    return1y: "near_1y",
    return3y: "near_3y",
    returnThisYear: "ytd",
    annualizedReturn: "near_1y",
  };
  return map[sortBy] || sortBy || "ytd";
}

// ========== 防并发锁（冷启动 list + marketOverview 竞态问题） ==========
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

function refreshHomeCaches(reason: string, retries = 3) {
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
      if (retries > 0) {
        const delay = reason === "startup" ? 5000 : 30000;
        console.warn(`[fundRouter] 首页缓存刷新失败(${reason}), ${retries}次重试剩余, ${delay / 1000}s后重试:`, err.message || err);
        setTimeout(() => refreshHomeCaches(reason, retries - 1), delay);
      } else {
        console.error(`[fundRouter] 首页缓存刷新失败(${reason}), 已耗尽重试:`, err);
      }
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
  const pageSize = Math.min(Number(params.page_size || 500), 500);
  const singlePageRequested = Number(params.page || 0) > 0;
  if (singlePageRequested) {
    const pageResult = await getFundSnapshotList({
      category: params.category,
      keyword: params.keyword,
      xinjihui_only: params.guoyuan_only !== false && !params.use_watchlist,
      sort_by: params.sort_by || "ytd",
      sort_order: params.sort_order || "desc",
      page: params.page,
      page_size: pageSize,
    });
    return Array.isArray(pageResult?.funds) ? pageResult.funds : [];
  }

  const all: any[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (all.length < total && page <= 20) {
    const pageResult = await getFundSnapshotList({
      category: params.category,
      keyword: params.keyword,
      xinjihui_only: params.guoyuan_only !== false && !params.use_watchlist,
      sort_by: params.sort_by || "ytd",
      sort_order: params.sort_order || "desc",
      page,
      page_size: pageSize,
    });
    const funds = Array.isArray(pageResult?.funds) ? pageResult.funds : [];
    total = Number(pageResult?.total || funds.length || 0);
    if (funds.length === 0) break;
    all.push(...funds);
    if (funds.length < pageSize) break;
    page += 1;
  }
  return all;
}

/**
 * 轻量首页摘要：仅拉取基金列表+排名业绩+实时报价，不调用 /analysis/batch?
 * 避免首屏同时背上 100+ 只基金的深度分析（净值历史持仓/经理/Sharpe）?
 * 首页表格需要的 净?日涨???均已在排名数据中 ?首屏秒开?
 * 缺失?夏普?最大回撤?展示?"?，由后台预热后刷新?
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
        console.error("[fetchHomeFundSummaries] 获取自选基金失败，跳过自选合并", err);
        return [] as any[];
      });
      for (const fund of watchlistResult) {
        if (fund?.code) {
          watchlistCodes.add(fund.code);
          const existing = fundsByCode.get(fund.code);
          fundsByCode.set(fund.code, {
            ...(existing || {}),
            ...fund,
            _source: existing?._source === "xinjihui" ? "xinjihui" : "watchlist",
            is_xinjihui: existing?.is_xinjihui === true || fund.is_xinjihui === true,
          });
        }
      }
    }

    const funds = Array.from(fundsByCode.values());
    // 补充基金名称（对仍然缺少名称的基金用实时报价补全
    const enriched = funds.length > HOME_ANALYSIS_LIMIT
      ? funds
      : await concurrentMap(funds, enrichFundSummary, 6);

    // ?TTL?5min（净值日频，排名数据下一个交易日才更新）
    setCache("homeFundSummaries", enriched, dailyCacheTtl());
    return enriched;
  });
}

/**
 * 完整首页数据：含深度分析（Sharpe/最大回撤持仓/经理）?
 * 用于 marketOverview 统计聚合与后台预热，不阻塞首屏渲染
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

    // Page-facing data stays on local snapshots. Deep analysis is filled by
    // background jobs and detail pages, not by homepage prewarm fanout.
    const summaryOnly = Array.from(fundsByCode.values());
    setCache("homeFunds", summaryOnly, dailyCacheTtl());
    return summaryOnly;
  });
}

function needsFundName(fund: any, code: string) {
  const name = String(fund?.name || fund?.fundName || "").trim();
  return /^\d{6}$/.test(code) && (!name || name === code);
}

async function enrichFundSummary(fund: any) {
  const code = String(fund?.code || fund?.fundCode || "").trim();
  if (!needsFundName(fund, code) && !isExchangeFundCode(code)) return fund;

  const quote = await fetchFundQuote(code);
  if (!quote) return fund;

  return {
    ...fund,
    code,
    name: chooseFundName(fund?.name, quote.name, code),
    nav: isExchangeFundCode(code) ? (quote.nav ?? fund?.nav) : (fund?.nav ?? quote.nav),
    accum_nav: fund?.accum_nav ?? quote.accumNav,
    nav_date: isExchangeFundCode(code) ? (quote.navDate ?? fund?.nav_date) : (fund?.nav_date ?? quote.navDate),
    day_growth: isExchangeFundCode(code) ? (quote.dayGrowth ?? fund?.day_growth) : (fund?.day_growth ?? quote.dayGrowth),
  };
}

async function enrichFundAnalysis(analysis: any, code: string) {
  if (!analysis || (!needsFundName(analysis, code) && !isExchangeFundCode(code))) return analysis;

  const quote = await fetchFundQuote(code);
  if (!quote) return analysis;

  return {
    ...analysis,
    code,
    name: chooseFundName(analysis?.name, quote.name, code),
    nav: isExchangeFundCode(code) ? (quote.nav ?? analysis?.nav) : (analysis?.nav ?? quote.nav),
    accum_nav: analysis?.accum_nav ?? quote.accumNav,
    nav_date: isExchangeFundCode(code) ? (quote.navDate ?? analysis?.nav_date) : (analysis?.nav_date ?? quote.navDate),
    day_growth: isExchangeFundCode(code) ? (quote.dayGrowth ?? analysis?.day_growth) : (analysis?.day_growth ?? quote.dayGrowth),
  };
}

function quoteToAnalysis(code: string, quote: Awaited<ReturnType<typeof fetchFundQuote>> | null, source = "manual") {
  if (!quote) return null;
  const name = quote.name || code;
  const type = quote.type || (/^508\d{3}$/.test(code) ? "REITs" : isExchangeFundCode(code) ? "ETF" : "");
  return {
    code,
    name,
    type,
    company: quote.company,
    management: quote.company,
    total_scale: quote.totalScale,
    feeManage: quote.feeManage,
    feeCustody: quote.feeCustody,
    manager: quote.manager ? { name: quote.manager, company: quote.company, tenure_days: 0 } : {},
    nav: quote.nav,
    accum_nav: quote.accumNav,
    nav_date: quote.navDate,
    day_growth: quote.dayGrowth,
    holdings: [],
    nav_data: [],
    asset_allocation: [],
    dividends: [],
    _source: source,
  };
}

const PEER_RANKING_CATEGORIES = ["股票型", "混合型", "债券型", "指数型", "QDII", "FOF", "货币"];

async function fetchAndCacheFundAnalysis(code: string, cacheKey = `analysis_${code}`) {
  return dedupe(`detailAnalysis_${code}`, async () => {
    const [snapshot, analysis] = await Promise.all([
      getFundSnapshot(code, true).catch(() => null),
      getFundAnalysis(code).catch(() => null),
    ]);
    const merged = analysis ? { ...(snapshot || {}), ...analysis } : snapshot;
    const enriched = await enrichFundAnalysis(merged, code);
    if (enriched) setCache(cacheKey, enriched, ANALYSIS_TTL);
    return enriched;
  });
}

function scheduleFundAnalysisWarmup(code: string, cacheKey = `analysis_${code}`) {
  dedupe(`detailWarmup_${code}`, () => requestFundBackfill(code).then((snapshot) => {
    if (snapshot) setCache(cacheKey, snapshot, ANALYSIS_TTL);
    return snapshot;
  }))
    .catch((err) => {
      console.error(`[fundRouter] detail warmup failed for ${code}:`, err);
    });
}

function resolvePeerCategory(...values: unknown[]) {
  const text = values.map((value) => String(value || "")).join(" ");
  if (/股票/.test(text)) return "股票型";
  if (/混合/.test(text)) return "混合型";
  if (/债/.test(text)) return "债券型";
  if (/指数|ETF|LOF|index|etf/i.test(text)) return "指数型";
  if (/QDII|海外|全球|港股|美股/i.test(text)) return "QDII";
  if (/FOF/i.test(text)) return "FOF";
  if (/货币|money/i.test(text)) return "货币";
  return "";
}

async function fetchPeerMarketRanking(category: string) {
  const cacheKey = `peerMarketRanking_${category}`;
  const cached = getCached<any[]>(cacheKey);
  if (cached) return cached;
  const funds = (await fetchAllFundList({ guoyuan_only: false, category }))
    .map((fund: any) => ({ ...fund, type: fund?.type || category }));
  setCache(cacheKey, funds, dailyCacheTtl());
  return funds;
}

if (process.env.FUNDTRADER_DISABLE_AUTO_PREWARM !== "true") {
  const startupTimer = setTimeout(() => refreshHomeCaches("startup"), 5000);
  startupTimer.unref?.();
  scheduleDailyHomePrewarm();
}

export const fundRouter = createRouter({
  // 基金列表查询（支持筛选和排序?
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
        withMetrics: z.boolean().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }).optional()
    )
    .query(async ({ input, ctx }) => {
      try {
        const opts = input || {};
        const page = opts.page ?? 1;
        const pageSize = opts.pageSize ?? 20;
        const sortBy = opts.sortBy ?? "dailyChange";
        const sortOrder = opts.sortOrder ?? "desc";

        if (!opts.withMetrics && !ctx.user && !opts.fundType && !opts.company && !opts.riskLevel && opts.isContinuousMarketing === undefined) {
          const snapshotResult = await getFundSnapshotList({
            page,
            page_size: Math.min(pageSize, 500),
            xinjihui_only: true,
            keyword: opts.search,
            category: opts.category,
            sort_by: toSnapshotSortField(sortBy),
            sort_order: sortOrder,
          });
          const raw = Array.isArray(snapshotResult?.funds) ? snapshotResult.funds : [];
          return {
            funds: raw.map(mapFundItem).filter(Boolean),
            total: Number(snapshotResult?.total || raw.length),
            page,
            pageSize,
          };
        }

        // 首页优先返回已预热的完整缓存；冷启动时先返回轻量列表，后台继续预热风险指标?
        let rawFunds = getCached<any[]>("homeFunds");
        if (!rawFunds) {
          rawFunds = await fetchHomeFundSummaries();
          setCache("homeFunds", rawFunds, dailyCacheTtl());
          if (opts.withMetrics) scheduleHomeFundsPrewarm();
        }
        let result = rawFunds.map(mapFundItem).filter(Boolean);
        if (ctx.user) {
          const savedCodes = getUserState(ctx.user.id).watchlistCodes;
          const existingCodes = new Set(result.map((fund: any) => String(fund.fundCode)));
          const savedFunds = await Promise.all(savedCodes
            .filter((code) => /^\d{6}$/.test(code) && !existingCodes.has(code))
            .map(async (code) => {
              const quote = await fetchFundQuote(code).catch(() => null);
              const mapped = mapFundItem(quoteToAnalysis(code, quote, "watchlist"));
              return mapped ? { ...mapped, source: "watchlist" } : null;
            }));
          result = [...result, ...savedFunds.filter(Boolean)];
        }

        // 本地筛?
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
            if (value === undefined || value === null || value === "" || value === "—" || value === "-") return Number.NaN;
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
        if (cached && hasDetailPayload(cached)) return mapFundDetail(cached);

        if (hasRiskMetrics(fund) && Array.isArray(fund.nav_data)) {
          setCache(cacheKey, fund, ANALYSIS_TTL);
          return mapFundDetail(fund);
        }

        const enriched = await withTimeout(
          fetchAndCacheFundAnalysis(fund.code, cacheKey),
          DETAIL_ANALYSIS_TIMEOUT_MS,
          () => fund
        );
        return mapFundDetail(enriched);
      } catch (err) {
        wrapError(err, "获取基金详情失败");
      }
    }),

  // 按基金代码获取详情。用于主页直接输?6 位基金代码跳转?
  detailByCode: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ input }) => {
      try {
        const cacheKey = `analysis_${input.code}`;
        const cachedAnalysis = getCached<any>(cacheKey);
        if (cachedAnalysis && hasDetailPayload(cachedAnalysis)) return mapFundDetail(cachedAnalysis);

        const cachedHomeFunds = getCached<any[]>("homeFunds");
        const cachedHomeFund = cachedHomeFunds?.find((fund: any) => fund?.code === input.code);
        if (cachedHomeFund && hasRiskMetrics(cachedHomeFund) && Array.isArray(cachedHomeFund.nav_data)) {
          setCache(cacheKey, cachedHomeFund, ANALYSIS_TTL);
          return mapFundDetail(cachedHomeFund);
        }

        const enriched = await withTimeout(
          fetchAndCacheFundAnalysis(input.code, cacheKey),
          DETAIL_ANALYSIS_TIMEOUT_MS,
          async () => {
            const quote = await fetchFundQuote(input.code);
            return quoteToAnalysis(input.code, quote, "watchlist") || cachedHomeFund || null;
          }
        ).catch(async (analysisErr) => {
          console.error(`[fundRouter] detail analysis failed for ${input.code}:`, analysisErr);
          scheduleFundAnalysisWarmup(input.code, cacheKey);
          const quote = await fetchFundQuote(input.code);
          return quoteToAnalysis(input.code, quote, "watchlist") || cachedHomeFund || null;
        });
        if (!enriched) throw new Error(`No fund detail available for ${input.code}`);
        return mapFundDetail(enriched);
      } catch (err) {
        wrapError(err, "按基金代码获取详情失败");
      }
    }),

  addByCode: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ input, ctx }) => {
      try {
        invalidateHomeCaches();
        const [quote, xinjihuiFunds] = await Promise.all([
          fetchFundQuote(input.code),
          fetchAllFundList({ guoyuan_only: true }).catch(() => [] as any[]),
        ]);
        const knownFund = xinjihuiFunds.find((fund: any) => fund?.code === input.code);
        const name = quote?.name || knownFund?.name || "";
        await addToWatchlist(input.code, name);
        if (ctx.user) {
          const state = getUserState(ctx.user.id);
          updateUserState(ctx.user.id, {
            watchlistCodes: Array.from(new Set([...state.watchlistCodes, input.code])),
            recentFunds: Array.from(new Set([input.code, ...state.recentFunds])).slice(0, 20),
          });
        }
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

  // 全市场同类收益排名
  peerPerformanceRanking: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ input }) => {
      try {
        const cachedHomeFunds = getCached<any[]>("homeFunds") || getCached<any[]>("homeFundSummaries") || [];
        const cachedFund = cachedHomeFunds.find((fund: any) => String(fund?.code || fund?.fundCode || "") === input.code);
        const [analysis, analysisDetail] = await Promise.all([
          getFundSnapshot(input.code, true).catch(() => null),
          getFundAnalysis(input.code).catch(() => null),
        ]);
        const mergedTarget = { ...(analysis || {}), ...(analysisDetail || {}) };
        const mapped = mapFundItem(mergedTarget || cachedFund || { code: input.code });
        const preferredCategory = resolvePeerCategory(cachedFund?.type, mergedTarget?.type, mapped?.category, mapped?.fundType, mapped?.fundName);
        const categories = preferredCategory
          ? [preferredCategory, ...PEER_RANKING_CATEGORIES.filter((item) => item !== preferredCategory)]
          : PEER_RANKING_CATEGORIES;
        let peerCategory = preferredCategory || "";
        let peerFunds: any[] = [];
        let marketFund: any = null;
        for (const category of categories) {
          const ranking = await fetchPeerMarketRanking(category);
          const found = ranking.find((fund: any) => String(fund?.code || fund?.fundCode || "") === input.code);
          if (found || category === preferredCategory) {
            peerCategory = category;
            peerFunds = ranking;
            marketFund = found || null;
            if (found) break;
          }
        }
        const target = {
          ...(marketFund || {}),
          ...mergedTarget,
          code: input.code,
          type: peerCategory || marketFund?.type || cachedFund?.type || mergedTarget?.type || mapped?.category,
          mappedType: mapped?.fundType,
          near_1w:
            marketFund?.near_1w ??
            mergedTarget?.return1w ??
            calcNearReturnFromNav(mergedTarget?.nav_data, 7) ??
            mapped?.performance?.return1w,
          near_1m: marketFund?.near_1m ?? mergedTarget?.return1m ?? mapped?.performance?.return1m,
          near_3m: marketFund?.near_3m ?? mergedTarget?.return3m ?? mapped?.performance?.return3m,
          near_6m: marketFund?.near_6m ?? mergedTarget?.return6m ?? mapped?.performance?.return6m,
          near_1y: marketFund?.near_1y ?? mergedTarget?.return1y ?? mapped?.performance?.return1y,
        };
        const peers = peerFunds.map((fund: any) => {
          const item = mapFundItem(fund);
          return { ...fund, type: fund?.type || peerCategory, mappedType: item?.fundType };
        });
        return {
          code: input.code,
          peerType: peerCategory || target.type || mapped?.category || mapped?.fundType || "同类基金",
          source: "local fund snapshots",
          updatedAt: new Date().toISOString(),
          rows: buildPeerPerformanceRows(target, peers),
        };
      } catch (err) {
        wrapError(err, "获取全市场同类收益排名失败");
      }
    }),

  // 移除自选基金
  removeFromWatchlist: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ input, ctx }) => {
      try {
        invalidateHomeCaches();
        await ftRemoveFromWatchlist(input.code);
        if (ctx.user) {
          const state = getUserState(ctx.user.id);
          updateUserState(ctx.user.id, {
            watchlistCodes: state.watchlistCodes.filter((code) => code !== input.code),
          });
        }
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
          company: managerFund.manager.company !== "—"
            ? managerFund.manager.company
            : managedFunds.find((fund: any) => fund.company && fund.company !== "—")?.company || "基金公司待补充",
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
      const rawFunds = getCached<any[]>("homeFunds") || getCached<any[]>("homeFundSummaries") || await fetchHomeFundSummaries();
      const companies = Array.from(new Set(rawFunds
        .map((fund: any) => fund?.company || fund?.management)
        .filter((company: unknown) => company && company !== "—")
        .map((company: unknown) => String(company))))
        .sort((a, b) => a.localeCompare(b, "zh-CN"));
      return {
        types: ["equity", "hybrid", "bond", "index", "etf", "reits", "qdii", "money", "fof"],
        categories,
        companies,
        riskLevels: ["low", "low_medium", "medium", "medium_high", "high"],
      };
    } catch (err) {
      wrapError(err, "获取筛选选项失败");
    }
  }),

  // 鑫基荟名单
  continuousMarketing: publicQuery.query(async () => {
    try {
      const ftResult = await getFundSnapshotList({ xinjihui_only: true, page_size: 100 });
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
      optimizationGoal: z.string().optional(),
      focusTheme: z.string().optional(),
      sourceMode: z.enum(["xinjihui", "watchlist", "custom"]).optional(),
      includeXinjihui: z.boolean().optional(),
      includeWatchlist: z.boolean().optional(),
      manualFundCodes: z.array(z.string().regex(/^\d{6}$/)).optional(),
      selectedFundCodes: z.array(z.string()).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      try {
        const opts = input || {};
        // 优先用已预热的 homeFunds 缓存（含风险指标）；冷启动时用轻量摘要，
        // 避免 fetchHomeFunds 的批量分析请求超时导致整个推荐卡住
        const rawFunds = getCached<any[]>("homeFunds") || await fetchHomeFundSummaries();
        const parseMetric = (value: unknown) => {
          if (value === null || value === undefined || value === "" || value === "—") return null;
          const num = parseFloat(String(value).replace("%", ""));
          return Number.isFinite(num) ? num : null;
        };
        const fundFamilyKey = (fund: any) => {
          const name = String(fund?.fundName || fund?.fundAbbr || fund?.name || "").replace(/\s+/g, "");
          return name ? name.replace(/(?:A|B|C|D|E|I)$/i, "") : String(fund?.fundCode || fund?.code || "");
        };
        const valueOrZero = (value: unknown) => parseMetric(value) ?? 0;
        const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
        const round = (value: number, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
        const RISK_FREE_RATE = 0.02;
        const TRADING_DAYS = 252;
        const annualizePeriodReturn = (periodReturnPct: number | null, years: number) => {
          if (periodReturnPct === null || years <= 0) return null;
          const decimal = periodReturnPct / 100;
          if (decimal <= -1) return -100;
          return (Math.pow(1 + decimal, 1 / years) - 1) * 100;
        };
        const navPointsFromRaw = (raw: any) => {
          const byDate = new Map<string, { date: string; nav: number; dayGrowth: number | null }>();
          const rows = raw?.nav_data || raw?.navHistory || raw?.navHistoryFull || [];
          for (const item of rows || []) {
            const date = item?.date || item?.navDate || item?.净值日期;
            const nav = parseMetric(item?.nav ?? item?.单位净值 ?? item?.nav_value);
            if (!date || nav === null || nav <= 0) continue;
            byDate.set(String(date).slice(0, 10), {
              date: String(date).slice(0, 10),
              nav,
              dayGrowth: parseMetric(item?.day_growth ?? item?.dailyReturn ?? item?.日增长率 ?? item?.涨跌幅 ?? item?.增长率),
            });
          }
          return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
        };
        const returnSeriesFromNav = (points: Array<{ date: string; nav: number; dayGrowth: number | null }>, years: number) => {
          if (points.length < 3) return new Map<string, number>();
          const latestTime = new Date(points[points.length - 1].date).getTime();
          const startTime = latestTime - years * 365.25 * 24 * 60 * 60 * 1000;
          const series = new Map<string, number>();
          for (let index = 1; index < points.length; index += 1) {
            const current = points[index];
            const prev = points[index - 1];
            if (new Date(current.date).getTime() < startTime || prev.nav <= 0) continue;
            const daily = current.dayGrowth !== null ? current.dayGrowth / 100 : (current.nav - prev.nav) / prev.nav;
            if (Number.isFinite(daily)) series.set(current.date, daily);
          }
          return series;
        };
        const portfolioDrawdownFromReturns = (returns: number[]) => {
          let value = 100;
          let peak = 100;
          let maxDrawdown = 0;
          returns.forEach((ret) => {
            value *= 1 + ret;
            peak = Math.max(peak, value);
            if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak * 100);
          });
          return maxDrawdown;
        };
        const portfolioStatsFromNav = (allocations: any[], years: number) => {
          const valid = allocations
            .map((item) => ({ item, points: item.fund?._navPoints || [] }))
            .filter(({ points }) => points.length >= 60);
          if (valid.length !== allocations.length || allocations.length === 0) return null;
          const totalWeight = allocations.reduce((sum, item) => sum + Math.max(0, item.weight || 0), 0) || 100;
          const seriesList = valid.map(({ item, points }) => ({
            weight: Math.max(0, item.weight || 0) / totalWeight,
            series: returnSeriesFromNav(points, years),
          }));
          const commonDates = Array.from(seriesList[0].series.keys())
            .filter((date) => seriesList.every((entry) => entry.series.has(date)))
            .sort();
          if (commonDates.length < Math.min(60, Math.max(20, years * 120))) return null;
          const returns = commonDates.map((date) => (
            seriesList.reduce((sum, entry) => sum + (entry.series.get(date) || 0) * entry.weight, 0)
          ));
          const compounded = returns.reduce((value, ret) => value * (1 + ret), 1);
          const annualizedReturn = compounded > 0 ? (Math.pow(compounded, TRADING_DAYS / returns.length) - 1) * 100 : -100;
          const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
          const variance = returns.reduce((sum, ret) => sum + (ret - mean) ** 2, 0) / Math.max(1, returns.length - 1);
          const volatility = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100;
          const maxDrawdown = portfolioDrawdownFromReturns(returns);
          const downside = returns.filter((ret) => ret < 0).sort((a, b) => a - b);
          const tailCount = Math.max(1, Math.ceil(returns.length * 0.05));
          const cvar95 = downside.length
            ? Math.abs(downside.slice(0, tailCount).reduce((sum, ret) => sum + ret, 0) / Math.min(tailCount, downside.length)) * Math.sqrt(TRADING_DAYS) * 100
            : 0;
          return {
            expectedReturn: annualizedReturn,
            volatility,
            expectedRisk: maxDrawdown,
            sharpe: volatility > 0 ? (annualizedReturn - RISK_FREE_RATE * 100) / volatility : 0,
            cvar95,
          };
        };
        const correlationByType = (left: string, right: string) => {
          if (left === right) return 0.85;
          const equityLike = new Set(["equity", "index", "etf"]);
          const defensiveLike = new Set(["bond", "money"]);
          if (equityLike.has(left) && equityLike.has(right)) return 0.8;
          if ((left === "hybrid" && equityLike.has(right)) || (right === "hybrid" && equityLike.has(left))) return 0.65;
          if (defensiveLike.has(left) && defensiveLike.has(right)) return 0.35;
          if ((left === "qdii" && equityLike.has(right)) || (right === "qdii" && equityLike.has(left))) return 0.55;
          if ((left === "reits" && equityLike.has(right)) || (right === "reits" && equityLike.has(left))) return 0.45;
          if ((defensiveLike.has(left) && equityLike.has(right)) || (defensiveLike.has(right) && equityLike.has(left))) return 0.1;
          return 0.35;
        };
        const covariancePortfolioMetric = (allocations: any[], pick: (item: any) => number) => {
          const totalWeight = allocations.reduce((sum, item) => sum + Math.max(0, item.weight || 0), 0) || 100;
          let variance = 0;
          allocations.forEach((left) => {
            allocations.forEach((right) => {
              const leftWeight = Math.max(0, left.weight || 0) / totalWeight;
              const rightWeight = Math.max(0, right.weight || 0) / totalWeight;
              // 对角线元素（同一基金与自身）相关系数为 1，符合投资组合理论
              const corr = left === right ? 1 : correlationByType(left.fund?.fundType || "", right.fund?.fundType || "");
              variance += leftWeight * rightWeight * pick(left) * pick(right) * corr;
            });
          });
          return Math.sqrt(Math.max(0, variance));
        };
        const typeLabels: Record<string, string> = {
          bond: "债券",
          money: "货币",
          hybrid: "混合",
          index: "指数",
          etf: "ETF",
          equity: "股票",
          reits: "REITs",
          qdii: "QDII",
          fof: "FOF",
        };
        const riskProfile = opts.riskProfile || "balanced";
        const maxDdLimit = opts.maxDrawdown ?? (riskProfile === "conservative" ? 12 : riskProfile === "aggressive" ? 35 : 22);
        const horizon = opts.horizon || "1年";
        const horizonConfig = horizon.includes("10年")
          ? { key: "return10y", years: 10, label: "近10年" }
          : horizon.includes("5年")
            ? { key: "return5y", years: 5, label: "近5年" }
            : horizon.includes("3年")
              ? { key: "return3y", years: 3, label: "近3年" }
              : horizon.includes("6个月")
                ? { key: "return6m", years: 0.5, label: "近6个月" }
                : { key: "return1y", years: 1, label: "近1年" };
        const returnKey = horizonConfig.key;
        const optimizationGoal = opts.optimizationGoal || "balanced";
        const focusTheme = opts.focusTheme || "all";
        const sourceMode = opts.sourceMode || "xinjihui";
        const includeXinjihui = opts.includeXinjihui ?? sourceMode === "xinjihui";
        const includeWatchlist = opts.includeWatchlist ?? sourceMode === "watchlist";
        const selectedFundCodes = new Set((opts.selectedFundCodes || []).map((code) => String(code)));
        const savedState = ctx.user ? getUserState(ctx.user.id) : null;
        const savedWatchlistCodes = savedState?.watchlistCodes || [];
        const manualFundCodes = Array.from(new Set([
          ...(opts.manualFundCodes || []),
          ...(opts.selectedFundCodes || []),
          ...(includeWatchlist ? savedWatchlistCodes : []),
        ].map((code) => String(code)).filter((code) => /^\d{6}$/.test(code))));
        const preferredTypes = opts.preferredTypes?.length ? opts.preferredTypes : ["bond", "hybrid", "index", "etf", "equity", "reits", "money", "qdii"];
        const allFunds = rawFunds.map((raw: any) => {
          const mapped = mapFundItem(raw);
          return mapped ? { ...mapped, _navPoints: navPointsFromRaw(raw) } : null;
        }).filter(Boolean);
        const manualFunds = (await Promise.all(manualFundCodes.map(async (code) => {
          const existing = allFunds.find((fund: any) => String(fund.fundCode) === code);
          if (existing) return { ...existing, source: existing.source || "manual" };
          const quote = await fetchFundQuote(code);
          const mapped = mapFundItem(quoteToAnalysis(code, quote, "manual"));
          return mapped ? { ...mapped, source: "manual", _navPoints: navPointsFromRaw(quote) } : null;
        }))).filter(Boolean);
        const fundsByCode = new Map<string, any>();
        allFunds.forEach((fund: any) => {
          const code = String(fund.fundCode);
          if (includeXinjihui && fund.isXinjihui) fundsByCode.set(code, fund);
          if (includeWatchlist && (fund.source === "watchlist" || !fund.isXinjihui)) fundsByCode.set(code, fund);
          if (sourceMode === "custom" && selectedFundCodes.has(code)) fundsByCode.set(code, fund);
        });
        manualFunds.forEach((fund: any) => fundsByCode.set(String(fund.fundCode), fund));
        let funds = Array.from(fundsByCode.values());
        funds = funds.filter((fund: any) => preferredTypes.includes(fund.fundType));

        if (funds.length === 0) return [];

        const themeMatches = (fund: any) => {
          const text = `${fund.fundName || ""}${fund.fundAbbr || ""}${fund.category || ""}${(fund.tags || []).join("")}`;
          if (focusTheme === "all") return true;
          if (focusTheme === "income") return /债|红利|股息|收益|现金|货币|短债|中短债/.test(text);
          if (focusTheme === "dividend") return /红利|股息|央企|价值|低波|银行|公用/.test(text);
          if (focusTheme === "growth") return /科技|创新|成长|新能源|高端|制造|人工智能|半导体|芯片/.test(text);
          if (focusTheme === "consumption") return /消费|白酒|食品|家电|旅游|医药|医疗/.test(text);
          if (focusTheme === "manufacturing") return /制造|高端|装备|军工|新能源|汽车|机器人/.test(text);
          if (focusTheme === "diversified") return /指数|宽基|沪深|中证|上证|创业板|QDII|全球|海外|标普|纳斯达克/.test(text);
          if (focusTheme === "overseas") return /QDII|全球|海外|标普|纳斯达克|恒生|港股|美元/.test(text);
          if (focusTheme === "defensive") return /低波|稳健|价值|红利|债|医药|消费|公用|银行/.test(text);
          return true;
        };

        const annualizedReturn = (fund: any) => {
          const perf = fund.performance || {};
          const periodReturn = parseMetric(perf[returnKey]);
          const periodAnnualized = annualizePeriodReturn(periodReturn, horizonConfig.years);
          if (periodAnnualized !== null) return periodAnnualized;
          if (returnKey === "return10y") {
            const return5y = parseMetric(perf.return5y);
            const fiveYearAnnualized = annualizePeriodReturn(return5y, 5);
            if (fiveYearAnnualized !== null) return fiveYearAnnualized;
          }
          return valueOrZero(perf.annualizedReturn || perf.return1y);
        };
        const riskStats = (fund: any) => {
          const perf = fund.performance || {};
          const rawDrawdown = parseMetric(perf.maxDrawdown);
          const rawSharpe = parseMetric(perf.sharpeRatio);
          const rawVolatility = parseMetric(perf.annualizedVolatility);
          // 回撤数据缺失时，根据基金类型赋予合理惩罚值，而非低估
          const hasDrawdown = rawDrawdown !== null;
          const hasSharpe = rawSharpe !== null;
          const hasVolatility = rawVolatility !== null;
          const fundType = fund.fundType || "";
          // 根据基金类型赋予默认回撤惩罚：股票混合 > 指数 > 债券 > 货币
          const defaultDrawdownByType: Record<string, number> = {
            equity: 28, hybrid: 22, index: 18, etf: 18, qdii: 25, bond: 5, money: 0.5, fof: 12, reits: 15,
          };
          const defaultDrawdown = defaultDrawdownByType[fundType] || 15;
          const drawdown = hasDrawdown ? Math.abs(rawDrawdown) : defaultDrawdown;
          // 波动率：有真实值用真实值，否则根据回撤估算（但保底用类型默认值）
          const defaultVolatility = hasDrawdown ? clamp(drawdown * 1.18 + 0.6, 1.2, 42) : Math.max(defaultDrawdown * 1.3, 3);
          const volatility = hasVolatility && rawVolatility > 0 ? rawVolatility : defaultVolatility;
          const expected = annualizedReturn(fund);
          // 夏普：有真实值用真实值，否则用收益波动率估算
          const sharpe = hasSharpe && rawSharpe !== 0 ? rawSharpe : (volatility > 0 ? (expected - RISK_FREE_RATE * 100) / volatility : 0);
          const missingRisk = !hasDrawdown || !hasSharpe;
          return { expected, drawdown, volatility, sharpe, missingRisk };
        };
        const qualityScore = (fund: any, variant: "defensive" | "balanced" | "growth") => {
          const stats = riskStats(fund);
          const calmar = stats.drawdown > 0 ? stats.expected / stats.drawdown : 0;
          const themeBonus = themeMatches(fund) ? 5 : -5;
          const missingPenalty = stats.missingRisk ? 8 : 0;
          const goalTilt = optimizationGoal === "return" ? stats.expected * 0.28 : optimizationGoal === "risk" ? -stats.drawdown * 0.35 : stats.sharpe * 2;
          const variantTilt = variant === "defensive"
            ? -stats.drawdown * 0.65 + stats.sharpe * 10
            : variant === "growth"
              ? stats.expected * 0.55 + stats.sharpe * 5
              : stats.expected * 0.35 + stats.sharpe * 8 - stats.drawdown * 0.35;
          return variantTilt + calmar * 6 + themeBonus + goalTilt - missingPenalty;
        };

        const baseTemplates: Record<string, Record<string, number>> = {
          conservative: { bond: 46, money: 12, hybrid: 18, index: 8, etf: 6, equity: 4, reits: 6 },
          moderate: { bond: 32, money: 5, hybrid: 28, index: 14, etf: 8, equity: 8, reits: 5 },
          balanced: { bond: 22, hybrid: 28, index: 20, etf: 10, equity: 12, reits: 4, qdii: 4 },
          aggressive: { bond: 9, hybrid: 22, index: 24, etf: 12, equity: 22, reits: 3, qdii: 8 },
        };
        const variantTilts: Record<string, Record<string, number>> = {
          defensive: { bond: 10, money: 6, hybrid: -2, index: -6, etf: -3, equity: -6, reits: 2, qdii: -2 },
          balanced: {},
          growth: { bond: -8, money: -5, hybrid: -2, index: 7, etf: 4, equity: 6, reits: -2, qdii: 2 },
        };
        const names: Record<string, string> = {
          defensive: "稳健优先",
          balanced: "平衡推荐",
          growth: "进攻增强",
        };
        const normalizeTemplate = (variant: "defensive" | "balanced" | "growth") => {
          const template = { ...(baseTemplates[riskProfile] || baseTemplates.balanced) };
          Object.entries(variantTilts[variant]).forEach(([type, tilt]) => {
            template[type] = Math.max(0, (template[type] || 0) + tilt);
          });
          if (horizon.includes("6个月")) {
            template.bond = (template.bond || 0) + 8;
            template.money = (template.money || 0) + 5;
            template.equity = Math.max(0, (template.equity || 0) - 7);
            template.qdii = Math.max(0, (template.qdii || 0) - 4);
          } else if (horizon.includes("3年") || horizon.includes("5年") || horizon.includes("10年")) {
            template.index = (template.index || 0) + 6;
            template.equity = (template.equity || 0) + 6;
            template.money = Math.max(0, (template.money || 0) - 7);
            if (horizon.includes("10年")) {
              template.index = (template.index || 0) + 4;
              template.qdii = (template.qdii || 0) + 3;
              template.bond = Math.max(0, (template.bond || 0) - 4);
            }
          }
          Object.keys(template).forEach((type) => {
            if (!preferredTypes.includes(type)) template[type] = 0;
          });
          const total = Object.values(template).reduce((sum, weight) => sum + weight, 0) || 100;
          const slots = Object.entries(template)
            .filter(([, weight]) => weight > 0)
            .map(([type, weight]) => ({ type, weight: Math.round(weight / total * 100) }));
          const drift = 100 - slots.reduce((sum, slot) => sum + slot.weight, 0);
          if (slots[0]) slots[0].weight += drift;
          return slots;
        };
        const buildPortfolio = (variant: "defensive" | "balanced" | "growth", id: number) => {
          const usedCodes = new Set<string>();
          const usedFamilies = new Set<string>();
          const slots = normalizeTemplate(variant);
          const allocations = slots.map((slot) => {
            const withinType = funds
              .filter((fund: any) => fund.fundType === slot.type && !usedCodes.has(fund.fundCode) && !usedFamilies.has(fundFamilyKey(fund)))
              .filter((fund: any) => {
                const stats = riskStats(fund);
                return stats.drawdown === 0 || stats.drawdown <= maxDdLimit * (variant === "growth" ? 1.15 : 1);
              })
              .sort((a: any, b: any) => qualityScore(b, variant) - qualityScore(a, variant));
            const fallback = funds
              .filter((fund: any) => !usedCodes.has(fund.fundCode) && !usedFamilies.has(fundFamilyKey(fund)))
              .sort((a: any, b: any) => qualityScore(b, variant) - qualityScore(a, variant));
            const fund = withinType[0] || fallback[0];
            if (!fund) return null;
            usedCodes.add(fund.fundCode);
            usedFamilies.add(fundFamilyKey(fund));
            const stats = riskStats(fund);
            return {
              fundId: fund.id,
              weight: slot.weight,
              score: round(qualityScore(fund, variant), 1),
              role: slot.type === "bond" || slot.type === "money" ? "防守底仓" : slot.type === "index" ? "权益核心" : slot.type === "qdii" ? "分散卫星" : "收益增强",
              reason: `${typeLabels[slot.type] || fund.category}仓位按${horizonConfig.label}几何年化折算${round(stats.expected)}%，最大回撤${round(stats.drawdown)}%，估算夏普${round(stats.sharpe, 2)}，在${names[variant]}目标下综合排序靠前。`,
              fund,
            };
          }).filter(Boolean);
          const totalWeight = allocations.reduce((sum: number, item: any) => sum + Math.max(0, item.weight || 0), 0) || 100;
          const weighted = (pick: (item: any) => number) => allocations.reduce((sum: number, item: any) => sum + pick(item) * Math.max(0, item.weight || 0), 0) / totalWeight;
          const navPortfolioStats = portfolioStatsFromNav(allocations, Math.max(0.5, horizonConfig.years));
          if (!navPortfolioStats) console.warn("[recommendations] NAV-based portfolio stats unavailable for " + allocations.length + " funds, falling back to covariance estimate");
          const fallbackExpectedReturn = weighted((item: any) => riskStats(item.fund).expected);
          const fallbackVolatility = covariancePortfolioMetric(allocations, (item: any) => riskStats(item.fund).volatility);
          const fallbackDrawdown = covariancePortfolioMetric(allocations, (item: any) => riskStats(item.fund).drawdown);
          const concentration = allocations.length ? Math.max(...allocations.map((item: any) => item.weight)) : 0;
          const concentrationPenalty = Math.max(0, concentration - 35) * 0.08;
          const expectedReturn = navPortfolioStats?.expectedReturn ?? fallbackExpectedReturn;
          const volatility = navPortfolioStats?.volatility ?? fallbackVolatility;
          const expectedRisk = (navPortfolioStats?.expectedRisk ?? fallbackDrawdown) + concentrationPenalty;
          const sharpe = volatility > 0 ? (expectedReturn - RISK_FREE_RATE * 100) / volatility : 0;
          const cvar95 = navPortfolioStats?.cvar95 ?? Math.max(expectedRisk, Math.max(0, 1.65 * volatility - expectedReturn));
          const riskAdjustedScore = clamp(50 + expectedReturn * 1.8 + sharpe * 16 - expectedRisk * 1.2 - cvar95 * 0.35 - concentrationPenalty * 2, 0, 100);
          const sourceLabel = sourceMode === "watchlist" ? "自选基金" : sourceMode === "custom" ? "指定产品" : "鑫基荟";
          const constraints = [
            { label: "回撤约束", passed: expectedRisk <= maxDdLimit, value: `${round(expectedRisk)}% / ${maxDdLimit}%` },
            { label: "单品集中度", passed: concentration <= 45, value: `${round(concentration, 0)}%` },
            { label: "基金数量", passed: allocations.length >= (sourceMode === "custom" ? 2 : 3), value: `${allocations.length}只` },
            { label: "风险数据覆盖", passed: allocations.every((item: any) => !riskStats(item.fund).missingRisk), value: `${allocations.filter((item: any) => !riskStats(item.fund).missingRisk).length}/${allocations.length}` },
          ];
          const stressTests = [
            { label: "股债同时调整", loss: round(-(expectedRisk * 0.65 + volatility * 0.08)), note: "权益和债券同时承压时的组合级估算" },
            { label: "权益急跌", loss: round(-(expectedRisk * (variant === "growth" ? 0.95 : 0.75))), note: "权益类仓位主导的短期冲击" },
            { label: "利率上行", loss: round(-(expectedRisk * 0.35 + (allocations.some((item: any) => item.fund?.fundType === "bond") ? 1.2 : 0))), note: "债券底仓净值回撤压力" },
          ];
          return {
            id,
            name: names[variant],
            description: `${sourceLabel} · ${horizon}视角，目标${optimizationGoal === "risk" ? "控制波动" : optimizationGoal === "return" ? "提高收益弹性" : "收益风险平衡"}，约束最大回撤${maxDdLimit}%`,
            riskProfile,
            marketCondition: horizon,
            expectedReturn: round(expectedReturn).toFixed(2),
            expectedRisk: round(expectedRisk).toFixed(2),
            volatility: round(volatility).toFixed(2),
            sharpe: round(sharpe, 2).toFixed(2),
            cvar95: round(cvar95).toFixed(2),
            score: round(riskAdjustedScore, 1),
            sourceLabel,
            rationale: `先按风险档位和投资周期确定大类权重，再在${sourceLabel}池内按${horizonConfig.label}几何年化、最大回撤、估算波动、夏普、卡玛和数据完整度评分选基。组合层面优先用同步净值曲线测算；缺少净值时使用权重-相关矩阵估算波动和回撤。`,
            constraints,
            stressTests,
            tags: [sourceLabel, "组合优化", names[variant]],
            fundAllocations: allocations.map((item: any) => {
              const { _navPoints, ...fund } = item.fund || {};
              return { ...item, fund };
            }),
          };
        };

        const portfolios = (["defensive", "balanced", "growth"] as const)
          .map((variant, index) => buildPortfolio(variant, index + 1))
          .sort((a, b) => Number(b.score) - Number(a.score));
        if (ctx.user) {
          updateUserState(ctx.user.id, {
            recommendationRecords: [{
              id: Date.now(),
              createdAt: new Date().toISOString(),
              input: opts,
              plans: portfolios,
            }, ...(savedState?.recommendationRecords || [])].slice(0, 50),
            preferences: {
              lastRecommendation: {
                riskProfile,
                horizon,
                maxDrawdown: maxDdLimit,
                preferredTypes,
                optimizationGoal,
                focusTheme,
              },
            },
          });
        }
        return portfolios;
      } catch (err) {
        wrapError(err, "获取推荐配置失败");
      }
    }),

  // 回测记录列表
  backtests: publicQuery
    .input(z.object({ strategy: z.string().optional() }).optional())
    .query(async ({ ctx }) => {
      if (!ctx.user) return [];
      return getUserState(ctx.user.id).backtestRecords;
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
        feeRate: z.number().optional(),
        slippageRate: z.number().optional(),
        riskProfile: z.string().optional(),
        maxDrawdownLimit: z.number().optional(),
        targetAnnualReturn: z.number().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        // 同时获取国元基金和自选基金，list 查询保持一致
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

        const selectedFundMeta = input.fundIds.map((id) => allFunds.find((x: any) => x.id === id)).filter(Boolean);
        const mapped = mapBacktestResult(ftResult, {
          weights: input.weights,
          strategy: input.strategy,
          fundMeta: selectedFundMeta,
          feeRate: input.feeRate,
          slippageRate: input.slippageRate,
          riskProfile: input.riskProfile,
          maxDrawdownLimit: input.maxDrawdownLimit,
          targetAnnualReturn: input.targetAnnualReturn,
        });
        if (ctx.user) {
          const state = getUserState(ctx.user.id);
          updateUserState(ctx.user.id, {
            backtestRecords: [{
              id: Date.now(),
              createdAt: new Date().toISOString(),
              input,
              result: mapped,
            }, ...state.backtestRecords].slice(0, 50),
            preferences: {
              lastBacktest: {
                strategy: input.strategy,
                investAmount: input.investAmount,
                investFrequency: input.investFrequency,
                riskProfile: input.riskProfile,
                maxDrawdownLimit: input.maxDrawdownLimit,
                targetAnnualReturn: input.targetAnnualReturn,
              },
            },
          });
        }
        return mapped;
      } catch (err) {
        wrapError(err, "执行回测失败");
      }
    }),

  // 行业分布统计（基于基金持仓聚合，抽样 ?0只基金）
  // 持仓数据季报级别更新 ?/6/9/12月），缓存 6 小时
  industryStats: publicQuery.query(async () => {
    try {
      const cacheKey = "industryStats";
      const cached = getCached<any[]>(cacheKey);
      if (cached) return cached;

      const ftResult = await getFundSnapshotList({ xinjihui_only: true, page_size: 500 });
      const rawFunds = Array.isArray(ftResult?.funds) ? ftResult.funds : [];
      const typeMap = new Map<string, number>();
      rawFunds.forEach((fund: any) => {
        const label = String(fund.type || "other");
        typeMap.set(label, (typeMap.get(label) || 0) + 1);
      });
      const total = rawFunds.length || 1;
      const result = Array.from(typeMap.entries())
        .map(([industry, count]) => ({ industry, totalRatio: ((count / total) * 100).toFixed(2) }))
        .sort((a, b) => parseFloat(b.totalRatio) - parseFloat(a.totalRatio))
        .slice(0, 10);
      if (result.length === 0) return [{ industry: "暂无数据", totalRatio: "100.00" }];
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

  categoryMetrics: publicQuery
    .input(z.object({
      windowDays: z.number().optional(),
      riskFreeRate: z.number().optional(),
      xinjihuiOnly: z.boolean().optional(),
      forceRefresh: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      try {
        const opts = input || {};
        const result = await getFundCategoryMetrics({
          window_days: opts.windowDays ?? 365,
          risk_free_rate: opts.riskFreeRate ?? 0.02,
          xinjihui_only: opts.xinjihuiOnly ?? false,
          force_refresh: opts.forceRefresh ?? false,
        });
        return result;
      } catch (err) {
        wrapError(err, "获取分类指标失败");
      }
    }),

  // 基金评价 LLM 分析（详情页使用）— 使用独立 LLM 超时避免被 12s 数据超时截断
  analyzeFundLLM: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ input }) => {
      try {
        const cacheKey = `llm_review_v4_${input.code}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return cached;
        // 使用独立的 LLM 超时 (60s)，超时后返回 generating 占位而非抛错
        const data = await withTimeout(
          getFundLLMReview(input.code).then(normalizeLlmReview),
          LLM_ANALYSIS_TIMEOUT_MS,
          () => ({ code: input.code, review: { raw: "分析生成中，请稍后刷新..." }, _generating: true })
        );
        if (data && (data as any).review && !(data as any)._generating) {
          setCache(cacheKey, data, 30 * 60 * 1000);
        }
        return data;
      } catch (err) {
        console.error(`[fundRouter] LLM review failed for ${input.code}:`, err);
        // 不抛 TRPCError — 前端优雅降级为 "分析暂不可用"
        return { code: input.code, review: { raw: "LLM 分析暂不可用，请稍后重试" } };
      }
    }),

  // 定投回测 LLM 评价 — 使用独立 LLM 超时避免被截断
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
        const data = await withTimeout(
          getDcaLLMReview({
            code: input.code,
            name: input.name || input.code,
            dca: input.dca,
            benchmark: input.benchmark || {},
          }),
          LLM_ANALYSIS_TIMEOUT_MS,
          () => ({ review: { raw: "分析生成中，请稍后刷新..." }, _generating: true })
        );
        if (data && (data as any).review && !(data as any)._generating) {
          setCache(cacheKey, data, 30 * 60 * 1000);
        }
        return data;
      } catch (err) {
        console.error(`[fundRouter] DCA LLM review failed:`, err);
        return { review: { raw: "LLM 分析暂不可用，请稍后重试" } };
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

  // 资产配置生成
  allocate: publicQuery
    .input(
      z.object({
        age: z.number().min(18).max(80),
        goal_type: z.string(),
        investment_horizon: z.string(),
        amount: z.number().min(1000),
        risk_tolerance: z.string(),
        max_drawdown: z.number().min(5).max(45),
        preferred_tags: z.array(z.string()),
        behavior_answers: z.record(z.string(), z.string()),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const cacheKey = `alloc_${input.risk_tolerance}_${input.age}_${input.amount}_${input.investment_horizon}_${input.goal_type}_${input.max_drawdown}_${input.preferred_tags.join(",")}_${JSON.stringify(input.behavior_answers)}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return cached;

        const result = await generateAllocation(input);
        setCache(cacheKey, result, 5 * 60 * 1000); // 5min cache
        return result;
      } catch (err) {
        wrapError(err, "资产配置生成失败");
      }
    }),
});
