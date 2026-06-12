import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AlertTriangle, TrendingUp, Loader2 } from 'lucide-react';
import { useAllocationData } from '@/hooks/useAllocationData';
import PageHeader from '@/components/ui/PageHeader';
import MetricCard from '@/components/ui/MetricCard';
import SectionCard from '@/components/ui/SectionCard';
import CorrelationMatrixPanel from '@/components/allocation/CorrelationMatrixPanel';
import { checkCorrelation, analyzeFees } from '@/lib/api';
import type { CorrelationCheckResponse, FeeAnalysisResponse } from '@/types/allocation';
import { ASSET_CLASS_LABELS } from '@/types/allocation';

export default function RiskPage() {
  const { d, mc, st, meta } = useAllocationData();
  const [corrData, setCorrData] = useState<CorrelationCheckResponse | null>(null);
  const [corrLoading, setCorrLoading] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);
  const [feeData, setFeeData] = useState<FeeAnalysisResponse | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);

  const handleCheckCorrelation = async () => {
    const allocations = d?.saa?.allocations;
    if (!allocations || Object.keys(allocations).length === 0) {
      setCorrError('请先生成配置方案');
      return;
    }
    setCorrLoading(true);
    setCorrError(null);
    try {
      const normalized = Object.fromEntries(
        Object.entries(allocations).map(([k, v]) => [k, (v as number) / 100])
      );
      const res = await checkCorrelation({ allocations: normalized, threshold: 0.85 });
      setCorrData(res);
    } catch (e: any) {
      setCorrError(e?.message || '相关性检查失败');
    } finally {
      setCorrLoading(false);
    }
  };

  const handleAnalyzeFees = async () => {
    const funds = d?.funds;
    if (!funds || funds.length === 0) {
      setFeeError('请先生成配置方案');
      return;
    }
    setFeeLoading(true);
    setFeeError(null);
    try {
      const res = await analyzeFees({ funds, asset_class: 'all' });
      setFeeData(res);
    } catch (e: any) {
      setFeeError(e?.message || '费率分析失败');
    } finally {
      setFeeLoading(false);
    }
  };

  const stressData = [...st].sort((a, b) => a.impact - b.impact);
  const worst = [...st].sort((a, b) => a.impact - b.impact)[0];

  return (
    <div className="space-y-5">
      <PageHeader title="风险管理" regime={meta.regime} regimeLabel={meta.regime_label} generatedAt={meta.generated_at} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="中位收益" value={`${mc?.median_return}%`} color="#16C784" />
        <MetricCard label="P10-P90区间" value={`${mc?.percentile_10}% ~ ${mc?.percentile_90}%`} color="#FAC858" />
        <MetricCard label="VaR(95%)" value={`${mc?.var_95}%`} color="#EE6666" />
        <MetricCard label="正收益概率" value={`${mc?.prob_positive}%`} color="#91CC75" />
        <MetricCard label="P25" value={`${mc?.percentile_25}%`} color="#5470C6" />
        <MetricCard label="P75" value={`${mc?.percentile_75}%`} color="#5470C6" />
        <MetricCard label="CVaR(95%)" value={`${mc?.cvar_95}%`} color="#EE6666" />
        <MetricCard label="最大回撤(P95)" value={`${mc?.max_drawdown_95}%`} color="#FF6B35" />
      </div>

      <SectionCard title="压力测试 (6历史情景)" icon={AlertTriangle} iconColor="#EE6666">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={stressData} layout="vertical" margin={{ left: 80, right: 40 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} unit="%" />
            <YAxis
              type="category"
              dataKey="scenario"
              tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 12 }}
              width={80}
            />
            <Tooltip formatter={(v: number) => [`${v}%`, '组合影响']} />
            <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
              {stressData.map((s, i) => (
                <Cell key={i} fill={s.impact < 0 ? '#16C784' : '#F5384B'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 p-3 surface text-xs text-white/45">
          最坏情景: {worst?.scenario} ({worst?.impact}%, 预计损失 {worst?.max_loss.toLocaleString()}元)
        </div>
      </SectionCard>

      <SectionCard title="相关性快速检查" icon={AlertTriangle} iconColor="#73C0DE">
        <div className="flex items-center gap-3">
          <button
            onClick={handleCheckCorrelation}
            disabled={corrLoading}
            className="px-4 py-2 rounded-lg bg-[#73C0DE]/20 text-[#73C0DE] text-xs font-medium hover:bg-[#73C0DE]/30 disabled:opacity-50 flex items-center gap-2"
          >
            {corrLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {corrLoading ? '检查中...' : '运行相关性检查'}
          </button>
          {corrError && <span className="text-xs text-[#EE6666]">{corrError}</span>}
        </div>
        {corrData && (
          <div className="mt-3 space-y-2">
            <div className={`flex items-center gap-2 text-xs ${corrData.passed ? 'text-[#16C784]' : 'text-[#EE6666]'}`}>
              <span>{corrData.passed ? '✅ 通过' : '❌ 未通过'}</span>
              <span className="text-white/50">最大相关性: {corrData.max_correlation.toFixed(2)} (阈值: {corrData.threshold})</span>
              {corrData.max_pair.length === 2 && (
                <span className="text-white/40">
                  ({ASSET_CLASS_LABELS[corrData.max_pair[0]] || corrData.max_pair[0]} / {ASSET_CLASS_LABELS[corrData.max_pair[1]] || corrData.max_pair[1]})
                </span>
              )}
            </div>
            {corrData.violations.length > 0 && (
              <div className="text-[10px] text-[#EE6666]">
                超阈值资产对: {corrData.violations.map((v) => `${ASSET_CLASS_LABELS[v.asset_a] || v.asset_a}↔${ASSET_CLASS_LABELS[v.asset_b] || v.asset_b}(${v.correlation.toFixed(2)})`).join('、')}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="费率快速分析" icon={TrendingUp} iconColor="#F59E0B">
        <div className="flex items-center gap-3">
          <button
            onClick={handleAnalyzeFees}
            disabled={feeLoading}
            className="px-4 py-2 rounded-lg bg-[#F59E0B]/20 text-[#F59E0B] text-xs font-medium hover:bg-[#F59E0B]/30 disabled:opacity-50 flex items-center gap-2"
          >
            {feeLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {feeLoading ? '分析中...' : '运行费率分析'}
          </button>
          {feeError && <span className="text-xs text-[#EE6666]">{feeError}</span>}
        </div>
        {feeData && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-white/50">{feeData.recommendation}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
              {feeData.analyses.slice(0, 8).map((a) => (
                <div key={a.fund_code} className="rounded border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
                  <div className="text-[10px] text-white/60 truncate">{a.fund_name}</div>
                  <div className="flex items-center gap-1">
                    <span className="data-number text-[10px]" style={{ color: a.fee_efficiency_score >= 80 ? '#16C784' : a.fee_efficiency_score >= 60 ? '#FAC858' : '#EE6666' }}>
                      {a.fee_efficiency_score.toFixed(0)}分
                    </span>
                    <span className="text-[10px] text-white/40">TER {a.total_expense_ratio.toFixed(2)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      <CorrelationMatrixPanel />
    </div>
  );
}
