/**
 * FundTrader FastAPI Backend Client
 * ���� BFF ����� FundTrader REST API
 */

const API_BASE = process.env.FUNDTRADER_API_BASE || "http://localhost:8766";

function createTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Request timeout (${timeoutMs / 1000}s)`)),
    timeoutMs,
  );

  const abortFromExternal = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromExternal();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

export async function ftFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const timeoutSignal = createTimeoutSignal(120000, options?.signal);
  try {
    const res = await fetch(url, {
      ...options,
      signal: timeoutSignal.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });
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
  } finally {
    timeoutSignal.cleanup();
  }
}

// �����б�
export async function getFundList(params: Record<string, unknown> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  });
  return ftFetch<Record<string, unknown>>(`/fund/list?${qs.toString()}`);
}

export async function getFundSnapshotList(params: Record<string, unknown> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  });
  return ftFetch<Record<string, unknown>>(`/fund/snapshot/list?${qs.toString()}`);
}

export async function getFundSnapshot(code: string, enqueueMissing = true) {
  const qs = new URLSearchParams({ enqueue_missing: String(enqueueMissing) });
  return ftFetch<Record<string, unknown>>(`/fund/snapshot/${code}?${qs.toString()}`);
}

export async function getFundCategoryMetrics(params: {
  window_days?: number;
  risk_free_rate?: number;
  xinjihui_only?: boolean;
  force_refresh?: boolean;
} = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  });
  return ftFetch<Record<string, unknown>>(`/fund/category-metrics?${qs.toString()}`);
}

export async function requestFundBackfill(code: string) {
  return getFundSnapshot(code, true);
}

// �������
export async function getCategories() {
  return ftFetch<Record<string, unknown>>("/fund/categories");
}

// �����������
export async function getFundAnalysis(code: string) {
  return ftFetch<Record<string, unknown>>(`/analysis/${code}`);
}

// �����������������HTTP������
export async function getFundAnalysisBatch(codes: string[]) {
  return ftFetch<{ results: Record<string, unknown> }>("/analysis/batch", {
    method: "POST",
    body: JSON.stringify(codes),
  });
}

// �г�����
export async function getMarketIndex() {
  return ftFetch<Record<string, unknown>>("/recommend/market");
}

// ��Ͷ�ز�
export async function runDcaBacktest(params: Record<string, unknown>) {
  return ftFetch<Record<string, unknown>>("/dca/backtest", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// �ز⽨��
export async function getDcaSuggestion(code: string) {
  return ftFetch<Record<string, unknown>>(`/dca/suggestion/${code}`);
}

// �����Ƽ�
export async function getRecommendations(params: Record<string, unknown>) {
  return ftFetch<Record<string, unknown>>("/recommend", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// רҵ����
export async function getProfessionalAnalysis(code: string) {
  return ftFetch<Record<string, unknown>>(`/professional/${code}`);
}

// ����Ծ���
export async function getCorrelationMatrix(codes: string[]) {
  const qs = new URLSearchParams();
  codes.forEach((c) => qs.append("codes", c));
  return ftFetch<Record<string, unknown>>(`/professional/correlation?${qs.toString()}`, {
    method: "POST",
  });
}

// ��ѡ�б�
export async function getWatchlist() {
  return ftFetch<Record<string, unknown>>("/settings/watchlist");
}

export async function addToWatchlist(code: string, name = "", type = "", tags: string[] = []) {
  return ftFetch<Record<string, unknown>>("/settings/watchlist/add", {
    method: "POST",
    body: JSON.stringify({ code, name, type, tags }),
  });
}

// �Ƴ���ѡ����
export async function removeFromWatchlist(code: string) {
  return ftFetch<Record<string, unknown>>(`/settings/watchlist/${code}`, {
    method: "DELETE",
  });
}

// �������
export async function healthCheck() {
  return ftFetch<Record<string, unknown>>("/health");
}

// �������� LLM ����
export async function getFundLLMReview(code: string) {
  return ftFetch<Record<string, unknown>>(`/analysis/${code}/llm_review`);
}

// ��Ͷ LLM ����
export async function getDcaLLMReview(payload: Record<string, unknown>) {
  return ftFetch<Record<string, unknown>>(`/dca/llm_review`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ͼƬʶ�����
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

// 资产配置生成
export interface AllocationParams {
  age: number;
  goal_type: string;
  investment_horizon: string;
  amount: number;
  risk_tolerance: string;
  max_drawdown: number;
  preferred_tags: string[];
  behavior_answers: Record<string, string>;
}

export async function generateAllocation(params: AllocationParams) {
  return ftFetch<any>("/allocation/generate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
