import { useState, useEffect } from 'react';
import { Wrench, Loader2 } from 'lucide-react';
import { useAllocationData } from '@/hooks/useAllocationData';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';
import PipelineHealthPanel from '@/components/allocation/PipelineHealthPanel';
import DualEnginePanel from '@/components/allocation/DualEnginePanel';
import ExplainReportPanel from '@/components/allocation/ExplainReportPanel';
import { getPipelineHealth, runDualEngine } from '@/lib/api';
import type { PipelineHealthResponse, DualEngineResponse, AllocationRequest } from '@/types/allocation';
import { HEALTH_COLORS } from '@/types/allocation';
import { useAllocationStore } from '@/store/allocationStore';

export default function OpsPage() {
  const { meta } = useAllocationData();
  const [healthData, setHealthData] = useState<PipelineHealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [dualData, setDualData] = useState<DualEngineResponse | null>(null);
  const [dualLoading, setDualLoading] = useState(false);
  const [dualError, setDualError] = useState<string | null>(null);

  let storeReq: AllocationRequest | null = null;
  try { storeReq = useAllocationStore().state.config; } catch {}

  useEffect(() => {
    const fetchHealth = async () => {
      setHealthLoading(true);
      setHealthError(null);
      try {
        const res = await getPipelineHealth();
        setHealthData(res);
      } catch (e: any) {
        setHealthError(e?.message || '获取管线健康状态失败');
      } finally {
        setHealthLoading(false);
      }
    };
    fetchHealth();
  }, []);

  const handleDualEngine = async () => {
    if (!storeReq) { setDualError('请先生成配置方案'); return; }
    setDualLoading(true);
    setDualError(null);
    try {
      const res = await runDualEngine(storeReq);
      setDualData(res);
    } catch (e: any) {
      setDualError(e?.message || '双引擎对比失败');
    } finally {
      setDualLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="运维工具" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      <SectionCard title="管线健康概览" icon={Wrench} iconColor="#FAC858">
        {healthLoading && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>正在获取管线健康状态...</span>
          </div>
        )}
        {healthError && (
          <div className="text-xs text-[#EE6666]">{healthError}</div>
        )}
        {healthData && (
          <div className="flex items-center gap-4 flex-wrap text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: HEALTH_COLORS[healthData.health] || '#666' }} />
              <span className="text-white/70">状态:</span>
              <span className="font-medium" style={{ color: HEALTH_COLORS[healthData.health] || '#666' }}>
                {healthData.health === 'healthy' ? '健康' : healthData.health === 'degraded' ? '降级' : healthData.health === 'critical' ? '异常' : '未知'}
              </span>
            </span>
            <span className="text-white/50">Regime: <span className="text-white/80">{healthData.subsystems.regime.confirmed_label}</span></span>
            <span className="text-white/50">断路器: <span className="text-white/80">{healthData.subsystems.circuit_breaker.confirmed_name}</span></span>
            {healthData.history_summary.total_runs > 0 && (
              <span className="text-white/40">运行 {healthData.history_summary.total_runs} 次 · 平均 {healthData.history_summary.avg_total_ms.toFixed(0)}ms</span>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="双引擎快速对比" icon={Wrench} iconColor="#9D7BFF">
        <div className="flex items-center gap-3">
          <button
            onClick={handleDualEngine}
            disabled={dualLoading}
            className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-300 text-xs font-medium hover:bg-purple-500/30 disabled:opacity-50 flex items-center gap-2"
          >
            {dualLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {dualLoading ? '对比中...' : '运行对比'}
          </button>
          {dualError && <span className="text-xs text-[#EE6666]">{dualError}</span>}
        </div>
        {dualData && (
          <div className="mt-3 space-y-2">
            <div className="p-2 surface text-xs text-white/60">
              {dualData.comparison.assessment}
            </div>
            <div className="flex gap-3 text-[10px] text-white/40">
              <span>变化资产: {dualData.comparison.changed_assets}/{dualData.comparison.total_assets}</span>
              <span>最大偏移: {dualData.comparison.max_allocation_delta.toFixed(2)}%</span>
              <span>Regime: {dualData.comparison.regime_same ? '相同' : '不同'}</span>
              <span>性能比: {dualData.comparison.performance_ratio.toFixed(2)}x</span>
            </div>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PipelineHealthPanel />
        <DualEnginePanel />
      </div>

      <ExplainReportPanel />
    </div>
  );
}
