import { CheckCircle2, Loader2, XCircle, AlertTriangle, X, Clock } from "lucide-react";

/** Step labels for the 14-step pipeline */
const STEP_LABELS: Record<string, string> = {
  risk_profiling: "风险画像",
  cma_estimation: "资本市场假设",
  saa_optimization: "战略配置优化",
  regime_detection: "市场体制检测",
  taa_adjustment: "战术调整",
  circuit_breaker: "熔断器评估",
  constraint_check: "约束检验",
  fund_mapping: "基金映射",
  monte_carlo: "蒙特卡洛模拟",
  stress_test: "压力测试",
  factor_exposure: "因子暴露计算",
  scenario_analysis: "情景分析",
  portfolio_metrics: "组合指标计算",
  output_assembly: "输出组装",
  backtest_prepare: "回测准备",
  historical_data: "历史数据加载",
  strategy_replay: "策略回放",
  metric_calculation: "指标计算",
  result_assembly: "结果生成",
};

export interface StepState {
  name: string;
  status: "running" | "ok" | "degraded" | "error";
  detail: string;
}

interface Props {
  steps: StepState[];
  currentStep: number;
  totalSteps: number;
  elapsed: number;
  onCancel: () => void;
  waitingNotice?: string;
}

export { STEP_LABELS };

function statusIcon(status: string) {
  switch (status) {
    case "ok":
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    case "degraded":
      return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
    case "error":
      return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    default:
      return <Loader2 className="w-4 h-4 text-[#3B6CFF] animate-spin shrink-0" />;
  }
}

function formatTime(s: number) {
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}分${sec}秒`;
}

export default function AllocationProgress({ steps, currentStep, totalSteps, elapsed, onCancel, waitingNotice }: Props) {
  const safeCurrentStep = Math.max(0, Math.min(currentStep, totalSteps));
  const activeIndex = safeCurrentStep > 0 ? Math.min(safeCurrentStep - 1, steps.length - 1) : -1;
  const pct = totalSteps > 0 ? Math.round((safeCurrentStep / totalSteps) * 100) : 0;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0B1021]/80 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-[#3B6CFF] animate-spin" />
          <span className="text-white text-sm font-medium">
            引擎计算中... {safeCurrentStep}/{totalSteps}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-white/40 text-xs">
            <Clock className="w-3.5 h-3.5" />
            {formatTime(elapsed)}
          </span>
          <button
            onClick={onCancel}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 text-xs hover:bg-red-500/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            取消
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#3B6CFF] to-[#00F0FF] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Waiting notice */}
      {waitingNotice && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[#3B6CFF]/15 bg-[#3B6CFF]/[0.04] text-xs text-[#5AA9FF]">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span>{waitingNotice}</span>
        </div>
      )}

      {/* Step list */}
      <div className="space-y-0.5 max-h-60 overflow-y-auto">
        {steps.map((s, i) => (
          <div
            key={s.name}
            className={`flex items-center gap-2.5 px-2 py-1 rounded text-xs ${
              i === activeIndex ? "text-white/90 bg-white/[0.04]" : "text-white/40"
            }`}
          >
            {statusIcon(s.status)}
            <span className="flex-1">{STEP_LABELS[s.name] || s.name}</span>
            {s.detail && (
              <span className="text-white/25 truncate max-w-[140px]" title={s.detail}>
                {s.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
