/**
 * FundTrader 2.0 API Client
 * 封装 FundTrader FastAPI 后端 REST API 调用
 * 将后端数据格式映射为前端期望的格式
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/fund/api";

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`API ${path} error: ${res.status}`);
  return res.json();
}

// ==================== 基金列表 ====================
export async function getFundList(params: {
  category?: string;
  tag?: string;
  keyword?: string;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  page_size?: number;
  guoyuan_only?: boolean;
  use_watchlist?: boolean;
}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  });
  return fetchJson<{ total: number; page: number; page_size: number; funds: any[]; categories: string[]; types: string[] }>(
    `/fund/list?${qs.toString()}`
  );
}

export async function getCategories() {
  return fetchJson<{ categories: string[]; types: string[] }>("/fund/categories");
}

// ==================== 基金详情 ====================
export async function getFundAnalysis(code: string) {
  return fetchJson<any>(`/analysis/${code}`);
}

export async function getManagerStyle(code: string) {
  return fetchJson<{ code: string; style_analysis?: string; error?: string }>(`/analysis/${code}/style`);
}

// ==================== 定投回测 ====================
export async function runBacktest(params: {
  codes: string[];
  amount: number;
  frequency: string;
  strategy: string;
  start_date?: string;
  end_date?: string;
}) {
  return fetchJson<any>("/dca/backtest", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getDcaSuggestion(code: string) {
  return fetchJson<any>(`/dca/suggestion/${code}`);
}

// ==================== 智能推荐 ====================
export async function getRecommendations(params: {
  risk_level?: string;
  investment_horizon?: string;
  amount?: number;
  preferences?: string[];
}) {
  return fetchJson<any>("/recommend", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getMarketOverview() {
  return fetchJson<any>("/recommend/market");
}

// ==================== 专业分析 ====================
export async function getProfessionalAnalysis(code: string) {
  return fetchJson<any>(`/professional/${code}`);
}

export async function getCorrelationMatrix(codes: string[]) {
  return fetchJson<any>("/professional/correlation", {
    method: "POST",
    body: JSON.stringify({ codes }),
  });
}

// ==================== 自选股 ====================
export async function getWatchlist() {
  return fetchJson<any>("/settings/watchlist");
}

export async function addToWatchlist(code: string, name?: string) {
  return fetchJson<any>("/settings/watchlist/add", {
    method: "POST",
    body: JSON.stringify({ code, name }),
  });
}

export async function removeFromWatchlist(code: string) {
  return fetchJson<any>(`/settings/watchlist/${code}`, { method: "DELETE" });
}

// ==================== 健康检查 ====================
export async function healthCheck() {
  return fetchJson<{ status: string }>("/health");
}
