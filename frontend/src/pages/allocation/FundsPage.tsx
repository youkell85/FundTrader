import { useState, useEffect } from 'react';
import { List, TrendingUp, DollarSign, Loader2, AlertCircle } from 'lucide-react';
import { useAllocationData } from '@/hooks/useAllocationData';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';
import FundRankingPanel from '@/components/allocation/FundRankingPanel';
import FeeAnalysisPanel from '@/components/allocation/FeeAnalysisPanel';
import { getFundRanking } from '@/lib/api';
import type { FundRankingResponse } from '@/types/allocation';
import { useAllocationStore } from '@/store/allocationStore';

export default function FundsPage() {
  const { d, funds, constraints, meta, isReal } = useAllocationData();
  const [rankingData, setRankingData] = useState<FundRankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState<string | null>(null);

  let preferredTags: string[] = [];
  try { preferredTags = useAllocationStore().state.config.preferred_tags; } catch {}

  useEffect(() => {
    if (!isReal) {
      setRankingData(null);
      setRankingError(null);
      return;
    }
    const fetchRankings = async () => {
      setRankingLoading(true);
      setRankingError(null);
      try {
        const res = await getFundRanking(preferredTags);
        setRankingData(res);
      } catch (e: any) {
        setRankingError(e?.message || '获取基金排名失败');
      } finally {
        setRankingLoading(false);
      }
    };
    fetchRankings();
  }, [preferredTags.join(','), isReal]);

  return (
    <div className="space-y-5">
      <PageHeader title="基金研究" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      <SectionCard title={`基金明细 (${funds.length}只)`} icon={List} iconColor="#16C784">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/55 border-b border-white/[0.06]">
                {['代码', '名称', '类型', '权重', '金额', '角色', '入选理由', '评分'].map((h) => (
                  <th key={h} className="text-left py-2 px-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funds.map((f: any) => (
                <tr key={f.code} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="py-2 px-2 data-number text-[#5AA9FF]">{f.code}</td>
                  <td className="py-2 px-2 text-white/70">{f.name}</td>
                  <td className="py-2 px-2 text-white/45">{f.type}</td>
                  <td className="py-2 px-2 data-number text-white/80">{f.weight}%</td>
                  <td className="py-2 px-2 data-number text-white/55">{f.amount.toLocaleString()}</td>
                  <td className="py-2 px-2 text-white/55">{f.role}</td>
                  <td className="py-2 px-2 text-white/40 max-w-[200px] truncate">{f.reason}</td>
                  <td className="py-2 px-2 data-number text-[#FAC858]">{f.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-1">
          {constraints.map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={c.passed ? 'text-[#16C784]' : 'text-[#EE6666]'}>{c.passed ? '✅' : '❌'}</span>
              <span className="text-white/45">
                {c.rule}: {c.value} 限制 {c.limit}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      {!isReal && (
        <div className="liquid-glass p-4 border border-[#3B6CFF]/20 bg-[#3B6CFF]/[0.05] flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-[#5AA9FF]" />
          <p className="text-xs text-white/55">当前为演示数据，排名接口未调用。请先生成真实配置方案以查看基金排名。</p>
        </div>
      )}

      {isReal && rankingLoading && (
        <div className="flex items-center gap-2 text-xs text-white/50 px-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>正在加载基金排名...</span>
        </div>
      )}
      {isReal && rankingError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">
          {rankingError}（使用面板内刷新重试）
        </div>
      )}
      {isReal && rankingData && (
        <SectionCard title={`API 基金排名 (${Object.keys(rankingData.rankings).length} 类)`} icon={TrendingUp} iconColor="#5AA9FF">
          <div className="flex flex-wrap gap-2">
            {Object.entries(rankingData.rankings).map(([cls, items]) => (
              <div key={cls} className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs">
                <span className="text-white/70">{cls}</span>
                <span className="text-white/40 ml-1">({items.length}只)</span>
                {items[0] && <span className="text-[#FAC858] ml-1">Top: {items[0].name}</span>}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <FundRankingPanel />

      <FeeAnalysisPanel />
    </div>
  );
}
