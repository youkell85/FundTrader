import React, { useState, useCallback } from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { WHATIF_SLIDER_CONFIG } from '@/types/allocation';
import type { WhatIfRequest, WhatIfResponse, AllocationRequest } from '@/types/allocation';
import { runWhatIfSimulation } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';

type SliderKey = keyof typeof WHATIF_SLIDER_CONFIG;

const DELTA_LABELS: Record<string, string> = {
  delta_return: '收益变化',
  delta_volatility: '波动变化',
  delta_sharpe: '夏普变化',
};

export default function WhatIfSimulatorPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WhatIfResponse | null>(null);

  const defaults: Record<SliderKey, number> = {
    amount_multiplier: 1.0,
    return_adjust: 0,
    vol_multiplier: 1.0,
    equity_shift: 0,
    bond_duration_shift: 0,
    alt_shift: 0,
  };

  const [params, setParams] = useState(defaults);

  let storeReq: AllocationRequest | null = null;
  try { storeReq = useAllocationStore().state.config; } catch { /* no store */ }

  const handleSimulate = useCallback(async () => {
    if (!storeReq) { setError('请先生成配置方案'); return; }
    setLoading(true); setError(null);
    try {
      const req: WhatIfRequest = { base_request: storeReq, ...params };
      const resp = await runWhatIfSimulation(req);
      setData(resp);
    } catch (e: any) {
      setError(e.message || '模拟失败');
    } finally {
      setLoading(false);
    }
  }, [params, storeReq]);

  const handleReset = () => {
    setParams(defaults);
    setData(null);
  };

  const updateParam = (key: SliderKey, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5">
      <div className="liquid-glass p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm text-white/70">
            <SlidersHorizontal className="w-4 h-4 inline mr-2" style={{ color: '#FAC858' }} />
            What-If 情景模拟
          </h3>
          <div className="flex gap-2">
            <button onClick={handleReset} className="px-3 py-1.5 text-xs rounded-md bg-white/[0.05] text-white/50 hover:bg-white/[0.1]">
              <RotateCcw className="w-3 h-3 inline mr-1" />重置
            </button>
            <button
              onClick={handleSimulate}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded-md bg-[#3B6CFF]/20 text-[#5AA9FF] hover:bg-[#3B6CFF]/30 disabled:opacity-50"
            >
              {loading ? '模拟中...' : '运行模拟'}
            </button>
          </div>
        </div>

        {error && <div className="text-xs text-[#EE6666] mb-3">{error}</div>}

        {/* Sliders */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {(Object.entries(WHATIF_SLIDER_CONFIG) as [SliderKey, typeof WHATIF_SLIDER_CONFIG[SliderKey]][]).map(([key, cfg]) => (
            <div key={key} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-white/50">{cfg.label}</span>
                <span className="data-number text-white/70">{params[key]}{cfg.unit}</span>
              </div>
              <input
                type="range"
                min={cfg.min}
                max={cfg.max}
                step={cfg.step}
                value={params[key]}
                onChange={(e) => updateParam(key, parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-white/[0.08] accent-[#3B6CFF]"
              />
              <div className="flex justify-between text-[10px] text-white/50">
                <span>{cfg.min}{cfg.unit}</span>
                <span>{cfg.max}{cfg.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Results */}
        {data && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <MetricBox label="预期收益" value={`${data.expected_return.toFixed(2)}%`} color="#16C784" delta={data.delta_return} />
              <MetricBox label="波动率" value={`${data.expected_volatility.toFixed(2)}%`} color="#FAC858" delta={data.delta_volatility} />
              <MetricBox label="夏普比率" value={data.sharpe_ratio.toFixed(2)} color="#5470C6" delta={data.delta_sharpe} />
              <MetricBox label="最大回撤" value={`${data.max_drawdown.toFixed(2)}%`} color="#EE6666" />
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-xs text-white/50 mb-2">调整后配置</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.modified_allocations)
                  .filter(([, v]) => v > 0.5)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <span key={k} className="px-2 py-0.5 rounded text-[10px] bg-white/[0.05] text-white/60">
                      {k}: <span className="data-number">{v.toFixed(1)}%</span>
                    </span>
                  ))}
              </div>
            </div>
          </div>
        )}

        {!data && !loading && (
          <div className="text-sm text-white/40 text-center py-4">调整参数后点击"运行模拟"查看影响</div>
        )}
      </div>
    </div>
  );
}

function MetricBox({ label, value, color, delta }: { label: string; value: string; color: string; delta?: number }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-3">
      <div className="text-white/55 text-xs">{label}</div>
      <div className="data-number mt-1 text-lg font-medium" style={{ color }}>{value}</div>
      {delta !== undefined && delta !== 0 && (
        <div className="text-[10px] data-number mt-0.5" style={{ color: delta > 0 ? '#16C784' : '#EE6666' }}>
          {delta > 0 ? '+' : ''}{delta.toFixed(2)}
        </div>
      )}
    </div>
  );
}
