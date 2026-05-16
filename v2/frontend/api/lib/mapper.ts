/**
 * FundTrader 后端数据 → 前端数据格式映射
 */

// 基金类型映射（FundTrader 中文 → 前端英文标识）
const typeMap: Record<string, string> = {
  "股票型": "equity",
  "混合型": "hybrid",
  "债券型": "bond",
  "指数型": "index",
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
function generateTags(name: string, type: string): string[] {
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

// 映射基金列表项
export function mapFundItem(item: any): any {
  if (!item || typeof item !== "object") return null;
  const code = item.code || "";
  const name = item.name || "";
  const type = item.type || "";
  const perf = item.performance || {};
  // 兼容 manager 为字符串或对象的情况
  const mgrRaw = item.manager_info || item.manager;
  const mgr = typeof mgrRaw === "string" ? { name: mgrRaw } : (mgrRaw || {});
  const id = codeToId(code);

  return {
    id,
    fundCode: code,
    fundName: name,
    fundAbbr: name.replace(/混合型|股票型|债券型|指数型|证券投资基金|A类|C类/g, "").trim(),
    fundType: typeMap[type] || type.toLowerCase().replace(/型/g, ""),
    category: type || "其他",
    company: item.company || item.management || "—",
    riskLevel: riskMap[item.risk_level || item.riskLevel] || "medium",
    isContinuousMarketing: item.isContinuousMarketing ?? 0,
    nav: item.nav != null ? String(item.nav) : "—",
    accumNav: item.accum_nav != null ? String(item.accum_nav) : item.nav != null ? String(item.nav) : "—",
    dailyChange: item.day_growth != null ? String(item.day_growth) : "0",
    totalScale: item.total_scale != null ? String(item.total_scale) : item.scale != null ? String(item.scale) : "—",
    benchmark: item.benchmark || "—",
    feeManage: item.feeManage ?? item.fee_rate ?? "—",
    feeCustody: item.feeCustody ?? "—",
    stars: item.stars || (item.rating ? Math.min(5, Math.max(1, item.rating)) : 4),
    managerId: mgr.name ? codeToId(mgr.name) : null,
    tags: item.tags || generateTags(name, type),
    trackingIndex: item.trackingIndex || null,
    performance: {
      return1m: perf.near_1m != null ? String(perf.near_1m) : item.near_1m != null ? String(item.near_1m) : "0",
      return3m: perf.near_3m != null ? String(perf.near_3m) : item.near_3m != null ? String(item.near_3m) : "0",
      return6m: perf.near_6m != null ? String(perf.near_6m) : item.near_6m != null ? String(item.near_6m) : "0",
      return1y: perf.near_1y != null ? String(perf.near_1y) : item.near_1y != null ? String(item.near_1y) : "0",
      return2y: perf.near_2y != null ? String(perf.near_2y) : "0",
      return3y: perf.near_3y != null ? String(perf.near_3y) : item.near_3y != null ? String(item.near_3y) : "0",
      return5y: perf.near_5y != null ? String(perf.near_5y) : "0",
      returnThisYear: perf.ytd != null ? String(perf.ytd) : item.ytd != null ? String(item.ytd) : "0",
      annualizedReturn: perf.annualizedReturn || item.annualizedReturn || "0",
      annualizedVolatility: perf.annualizedVolatility || "0",
      sharpeRatio: perf.sharpeRatio || item.sharpe_ratio || "0",
      maxDrawdown: perf.maxDrawdown || item.max_drawdown || "0",
      calmarRatio: perf.calmarRatio || "0",
      sortinoRatio: perf.sortinoRatio || "0",
      informationRatio: perf.informationRatio || "0",
      alpha: perf.alpha || "0",
      beta: perf.beta || "0",
      winRate: perf.winRate || "0",
      recoveryPeriod: perf.recoveryPeriod != null ? String(perf.recoveryPeriod) : "0",
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
    ratio: h?.ratio != null ? (h.ratio / 100).toFixed(4) : "0",
    changeRatio: h?.change_ratio != null ? String(h.change_ratio) : "0",
    quarter: h?.quarter || null,
  }));

  const industries: any[] = [];
  if (holdings.length > 0) {
    const industriesSet = new Set(holdings.map((h: any) => h.industry).filter((ind: any) => ind && ind !== "—"));
    industriesSet.forEach((ind: any) => {
      const total = holdings.filter((h: any) => h.industry === ind).reduce((s: number, h: any) => s + parseFloat(h.ratio), 0);
      industries.push({ fundId: base?.id, industry: ind, ratio: total.toFixed(4), changeRatio: "0", quarter: holdings[0]?.quarter || null });
    });
  }

  return {
    ...base,
    navHistory: navData.slice(-120),
    holdings,
    industries,
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
    fundAllocations: (rec.funds || rec.fundAllocations || []).map((fa: any, i: number) => {
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
    totalInvested: first.total_invested != null ? String(first.total_invested) : "0",
    finalValue: first.total_value != null ? String(first.total_value) : "0",
    totalReturn: first.total_profit_rate != null ? String(first.total_profit_rate) : "0",
    annualizedReturn: first.annual_return != null ? String(first.annual_return) : "0",
    maxDrawdown: first.max_drawdown != null ? String(first.max_drawdown) : "0",
    sharpeRatio: first.sharpe_ratio != null ? String(first.sharpe_ratio) : "0",
    benchmarkReturn: first.benchmark_return != null ? String(first.benchmark_return) : "0",
    excessReturn: first.excess_return != null ? String(first.excess_return) : "0",
  };
}

// 映射市场概览
export function mapMarketOverview(data: any): any {
  data = data || {};
  const funds = data.funds || [];
  const totalFunds = data.totalFunds || funds.length || 14;
  const avgReturn = data.avgReturn || "8.50";
  const avgSharpe = data.avgSharpe || "0.75";
  const avgMaxDD = data.avgMaxDD || "-20.00";
  const marketingCount = data.marketingCount || totalFunds;

  return { totalFunds, avgReturn, avgSharpe, avgMaxDD, marketingCount };
}
