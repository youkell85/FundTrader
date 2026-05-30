import React, { useState } from 'react';
import { Network, AlertCircle, CheckCircle2 } from 'lucide-react';
import { ASSET_CLASS_LABELS } from '@/types/allocation';
import type { CorrelationCheckResponse, AllocationRequest } from '@/types/allocation';
import { checkCorrelation } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';

export default function CorrelationMatrixPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CorrelationCheckResponse | null>(null);

  let storeOutput: any = null;
  try { storeOutput = useAllocationStore().state.output; } catch { /* no store */ }

  const handleCheck = async () => {
    if (!storeOutput?.saa?.allocations) { setError('请先生成配置方案'); return; }
    setLoading(true); setError(null);
    try {
      // Convert from percentage to fraction for API
      const allocations: Record<string, number> = {};
      for (const [k, v] of Object.entries(storeOutput.saa.allocations)) {
        allocations[k] = (v as number) / 100;
      }
      const resp = await checkCorrelation({ allocations, threshold: 0.85 });
      setData(resp);
    } catch (e: any) {
      setError(e.message || '检查失败');
    } finally {
      setLoading(false);
    }
  };

  // Get unique assets from matrix for rendering
  const matrixAssets = data ? Object.keys(data.correlation_matrix) : [];

  return (
    <div className="space-y-5">
      <div className="liquid-glass p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm text-white/70">
            <Network className="w-4 h-4 inline mr-2" style={{ color: '#73C0DE' }} />
            相关性约束检查
          </h3>
          <button
            onClick={handleCheck}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded-md bg-[#3B6CFF]/20 text-[#5AA9FF] hover:bg-[#3B6CFF]/30 disabled:opacity-50"
          >
            {loading ? '检查中...' : '运行检查'}
          </button>
        </div>

        {error && <div className="text-xs text-[#EE6666] mb-3">{error}</div>}

        {!data && !loading && (
          <div className="text-sm text-white/40 text-center py-8">点击"运行检查"分析资产间相关性约束</div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Pass/Fail status */}
            <div className={`flex items-center gap-2 p-3 rounded-lg border ${data.passed ? 'bg-[#16C784]/[0.06] border-[#16C784]/15' : 'bg-[#EE6666]/[0.06] border-[#EE6666]/15'}`}>
              {data.passed ? (
                <CheckCircle2 className="w-4 h-4 text-[#16C784]" />
              ) : (
                <AlertCircle className="w-4 h-4 text-[#EE6666]" />
              )}
              <span className="text-xs" style={{ color: data.passed ? '#16C784' : '#EE6666' }}>
                {data.passed ? '通过' : '未通过'} — 最大相关性: {data.max_correlation.toFixed(2)}
                {data.max_pair.length === 2 && ` (${(ASSET_CLASS_LABELS[data.max_pair[0]] || data.max_pair[0])} / ${(ASSET_CLASS_LABELS[data.max_pair[1]] || data.max_pair[1])})`}
                {' '}(阈值: {data.threshold})
              </span>
            </div>

            {/* Violations */}
            {data.violations.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-white/50">超阈值资产对:</div>
                {data.violations.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-[#EE6666]">
                    <span>{ASSET_CLASS_LABELS[v.asset_a] || v.asset_a}</span>
                    <span className="text-white/40">↔</span>
                    <span>{ASSET_CLASS_LABELS[v.asset_b] || v.asset_b}</span>
                    <span className="data-number">{v.correlation.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Correlation heatmap */}
            <div className="overflow-x-auto">
              <div className="text-xs text-white/50 mb-2">相关系数矩阵</div>
              <table className="text-[10px]">
                <thead>
                  <tr>
                    <th className="px-1 py-0.5" />
                    {matrixAssets.map((a) => (
                      <th key={a} className="px-1 py-0.5 text-white/40 font-normal writing-mode-vertical whitespace-nowrap" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', maxHeight: 60 }}>
                        {ASSET_CLASS_LABELS[a] || a}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixAssets.map((row) => (
                    <tr key={row}>
                      <td className="px-1 py-0.5 text-white/40 whitespace-nowrap">{ASSET_CLASS_LABELS[row] || row}</td>
                      {matrixAssets.map((col) => {
                        const val = data.correlation_matrix[row]?.[col] ?? 0;
                        const abs = Math.abs(val);
                        const bg = val >= 0.85 ? 'rgba(238,102,102,0.3)' : abs > 0.6 ? 'rgba(250,200,88,0.15)' : 'rgba(255,255,255,0.03)';
                        return (
                          <td key={col} className="px-1 py-0.5 text-center data-number" style={{ backgroundColor: bg, color: abs > 0.7 ? '#EE6666' : 'rgba(255,255,255,0.5)' }}>
                            {row === col ? '1.00' : val.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Suggestions */}
            {data.suggestions.length > 0 && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
                <div className="text-xs text-white/50 mb-2">分散化建议:</div>
                {data.suggestions.map((s, i) => (
                  <div key={i} className="text-xs text-white/40 flex items-start gap-1.5">
                    <span className="text-white/40">-</span><span>{s}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
