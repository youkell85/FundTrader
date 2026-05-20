import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import {
  getFundList,
  getCategories as ftGetCategories,
  getFundAnalysis,
  getFundAnalysisBatch,
  runDcaBacktest,
  getRecommendations,
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
  mapRecommendation,
  mapBacktestResult,
  mapMarketOverview,
} from "./lib/mapper";
import { fetchFundQuote } from "./lib/fund-quote";

const strategyMap: Record<string, string> = {
  fixed_amount: "fixed",
  fixed_ratio: "fixed",
  value_averaging: "ma",
  smart_beta: "compare",
  martingale: "compare",
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
const SNAPSHOT_TTL = 60 * 60 * 1000;                       // L0+L1快照 1小时
const ANALYSIS_TTL = 60 * 60 * 1000;                       // 准静态分析 1小时
const HOLDINGS_TTL = 6 * 60 * 60 * 1000;                   // 持仓/行业 6小时（季报级别）
const QUOTE_TTL = 15 * 60 * 1000;                          // 日频净值 15分钟

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

// ========== 防并发锁（冷启动时 list + marketOverview 竞态问题） ==========
const inflightRequests = new Map<string, Promise<any>>();

function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflightRequests.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => inflightRequests.delete(key));
  inflightRequests.set(key, promise);
  return promise;
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

async function fetchHomeFunds() {
  const cached = getCached<any[]>("homeFunds");
  if (cached) return cached;

  // 防并发：冷启动时 list 和 marketOverview 可能同时调用
  return dedupe("homeFunds", async () => {
    const fundsByCode = new Map<string, any>();
    const watchlistCodes = new Set<string>();

    for (const fund of await fetchAllFundList({ guoyuan_only: true })) {
      if (fund?.code) fundsByCode.set(fund.code, { ...fund, _source: "guoyuan" });
    }

    const watchlist = await getWatchlist().catch(() => null);
    const watchlistFunds = Array.isArray(watchlist?.funds) ? watchlist.funds : [];
    if (watchlistFunds.length > 0) {
      for (const fund of await fetchAllFundList({ use_watchlist: true })) {
        if (fund?.code) {
          watchlistCodes.add(fund.code);
          fundsByCode.set(fund.code, { ...fund, _source: "watchlist" });
        }
      }
    }

    // 使用批量接口获取所有基金的分析数据（1次HTTP请求替代N次）
    const funds = Array.from(fundsByCode.values());
    const codes = funds.map((f) => f.code).filter(Boolean);
    let analysisMap = new Map<string, any>();
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
    const withAnalysis = funds.map((fund) => {
      const analysis = analysisMap.get(fund.code);
      if (!analysis || analysis.error) return fund;
      return {
        ...fund,
        name: analysis.name || fund.name,
        nav: analysis.nav ?? fund.nav,
        nav_date: analysis.nav_date || fund.nav_date,
        day_growth: analysis.day_growth ?? fund.day_growth,
        nav_data: analysis.nav_data || [],
        manager_info: analysis.manager || fund.manager_info,
        holdings: analysis.holdings || fund.holdings,
      };
    });

    // 补充基金名称（对仍然缺少名称的基金）
    const enriched = await Promise.all(withAnalysis.map(enrichFundSummary));

    // L0+L1 快照：1小时 TTL（净值日频，分析准静态）
    setCache("homeFunds", enriched, SNAPSHOT_TTL);
    return enriched;
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
    name: quote.name,
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
    name: quote.name,
    nav: analysis?.nav ?? quote.nav,
    accum_nav: analysis?.accum_nav ?? quote.accumNav,
    nav_date: analysis?.nav_date ?? quote.navDate,
    day_growth: analysis?.day_growth ?? quote.dayGrowth,
  };
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

        const rawFunds = await fetchHomeFunds();
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
          const aVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
            ? parseFloat(aPerf[sortKey] || "0")
            : parseFloat(a[sortKey] || "0");
          const bVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
            ? parseFloat(bPerf[sortKey] || "0")
            : parseFloat(b[sortKey] || "0");
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
        const rawFunds = await fetchHomeFunds();
        const fund = rawFunds.find((f: any) => {
          const mapped = mapFundItem(f);
          return mapped?.id === input.id;
        });
        if (!fund) return null;

        // L1 准静态缓存命中：经理/持仓/回撤/Sharpe 1h 不变
        const cacheKey = `analysis_${fund.code}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return mapFundDetail(cached);

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
        invalidateCache("homeFunds");
        invalidateCache("analysis_");
        const quote = await fetchFundQuote(input.code);
        const name = quote?.name || "";
        await addToWatchlist(input.code, name);
        return mapFundItem({
          code: input.code,
          name: name || input.code,
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
        invalidateCache("homeFunds");
        invalidateCache("analysis_");
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
        const ftList = await getFundList({ guoyuan_only: true, page_size: 100 });
        const rawFunds = Array.isArray(ftList?.funds) ? ftList.funds : [];
        const allFunds = rawFunds.map(mapFundItem).filter(Boolean);
        const managerFund = allFunds.find((f: any) => f.managerId === input.id);
        if (!managerFund || !managerFund.manager) return null;

        const managedFunds = allFunds.filter((f: any) => f.managerId === input.id);
        return { ...managerFund.manager, funds: managedFunds };
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

  // 持续营销名单
  continuousMarketing: publicQuery.query(async () => {
    try {
      const ftResult = await getFundList({ guoyuan_only: true, page_size: 100 });
      const rawFunds = Array.isArray(ftResult?.funds) ? ftResult.funds : [];
      return rawFunds.map(mapFundItem).filter((f: any) => f?.isContinuousMarketing === 1);
    } catch (err) {
      wrapError(err, "获取持续营销名单失败");
    }
  }),

  // 推荐配置列表
  recommendations: publicQuery
    .input(z.object({ riskProfile: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const ftResult = await getRecommendations({
          risk_level: input?.riskProfile === "conservative" ? "保守" :
                      input?.riskProfile === "balanced" ? "稳健" :
                      input?.riskProfile === "aggressive" ? "激进" : "稳健",
          amount: 100000,
        });
        if (!ftResult || typeof ftResult !== "object") {
          throw new Error("Invalid recommendation response");
        }

        const ftList = await getFundList({ guoyuan_only: true, page_size: 100 });
        const rawFunds = Array.isArray(ftList?.funds) ? ftList.funds : [];
        const fundsMap = new Map<string, any>(rawFunds.map((f: any) => [f.code, mapFundItem(f)]));

        const rec = mapRecommendation(ftResult, fundsMap);
        if (input?.riskProfile) {
          return [rec].filter((r) => r.riskProfile === input.riskProfile);
        }
        return [rec];
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
        strategy: z.enum(["fixed_amount", "fixed_ratio", "value_averaging", "smart_beta", "martingale"]),
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

        // biweekly 后端不支持，映射为 monthly
        const backendFrequency = input.investFrequency === "biweekly" ? "monthly" : input.investFrequency;

        const ftResult = await runDcaBacktest({
          codes,
          amount: input.investAmount,
          frequency: backendFrequency,
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

      // 使用 fetchHomeFunds 获取完整数据（含夏普/最大回撤）
      const funds = await fetchHomeFunds();
      const mapped = funds.map(mapFundItem).filter(Boolean);
      const totalFunds = mapped.length;
      const avgReturn = totalFunds > 0
        ? (mapped.reduce((s: number, f: any) => s + parseFloat(f.performance?.return1y || "0"), 0) / totalFunds).toFixed(2)
        : "0";
      const avgSharpe = totalFunds > 0
        ? (mapped.reduce((s: number, f: any) => s + parseFloat(f.performance?.sharpeRatio || "0"), 0) / totalFunds).toFixed(2)
        : "0";
      const avgMaxDD = totalFunds > 0
        ? (mapped.reduce((s: number, f: any) => s + parseFloat(f.performance?.maxDrawdown || "0"), 0) / totalFunds).toFixed(2)
        : "0";
      const result = { totalFunds, avgReturn, avgSharpe, avgMaxDD, marketingCount: totalFunds };
      setCache(cacheKey, result, SNAPSHOT_TTL);
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
        const cacheKey = `llm_review_${input.code}`;
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
