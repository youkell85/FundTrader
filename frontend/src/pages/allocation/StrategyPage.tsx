import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } from 'recharts';
import { Target, TrendingUp, Zap, Shield } from 'lucide-react';
import { ASSET_CLASS_LABELS, SIGNAL_COLORS } from '@/types/allocation';
import { useAllocationData } from '@/hooks/useAllocationData';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';

export default function StrategyPage() {
  const { d, saa, taa, meta } = useAllocationData();

  const radarData = Object.entries(taa.category_summary).map(([k, v]: [string, any]) => ({
    category: v.name,
    score: v.avg_score,
    fullMark: 1,
  }));

  return (
    <div className="space-y-5">
      <PageHeader title="策略配置" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SectionCard title="SAA 战略资产配置" icon={Target} iconColor="#EE6666">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/55 border-b border-white/[0.06]">
                  {['资产', '权重', '预期收益', '波动率', '风险贡献'].map((h) => (
                    <th key={h} className="text-left py-2 px-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(saa.allocations)
                  .filter(([, w]) => w > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, w]) => (
                    <tr key={k} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="py-2 px-2 text-white/70">{(ASSET_CLASS_LABELS as any)[k] || k}</td>
                      <td className="py-2 px-2 data-number text-white/80">{w.toFixed(1)}%</td>
                      <td className="py-2 px-2 data-number text-white/45">{(w * 0.085).toFixed(1)}%</td>
                      <td className="py-2 px-2 data-number text-white/45">
                        {(
                          {
                            a_share_large: 22, a_share_growth: 30, a_share_value: 20, a_share_small: 28,
                            hk_equity: 24, us_equity: 18, rate_bond: 4, credit_bond: 5, convertible: 15,
                            money_fund: 0.3, gold: 15, commodity: 20, reits: 12, cash: 0.1,
                          } as any
                        )[k] || 10}
                        %
                      </td>
                      <td className="py-2 px-2 data-number text-[#FAC858]">
                        {(saa.risk_contributions[k] || 0).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white/45">
            分组: 权益{saa.group_allocations.equity?.toFixed(1)}% | 固收
            {saa.group_allocations.fixed_income?.toFixed(1)}% | 另类
            {saa.group_allocations.alternative?.toFixed(1)}% | 现金
            {saa.group_allocations.cash_equiv?.toFixed(1)}% {saa.glide_path_applied && '下滑曲线已应用'}
          </div>
        </SectionCard>

        <SectionCard title="TAA 战术资产配置" icon={TrendingUp} iconColor="#9D7BFF">
          <div className="space-y-2">
            {Object.entries(taa.category_summary).map(([k, v]: [string, any]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-16 text-xs text-white/50">{v.name}</span>
                <div className="flex-1 h-2 rounded-full bg-white/[0.04]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.abs(v.avg_score) * 100}%`,
                      backgroundColor: (SIGNAL_COLORS as any)[k] || '#5470C6',
                    }}
                  />
                </div>
                <span className="text-xs w-12 text-right text-white/70">{v.interpretation}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-[#3B6CFF]/[0.06] border border-[#3B6CFF]/15">
            <div className="text-xs text-white/55">
              综合评分:{' '}
              <span className="text-[#5AA9FF] data-number text-sm">{taa.composite_score.toFixed(2)}</span>{' '}
              → 权益调整{' '}
              <span
                className="data-number text-sm"
                style={{ color: taa.equity_adjustment > 0 ? '#16C784' : '#EE6666' }}
              >
                {taa.equity_adjustment > 0 ? '+' : ''}
                {taa.equity_adjustment}%
              </span>
            </div>
          </div>
          {taa.fed_value != null && (
            <div className="mt-3 p-3 rounded-lg bg-[#5AA9FF]/[0.06] border border-[#5AA9FF]/15">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[#5AA9FF] text-xs font-medium">FED 模型</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#5AA9FF]/10 text-[#5AA9FF]">连续模型</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="data-number text-xl font-semibold text-[#5AA9FF]">{taa.fed_value}</span>
                <span className="text-xs text-white/45">{taa.fed_interpretation}</span>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SectionCard title="宏观因子雷达图" icon={Zap} iconColor="#FAC858">
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.08)" />
              <PolarAngleAxis dataKey="category" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
              <Radar name="信号评分" dataKey="score" stroke="#3B6CFF" fill="#3B6CFF" fillOpacity={0.15} />
            </RadarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="美林时钟" icon={Shield} iconColor="#16C784">
          <div className="text-sm text-white/60">
            当前阶段:{' '}
            <span className="text-[#16C784] font-medium">{taa.business_cycle.phase_name}</span>{' '}
            → 风格:{' '}
            <span className="text-[#5AA9FF]">
              {taa.business_cycle.preferred_style === 'growth'
                ? '成长'
                : taa.business_cycle.preferred_style === 'value'
                  ? '价值'
                  : '均衡'}
            </span>{' '}
            → 行业: {taa.business_cycle.preferred_industries.join(', ')} → 久期:{' '}
            {taa.business_cycle.bond_duration}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
