import { useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
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
      <PageHeader title="模拟器" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      <SectionCard title="快速模拟 (权益+5%)" icon={FlaskConical} iconColor="#FAC858">
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
              <div className="text-white/55 text-[10px]">预期收益</div>
              <div className="data-number text-sm text-[#16C784]">{simData.expected_return.toFixed(2)}%</div>
              {simData.delta_return !== 0 && <div className="text-[10px] data-number" style={{ color: simData.delta_return > 0 ? '#16C784' : '#EE6666' }}>{simData.delta_return > 0 ? '+' : ''}{simData.delta_return.toFixed(2)}</div>}
            </div>
            <div className="surface px-3 py-2">
              <div className="text-white/55 text-[10px]">波动率</div>
              <div className="data-number text-sm text-[#FAC858]">{simData.expected_volatility.toFixed(2)}%</div>
              {simData.delta_volatility !== 0 && <div className="text-[10px] data-number" style={{ color: simData.delta_volatility > 0 ? '#16C784' : '#EE6666' }}>{simData.delta_volatility > 0 ? '+' : ''}{simData.delta_volatility.toFixed(2)}</div>}
            </div>
            <div className="surface px-3 py-2">
              <div className="text-white/55 text-[10px]">夏普比率</div>
              <div className="data-number text-sm text-[#5470C6]">{simData.sharpe_ratio.toFixed(2)}</div>
              {simData.delta_sharpe !== 0 && <div className="text-[10px] data-number" style={{ color: simData.delta_sharpe > 0 ? '#16C784' : '#EE6666' }}>{simData.delta_sharpe > 0 ? '+' : ''}{simData.delta_sharpe.toFixed(2)}</div>}
            </div>
            <div className="surface px-3 py-2">
              <div className="text-white/55 text-[10px]">最大回撤</div>
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
