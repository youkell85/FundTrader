import { useState } from 'react';
import { FlaskConical, Loader2, Info } from 'lucide-react';
import { useAllocationData } from '@/hooks/useAllocationData';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';
import WhatIfSimulatorPanel from '@/components/allocation/WhatIfSimulatorPanel';
import ShareSelectorPanel from '@/components/allocation/ShareSelectorPanel';
import { runWhatIfSimulation } from '@/lib/api';
import type { WhatIfRequest, WhatIfResponse, AllocationRequest } from '@/types/allocation';
import { useAllocationStore } from '@/store/allocationStore';

export default function SimulatorPage() {
  const { meta } = useAllocationData();
  const [simData, setSimData] = useState<WhatIfResponse | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  let storeReq: AllocationRequest | null = null;
  try { storeReq = useAllocationStore().state.config; } catch {}

  const handleQuickSim = async () => {
    if (!storeReq) { setSimError('请先生成配置方案'); return; }
    setSimLoading(true);
    setSimError(null);
    try {
      const req: WhatIfRequest = {
        base_request: storeReq,
        amount_multiplier: 1.0,
        return_adjust: 0,
        vol_multiplier: 1.0,
        equity_shift: 5,
        bond_duration_shift: 0,
        alt_shift: 0,
      };
      const resp = await runWhatIfSimulation(req);
      setSimData(resp);
    } catch (e: any) {
      setSimError(e?.message || '模拟失败');
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="方案模拟实验室" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      {/* Page purpose explanation */}
      <section className="surface p-4 border border-[#3B6CFF]/15 bg-[#3B6CFF]/[0.05]">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-[#5AA9FF] shrink-0 mt-0.5" />
          <div className="text-xs text-white/60 leading-relaxed space-y-1.5">
            <p className="text-white/75 font-medium">在不改变实际配置的前提下，预览不同假设对组合表现的影响</p>
            <p>本页提供三种模拟工具：</p>
            <ul className="list-disc pl-4 space-y-1">
              <li><span className="text-[#5AA9FF]">快速模拟</span> — 一键预览"权益仓位+5%"后的收益、波动、夏普变化</li>
              <li><span className="text-[#FAC858]">情景模拟</span> — 通过滑块调节投资金额、收益预期、波动率、权益/债券/另类仓位偏移，实时对比调整前后配置差异</li>
              <li><span className="text-[#FAC858]">A/C 份额选择</span> — 根据计划持有期限，智能推荐每只基金应购买 A 类还是 C 类份额，并计算费率节省</li>
            </ul>
            <p className="text-white/40">所有模拟基于当前已生成的真实配置方案。调整参数仅影响模拟结果，不会修改实际配置。</p>
          </div>
        </div>
      </section>

      <SectionCard title="快速模拟（权益+5%）" icon={FlaskConical} iconColor="#FAC858">
        <div className="flex items-center gap-3 mb-2">
          <p className="text-xs text-white/45">
            假设将权益类资产仓位上调 5%，观察组合预期收益与风险的变化。适合评估"更激进一点"的潜在效果。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleQuickSim}
            disabled={simLoading}
            className="px-4 py-2 rounded-lg bg-[#3B6CFF]/20 text-[#5AA9FF] text-xs font-medium hover:bg-[#3B6CFF]/30 disabled:opacity-50 flex items-center gap-2"
          >
            {simLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {simLoading ? '模拟中...' : '运行快速模拟'}
          </button>
          {simError && <span className="text-xs text-[#EE6666]">{simError}</span>}
        </div>
        {simData && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="surface px-3 py-2">
              <div className="text-white/55 text-[10px]">调整后预期收益</div>
              <div className="data-number text-sm text-[#16C784]">{simData.expected_return.toFixed(2)}%</div>
              {simData.delta_return !== 0 && <div className="text-[10px] data-number" style={{ color: simData.delta_return > 0 ? '#16C784' : '#EE6666' }}>{simData.delta_return > 0 ? '+' : ''}{simData.delta_return.toFixed(2)}</div>}
            </div>
            <div className="surface px-3 py-2">
              <div className="text-white/55 text-[10px]">调整后波动率</div>
              <div className="data-number text-sm text-[#FAC858]">{simData.expected_volatility.toFixed(2)}%</div>
              {simData.delta_volatility !== 0 && <div className="text-[10px] data-number" style={{ color: simData.delta_volatility > 0 ? '#16C784' : '#EE6666' }}>{simData.delta_volatility > 0 ? '+' : ''}{simData.delta_volatility.toFixed(2)}</div>}
            </div>
            <div className="surface px-3 py-2">
              <div className="text-white/55 text-[10px]">调整后夏普</div>
              <div className="data-number text-sm text-[#5470C6]">{simData.sharpe_ratio.toFixed(2)}</div>
              {simData.delta_sharpe !== 0 && <div className="text-[10px] data-number" style={{ color: simData.delta_sharpe > 0 ? '#16C784' : '#EE6666' }}>{simData.delta_sharpe > 0 ? '+' : ''}{simData.delta_sharpe.toFixed(2)}</div>}
            </div>
            <div className="surface px-3 py-2">
              <div className="text-white/55 text-[10px]">调整后最大回撤</div>
              <div className="data-number text-sm text-[#EE6666]">{simData.max_drawdown.toFixed(2)}%</div>
            </div>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <WhatIfSimulatorPanel />
        <ShareSelectorPanel />
      </div>
    </div>
  );
}
