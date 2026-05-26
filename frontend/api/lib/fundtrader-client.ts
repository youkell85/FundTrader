/**
 * FundTrader FastAPI Backend Client
 * 用于 BFF 层调用 FundTrader REST API
 */

const API_BASE = process.env.FUNDTRADER_API_BASE || "http://localhost:8766";

export async function ftFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
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
export async function getFundList(params: Record<string, unknown> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  });
  return ftFetch<Record<string, unknown>>(`/fund/list?${qs.toString()}`);
}

// 基金分类
export async function getCategories() {
  return ftFetch<Record<string, unknown>>("/fund/categories");
}

// 基金分析详情
export async function getFundAnalysis(code: string) {
  return ftFetch<Record<string, unknown>>(`/analysis/${code}`);
}

// 批量基金分析（减少HTTP往返）
export async function getFundAnalysisBatch(codes: string[]) {
  return ftFetch<{ results: Record<string, unknown> }>("/analysis/batch", {
    method: "POST",
    body: JSON.stringify(codes),
  });
}

// 市场概览
export async function getMarketIndex() {
  return ftFetch<Record<string, unknown>>("/recommend/market");
}

// 定投回测
export async function runDcaBacktest(params: Record<string, unknown>) {
  return ftFetch<Record<string, unknown>>("/dca/backtest", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// 回测建议
export async function getDcaSuggestion(code: string) {
  return ftFetch<Record<string, unknown>>(`/dca/suggestion/${code}`);
}

// 智能推荐
export async function getRecommendations(params: Record<string, unknown>) {
  return ftFetch<Record<string, unknown>>("/recommend", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// 专业分析
export async function getProfessionalAnalysis(code: string) {
  return ftFetch<Record<string, unknown>>(`/professional/${code}`);
}

// 相关性矩阵
export async function getCorrelationMatrix(codes: string[]) {
  const qs = new URLSearchParams();
  codes.forEach((c) => qs.append("codes", c));
  return ftFetch<Record<string, unknown>>(`/professional/correlation?${qs.toString()}`, {
    method: "POST",
  });
}

// 自选列表
export async function getWatchlist() {
  return ftFetch<Record<string, unknown>>("/settings/watchlist");
}

export async function addToWatchlist(code: string, name = "", type = "", tags: string[] = []) {
  return ftFetch<Record<string, unknown>>("/settings/watchlist/add", {
    method: "POST",
    body: JSON.stringify({ code, name, type, tags }),
  });
}

// 移除自选基金
export async function removeFromWatchlist(code: string) {
  return ftFetch<Record<string, unknown>>(`/settings/watchlist/${code}`, {
    method: "DELETE",
  });
}

// 健康检查
export async function healthCheck() {
  return ftFetch<Record<string, unknown>>("/health");
}

// 基金评价 LLM 分析
export async function getFundLLMReview(code: string) {
  return ftFetch<Record<string, unknown>>(`/analysis/${code}/llm_review`);
}

// 定投 LLM 评价
export async function getDcaLLMReview(payload: Record<string, unknown>) {
  return ftFetch<Record<string, unknown>>(`/dca/llm_review`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Image search returned invalid JSON: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
