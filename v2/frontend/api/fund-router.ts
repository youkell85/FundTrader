import { z } from "zod";
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
} from "./lib/fundtrader-client";
import {
  mapFundItem,
  mapFundDetail,
  mapRecommendation,
  mapBacktestResult,
  mapMarketOverview,
} from "./lib/mapper";

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
        sortBy: z.string().default("dailyChange"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
        page: z.number().default(1),
        pageSize: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      const opts = input;

      // 调用 FundTrader 后端获取基金列表
      const ftResult = await getFundList({
        guoyuan_only: true,
        page: opts.page,
        page_size: opts.pageSize,
      });

      let result = (ftResult.funds || []).map(mapFundItem);

      // 本地筛选（FundTrader 后端筛选能力有限）
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
      const sortKey = opts.sortBy;
      const sortDir = opts.sortOrder;
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
      const page = opts.page;
      const pageSize = opts.pageSize;
      const paginated = result.slice((page - 1) * pageSize, page * pageSize);

      return { funds: paginated, total, page, pageSize };
    }),

  // 单只基金详情
  detail: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      // 先获取列表找到基金代码
      const ftList = await getFundList({ guoyuan_only: true, page_size: 100 });
      const fund = (ftList.funds || []).find((f: any) => {
        const mapped = mapFundItem(f);
        return mapped.id === input.id;
      });
      if (!fund) return null;

      const analysis = await getFundAnalysis(fund.code);
      return mapFundDetail(analysis);
    }),

  // 基金经理详情
  managerDetail: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const ftList = await getFundList({ guoyuan_only: true, page_size: 100 });
      const allFunds = (ftList.funds || []).map(mapFundItem);
      const managerFund = allFunds.find((f: any) => f.managerId === input.id);
      if (!managerFund || !managerFund.manager) return null;

      const managedFunds = allFunds.filter((f: any) => f.managerId === input.id);
      return { ...managerFund.manager, funds: managedFunds };
    }),

  // 筛选选项
  filterOptions: publicQuery.query(async () => {
    const ftCats = await ftGetCategories();
    return {
      types: ["equity", "hybrid", "bond", "index", "qdii", "money", "fof"],
      categories: ftCats.categories || [],
      companies: ftCats.types || [],
      riskLevels: ["low", "low_medium", "medium", "medium_high", "high"],
    };
  }),

  // 持续营销名单
  continuousMarketing: publicQuery.query(async () => {
    const ftResult = await getFundList({ guoyuan_only: true, page_size: 100 });
    return (ftResult.funds || []).map(mapFundItem);
  }),

  // 推荐配置列表
  recommendations: publicQuery
    .input(z.object({ riskProfile: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const ftResult = await getRecommendations({
        risk_level: input?.riskProfile === "conservative" ? "保守" :
                    input?.riskProfile === "balanced" ? "稳健" :
                    input?.riskProfile === "aggressive" ? "激进" : "稳健",
        amount: 100000,
      });

      const ftList = await getFundList({ guoyuan_only: true, page_size: 100 });
      const fundsMap = new Map((ftList.funds || []).map((f: any) => [f.code, mapFundItem(f)]));

      const rec = mapRecommendation(ftResult, fundsMap);
      if (input?.riskProfile) {
        return [rec].filter((r) => r.riskProfile === input.riskProfile);
      }
      return [rec];
    }),

  // 回测记录列表
  backtests: publicQuery
    .input(z.object({ strategy: z.string().optional() }).optional())
    .query(async ({ input }) => {
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
      const ftList = await getFundList({ guoyuan_only: true, page_size: 100 });
      const allFunds = (ftList.funds || []).map(mapFundItem);
      const codes = input.fundIds.map((id) => {
        const f = allFunds.find((x: any) => x.id === id);
        return f?.fundCode;
      }).filter(Boolean);

      const ftResult = await runDcaBacktest({
        codes,
        amount: input.investAmount,
        frequency: input.investFrequency,
        strategy: input.strategy === "fixed_amount" ? "fixed" : "compare",
        start_date: input.startDate,
        end_date: input.endDate,
      });

      return mapBacktestResult(ftResult);
    }),

  // 行业分布统计
  industryStats: publicQuery.query(async () => {
    // FundTrader 后端没有行业统计接口，返回模拟数据
    return [
      { industry: "食品饮料", totalRatio: "12.50" },
      { industry: "医药生物", totalRatio: "10.30" },
      { industry: "电子", totalRatio: "9.80" },
      { industry: "电力设备", totalRatio: "8.60" },
      { industry: "银行", totalRatio: "7.40" },
    ];
  }),

  // 市场概览
  marketOverview: publicQuery.query(async () => {
    try {
      const ftResult = await getFundList({ guoyuan_only: true, page_size: 100 });
      const funds = (ftResult.funds || []).map(mapFundItem);
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
});
