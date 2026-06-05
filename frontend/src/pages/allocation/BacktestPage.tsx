import { useState } from 'react';
import { TrendingUp, Loader2, AlertCircle } from 'lucide-react';
import { useAllocationData } from '@/hooks/useAllocationData';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';
import BacktestPanel from '@/components/backtest/BacktestPanel';
import RebalancePanel from '@/components/allocation/RebalancePanel';
import { runAllocationBacktest } from '@/lib/api';
import type { BacktestRequest, BacktestResponse } from '@/types/backtest';

export default function BacktestPage() {
  const { meta, d, isReal } = useAllocationData();
  const [backtestResult, setBacktestResult] = useState<BacktestResponse | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  const handleQuickBacktest = async () => {
    if (!isReal) {
      setBacktestError('当前为演示数据，请先生成真实配置方案');
      return;
    }
    const riskProfile = d?.user_profile?.risk_tolerance;
    if (!riskProfile) {
      setBacktestError('请先生成配置方案');
      return;
    }
    setBacktestLoading(true);
    setBacktestError(null);
    try {
      const req: BacktestRequest = {
        risk_profile: riskProfile,
        start_date: '2020-01-01',
        end_date: new Date().toISOString().slice(0, 10),
        initial_amount: d?.user_profile?.amount || 500000,
        rebalance_frequency: 'monthly',
        comparison_modes: ['saa_only', 'saa_taa'],
      };
      const res = await runAllocationBacktest(req);
      setBacktestResult(res);
    } catch (e: any) {
      setBacktestError(e?.message || '回测失败');
    } finally {
      setBacktestLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="回测中心" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      <SectionCard title="资产配置策略回测 (SAA/TAA)" icon={TrendingUp} iconColor="#16C784">
        {!isReal && (
          <div className="flex items-center gap-3 mb-3 p-3 rounded-lg border border-[#3B6CFF]/20 bg-[#3B6CFF]/[0.05]">
            <AlertCircle className="w-4 h-4 text-[#5AA9FF]" />
            <p className="text-xs text-white/55">当前为演示数据，策略回测不可用。请先生成真实配置方案。</p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={handleQuickBacktest}
            disabled={backtestLoading || !isReal}
            className="px-4 py-2 rounded-lg bg-[#16C784]/20 text-[#16C784] text-xs font-medium hover:bg-[#16C784]/30 disabled:opacity-50 flex items-center gap-2"
          >
            {backtestLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {backtestLoading ? '回测中...' : '运行快速回测'}
          </button>
          {backtestError && <span className="text-xs text-[#EE6666]">{backtestError}</span>}
        </div>
        {backtestResult && backtestResult.metrics && (
          <div className="mt-3 space-y-2">
            {Object.entries(backtestResult.metrics).map(([mode, m]) => (
              <div key={mode} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
                <div className="text-xs text-white/60 font-medium mb-2">{mode === 'saa_only' ? '纯SAA' : mode === 'saa_taa' ? 'SAA+TAA' : mode}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div><span className="text-white/50 text-[10px]">年化收益</span><div className="data-number text-sm text-[#16C784]">{m.annualized_return.toFixed(2)}%</div></div>
                  <div><span className="text-white/50 text-[10px]">年化波动</span><div className="data-number text-sm text-[#FAC858]">{m.annualized_volatility.toFixed(2)}%</div></div>
                  <div><span className="text-white/50 text-[10px]">夏普比率</span><div className="data-number text-sm text-[#5470C6]">{m.sharpe_ratio.toFixed(2)}</div></div>
                  <div><span className="text-white/50 text-[10px]">最大回撤</span><div className="data-number text-sm text-[#EE6666]">{m.max_drawdown.toFixed(2)}%</div></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <BacktestPanel />

      <RebalancePanel />
    </div>
  );
}
