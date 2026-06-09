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
  // ETF 识别：名称含 ETF/LOF，或场内基金代码格式
  if (/ETF/.test(text) || /LOF/.test(text) || /^(15\d{4}|16\d{4}|18\d{4}|5\d{5})$/.test(code)) return "ETF";
  // 数据库中指数型基金，若名称含 ETF 也应识别为 ETF
  if ((rawType === "指数型" || rawType === "指数") && /ETF/.test((name || "").toUpperCase())) return "ETF";
  // 类型映射：数据库中文类型 → 前端标识
  const typeMapReverse: Record<string, string> = {
    "股票型": "equity",
    "混合型": "hybrid",
    "债券型": "bond",
    "指数型": "index",
    "货币型": "money",
    "货币": "money",
    "QDII": "qdii",
    "FOF": "fof",
    "REITs": "reits",
    "ETF": "etf",
  };
  if (typeMapReverse[rawType]) return typeMapReverse[rawType];
  return rawType || "";
}

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : parseFloat(String(value).replace("%", ""));
  return Number.isFinite(num) ? num : null;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
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
      dayGrowth: toNumber(item?.day_growth ?? item?.dailyReturn ?? item?.日增长率 ?? item?.涨跌幅 ?? item?.增长率),
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
    return1w: formatNumber(calcReturn(points, 7)),
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
  try {
    if (!item || typeof item !== "object") return null;
    const code = item.code || "";
    const name = item.name || "";
    const type = inferFundType(code, name, item.type || "");
    const perf = item.performance || {};
    const navPerformance = calcPerformanceFromNav(item.nav_data || item.navHistory || []);
    // 兼容 manager 为字符串或对象的情况
    const mgrRaw = item.manager_info || item.manager;
    const mgr = typeof mgrRaw === "string" ? { name: mgrRaw } : (mgrRaw || {});
    // 如果 manager 对象存在但 name 为空，尝试从其他字段提取
    const mgrName = mgr.name || mgr.manager_name || item.manager_name || item.基金经理 || "";
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
      company: item.company || item.management || item.fund_company || item.company_name || item.manager_company || "—",
      riskLevel: riskMap[item.risk_level || item.riskLevel] || "medium",
      isContinuousMarketing: isXinjihui ? 1 : item.isContinuousMarketing ?? 0,
      isXinjihui,
      nav: item.nav != null ? String(item.nav) : "—",
      navDate: item.nav_date || item.navDate || null,
      accumNav: item.accum_nav != null ? String(item.accum_nav) : item.accumNav != null ? String(item.accumNav) : item.nav != null ? String(item.nav) : "—",
      dailyChange: item.day_growth != null ? String(item.day_growth) : item.dailyChange != null ? String(item.dailyChange) : "0",
      totalScale: item.total_scale != null ? String(item.total_scale) : item.scale != null ? String(item.scale) : "—",
      benchmark: item.benchmark || "—",
      feeManage: item.feeManage ?? item.fee_rate ?? "—",
      feeCustody: item.feeCustody ?? "—",
      stars: item.stars || (item.rating ? Math.min(5, Math.max(1, item.rating)) : 4),
      managerId: mgrName ? codeToId(mgrName) : null,
      tags,
      trackingIndex: item.trackingIndex || null,
      source, // xinjihui / watchlist 标记
      updatedAt: item.updated_at || item.updatedAt || item.created_at || null,
      dataQuality: item.data_quality || item.dataQuality || "unknown",
      staleLevel: item.stale_level || item.staleLevel || "unknown",
      metricsUpdatedAt: item.metrics_updated_at || item.metricsUpdatedAt || null,
      _partial: item._partial || false,
      performance: {
        return1w: perf.near_1w != null ? String(perf.near_1w) : item.near_1w != null ? String(item.near_1w) : navPerformance.return1w || "—",
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
        annualizedVolatility: pickMetric(perf.annualizedVolatility, navPerformance.annualizedVolatility) || "—",
        // 夏普/回撤需净值历史计算，轻量摘要模式下无此数据 → 展示 "—"
        // 后台预热完成后再次查询即可获得真实值
        sharpeRatio: pickMetric(perf.sharpeRatio, perf.sharpe_ratio, item.sharpe_ratio, navPerformance.sharpeRatio) || "—",
        maxDrawdown: pickMetric(perf.maxDrawdown, perf.max_drawdown, item.max_drawdown, navPerformance.maxDrawdown) || "—",
        calmarRatio: perf.calmarRatio || navPerformance.calmarRatio || "—",
        sortinoRatio: perf.sortinoRatio || navPerformance.sortinoRatio || "—",
        informationRatio: perf.informationRatio || navPerformance.informationRatio || "—",
        alpha: perf.alpha || navPerformance.alpha || "—",
        beta: perf.beta || navPerformance.beta || "—",
        winRate: perf.winRate || navPerformance.winRate || "—",
        recoveryPeriod: perf.recoveryPeriod != null ? String(perf.recoveryPeriod) : navPerformance.recoveryPeriod || "—",
      },
      manager: mgrName ? {
        id: codeToId(mgrName),
        name: mgrName,
        gender: mgr.gender || null,
        education: mgr.education || null,
        careerStart: mgr.begin_date || mgr.career_start || "2010-01-01",
        manageYears: mgr.tenure_days ? (mgr.tenure_days / 365).toFixed(2) : "5.00",
        totalScale: mgr.total_scale != null ? String(mgr.total_scale) : "—",
        fundCount: mgr.fund_count ?? 1,
        company: item.company || item.management || item.fund_company || "—",
        investmentStyle: mgr.style_analysis || mgr.investment_style || "均衡配置",
        philosophy: mgr.philosophy || "坚持价值投资，精选优质企业",
        styleDescription: mgr.style_description || "",
        bestReturn: mgr.best_return != null ? String(mgr.best_return) : "—",
        worstReturn: mgr.worst_return != null ? String(mgr.worst_return) : "—",
        returnSinceTenure: mgr.return_since_tenure != null ? String(mgr.return_since_tenure) : "—",
        annualizedReturn: mgr.annualized_return != null ? String(mgr.annualized_return) : "—",
      } : null,
    };
  } catch (err) {
    console.error("[mapFundItem] failed:", err, "item:", item);
    return null;
  }
}

// 映射基金详情
export function mapFundDetail(analysis: any): any {
  try {
    if (!analysis || typeof analysis !== "object") return null;
    const base = mapFundItem(analysis);
  const navDataRaw =
    analysis.nav_data ||
    analysis.navHistory ||
    analysis.nav_history ||
    analysis.navHistoryFull ||
    [];
  const navData = (navDataRaw || [])
    .map((n: any) => ({
      navDate: n?.date || n?.navDate || n?.净值日期,
      nav: n?.nav ?? n?.单位净值 ?? n?.nav_value,
      dailyReturn: n?.day_growth ?? n?.dailyReturn ?? n?.日增长率 ?? n?.涨跌幅 ?? n?.增长率 ?? "0",
    }))
    .filter((n: any) => n.navDate && toNumber(n.nav) !== null)
    .sort((a: any, b: any) => String(a.navDate).localeCompare(String(b.navDate)))
    .map((n: any) => ({
      navDate: String(n.navDate),
      nav: String(n.nav),
      dailyReturn: n.dailyReturn != null ? String(n.dailyReturn) : "0",
    }));

  const holdings = (analysis.holdings || []).map((h: any) => ({
    fundId: base?.id,
    stockCode: h?.code || h?.stockCode || h?.stock_code || h?.bondCode || h?.bond_code || "",
    stockName: h?.name || h?.stockName || h?.stock_name || h?.bondName || h?.bond_name || "",
    industry: h?.industry || h?.asset_type || h?.type || "—",
    ratio: normalizeRatio(h?.ratio ?? h?.weight ?? h?.market_value_ratio).toFixed(4),
    changeRatio: h?.change_ratio != null ? String(h.change_ratio) : h?.changeRatio != null ? String(h.changeRatio) : "0",
    dailyChange: h?.daily_change != null ? String(h.daily_change) : h?.dailyChange != null ? String(h.dailyChange) : null,
    quoteCode: h?.quote_code || h?.quoteCode || null,
    quarter: h?.quarter || h?.report_date || h?.reportDate || null,
    source: h?.source || null,
    updatedAt: h?.updated_at || h?.updatedAt || null,
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

  const industryHistory = (analysis.industry_history || analysis.industryHistory || [])
    .flatMap((item: any) => {
      const period = item?.quarter || item?.report_date || item?.reportDate || item?.date || "";
      if (Array.isArray(item?.industries)) {
        return item.industries.map((industry: any) => ({
          period,
          quarter: period,
          industry: industry?.industry || industry?.name || "",
          ratio: normalizeRatio(industry?.ratio ?? industry?.value).toFixed(4),
        }));
      }
      return [{
        period,
        quarter: period,
        industry: item?.industry || item?.name || "",
        ratio: normalizeRatio(item?.ratio ?? item?.value).toFixed(4),
      }];
    })
    .filter((item: any) => item.period && item.industry && parseFloat(item.ratio) > 0);

  return {
    ...base,
    navHistory: navData, // 返回全量净值数据，由前端按周期裁剪
    navHistoryFull: navData, // 保留完整历史供周期切换
    holdings,
    industries,
    industryHistory: industryHistory.length ? industryHistory : industries,
    assetAllocation,
    dividends,
    establishDate: analysis.establishDate || analysis.establish_date || analysis.found_date || null,
    stars: (analysis.stars || analysis.rating) ? Math.min(5, Math.max(1, Number(analysis.stars || analysis.rating))) : null,
    benchmark: analysis.benchmark || null,
    accumNav: analysis.accum_nav ?? analysis.accumNav ?? null,
    companyInfo: analysis.company_info || null,
    _partial: analysis._partial || false,
  };
  } catch (err) {
    console.error("[mapFundDetail] failed:", err, "analysis:", analysis);
    return null;
  }
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
function mapBacktestResultLegacy(result: any): any {
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
type BacktestMapOptions = {
  weights?: number[];
  strategy?: string;
  fundMeta?: any[];
  feeRate?: number;
  slippageRate?: number;
  riskProfile?: string;
  maxDrawdownLimit?: number;
  targetAnnualReturn?: number;
};

function toFiniteBacktestNumber(value: unknown, fallback = 0): number {
  const num = typeof value === "number" ? value : parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(num) ? num : fallback;
}

function normalizePortfolioWeights(count: number, weights: number[] = []): number[] {
  if (count <= 0) return [];
  const values = Array.from({ length: count }, (_, index) => Math.max(0, toFiniteBacktestNumber(weights[index], 0)));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return Array.from({ length: count }, () => 1 / count);
  return values.map((value) => value / total);
}

function parseBacktestDate(date: unknown): number {
  const time = new Date(String(date || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function calcCashflowAdjustedReturns(curve: Array<{ value: number; invested?: number }>): number[] {
  const returns: number[] = [];
  let previousValue: number | null = null;
  let previousInvested = 0;
  curve.forEach((point) => {
    const value = toFiniteBacktestNumber(point.value);
    const invested = toFiniteBacktestNumber(point.invested);
    if (value <= 0) return;
    if (previousValue !== null && previousValue > 0) {
      const flow = invested - previousInvested;
      const periodReturn = (value - previousValue - flow) / previousValue;
      if (Number.isFinite(periodReturn)) returns.push(periodReturn);
    }
    previousValue = value;
    previousInvested = invested;
  });
  return returns;
}

function calcUnitizedValues(curve: Array<{ value: number; invested?: number }>): number[] {
  if (curve.some((point) => point.invested !== undefined)) {
    return calcCashflowAdjustedReturns(curve).reduce((values, periodReturn) => {
      values.push(values[values.length - 1] * (1 + periodReturn));
      return values;
    }, [100]);
  }
  return curve.map((point) => point.value).filter((value) => value > 0);
}

function calcPortfolioDrawdown(curve: Array<{ value: number; invested?: number }>): number {
  let peak = 0;
  let maxDrawdown = 0;
  calcUnitizedValues(curve).forEach((value) => {
    if (value > peak) peak = value;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak * 100);
  });
  return maxDrawdown;
}

function calcPortfolioSharpe(curve: Array<{ value: number; invested?: number }>): number {
  let returns: number[] = [];
  if (curve.some((point) => point.invested !== undefined)) {
    returns = calcCashflowAdjustedReturns(curve);
  } else {
    const values = curve.map((point) => point.value).filter((value) => value > 0);
    if (values.length < 3) return 0;
    for (let index = 1; index < values.length; index += 1) {
      const prev = values[index - 1];
      if (prev > 0) returns.push((values[index] - prev) / prev);
    }
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const volatility = Math.sqrt(variance);
  return volatility > 0 ? (mean / volatility) * Math.sqrt(252) : 0;
}

function calcPortfolioXirr(cashFlows: Array<{ date: string; value: number }>): number {
  if (cashFlows.length < 2) return 0;
  const dated = cashFlows
    .map((flow) => ({ date: parseBacktestDate(flow.date), value: flow.value }))
    .filter((flow) => flow.date > 0 && Number.isFinite(flow.value));
  if (!dated.some((flow) => flow.value < 0) || !dated.some((flow) => flow.value > 0)) return 0;
  const start = dated[0].date;
  const npv = (rate: number) => dated.reduce((sum, flow) => {
    const years = (flow.date - start) / (365.25 * 24 * 60 * 60 * 1000);
    return sum + flow.value / ((1 + rate) ** years);
  }, 0);

  let low = -0.95;
  let high = 5;
  for (let index = 0; index < 100; index += 1) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (Math.abs(value) < 1e-6) return mid * 100;
    if (value > 0) low = mid;
    else high = mid;
  }
  return ((low + high) / 2) * 100;
}

function getStrategyPayload(item: any, strategyKey: string): any {
  if (item?.strategies && typeof item.strategies === "object") return item.strategies[strategyKey];
  return item;
}

type WeightedCurvePoint = { date: string; invested: number; value: number; feeCost?: number };
type BenchmarkCurvePoint = { date: string; value: number };

function mergeWeightedCurves(
  individual: any[],
  weights: number[],
  strategyKey: string,
  feeRate = 0,
  slippageRate = 0
) {
  const perFund: WeightedCurvePoint[][] = individual.map((item) => {
    const payload = getStrategyPayload(item, strategyKey);
    const curve = Array.isArray(payload?.nav_curve) ? payload.nav_curve : [];
    return curve
      .map((point: any) => ({
        date: String(point?.date || ""),
        invested: toFiniteBacktestNumber(point?.invested),
        value: toFiniteBacktestNumber(point?.value),
      }))
      .filter((point: WeightedCurvePoint) => point.date)
      .sort((a: WeightedCurvePoint, b: WeightedCurvePoint) => parseBacktestDate(a.date) - parseBacktestDate(b.date));
  });

  const dates = Array.from(new Set(perFund.flatMap((curve: WeightedCurvePoint[]) => curve.map((point: WeightedCurvePoint) => point.date))))
    .sort((a, b) => parseBacktestDate(a) - parseBacktestDate(b));
  const cursors = Array.from({ length: perFund.length }, () => 0);
  const lastPoints: Array<{ invested: number; value: number } | null> = Array.from({ length: perFund.length }, () => null);
  let cumulativeCost = 0;
  let previousInvested = 0;
  const costRate = Math.max(0, feeRate + slippageRate) / 100;

  const curve = dates.map((date) => {
    let invested = 0;
    let value = 0;
    perFund.forEach((fundCurve, index) => {
      while (cursors[index] < fundCurve.length && fundCurve[cursors[index]].date <= date) {
        lastPoints[index] = fundCurve[cursors[index]];
        cursors[index] += 1;
      }
      const point = lastPoints[index];
      if (!point) return;
      invested += point.invested * (weights[index] || 0);
      value += point.value * (weights[index] || 0);
    });
    const added = Math.max(0, invested - previousInvested);
    cumulativeCost += added * costRate;
    previousInvested = invested;
    return {
      date,
      invested: Math.round(invested * 100) / 100,
      value: Math.max(0, Math.round((value - cumulativeCost) * 100) / 100),
      feeCost: Math.round(cumulativeCost * 100) / 100,
    };
  }).filter((point) => point.invested > 0 || point.value > 0);

  const final = curve[curve.length - 1] || { date: "", invested: 0, value: 0, feeCost: 0 };
  const totalReturn = final.invested > 0 ? (final.value - final.invested) / final.invested * 100 : 0;
  const cashFlows: Array<{ date: string; value: number }> = [];
  let lastInvested = 0;
  curve.forEach((point) => {
    const added = point.invested - lastInvested;
    if (added > 0) cashFlows.push({ date: point.date, value: -added });
    lastInvested = point.invested;
  });
  if (final.value > 0) cashFlows.push({ date: final.date, value: final.value });

  return {
    curve,
    totalInvested: final.invested,
    finalValue: final.value,
    totalReturn,
    annualizedReturn: calcPortfolioXirr(cashFlows),
    maxDrawdown: calcPortfolioDrawdown(curve),
    sharpeRatio: calcPortfolioSharpe(curve),
    feeCost: final.feeCost,
  };
}

function mergeWeightedBenchmark(individual: any[], weights: number[], strategyKey?: string) {
  const curves: BenchmarkCurvePoint[][] = individual.map((item) => {
    const payload = strategyKey ? getStrategyPayload(item, strategyKey) : item;
    const rawCurve = Array.isArray(payload?.benchmark?.curve) ? payload.benchmark.curve : item?.benchmark?.curve;
    const curve = Array.isArray(rawCurve) ? rawCurve : [];
    return curve
      .map((point: any) => ({ date: String(point?.date || ""), value: toFiniteBacktestNumber(point?.value) }))
      .filter((point: BenchmarkCurvePoint) => point.date)
      .sort((a: BenchmarkCurvePoint, b: BenchmarkCurvePoint) => parseBacktestDate(a.date) - parseBacktestDate(b.date));
  });
  const dates = Array.from(new Set(curves.flatMap((curve: BenchmarkCurvePoint[]) => curve.map((point: BenchmarkCurvePoint) => point.date))))
    .sort((a, b) => parseBacktestDate(a) - parseBacktestDate(b));
  const cursors = Array.from({ length: curves.length }, () => 0);
  const lastPoints: Array<{ value: number } | null> = Array.from({ length: curves.length }, () => null);
  const curve = dates.map((date) => {
    let value = 0;
    curves.forEach((fundCurve, index) => {
      while (cursors[index] < fundCurve.length && fundCurve[cursors[index]].date <= date) {
        lastPoints[index] = fundCurve[cursors[index]];
        cursors[index] += 1;
      }
      const point = lastPoints[index];
      if (point) value += point.value * (weights[index] || 0);
    });
    return { date, value: Math.round(value * 100) / 100 };
  }).filter((point) => point.value > 0);
  const totalInvested = individual.reduce((sum, item, index) => (
    sum + toFiniteBacktestNumber(
      (strategyKey ? getStrategyPayload(item, strategyKey)?.benchmark : item?.benchmark)?.total_invested
      ?? (strategyKey ? getStrategyPayload(item, strategyKey)?.benchmark : item?.benchmark)?.totalInvested
    ) * (weights[index] || 0)
  ), 0);
  const finalValue = curve[curve.length - 1]?.value || 0;
  const totalReturn = totalInvested > 0 ? (finalValue - totalInvested) / totalInvested * 100 : 0;
  return {
    curve,
    totalInvested,
    finalValue,
    totalReturn,
    annualReturn: totalInvested > 0 && curve.length > 1
      ? calcPortfolioXirr([{ date: curve[0].date, value: -totalInvested }, { date: curve[curve.length - 1].date, value: finalValue }])
      : 0,
    maxDrawdown: calcPortfolioDrawdown(curve),
  };
}

export function mapBacktestResult(result: any, options: BacktestMapOptions = {}): any {
  result = result || {};
  const individual = Array.isArray(result.individual) ? result.individual : [];
  const first = individual[0] || result.combined || {};
  const weights = normalizePortfolioWeights(individual.length || 1, options.weights);
  const feeRate = toFiniteBacktestNumber(options.feeRate);
  const slippageRate = toFiniteBacktestNumber(options.slippageRate);
  const strategyEntries = first.strategies && typeof first.strategies === "object"
    ? Object.entries(first.strategies as Record<string, any>)
    : [];
  const strategyResults = strategyEntries.map(([key]: [string, any]) => {
    const portfolio = mergeWeightedCurves(individual.length ? individual : [first], individual.length ? weights : [1], key, feeRate, slippageRate);
    return {
      key,
      totalInvested: portfolio.totalInvested.toFixed(2),
      finalValue: portfolio.finalValue.toFixed(2),
      totalReturn: portfolio.totalReturn.toFixed(2),
      annualizedReturn: portfolio.annualizedReturn.toFixed(2),
      maxDrawdown: portfolio.maxDrawdown.toFixed(2),
      sharpeRatio: portfolio.sharpeRatio.toFixed(2),
      feeCost: portfolio.feeCost.toFixed(2),
      score: (portfolio.annualizedReturn - portfolio.maxDrawdown * 0.45 + portfolio.sharpeRatio * 5).toFixed(2),
    };
  });
  const selectedStrategyKey = options.strategy === "compare"
    ? (strategyResults.slice().sort((a: any, b: any) => toFiniteBacktestNumber(b.score) - toFiniteBacktestNumber(a.score))[0]?.key || "fixed")
    : (options.strategy === "fixed_amount" ? "fixed"
      : options.strategy === "fixed_ratio" ? "ratio"
        : options.strategy === "value_averaging" || options.strategy === "smart_beta" ? "ma"
          : options.strategy === "martingale" ? "martingale"
            : "fixed");
  const strategyData: any = first.strategies?.[selectedStrategyKey] || first.strategies?.fixed || first.strategies?.ma || first;
  const portfolioMetrics = individual.length > 0 ? mergeWeightedCurves(individual, weights, selectedStrategyKey, feeRate, slippageRate) : null;
  const metricsSource: any = portfolioMetrics ?? strategyData ?? first;
  const monthlyData = portfolioMetrics?.curve?.length
    ? portfolioMetrics.curve.map((p: any) => ({
        date: p.date || "",
        invested: p.invested != null ? String(p.invested) : "0",
        value: p.value != null ? String(p.value) : "0",
        feeCost: p.feeCost != null ? String(p.feeCost) : "0",
      }))
    : mapBacktestResultLegacy({ individual: [first] }).monthlyData;
  const weightedBenchmark = individual.length > 0 ? mergeWeightedBenchmark(individual, weights, selectedStrategyKey) : null;
  const benchmarkRaw = weightedBenchmark?.curve || first?.benchmark?.curve || strategyData?.benchmark?.curve || result?.benchmark?.curve || [];
  const benchmarkCurve = Array.isArray(benchmarkRaw)
    ? benchmarkRaw.map((p: any) => ({
        date: p?.date || "",
        value: p?.value != null ? String(p.value) : "0",
      }))
    : [];
  const benchmarkMap = new Map<string, string>();
  benchmarkCurve.forEach((p: any) => benchmarkMap.set(p.date, p.value));
  const merged = monthlyData.map((p: any) => ({ ...p, benchmark: benchmarkMap.get(p.date) ?? null }));
  const benchSummary = weightedBenchmark || first?.benchmark || strategyData?.benchmark || result?.benchmark || {};
  const totalInvested = metricsSource.totalInvested ?? metricsSource.total_invested ?? 0;
  const finalValue = metricsSource.finalValue ?? metricsSource.total_value ?? 0;
  const totalReturn = metricsSource.totalReturn ?? metricsSource.total_profit_rate ?? 0;
  const annualizedReturn = metricsSource.annualizedReturn ?? metricsSource.annual_return ?? 0;
  const maxDrawdown = metricsSource.maxDrawdown ?? metricsSource.max_drawdown ?? 0;
  const sharpeRatio = metricsSource.sharpeRatio ?? metricsSource.sharpe_ratio ?? 0;
  return {
    id: result.id || 1,
    name: result.name || "DCA Backtest",
    type: result.type || "portfolio",
    fundIds: result.fundIds || individual.map((r: any) => r?.fund_code).filter(Boolean),
    weights: options.weights || result.weights || [],
    strategy: options.strategy || result.strategy || "fixed_amount",
    selectedStrategyKey,
    recommendedStrategyKey: strategyResults.slice().sort((a: any, b: any) => toFiniteBacktestNumber(b.score) - toFiniteBacktestNumber(a.score))[0]?.key || selectedStrategyKey,
    startDate: result.startDate || result.start_date || "",
    endDate: result.endDate || result.end_date || "",
    investAmount: result.investAmount || result.amount || "1000",
    investFrequency: result.investFrequency || result.frequency || "monthly",
    totalInvested: toFiniteBacktestNumber(totalInvested).toFixed(2),
    finalValue: toFiniteBacktestNumber(finalValue).toFixed(2),
    totalReturn: toFiniteBacktestNumber(totalReturn).toFixed(2),
    annualizedReturn: toFiniteBacktestNumber(annualizedReturn).toFixed(2),
    maxDrawdown: toFiniteBacktestNumber(maxDrawdown).toFixed(2),
    sharpeRatio: toFiniteBacktestNumber(sharpeRatio).toFixed(2),
    feeCost: toFiniteBacktestNumber(portfolioMetrics?.feeCost).toFixed(2),
    benchmarkReturn: metricsSource.benchmark_return != null ? String(metricsSource.benchmark_return) : "0",
    excessReturn: metricsSource.excess_return != null ? String(metricsSource.excess_return) : "0",
    monthlyData: merged,
    benchmarkCurve,
    strategyResults,
    benchmark: {
      totalInvested: toFiniteBacktestNumber(benchSummary?.totalInvested ?? benchSummary?.total_invested).toFixed(2),
      finalValue: toFiniteBacktestNumber(benchSummary?.finalValue ?? benchSummary?.final_value).toFixed(2),
      totalReturn: toFiniteBacktestNumber(benchSummary?.totalReturn ?? benchSummary?.total_return).toFixed(2),
      annualReturn: toFiniteBacktestNumber(benchSummary?.annualReturn ?? benchSummary?.annual_return).toFixed(2),
      maxDrawdown: toFiniteBacktestNumber(benchSummary?.maxDrawdown ?? benchSummary?.max_drawdown).toFixed(2),
    },
    fundBreakdown: individual.map((item: any, index: number) => ({
      code: item?.fund_code || options.fundMeta?.[index]?.fundCode || "",
      name: options.fundMeta?.[index]?.fundAbbr || options.fundMeta?.[index]?.fundName || item?.fund_name || item?.fund_code || "",
      weight: Math.round((weights[index] || 0) * 10000) / 100,
      strategyReturn: toFiniteBacktestNumber(getStrategyPayload(item, selectedStrategyKey)?.total_profit_rate).toFixed(2),
      annualizedReturn: toFiniteBacktestNumber(getStrategyPayload(item, selectedStrategyKey)?.annual_return).toFixed(2),
      maxDrawdown: toFiniteBacktestNumber(getStrategyPayload(item, selectedStrategyKey)?.max_drawdown).toFixed(2),
      sharpeRatio: toFiniteBacktestNumber(getStrategyPayload(item, selectedStrategyKey)?.sharpe_ratio).toFixed(2),
    })),
    settings: {
      feeRate,
      slippageRate,
      riskProfile: options.riskProfile || "balanced",
      maxDrawdownLimit: options.maxDrawdownLimit ?? null,
      targetAnnualReturn: options.targetAnnualReturn ?? null,
    },
    fundCode: first?.fund_code || (individual[0]?.fund_code) || "",
    fundName: first?.fund_name || (individual[0]?.fund_name) || "",
  };
}

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
