import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import {
  getFundList,
  getCategories as ftGetCategories,
  getFundAnalysis,
  getMarketIndex,
  runDcaBacktest,
  getDcaSuggestion,
  getRecommendations,
  getProfessionalAnalysis,
  getCorrelationMatrix,
  getWatchlist,
  imageSearchFund,
} from "./lib/fundtrader-client";
import {
  mapFundItem,
  mapFundDetail,
  mapRecommendation,
  mapBacktestResult,
  mapMarketOverview,
} from "./lib/mapper";

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

        // 先拉取全部数据，再本地筛选分页（后端限制 page_size <= 100，需循环拉取）
        const allFunds: any[] = [];
        let backendPage = 1;
        let backendTotal = Infinity;
        while (allFunds.length < backendTotal) {
          const pageResult = await getFundList({
            guoyuan_only: true,
            page: backendPage,
            page_size: 100,
          });
          const batch = Array.isArray(pageResult?.funds) ? pageResult.funds : [];
          if (batch.length === 0) break;
          allFunds.push(...batch);
          backendTotal = pageResult?.total ?? allFunds.length;
          backendPage++;
          if (backendPage > 100) break; // 安全上限
        }
        const rawFunds = allFunds;
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
        const ftList = await getFundList({ guoyuan_only: true, page_size: 100 });
        const rawFunds = Array.isArray(ftList?.funds) ? ftList.funds : [];
        const fund = rawFunds.find((f: any) => {
          const mapped = mapFundItem(f);
          return mapped?.id === input.id;
        });
        if (!fund) return null;

        const analysis = await getFundAnalysis(fund.code);
        return mapFundDetail(analysis);
      } catch (err) {
        wrapError(err, "获取基金详情失败");
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
      return {
        types: ["equity", "hybrid", "bond", "index", "qdii", "money", "fof"],
        categories: ftCats?.categories || [],
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
        const fundsMap = new Map(rawFunds.map((f: any) => [f.code, mapFundItem(f)]));

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
        const ftList = await getFundList({ guoyuan_only: true, page_size: 100 });
        const rawFunds = Array.isArray(ftList?.funds) ? ftList.funds : [];
        const allFunds = rawFunds.map(mapFundItem).filter(Boolean);
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

  // 行业分布统计
  industryStats: publicQuery.query(async () => {
    try {
      // FundTrader 后端没有行业统计接口，返回模拟数据
      return [
        { industry: "食品饮料", totalRatio: "12.50" },
        { industry: "医药生物", totalRatio: "10.30" },
        { industry: "电子", totalRatio: "9.80" },
        { industry: "电力设备", totalRatio: "8.60" },
        { industry: "银行", totalRatio: "7.40" },
      ];
    } catch (err) {
      wrapError(err, "获取行业统计失败");
    }
  }),

  // 市场概览
  marketOverview: publicQuery.query(async () => {
    try {
      const ftResult = await getFundList({ guoyuan_only: true, page_size: 100 });
      const rawFunds = Array.isArray(ftResult?.funds) ? ftResult.funds : [];
      const funds = rawFunds.map(mapFundItem).filter(Boolean);
      const totalFunds = funds.length;
      const avgReturn = totalFunds > 0
        ? (funds.reduce((s: number, f: any) => s + parseFloat(f.performance?.return1y || "0"), 0) / totalFunds).toFixed(2)
        : "0";
      const avgSharpe = totalFunds > 0
        ? (funds.reduce((s: number, f: any) => s + parseFloat(f.performance?.sharpeRatio || "0"), 0) / totalFunds).toFixed(2)
        : "0";
      const avgMaxDD = totalFunds > 0
        ? (funds.reduce((s: number, f: any) => s + parseFloat(f.performance?.maxDrawdown || "0"), 0) / totalFunds).toFixed(2)
        : "0";
      return { totalFunds, avgReturn, avgSharpe, avgMaxDD, marketingCount: totalFunds };
    } catch {
      return mapMarketOverview({});
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
