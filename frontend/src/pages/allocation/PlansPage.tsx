import { useState, useEffect } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { useAllocationData } from '@/hooks/useAllocationData';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';
import PlanManager from '@/components/allocation/PlanManager';
import VariantsComparisonPanel from '@/components/allocation/VariantsComparisonPanel';
import { generateVariants, listPlans } from '@/lib/api';
import type { VariantsResponse, PlanListResponse, AllocationRequest } from '@/types/allocation';
import { VARIANT_LABELS, VARIANT_COLORS, RISK_LABELS } from '@/types/allocation';
import { useAllocationStore } from '@/store/allocationStore';

export default function PlansPage() {
  const { meta } = useAllocationData();
  const [variantsData, setVariantsData] = useState<VariantsResponse | null>(null);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState<string | null>(null);
  const [plansData, setPlansData] = useState<PlanListResponse | null>(null);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);

  let storeReq: AllocationRequest | null = null;
  try { storeReq = useAllocationStore().state.config; } catch {}

  useEffect(() => {
    const fetchPlans = async () => {
      setPlansLoading(true);
      setPlansError(null);
      try {
        const res = await listPlans({ limit: 10 });
        setPlansData(res);
      } catch (e: any) {
        setPlansError(e?.message || '获取方案列表失败');
      } finally {
        setPlansLoading(false);
      }
    };
    fetchPlans();
  }, []);

  const handleGenerateVariants = async () => {
    if (!storeReq) { setVariantsError('请先生成配置方案'); return; }
    setVariantsLoading(true);
    setVariantsError(null);
    try {
      const res = await generateVariants(storeReq);
      setVariantsData(res);
    } catch (e: any) {
      setVariantsError(e?.message || '生成方案变体失败');
    } finally {
      setVariantsLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="方案管理" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      <SectionCard title="已保存方案" icon={FolderOpen} iconColor="#5470C6">
        {plansLoading && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>正在加载方案列表...</span>
          </div>
        )}
        {plansError && (
          <div className="text-xs text-[#EE6666]">{plansError}</div>
        )}
        {plansData && (
          <div className="text-xs text-white/50">
            共 <span className="text-white/80 font-medium">{plansData.total}</span> 个已保存方案
            {plansData.plans.length > 0 && (
              <span className="ml-2">
                最近: {plansData.plans[0].name} ({plansData.plans[0].created_at.slice(0, 10)})
              </span>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="快速生成三方案" icon={FolderOpen} iconColor="#9D7BFF">
        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerateVariants}
            disabled={variantsLoading}
            className="px-4 py-2 rounded-lg bg-[#9D7BFF]/20 text-[#9D7BFF] text-xs font-medium hover:bg-[#9D7BFF]/30 disabled:opacity-50 flex items-center gap-2"
          >
            {variantsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {variantsLoading ? '生成中...' : '生成防御/均衡/进取三方案'}
          </button>
          {variantsError && <span className="text-xs text-[#EE6666]">{variantsError}</span>}
        </div>
        {variantsData && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            {(['defensive', 'balanced', 'growth'] as const).map((vk) => {
              const v = variantsData.variants[vk];
              if (!v) return null;
              return (
                <div key={vk} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: VARIANT_COLORS[vk] }} />
                    <span className="text-xs text-white/80 font-medium">{VARIANT_LABELS[vk]}</span>
                    <span className="text-[10px] text-white/40 ml-auto">{RISK_LABELS[v.risk_tolerance]}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                    <div><span className="text-white/50">收益</span> <span className="data-number text-[#16C784]">{v.response.portfolio_metrics.expected_return}%</span></div>
                    <div><span className="text-white/50">波动</span> <span className="data-number text-[#FAC858]">{v.response.portfolio_metrics.volatility}%</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <div className="max-w-2xl mx-auto">
        <PlanManager />
      </div>

      <VariantsComparisonPanel />
    </div>
  );
}
