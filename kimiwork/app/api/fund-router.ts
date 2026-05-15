import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import {
  fundsData,
  managersData,
  performanceData,
  getIndustryAlloc,
  getHoldings,
  recommendationsData,
  backtestsData,
  generateNavHistory,
} from "./data/fundData";

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
    .query(({ input }) => {
      const opts = input;
      let result = fundsData.map((f) => {
        const perf = performanceData.find((p) => p.fundId === f.id);
        const mgr = managersData.find((m) => m.id === f.managerId);
        return { ...f, performance: perf || null, manager: mgr || null };
      });

      // 筛选
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
        const aVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
          ? parseFloat((a.performance as any)?.[sortKey] || "0")
          : parseFloat((a as any)[sortKey] || "0");
        const bVal = sortKey.startsWith("return") || sortKey === "annualizedReturn" || sortKey === "sharpeRatio" || sortKey === "maxDrawdown"
          ? parseFloat((b.performance as any)?.[sortKey] || "0")
          : parseFloat((b as any)[sortKey] || "0");
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
    .query(({ input }) => {
      const fund = fundsData.find((f) => f.id === input.id);
      if (!fund) return null;
      const perf = performanceData.find((p) => p.fundId === input.id);
      const manager = managersData.find((m) => m.id === fund.managerId);
      const industries = getIndustryAlloc(input.id);
      const holdings = fund.fundType !== "index" ? getHoldings(input.id) : [];
      const navHistory = generateNavHistory(input.id, parseFloat(fund.nav || "1"));
      return { ...fund, performance: perf || null, manager: manager || null, industries, holdings, navHistory: navHistory.slice(-120) };
    }),

  // 基金经理详情
  managerDetail: publicQuery
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      const manager = managersData.find((m) => m.id === input.id);
      if (!manager) return null;
      const managedFunds = fundsData.filter((f) => f.managerId === input.id).map((f) => {
        const perf = performanceData.find((p) => p.fundId === f.id);
        return { ...f, performance: perf };
      });
      return { ...manager, funds: managedFunds };
    }),

  // 筛选选项
  filterOptions: publicQuery.query(() => {
    const types = [...new Set(fundsData.map((f) => f.fundType))];
    const categories = [...new Set(fundsData.map((f) => f.category).filter(Boolean))];
    const companies = [...new Set(fundsData.map((f) => f.company).filter(Boolean))];
    const riskLevels = [...new Set(fundsData.map((f) => f.riskLevel).filter(Boolean))];
    return { types, categories, companies, riskLevels };
  }),

  // 持续营销名单
  continuousMarketing: publicQuery.query(() => {
    const list = fundsData
      .filter((f) => f.isContinuousMarketing === 1)
      .map((f) => {
        const perf = performanceData.find((p) => p.fundId === f.id);
        const manager = managersData.find((m) => m.id === f.managerId);
        return { ...f, performance: perf || null, manager: manager || null };
      });
    return list;
  }),

  // 推荐配置列表
  recommendations: publicQuery
    .input(z.object({ riskProfile: z.string().optional() }).optional())
    .query(({ input }) => {
      let result = recommendationsData.map((r) => ({
        ...r,
        fundDetails: (r.fundAllocations as any[]).map((fa) => {
          const fund = fundsData.find((f) => f.id === fa.fundId);
          return { ...fa, fund };
        }),
      }));
      if (input?.riskProfile) result = result.filter((r) => r.riskProfile === input.riskProfile);
      return result;
    }),

  // 回测记录列表
  backtests: publicQuery
    .input(z.object({ strategy: z.string().optional() }).optional())
    .query(({ input }) => {
      let result = backtestsData.map((bt) => ({
        ...bt,
        fundDetails: bt.fundIds.map((fid, i) => {
          const fund = fundsData.find((f) => f.id === fid);
          return { fund, weight: bt.weights?.[i] || 100 };
        }),
      }));
      if (input?.strategy) result = result.filter((r) => r.strategy === input.strategy);
      return result;
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
    .query(({ input }) => {
      const { fundIds, weights, investAmount, investFrequency } = input;
      const navHistories = fundIds.map((id) => {
        const fund = fundsData.find((f) => f.id === id);
        return { fundId: id, history: generateNavHistory(id, parseFloat(fund?.nav || "1")) };
      });

      const periodsPerYear = investFrequency === "weekly" ? 52 : investFrequency === "biweekly" ? 26 : 12;
      const totalPeriods = Math.floor(navHistories[0].history.length / (investFrequency === "weekly" ? 5 : investFrequency === "biweekly" ? 10 : 21));
      const totalInvested = investAmount * totalPeriods * (weights ? 1 : 1);
      const w = weights || fundIds.map(() => 100 / fundIds.length);

      let finalValue = 0;
      const monthlyData: any[] = [];

      navHistories.forEach((nh, idx) => {
        const weight = w[idx] / 100;
        let shares = 0;
        let invested = 0;
        const freq = investFrequency === "weekly" ? 5 : investFrequency === "biweekly" ? 10 : 21;

        nh.history.forEach((h, i) => {
          if (i % freq === 0) {
            const amount = investAmount * weight;
            shares += amount / parseFloat(h.nav);
            invested += amount;
          }
          if (i % 21 === 0) {
            const currentValue = shares * parseFloat(h.nav);
            monthlyData.push({
              date: h.navDate,
              fundId: nh.fundId,
              invested: invested.toFixed(2),
              value: currentValue.toFixed(2),
            });
          }
        });

        const lastNav = parseFloat(nh.history[nh.history.length - 1].nav);
        finalValue += shares * lastNav;
      });

      const totalReturn = ((finalValue - totalInvested) / totalInvested * 100);
      const years = totalPeriods / periodsPerYear;
      const annReturn = (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
      const maxDD = -15 - Math.random() * 15;
      const sharpe = annReturn / 20;

      return {
        totalInvested: totalInvested.toFixed(2),
        finalValue: finalValue.toFixed(2),
        totalReturn: totalReturn.toFixed(2),
        annualizedReturn: annReturn.toFixed(2),
        maxDrawdown: maxDD.toFixed(2),
        sharpeRatio: sharpe.toFixed(2),
        benchmarkReturn: (totalReturn * 0.7).toFixed(2),
        excessReturn: (totalReturn * 0.3).toFixed(2),
        monthlyData: monthlyData.filter((_, i) => i % fundIds.length === 0),
      };
    }),

  // 行业分布统计
  industryStats: publicQuery.query(() => {
    const stats: Record<string, number> = {};
    fundsData.forEach((f) => {
      const alloc = getIndustryAlloc(f.id);
      alloc.forEach((a) => {
        stats[a.industry] = (stats[a.industry] || 0) + parseFloat(a.ratio);
      });
    });
    return Object.entries(stats)
      .map(([industry, totalRatio]) => ({ industry, totalRatio: (totalRatio / fundsData.length * 100).toFixed(2) }))
      .sort((a, b) => parseFloat(b.totalRatio) - parseFloat(a.totalRatio));
  }),

  // 市场概览
  marketOverview: publicQuery.query(() => {
    const totalFunds = fundsData.length;
    const avgReturn = (performanceData.reduce((sum, p) => sum + parseFloat(p.return1y || "0"), 0) / performanceData.length).toFixed(2);
    const avgSharpe = (performanceData.reduce((sum, p) => sum + parseFloat(p.sharpeRatio || "0"), 0) / performanceData.length).toFixed(2);
    const avgMaxDD = (performanceData.reduce((sum, p) => sum + parseFloat(p.maxDrawdown || "0"), 0) / performanceData.length).toFixed(2);
    const marketingCount = fundsData.filter((f) => f.isContinuousMarketing === 1).length;

    return { totalFunds, avgReturn, avgSharpe, avgMaxDD, marketingCount };
  }),
});
