/**
 * FundTrader 2.0 API Client
 * 封装 FundTrader FastAPI 后端 REST API 调用
 * 将后端数据格式映射为前端期望的格式
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/fund/api";

/** 长耗时路径（配置生成/回测/压力测试等）使用120s，其余30s */
const LONG_TIMEOUT_PATHS = [
  "/allocation/generate", "/allocation/backtest", "/allocation/variants",
  "/dca/backtest", "/allocation/explain", "/allocation/what-if",
  "/allocation/dual-engine",
];

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const isLongRequest = LONG_TIMEOUT_PATHS.some(p => path.startsWith(p));
  const timeoutMs = isLongRequest ? 120_000 : 30_000;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`请求超时(${timeoutMs / 1000}s)`)),
    timeoutMs,
  );

  // 兼容方案替代 AbortSignal.any()（2024年3月才 Baseline）
  if (options?.signal) {
    const external = options.signal;
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
    }
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${path} error: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json();
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(
        isLongRequest
          ? "请求超时（2分钟），数据量较大请缩小范围后重试"
          : "请求超时（30秒），请检查网络后重试",
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
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

// ==================== 市场数据状态 ====================
export async function getMarketDataStatus() {
  return fetchJson<import("@/types/allocation").MarketDataStatus>("/market-data/status");
}

// ==================== 配置回测 ====================
export async function runAllocationBacktest(params: import("@/types/backtest").BacktestRequest) {
  return fetchJson<import("@/types/backtest").BacktestResponse>("/allocation/backtest", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== 基金选优排名 ====================
export async function getFundRanking(preferred_tags: string[] = [], signal?: AbortSignal) {
  return fetchJson<import("@/types/allocation").FundRankingResponse>("/allocation/fund-ranking", {
    method: "POST",
    body: JSON.stringify({ preferred_tags }),
    signal,
  });
}

// ==================== 资产配置生成 ====================
export async function generateAllocation(params: import("@/types/allocation").AllocationRequest) {
  return fetchJson<import("@/types/allocation").AllocationResponse>("/allocation/generate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** SSE 流式生成配置 — 返回 { cancel } 用于取消 */
export function generateAllocationStream(
  params: import("@/types/allocation").AllocationRequest,
  onProgress?: (step: number, total: number, name: string, status: string, detail: string) => void,
  onDone?: (result: import("@/types/allocation").AllocationResponse) => void,
  onError?: (message: string) => void,
  onCancelled?: () => void,
): { cancel: () => void } {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/allocation/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Stream not supported");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const msg = JSON.parse(line.slice(6));
              switch (msg.type) {
                case "progress":
                  onProgress?.(msg.step, msg.total, msg.name, msg.status, msg.detail);
                  break;
                case "result":
                  onDone?.(msg.data);
                  break;
                case "error":
                  onError?.(msg.message);
                  break;
                case "cancelled":
                  onCancelled?.();
                  break;
              }
            } catch { /* skip parse errors */ }
          }
        }
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        onCancelled?.();
      } else {
        onError?.(e?.message || "流式请求失败");
      }
    }
  })();

  return { cancel: () => controller.abort() };
}

// ==================== 三方案输出 ====================
export async function generateVariants(params: import("@/types/allocation").AllocationRequest) {
  return fetchJson<import("@/types/allocation").VariantsResponse>("/allocation/variants", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== 可解释性报告 ====================
export async function getExplainReport(params: import("@/types/allocation").AllocationRequest) {
  return fetchJson<import("@/types/allocation").ExplainReportModel>("/allocation/explain", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== What-If模拟器 ====================
export async function runWhatIfSimulation(params: import("@/types/allocation").WhatIfRequest) {
  return fetchJson<import("@/types/allocation").WhatIfResponse>("/allocation/what-if", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== A/C份额选择 ====================
export async function selectShareClass(params: import("@/types/allocation").ShareSelectorRequest) {
  return fetchJson<import("@/types/allocation").ShareSelectorResponse>("/allocation/share-selector", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== 相关性约束检查 ====================
export async function checkCorrelation(params: import("@/types/allocation").CorrelationCheckRequest) {
  return fetchJson<import("@/types/allocation").CorrelationCheckResponse>("/allocation/correlation-check", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== 费率评分分析 ====================
export async function analyzeFees(params: import("@/types/allocation").FeeAnalysisRequest) {
  return fetchJson<import("@/types/allocation").FeeAnalysisResponse>("/allocation/fee-analysis", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== 再平衡检查 ====================
export async function checkRebalance(params: import("@/types/allocation").RebalanceCheckRequest) {
  return fetchJson<import("@/types/allocation").RebalanceCheckResponse>("/allocation/rebalance-check", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getRebalanceHistory() {
  return fetchJson<import("@/types/allocation").RebalanceHistoryResponse>("/allocation/rebalance-history");
}

// ==================== 数据存储 ====================
export async function savePlan(params: import("@/types/allocation").SavePlanRequest) {
  return fetchJson<import("@/types/allocation").SavedPlanItem>("/storage/plans", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function listPlans(params?: { risk_profile?: string; favorite_only?: boolean; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.risk_profile) qs.append("risk_profile", params.risk_profile);
  if (params?.favorite_only) qs.append("favorite_only", "true");
  if (params?.limit) qs.append("limit", String(params.limit));
  return fetchJson<import("@/types/allocation").PlanListResponse>(`/storage/plans?${qs.toString()}`);
}

export async function getPlan(planId: string) {
  return fetchJson<import("@/types/allocation").SavedPlanItem>(`/storage/plans/${planId}`);
}

export async function deletePlan(planId: string) {
  return fetchJson<{ success: boolean }>(`/storage/plans/${planId}`, { method: "DELETE" });
}

export async function updatePlan(planId: string, updates: { name?: string; is_favorite?: boolean; is_archived?: boolean }) {
  return fetchJson<import("@/types/allocation").SavedPlanItem>(`/storage/plans/${planId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function addRebalanceRecord(record: {
  risk_profile: string;
  trigger_type: string;
  actions: Record<string, any>[];
  total_turnover: number;
  estimated_cost: number;
  status: string;
  summary: string;
  plan_id?: string;
}) {
  return fetchJson<{ id: string }>("/storage/rebalance", {
    method: "POST",
    body: JSON.stringify(record),
  });
}

export async function getRebalanceStats() {
  return fetchJson<import("@/types/allocation").RebalanceStatsResponse>("/storage/rebalance/stats");
}

// ==================== 预警通知 ====================
export interface AlertItem {
  id: string;
  type: "deviation" | "drawdown" | "vol_spike" | "rebalance_due";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  asset_class?: string;
  value?: number;
  threshold?: number;
  created_at: string;
  read: boolean;
}

export interface AlertCheckResult {
  alerts: AlertItem[];
  count: number;
  thresholds_used: Record<string, number>;
}

export interface AlertListResult {
  alerts: AlertItem[];
  count: number;
  unread_critical: number;
  unread_warning: number;
}

export async function checkPortfolioAlerts(params: {
  target_weights: Record<string, number>;
  current_weights?: Record<string, number>;
  portfolio_return?: number;
  vol_ratio?: number;
  last_rebalance_date?: string;
  thresholds?: Record<string, number>;
}) {
  return fetchJson<AlertCheckResult>("/storage/alerts/check", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function checkPlanAlerts(planId: string, thresholds?: Record<string, number>) {
  return fetchJson<{
    plan_id: string;
    plan_name: string;
    alerts: AlertItem[];
    count: number;
    portfolio_return: number | null;
  }>(`/storage/alerts/check/${planId}`, {
    method: "POST",
    body: JSON.stringify({ thresholds }),
  });
}

export async function getActiveAlerts() {
  return fetchJson<AlertListResult>("/storage/alerts");
}

export async function markAlertRead(alertId: string) {
  return fetchJson<{ success: boolean; alert_id: string }>(`/storage/alerts/${alertId}/read`, {
    method: "POST",
  });
}

export async function clearAllAlerts() {
  return fetchJson<{ success: boolean }>("/storage/alerts/clear", { method: "POST" });
}

export async function getAlertThresholds() {
  return fetchJson<{ thresholds: Record<string, number> }>("/storage/alerts/thresholds");
}

// ==================== 健康检查 ====================
export async function healthCheck() {
  return fetchJson<{ status: string }>("/health");
}

// ==================== 管线健康报告 ====================
export async function getPipelineHealth(signal?: AbortSignal) {
  return fetchJson<import("@/types/allocation").PipelineHealthResponse>("/allocation/pipeline-health", { signal });
}

// ==================== 双引擎对比 ====================
export async function runDualEngine(params: import("@/types/allocation").AllocationRequest) {
  return fetchJson<import("@/types/allocation").DualEngineResponse>("/allocation/dual-engine", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
