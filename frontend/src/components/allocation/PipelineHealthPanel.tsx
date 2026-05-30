import { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { STEP_LABELS, HEALTH_COLORS } from '@/types/allocation';
import type { PipelineHealthResponse } from '@/types/allocation';
import { getPipelineHealth } from '@/lib/api';

const STATUS_ICON = {
  ok: <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  degraded: <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />,
  error: <XCircle className="w-3.5 h-3.5 text-red-400" />,
};

export default function PipelineHealthPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PipelineHealthResponse | null>(null);

  const handleRefresh = async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const resp = await getPipelineHealth(signal);
      setData(resp);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e.message || '获取失败');
      }
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const ac = new AbortController();
    handleRefresh(ac.signal);
    return () => ac.abort();
  }, []);

  const healthColor = data ? HEALTH_COLORS[data.health] || '#666' : '#666';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white/70">管线健康</span>
          {data && (
            <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: healthColor + '30', color: healthColor }}>
              {data.health === 'healthy' ? '健康' : data.health === 'degraded' ? '降级' : data.health === 'critical' ? '异常' : '未知'}
            </span>
          )}
        </div>
        <button onClick={handleRefresh} disabled={loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-white/80 transition disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-500/20 text-red-300 text-sm">{error}</div>}

      {loading && !data && <div className="text-center text-white/50 py-8">加载中...</div>}

      {data && (
        <>
          {/* Subsystem Status */}
          <div className="flex items-center gap-6 flex-wrap text-sm">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${data.subsystems.regime.is_stable ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
              <span className="text-white/50">Regime</span>
              <span className="text-white font-medium">{data.subsystems.regime.confirmed_label}</span>
              {!data.subsystems.regime.is_stable && (
                <span className="text-yellow-300 text-xs">→ {data.subsystems.regime.pending_label} ({data.subsystems.regime.pending_count}/2)</span>
              )}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${data.subsystems.circuit_breaker.confirmed_level === 0 ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-white/50">断路器</span>
              <span className="text-white font-medium">{data.subsystems.circuit_breaker.confirmed_name}</span>
              {data.subsystems.circuit_breaker.reduction_pct > 0 && (
                <span className="text-red-300 text-xs">(-{data.subsystems.circuit_breaker.reduction_pct}%)</span>
              )}
              {!data.subsystems.circuit_breaker.is_stable && (
                <span className="text-yellow-300 text-xs">→ {data.subsystems.circuit_breaker.pending_name} ({data.subsystems.circuit_breaker.downgrade_confirm_count}/2)</span>
              )}
            </span>
          </div>

          {/* History Summary */}
          {data.history_summary.total_runs > 0 && (
            <div className="text-xs text-white/40">
              运行 {data.history_summary.total_runs} 次 · 健康 {data.history_summary.healthy} · 降级 {data.history_summary.degraded} · 异常 {data.history_summary.critical} · 平均 {data.history_summary.avg_total_ms.toFixed(0)}ms
            </div>
          )}

          {/* Per-step Diagnostics */}
          {data.last_run && (
            <div className="overflow-hidden">
              <div className="py-2 text-xs text-white/40">
                最近运行: {data.last_run.total_ms.toFixed(1)}ms · {data.last_run.steps.length} 步
              </div>
              <div className="divide-y divide-white/5">
                {data.last_run.steps.map((s) => (
                  <div key={s.step} className="flex items-center gap-2 px-3 py-2 text-sm">
                    {STATUS_ICON[s.status]}
                    <span className="text-white/80 w-28 truncate">{STEP_LABELS[s.step] || s.step}</span>
                    <span className="text-white/40 text-xs flex-1">{s.elapsed_ms.toFixed(2)}ms</span>
                    {s.detail && <span className="text-xs text-white/40 truncate max-w-32">{s.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {data.last_run && data.last_run.warnings.length > 0 && (
            <div className="py-2">
              <div className="text-xs text-yellow-300/70 mb-1">警告</div>
              {data.last_run.warnings.map((w, i) => (
                <div key={i} className="text-xs text-white/40">• {w}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
