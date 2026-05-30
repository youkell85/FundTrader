import { useMemo } from 'react';
import { GitCompare, ArrowRight } from 'lucide-react';
import { ASSET_CLASS_LABELS, ASSET_GROUP_LABELS } from '@/types/allocation';
import type { DualEngineResponse } from '@/types/allocation';
import { runDualEngine } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';
import { useMutation } from '@tanstack/react-query';

export default function DualEnginePanel() {
  const storeState = useAllocationStore().state;
  const storeReq = storeState?.config ?? null;

  const mutation = useMutation({
    mutationFn: runDualEngine,
  });

  const handleCompare = () => {
    if (!storeReq) { return; }
    mutation.mutate(storeReq);
  };

  const loading = mutation.isPending;
  const error = mutation.error ? (mutation.error instanceof Error ? mutation.error.message : '对比失败') : null;
  const data = mutation.data as DualEngineResponse | null;

  const deltaColor = useMemo(() => (d: number) => d > 0 ? 'text-red-400' : d < 0 ? 'text-green-400' : 'text-white/40', []);
  const deltaSign = useMemo(() => (d: number) => d > 0 ? '+' : '', []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompare className="w-5 h-5 text-purple-400" />
          <span className="text-lg font-semibold text-white">双引擎对比</span>
          {data && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/30 text-purple-300">
              {data.mode}
            </span>
          )}
        </div>
        <button onClick={handleCompare} disabled={loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-500/30 hover:bg-purple-500/50 text-sm text-white transition disabled:opacity-50">
          {loading ? '运行中...' : '运行对比'}
        </button>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-500/20 text-red-300 text-sm">{error}</div>}

      {!data && !loading && (
        <div className="text-center text-white/40 py-8">
          <p>点击"运行对比"对比 v3 (旧引擎) 和 v4 (新引擎) 的配置差异</p>
          <p className="text-xs mt-1 text-white/50">支持 shadow / canary / full 三种部署模式</p>
        </div>
      )}

      {data && (
        <>
          {/* Assessment */}
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-sm text-white/80 font-medium">{data.comparison.assessment}</div>
            <div className="flex gap-3 mt-2 text-xs text-white/50">
              <span>变化资产: {data.comparison.changed_assets}/{data.comparison.total_assets}</span>
              <span>最大偏移: {data.comparison.max_allocation_delta.toFixed(2)}%</span>
              <span>Regime: {data.comparison.regime_same ? '相同' : '不同'}</span>
              <span>断路器: {data.comparison.breaker_same ? '相同' : '不同'}</span>
              {data.comparison.v4_has_fed_model && <span className="text-blue-300">FED模型已启用</span>}
            </div>
          </div>

          {/* Metrics Comparison */}
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(data.comparison.metrics_diff).map(([key, val]) => (
              <div key={key} className="p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="text-xs text-white/50 mb-1">
                  {key === 'expected_return' ? '预期收益' : key === 'expected_volatility' ? '预期波动' : 'Sharpe'}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-white/50">{val.v3.toFixed(2)}</span>
                  <ArrowRight className="w-3 h-3 text-white/50" />
                  <span className="text-white font-medium">{val.v4.toFixed(2)}</span>
                </div>
                <div className={`text-xs mt-1 ${deltaColor(val.delta)}`}>
                  {deltaSign(val.delta)}{val.delta.toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          {/* Performance */}
          <div className="flex gap-3 text-xs">
            <span className="px-2 py-1 rounded bg-white/5 text-white/60">v3: {data.v3.elapsed_ms.toFixed(0)}ms</span>
            <span className="px-2 py-1 rounded bg-white/5 text-white/60">v4: {data.v4.elapsed_ms.toFixed(0)}ms</span>
            <span className="px-2 py-1 rounded bg-white/5 text-white/60">性能比: {data.comparison.performance_ratio.toFixed(2)}x</span>
          </div>

          {/* Group Diff */}
          <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
            <div className="px-3 py-2 bg-white/5 text-xs text-white/50 border-b border-white/10">分组配置差异</div>
            <div className="divide-y divide-white/5">
              {Object.entries(data.comparison.group_diff).map(([grp, val]) => (
                <div key={grp} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="text-white/80 w-20">{ASSET_GROUP_LABELS[grp] || grp}</span>
                  <span className="text-white/50 text-xs w-14 text-right">{val.v3.toFixed(2)}%</span>
                  <ArrowRight className="w-3 h-3 text-white/50" />
                  <span className="text-white text-xs w-14 text-right">{val.v4.toFixed(2)}%</span>
                  <span className={`text-xs w-14 text-right ${deltaColor(val.delta)}`}>
                    {deltaSign(val.delta)}{val.delta.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Per-Asset Changed */}
          {data.comparison.changed_assets > 0 && (
            <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
              <div className="px-3 py-2 bg-white/5 text-xs text-white/50 border-b border-white/10">
                资产级变化 (仅显示 delta &gt; 0.01)
              </div>
              <div className="divide-y divide-white/5">
                {Object.entries(data.comparison.alloc_diff)
                  .filter(([, v]) => v.changed)
                  .map(([asset, val]) => (
                    <div key={asset} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="text-white/80 w-24 truncate">{ASSET_CLASS_LABELS[asset] || asset}</span>
                      <span className="text-white/50 text-xs w-14 text-right">{val.v3.toFixed(2)}%</span>
                      <ArrowRight className="w-3 h-3 text-white/50" />
                      <span className="text-white text-xs w-14 text-right">{val.v4.toFixed(2)}%</span>
                      <span className={`text-xs w-14 text-right ${deltaColor(val.delta)}`}>
                        {deltaSign(val.delta)}{val.delta.toFixed(2)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
