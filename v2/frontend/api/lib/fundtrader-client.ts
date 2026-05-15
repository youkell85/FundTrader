/**
 * FundTrader FastAPI Backend Client
 * 用于 BFF 层调用 FundTrader REST API
 */

const API_BASE = process.env.FUNDTRADER_API_BASE || "http://localhost:8766/fund/api";

export async function ftFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FundTrader API ${path} error ${res.status}: ${text}`);
  }
  return res.json();
}

// 基金列表
export async function getFundList(params: Record<string, any> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  });
  return ftFetch<any>(`/fund/list?${qs.toString()}`);
}

// 基金分类
export async function getCategories() {
  return ftFetch<any>("/fund/categories");
}

// 基金分析详情
export async function getFundAnalysis(code: string) {
  return ftFetch<any>(`/analysis/${code}`);
}

// 市场概览
export async function getMarketIndex() {
  return ftFetch<any>("/recommend/market");
}

// 定投回测
export async function runDcaBacktest(params: any) {
  return ftFetch<any>("/dca/backtest", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// 回测建议
export async function getDcaSuggestion(code: string) {
  return ftFetch<any>(`/dca/suggestion/${code}`);
}

// 智能推荐
export async function getRecommendations(params: any) {
  return ftFetch<any>("/recommend", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// 专业分析
export async function getProfessionalAnalysis(code: string) {
  return ftFetch<any>(`/professional/${code}`);
}

// 相关性矩阵
export async function getCorrelationMatrix(codes: string[]) {
  return ftFetch<any>("/professional/correlation", {
    method: "POST",
    body: JSON.stringify({ codes }),
  });
}

// 自选列表
export async function getWatchlist() {
  return ftFetch<any>("/settings/watchlist");
}

// 健康检查
export async function healthCheck() {
  return ftFetch<any>("/health");
}
