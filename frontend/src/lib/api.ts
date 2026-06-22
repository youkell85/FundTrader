/**
 * FundTrader 2.0 API Client
 * 灏佽 FundTrader FastAPI 鍚庣 REST API 璋冪敤
 * 灏嗗悗绔暟鎹牸寮忔槧灏勪负鍓嶇鏈熸湜鐨勬牸寮? */

import type {
  DataSourceHealthSnapshot,
  MarketDataSourcesStatus,
  MarketDataStatus,
  MarketDataStreamPayload,
} from "@/types/allocation";

const API_BASE = import.meta.env.VITE_API_BASE || "/fund/api";

/**
 * 请求超时策略：
 * 标准/回测/测试场景默认 30s；
 * 涉及长耗时生成和回测场景使用 120s
 */
const LONG_TIMEOUT_PATHS = [
  "/allocation/generate", "/allocation/backtest", "/allocation/variants",
  "/dca/backtest", "/allocation/explain", "/allocation/what-if",
  "/allocation/dual-engine",
];

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const isLongRequest = LONG_TIMEOUT_PATHS.some(p => path.startsWith(p));
  const timeoutMs = isLongRequest ? 120_000 : 30_000;

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`请求超时(${timeoutMs / 1000}s)`));
  }, timeoutMs);

  // 兼容写法，避免直接依赖 AbortSignal.any（部分环境基线较旧）
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
      throw new Error(`接口 ${path} 请求失败：${res.status} ${text.slice(0, 200)}`);
    }
    return res.json();
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(
        isLongRequest
          ? "请求超时（3分钟），正在重试"
          : "请求超时（60秒），请稍后再试",
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// ==================== 鍩洪噾鍒楄〃 ====================
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

// ==================== 鍩洪噾璇︽儏 ====================
export async function getFundAnalysis(code: string) {
  return fetchJson<any>(`/analysis/${code}`);
}

export async function getManagerStyle(code: string) {
  return fetchJson<{ code: string; style_analysis?: string; error?: string }>(`/analysis/${code}/style`);
}

// ==================== 瀹氭姇鍥炴祴 ====================
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

// ==================== 鏅鸿兘鎺ㄨ崘 ====================
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

// ==================== 涓撲笟鍒嗘瀽 ====================
export async function getProfessionalAnalysis(code: string) {
  return fetchJson<any>(`/professional/${code}`);
}

export async function getCorrelationMatrix(codes: string[]) {
  return fetchJson<any>("/professional/correlation", {
    method: "POST",
    body: JSON.stringify({ codes }),
  });
}

// ==================== 鑷€夎偂 ====================
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

// ==================== 甯傚満鏁版嵁鐘舵€?====================
export async function getMarketDataStatus() {
  return fetchJson<MarketDataStatus>("/market-data/status");
}

export async function getMarketDataSourcesStatus() {
  return fetchJson<MarketDataSourcesStatus>("/market-data/data-sources");
}

export async function getMarketDataSourceHealth() {
  return fetchJson<DataSourceHealthSnapshot>("/market-data/source-status");
}

export function subscribeMarketDataStream(options: {
  interval?: number;
  onMessage: (payload: MarketDataStreamPayload) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: Error | Event) => void;
}) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const base = API_BASE.startsWith("http")
    ? new URL(API_BASE, window.location.origin).toString()
    : `${window.location.origin}${API_BASE.startsWith("/") ? "" : "/"}${API_BASE}`;
  const wsBase = base.replace(/^http:/, protocol).replace(/^https:/, protocol);
  const ws = new WebSocket(`${wsBase}/market-data/stream?interval=${options.interval || 5}`);
  ws.addEventListener("open", () => options.onOpen?.());

  ws.addEventListener("message", (ev) => {
    try {
      options.onMessage(JSON.parse(ev.data));
    } catch {
      options.onError?.(new Error("market-data stream parse error"));
    }
  });
  ws.addEventListener("close", () => options.onClose?.());
  ws.addEventListener("error", (ev) => options.onError?.(ev));

  return {
    close: () => ws.close(),
    socket: ws,
  };
}
// ==================== 閰嶇疆鍥炴祴 ====================
export async function runAllocationBacktest(params: import("@/types/backtest").BacktestRequest) {
  return fetchJson<import("@/types/backtest").BacktestResponse>("/allocation/backtest", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function runAllocationBacktestStream(
  params: import("@/types/backtest").BacktestRequest,
  onProgress?: (step: number, total: number, name: string, status: string, detail: string) => void,
  onDone?: (result: import("@/types/backtest").BacktestResponse) => void,
  onError?: (message: string) => void,
  onCancelled?: (message?: string) => void,
): { cancel: () => void } {
  const controller = new AbortController();

  (async () => {
    let doneCalled = false;
    let cancelledCalled = false;
    let erroredCalled = false;

    const callDone = (result: import("@/types/backtest").BacktestResponse) => {
      if (doneCalled || cancelledCalled || erroredCalled) return;
      doneCalled = true;
      onDone?.(result);
    };
    const callError = (msg: string) => {
      if (doneCalled || cancelledCalled || erroredCalled) return;
      erroredCalled = true;
      onError?.(msg);
    };
    const callCancelled = (msg?: string) => {
      if (doneCalled || cancelledCalled || erroredCalled) return;
      cancelledCalled = true;
      onCancelled?.(msg);
    };

    try {
      const res = await fetch(`${API_BASE}/allocation/backtest/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`请求失败：${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("当前浏览器不支持流式响应");

      const decoder = new TextDecoder();
      let buffer = "";
      let terminalReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            switch (msg.type) {
              case "progress":
                onProgress?.(msg.step, msg.total, msg.name, msg.status, msg.detail);
                break;
              case "result":
                terminalReceived = true;
                callDone(msg.data);
                break;
              case "error":
                terminalReceived = true;
                callError(msg.stage ? `失败阶段 ${msg.stage}: ${msg.message}` : msg.message);
                break;
              case "cancelled":
                terminalReceived = true;
                callCancelled(msg.message);
                break;
              case "heartbeat":
                onProgress?.(-1, -1, "_heartbeat", "running", msg.message || "");
                break;
              case "done":
                terminalReceived = true;
                if (!doneCalled && !cancelledCalled && !erroredCalled) {
                  callError("回测流已关闭，但未收到结果，请重试。");
                }
                break;
            }
          } catch { /* skip malformed stream rows */ }
        }
      }

      if (!terminalReceived) {
        callError("回测流意外中断，未收到结果，请重试。");
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        callCancelled("回测已取消");
      } else {
        callError(e?.message || "流式回测请求失败");
      }
    }
  })();

  return { cancel: () => controller.abort() };
}

// ==================== 鍩洪噾閫変紭鎺掑悕 ====================
export async function getFundRanking(preferred_tags: string[] = [], signal?: AbortSignal) {
  return fetchJson<import("@/types/allocation").FundRankingResponse>("/allocation/fund-ranking", {
    method: "POST",
    body: JSON.stringify({ preferred_tags }),
    signal,
  });
}

// ==================== 璧勪骇閰嶇疆鐢熸垚 ====================
export async function generateAllocation(params: import("@/types/allocation").AllocationRequest) {
  return fetchJson<import("@/types/allocation").AllocationResponse>("/allocation/generate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** SSE 娴佸紡鐢熸垚閰嶇疆 鈥?杩斿洖 { cancel } 鐢ㄤ簬鍙栨秷 */
export function generateAllocationStream(
  params: import("@/types/allocation").AllocationRequest,
  onProgress?: (step: number, total: number, name: string, status: string, detail: string) => void,
  onDone?: (result: import("@/types/allocation").AllocationResponse) => void,
  onError?: (message: string) => void,
  onCancelled?: (message?: string) => void,
): { cancel: () => void } {
  const controller = new AbortController();

  (async () => {
    let doneCalled = false;
    let cancelledCalled = false;
    let erroredCalled = false;

    const callDone = (result: import("@/types/allocation").AllocationResponse) => {
      if (doneCalled || cancelledCalled || erroredCalled) return;
      doneCalled = true;
      onDone?.(result);
    };
    const callError = (msg: string) => {
      if (doneCalled || cancelledCalled || erroredCalled) return;
      erroredCalled = true;
      onError?.(msg);
    };
    const callCancelled = (msg?: string) => {
      if (doneCalled || cancelledCalled || erroredCalled) return;
      cancelledCalled = true;
      onCancelled?.(msg);
    };

    try {
      const res = await fetch(`${API_BASE}/allocation/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`请求失败：${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("当前浏览器不支持流式响应");

      const decoder = new TextDecoder();
      let buffer = "";
      let terminalReceived = false;

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
                  terminalReceived = true;
                  callDone(msg.data);
                  break;
                case "error":
                  terminalReceived = true;
                  callError(msg.message);
                  break;
                case "cancelled":
                  terminalReceived = true;
                  {
                    const cancelMsg: string = msg.message || "";
                    if (/超时|自动终止|timeout|timed out/i.test(cancelMsg)) {
                      callError(cancelMsg || "管线超过120s总超时，自动终止");
                    } else {
                      callCancelled(cancelMsg);
                    }
                  }
                  break;
                case "heartbeat":
                  onProgress?.(-1, -1, "_heartbeat", "running", msg.message || "");
                  break;
                case "done":
                  terminalReceived = true;
                  if (!doneCalled && !cancelledCalled && !erroredCalled) {
                    callError("流式连接已关闭，未收到配置结果，请重试。");
                  }
                  break;
              }
            } catch { /* skip parse errors */ }
          }
        }
      }

      if (!terminalReceived) {
        callError("流式连接意外中断，未收到配置结果，请重试。");
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        callCancelled();
      } else {
        callError(e?.message || "流式请求失败");
      }
    }
  })();

  return { cancel: () => controller.abort() };
}

// ==================== 涓夋柟妗堣緭鍑?====================
export async function generateVariants(params: import("@/types/allocation").AllocationRequest) {
  return fetchJson<import("@/types/allocation").VariantsResponse>("/allocation/variants", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== 鍙В閲婃€ф姤鍛?====================
export async function getExplainReport(params: import("@/types/allocation").AllocationRequest) {
  return fetchJson<import("@/types/allocation").ExplainReportModel>("/allocation/explain", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== What-If妯℃嫙鍣?====================
export async function runWhatIfSimulation(params: import("@/types/allocation").WhatIfRequest) {
  return fetchJson<import("@/types/allocation").WhatIfResponse>("/allocation/what-if", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== A/C浠介閫夋嫨 ====================
export async function selectShareClass(params: import("@/types/allocation").ShareSelectorRequest) {
  return fetchJson<import("@/types/allocation").ShareSelectorResponse>("/allocation/share-selector", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== 鐩稿叧鎬х害鏉熸鏌?====================
export async function checkCorrelation(params: import("@/types/allocation").CorrelationCheckRequest) {
  return fetchJson<import("@/types/allocation").CorrelationCheckResponse>("/allocation/correlation-check", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== 璐圭巼璇勫垎鍒嗘瀽 ====================
export async function analyzeFees(params: import("@/types/allocation").FeeAnalysisRequest) {
  return fetchJson<import("@/types/allocation").FeeAnalysisResponse>("/allocation/fee-analysis", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ==================== 鍐嶅钩琛℃鏌?====================
export async function checkRebalance(params: import("@/types/allocation").RebalanceCheckRequest) {
  return fetchJson<import("@/types/allocation").RebalanceCheckResponse>("/allocation/rebalance-check", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getRebalanceHistory() {
  return fetchJson<import("@/types/allocation").RebalanceHistoryResponse>("/storage/rebalance");
}

// ==================== 鏁版嵁瀛樺偍 ====================
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

// ==================== 组合构建与模型组合超市 ====================
export async function getPortfolioCandidates(limit = 80) {
  return fetchJson<import("@/types/portfolio").PortfolioCandidatesResponse>(`/marketplace/candidates?limit=${limit}`);
}

export async function buildPortfolio(params: import("@/types/portfolio").PortfolioBuildRequest) {
  return fetchJson<import("@/types/portfolio").PortfolioBuildResponse>("/marketplace/portfolio-build", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getModelPortfolios(limit = 6) {
  return fetchJson<import("@/types/portfolio").ModelPortfolioListResponse>(`/marketplace/model-portfolios?limit=${limit}`);
}

// ==================== 棰勮閫氱煡 ====================
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

// ==================== 鍋ュ悍妫€鏌?====================
export async function healthCheck() {
  return fetchJson<{ status: string }>("/health");
}

// ==================== 绠＄嚎鍋ュ悍鎶ュ憡 ====================
export async function getPipelineHealth(signal?: AbortSignal) {
  return fetchJson<import("@/types/allocation").PipelineHealthResponse>("/allocation/pipeline-health", { signal });
}

// ==================== 鍙屽紩鎿庡姣?====================
export async function runDualEngine(params: import("@/types/allocation").AllocationRequest) {
  return fetchJson<import("@/types/allocation").DualEngineResponse>("/allocation/dual-engine", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
