/**
 * FundTrader FastAPI Backend Client
 * 用于 BFF 层调用 FundTrader REST API
 */

const API_BASE = process.env.FUNDTRADER_API_BASE || "http://localhost:8766";

export async function ftFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`FundTrader API ${path} error ${res.status}: ${text}`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`FundTrader API ${path} returned invalid JSON: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
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
  const qs = new URLSearchParams();
  codes.forEach((c) => qs.append("codes", c));
  return ftFetch<any>(`/professional/correlation?${qs.toString()}`, {
    method: "POST",
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

// 图片识别基金
export async function imageSearchFund(file: File) {
  const url = `${API_BASE}/fund/image-search`;
  const formData = new FormData();
  formData.append("file", file);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Image search error ${res.status}: ${text}`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as any;
    } catch {
      throw new Error(`Image search returned invalid JSON: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
