/**
 * FundTrader 后端数据 → 前端数据格式映射
 */

// 基金类型映射（FundTrader 中文 → 前端英文标识）
const typeMap: Record<string, string> = {
  "股票型": "equity",
  "混合型": "hybrid",
  "债券型": "bond",
  "指数型": "index",
  "ETF": "etf",
  "QDII": "qdii",
  "货币型": "money",
  "FOF": "fof",
  "REITs": "reits",
};

// 风险等级映射
const riskMap: Record<string, string> = {
  "低风险": "low",
  "中低风险": "low_medium",
  "中风险": "medium",
  "中高风险": "medium_high",
  "高风险": "high",
};

// 推荐风险等级映射（中文 → 英文）
const recRiskMap: Record<string, string> = {
  "保守": "conservative",
  "稳健": "balanced",
  "积极": "aggressive",
  "激进": "aggressive",
};

// 为基金生成稳定的数字 ID
function codeToId(code: string): number {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) - hash + code.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100000;
}

// 生成 AI 标签
function generateTags(name: string, _type: string): string[] {
  const tags: string[] = [];
  if (name.includes("科技") || name.includes("创新") || name.includes("成长")) tags.push("科技成长");
  if (name.includes("消费") || name.includes("白酒")) tags.push("消费升级");
  if (name.includes("医药") || name.includes("医疗")) tags.push("医药龙头");
  if (name.includes("价值") || name.includes("低估")) tags.push("价值投资");
  if (name.includes("指数") || name.includes("ETF")) tags.push("指数核心");
  if (name.includes("新能源")) tags.push("新能源");
  if (tags.length === 0) tags.push("稳健增长");
  return tags.slice(0, 2);
}

function inferFundType(code: string, name: string, rawType: string): string {
  const text = `${rawType || ""}${name || ""}`.toUpperCase();
  if (/REIT/.test(text) || /^508\d{3}$/.test(code)) return "REITs";
  if (/ETF/.test(text) || /LOF/.test(text) || /^(15\d{4}|16\d{4}|18\d{4}|5\d{5})$/.test(code)) return "ETF";
  return rawType || "";
}

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : parseFloat(String(value).replace("%", ""));
  return Number.isFinite(num) ? num : null;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0";
  return value.toFixed(digits);
}

function pickMetric(...values: any[]): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === "" || value === "—") continue;
    return String(value);
  }
  return undefined;
}

function normalizeRatio(value: any): number {
  const num = toNumber(value);
  if (num === null || num < 0) return 0;
  return num > 1 ? num / 100 : num;
}

function uniqueNavPoints(navData: any[]) {
  const byDate = new Map<string, { date: string; nav: number; dayGrowth: number | null }>();
  for (const item of navData || []) {
    const date = item?.date || item?.navDate || item?.净值日期;
    const nav = toNumber(item?.nav ?? item?.单位净值 ?? item?.nav_value);
    if (!date || nav === null || nav <= 0) continue;
    byDate.set(String(date), {
      date: String(date),
      nav,
      dayGrowth: toNumber(item?.day_growth ?? item?.dailyReturn ?? item?.日增长率),
    });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function calcReturn(points: ReturnType<typeof uniqueNavPoints>, days: number): number | null {
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
  return ((latest.nav - start.nav) / start.nav) * 100;
}

function calcPerformanceFromNav(navData: any[]) {
  const points = uniqueNavPoints(navData);
  if (points.length < 2) return {};

  const first = points[0];
  const latest = points[points.length - 1];
  const elapsedDays = Math.max(
    1,
    (new Date(latest.date).getTime() - new Date(first.date).getTime()) / (24 * 60 * 60 * 1000)
  );
  const totalReturn = ((latest.nav - first.nav) / first.nav) * 100;
  const annualizedReturn = (Math.pow(latest.nav / first.nav, 365 / elapsedDays) - 1) * 100;

  const dailyReturns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    const prev = points[i - 1];
    const fromGrowth = current.dayGrowth;
    const daily = fromGrowth !== null ? fromGrowth / 100 : (current.nav - prev.nav) / prev.nav;
    if (Number.isFinite(daily)) dailyReturns.push(daily);
  }

  const mean = dailyReturns.reduce((sum, item) => sum + item, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, item) => sum + Math.pow(item - mean, 2), 0) / Math.max(1, dailyReturns.length - 1);
  const annualizedVolatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
  const downsideReturns = dailyReturns.filter((item) => item < 0);
  const downsideVariance = downsideReturns.reduce((sum, item) => sum + Math.pow(item, 2), 0) / Math.max(1, downsideReturns.length);
  const downsideVolatility = Math.sqrt(downsideVariance) * Math.sqrt(252) * 100;

  let peak = first.nav;
  let maxDrawdown = 0;
  let recoveryPeriod = 0;
  let currentUnderwater = 0;
  for (const point of points) {
    if (point.nav >= peak) {
      peak = point.nav;
      currentUnderwater = 0;
      continue;
    }
    currentUnderwater += 1;
    recoveryPeriod = Math.max(recoveryPeriod, currentUnderwater);
    maxDrawdown = Math.min(maxDrawdown, ((point.nav - peak) / peak) * 100);
  }

  const yearStart = points.find((point) => point.date.slice(0, 4) === latest.date.slice(0, 4)) ?? first;
  const returnThisYear = ((latest.nav - yearStart.nav) / yearStart.nav) * 100;

  return {
    return1m: formatNumber(calcReturn(points, 30)),
    return3m: formatNumber(calcReturn(points, 90)),
    return6m: formatNumber(calcReturn(points, 180)),
    return1y: formatNumber(calcReturn(points, 365) ?? totalReturn),
    return2y: formatNumber(calcReturn(points, 365 * 2) ?? totalReturn),
    return3y: formatNumber(calcReturn(points, 365 * 3) ?? totalReturn),
    return5y: formatNumber(calcReturn(points, 365 * 5) ?? totalReturn),
    return10y: formatNumber(calcReturn(points, 365 * 10) ?? totalReturn),
    returnThisYear: formatNumber(returnThisYear),
    annualizedReturn: formatNumber(annualizedReturn),
    annualizedVolatility: formatNumber(annualizedVolatility),
    sharpeRatio: formatNumber(annualizedVolatility > 0 ? annualizedReturn / annualizedVolatility : null),
    maxDrawdown: formatNumber(maxDrawdown),
    calmarRatio: formatNumber(maxDrawdown < 0 ? annualizedReturn / Math.abs(maxDrawdown) : null),
    sortinoRatio: formatNumber(downsideVolatility > 0 ? annualizedReturn / downsideVolatility : null),
    informationRatio: formatNumber(annualizedVolatility > 0 ? annualizedReturn / annualizedVolatility : null),
    alpha: formatNumber(totalReturn),
    beta: "1.00",
    winRate: formatNumber((dailyReturns.filter((item) => item > 0).length / Math.max(1, dailyReturns.length)) * 100),
    recoveryPeriod: String(recoveryPeriod),
  };
}

// 映射基金列表项
export function mapFundItem(item: any): any {
  if (!item || typeof item !== "object") return null;
  const code = item.code || "";
  const name = item.name || "";
  const type = inferFundType(code, name, item.type || "");
  const perf = item.performance || {};
  const navPerformance = calcPerformanceFromNav(item.nav_data || item.navHistory || []);
  // 兼容 manager 为字符串或对象的情况
  const mgrRaw = item.manager_info || item.manager;
  const mgr = typeof mgrRaw === "string" ? { name: mgrRaw } : (mgrRaw || {});
  const id = codeToId(code);
  const source = item._source || "guoyuan";
  const tags = item.tags || generateTags(name, type);
  const hasXinjihuiTag = tags.some((tag: unknown) => String(tag).includes("鑫基荟"));
  const isXinjihui =
    item.is_xinjihui === true ||
    item.isXinjihui === true ||
    hasXinjihuiTag ||
    tags.includes("鑫基荟") ||
    source === "xinjihui" ||
    source === "guoyuan";

  return {
    id,
    fundCode: code,
    fundName: name,
    fundAbbr: name.replace(/混合型|股票型|债券型|指数型|证券投资基金|A类|C类/g, "").trim(),
    fundType: typeMap[type] || type.toLowerCase().replace(/型/g, ""),
    category: type || "其他",
    company: item.company || item.management || "—",
    riskLevel: riskMap[item.risk_level || item.riskLevel] || "medium",
    isContinuousMarketing: isXinjihui ? 1 : item.isContinuousMarketing ?? 0,
    isXinjihui,
    nav: item.nav != null ? String(item.nav) : "—",
    accumNav: item.accum_nav != null ? String(item.accum_nav) : item.nav != null ? String(item.nav) : "—",
    dailyChange: item.day_growth != null ? String(item.day_growth) : "0",
    totalScale: item.total_scale != null ? String(item.total_scale) : item.scale != null ? String(item.scale) : "—",
    benchmark: item.benchmark || "—",
    feeManage: item.feeManage ?? item.fee_rate ?? "—",
    feeCustody: item.feeCustody ?? "—",
    stars: item.stars || (item.rating ? Math.min(5, Math.max(1, item.rating)) : 4),
    managerId: mgr.name ? codeToId(mgr.name) : null,
    tags,
    trackingIndex: item.trackingIndex || null,
    source, // xinjihui / watchlist 标记
    updatedAt: item.updated_at || item.updatedAt || item.created_at || null,
    performance: {
      return1m: perf.near_1m != null ? String(perf.near_1m) : item.near_1m != null ? String(item.near_1m) : navPerformance.return1m || "0",
      return3m: perf.near_3m != null ? String(perf.near_3m) : item.near_3m != null ? String(item.near_3m) : navPerformance.return3m || "0",
      return6m: perf.near_6m != null ? String(perf.near_6m) : item.near_6m != null ? String(item.near_6m) : navPerformance.return6m || "0",
      return1y: perf.near_1y != null ? String(perf.near_1y) : item.near_1y != null ? String(item.near_1y) : item.return1y != null ? String(item.return1y) : navPerformance.return1y || "0",
      return2y: perf.near_2y != null ? String(perf.near_2y) : navPerformance.return2y || "0",
      return3y: perf.near_3y != null ? String(perf.near_3y) : item.near_3y != null ? String(item.near_3y) : item.return3y != null ? String(item.return3y) : navPerformance.return3y || "0",
      return5y: perf.near_5y != null ? String(perf.near_5y) : item.return5y != null ? String(item.return5y) : navPerformance.return5y || "0",
      return10y: perf.near_10y != null ? String(perf.near_10y) : item.near_10y != null ? String(item.near_10y) : item.return10y != null ? String(item.return10y) : navPerformance.return10y || "0",
      returnThisYear: perf.ytd != null ? String(perf.ytd) : item.ytd != null ? String(item.ytd) : navPerformance.returnThisYear || "0",
      annualizedReturn: pickMetric(perf.annualizedReturn, perf.annualized_return, item.annualizedReturn, item.annualized_return, navPerformance.annualizedReturn, perf.near_1y, item.near_1y, item.return1y) || "0",
      annualizedVolatility: pickMetric(perf.annualizedVolatility, navPerformance.annualizedVolatility) || "0",
      // 夏普/回撤需净值历史计算，轻量摘要模式下无此数据 → 展示 "—"
      // 后台预热完成后再次查询即可获得真实值
      sharpeRatio: pickMetric(perf.sharpeRatio, perf.sharpe_ratio, item.sharpe_ratio, navPerformance.sharpeRatio) || "—",
      maxDrawdown: pickMetric(perf.maxDrawdown, perf.max_drawdown, item.max_drawdown, navPerformance.maxDrawdown) || "—",
      calmarRatio: perf.calmarRatio || navPerformance.calmarRatio || "0",
      sortinoRatio: perf.sortinoRatio || navPerformance.sortinoRatio || "0",
      informationRatio: perf.informationRatio || navPerformance.informationRatio || "0",
      alpha: perf.alpha || navPerformance.alpha || "0",
      beta: perf.beta || navPerformance.beta || "0",
      winRate: perf.winRate || navPerformance.winRate || "0",
      recoveryPeriod: perf.recoveryPeriod != null ? String(perf.recoveryPeriod) : navPerformance.recoveryPeriod || "0",
    },
    manager: mgr.name ? {
      id: codeToId(mgr.name),
      name: mgr.name,
      gender: mgr.gender || null,
      education: mgr.education || null,
      careerStart: mgr.begin_date || mgr.career_start || "2010-01-01",
      manageYears: mgr.tenure_days ? (mgr.tenure_days / 365).toFixed(2) : "5.00",
      totalScale: mgr.total_scale != null ? String(mgr.total_scale) : "—",
      fundCount: mgr.fund_count ?? 1,
      company: item.company || "—",
      investmentStyle: mgr.style_analysis || mgr.investment_style || "均衡配置",
      philosophy: mgr.philosophy || "坚持价值投资，精选优质企业",
      styleDescription: mgr.style_description || "",
      bestReturn: mgr.best_return != null ? String(mgr.best_return) : "—",
      worstReturn: mgr.worst_return != null ? String(mgr.worst_return) : "—",
    } : null,
  };
}

// 映射基金详情
export function mapFundDetail(analysis: any): any {
  if (!analysis || typeof analysis !== "object") return null;
  const base = mapFundItem(analysis);
  const navData = (analysis.nav_data || []).map((n: any) => ({
    navDate: n?.date,
    nav: n?.nav != null ? String(n.nav) : "—",
    dailyReturn: n?.day_growth != null ? String(n.day_growth) : "0",
  }));

  const holdings = (analysis.holdings || []).map((h: any) => ({
    fundId: base?.id,
    stockCode: h?.code || "",
    stockName: h?.name || "",
    industry: h?.industry || "—",
    ratio: normalizeRatio(h?.ratio).toFixed(4),
    changeRatio: h?.change_ratio != null ? String(h.change_ratio) : "0",
    dailyChange: h?.daily_change != null ? String(h.daily_change) : null,
    quoteCode: h?.quote_code || null,
    quarter: h?.quarter || null,
    source: h?.source || null,
    updatedAt: h?.updated_at || null,
  })).sort((a: any, b: any) => parseFloat(b.ratio || "0") - parseFloat(a.ratio || "0"));

  const industries: any[] = [];
  if (holdings.length > 0) {
    const industriesSet = new Set(holdings.map((h: any) => h.industry).filter((ind: any) => ind && ind !== "—"));
    industriesSet.forEach((ind: any) => {
      const total = holdings.filter((h: any) => h.industry === ind).reduce((s: number, h: any) => s + parseFloat(h.ratio), 0);
      industries.push({ fundId: base?.id, industry: ind, ratio: total.toFixed(4), changeRatio: "0", quarter: holdings[0]?.quarter || null });
    });
  }

  const assetAllocation = (analysis.asset_allocation || analysis.assetAllocation || []).map((item: any) => ({
    name: item?.name || item?.asset || item?.type || "",
    ratio: normalizeRatio(item?.ratio ?? item?.value).toFixed(4),
    reportDate: item?.report_date || item?.reportDate || item?.quarter || holdings[0]?.quarter || null,
    source: item?.source || analysis.source || null,
  })).filter((item: any) => item.name && parseFloat(item.ratio) > 0);

  const dividends = (analysis.dividends || []).map((item: any) => ({
    exDate: item?.ex_date || item?.exDate || "",
    payDate: item?.pay_date || item?.payDate || "",
    recordDate: item?.record_date || item?.recordDate || "",
    annDate: item?.ann_date || item?.annDate || "",
    baseDate: item?.base_date || item?.baseDate || "",
    cash: item?.div_cash != null ? String(item.div_cash) : item?.cash != null ? String(item.cash) : "",
  })).filter((item: any) => item.exDate || item.annDate || item.cash);

  return {
    ...base,
    navHistory: navData, // 返回全量净值数据，由前端按周期裁剪
    navHistoryFull: navData, // 保留完整历史供周期切换
    holdings,
    industries,
    industryHistory: analysis.industry_history || analysis.industryHistory || industries,
    assetAllocation,
    dividends,
  };
}

// 映射推荐方案
export function mapRecommendation(rec: any, fundsMap: Map<string, any>): any {
  rec = rec || {};
  const rawRisk = rec.riskProfile || rec.risk_level || "balanced";
  const riskProfile = recRiskMap[rawRisk] || rawRisk;

  return {
    id: rec.id || 1,
    name: rec.name || "推荐组合",
    description: rec.description || "",
    riskProfile,
    marketCondition: rec.marketCondition || "全市场周期",
    expectedReturn: rec.expectedReturn || rec.expected_return || "8.00",
    expectedRisk: rec.expectedRisk || rec.expected_risk || "10.00",
    rationale: rec.rationale || rec.analysis_summary || "",
    tags: rec.tags || [],
    fundAllocations: (rec.funds || rec.fundAllocations || []).map((fa: any) => {
      const code = fa?.code || "";
      const fund = fundsMap.get(code);
      return {
        fundId: fund?.id || codeToId(code),
        weight: Math.round((fa?.ratio ?? 0) * 100),
        reason: fa?.reason || "核心配置",
        fund: fund || null,
      };
    }),
  };
}

// 映射回测结果
export function mapBacktestResult(result: any): any {
  result = result || {};
  // 后端返回结构：{ individual: [...], combined: {...} } 或 { strategies: {...} }
  const individual = Array.isArray(result.individual) ? result.individual : [];
  const combined = result.combined || {};
  const first = individual[0] || combined || {};

  // 当策略为 compare 时，individual 中的元素结构为 { fund_code, strategies: { fixed, ma } }
  // 需从 strategies 中提取实际指标数据
  const strategyEntries = first.strategies && typeof first.strategies === "object"
    ? Object.entries(first.strategies as Record<string, any>)
    : [];
  const strategyResults = strategyEntries.map(([key, value]: [string, any]) => ({
    key,
    totalInvested: value?.total_invested != null ? String(value.total_invested) : "0",
    finalValue: value?.total_value != null ? String(value.total_value) : "0",
    totalReturn: value?.total_profit_rate != null ? String(value.total_profit_rate) : "0",
    annualizedReturn: value?.annual_return != null ? String(value.annual_return) : "0",
    maxDrawdown: value?.max_drawdown != null ? String(value.max_drawdown) : "0",
    sharpeRatio: value?.sharpe_ratio != null ? String(value.sharpe_ratio) : "0",
  }));
  const bestStrategy = strategyEntries
    .map(([, value]) => value)
    .sort((a: any, b: any) => parseFloat(String(b?.annual_return ?? "-999")) - parseFloat(String(a?.annual_return ?? "-999")))[0];
  const strategyData: any = bestStrategy || first.strategies?.fixed || first.strategies?.ma || null;
  const metricsSource: any = strategyData ?? first;

  // 提取时序数据（从 nav_curve 或 strategies.fixed.nav_curve）
  let monthlyData: any[] = [];
  if (first.nav_curve && Array.isArray(first.nav_curve)) {
    monthlyData = first.nav_curve.map((p: any) => ({
      date: p.date || "",
      invested: p.invested != null ? String(p.invested) : "0",
      value: p.value != null ? String(p.value) : "0",
    }));
  } else if (strategyData?.nav_curve && Array.isArray(strategyData.nav_curve)) {
    monthlyData = strategyData.nav_curve.map((p: any) => ({
      date: p.date || "",
      invested: p.invested != null ? String(p.invested) : "0",
      value: p.value != null ? String(p.value) : "0",
    }));
  }

  // 提取买入持有基准曲线（来自后端 dca_service._calc_buy_and_hold_curve）
  const benchmarkRaw =
    first?.benchmark?.curve ||
    strategyData?.benchmark?.curve ||
    result?.benchmark?.curve ||
    [];
  const benchmarkCurve = Array.isArray(benchmarkRaw)
    ? benchmarkRaw.map((p: any) => ({
        date: p?.date || "",
        value: p?.value != null ? String(p.value) : "0",
      }))
    : [];
  // 合并定投曲线 + 基准曲线（按日期对齐）
  const benchmarkMap = new Map<string, string>();
  benchmarkCurve.forEach((p: any) => benchmarkMap.set(p.date, p.value));
  const merged = monthlyData.map((p: any) => ({
    ...p,
    benchmark: benchmarkMap.get(p.date) ?? null,
  }));

  const benchSummary = first?.benchmark || strategyData?.benchmark || result?.benchmark || {};
  return {
    id: result.id || 1,
    name: result.name || "定投回测",
    type: result.type || "single",
    fundIds: result.fundIds || individual.map((r: any) => r?.fund_code).filter(Boolean),
    weights: result.weights || [],
    strategy: result.strategy || "fixed_amount",
    startDate: result.startDate || result.start_date || "",
    endDate: result.endDate || result.end_date || "",
    investAmount: result.investAmount || result.amount || "1000",
    investFrequency: result.investFrequency || result.frequency || "monthly",
    totalInvested: metricsSource.total_invested != null ? String(metricsSource.total_invested) : "0",
    finalValue: metricsSource.total_value != null ? String(metricsSource.total_value) : "0",
    totalReturn: metricsSource.total_profit_rate != null ? String(metricsSource.total_profit_rate) : "0",
    annualizedReturn: metricsSource.annual_return != null ? String(metricsSource.annual_return) : "0",
    maxDrawdown: metricsSource.max_drawdown != null ? String(metricsSource.max_drawdown) : "0",
    sharpeRatio: metricsSource.sharpe_ratio != null ? String(metricsSource.sharpe_ratio) : "0",
    benchmarkReturn: metricsSource.benchmark_return != null ? String(metricsSource.benchmark_return) : "0",
    excessReturn: metricsSource.excess_return != null ? String(metricsSource.excess_return) : "0",
    monthlyData: merged,
    benchmarkCurve,
    strategyResults,
    benchmark: {
      finalValue: benchSummary?.final_value != null ? String(benchSummary.final_value) : "0",
      totalReturn: benchSummary?.total_return != null ? String(benchSummary.total_return) : "0",
      annualReturn: benchSummary?.annual_return != null ? String(benchSummary.annual_return) : "0",
      maxDrawdown: benchSummary?.max_drawdown != null ? String(benchSummary.max_drawdown) : "0",
    },
    fundCode: first?.fund_code || (individual[0]?.fund_code) || "",
    fundName: first?.fund_name || (individual[0]?.fund_name) || "",
  };
}

// 映射市场概览
export function mapMarketOverview(data: any): any {
  data = data || {};
  const funds = data.funds || [];
  const totalFunds = data.totalFunds ?? funds.length ?? 0;
  const avgReturn = data.avgReturn ?? "0";
  const avgSharpe = data.avgSharpe ?? "—";
  const avgMaxDD = data.avgMaxDD ?? "—";
  const marketingCount = data.marketingCount || totalFunds;

  return { totalFunds, avgReturn, avgSharpe, avgMaxDD, marketingCount };
}
