import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { GitCompareArrows } from 'lucide-react';
import { VARIANT_LABELS, VARIANT_COLORS, RISK_LABELS } from '@/types/allocation';
import type { VariantsResponse, AllocationRequest } from '@/types/allocation';
import { generateVariants } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';

const METRIC_LABELS: Record<string, string> = {
  expected_return: '预期年化',
  volatility: '波动率',
  sharpe_ratio: '夏普比率',
  max_drawdown: '最大回撤',
  equity_ratio: '权益占比',
};

export default function VariantsComparisonPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<VariantsResponse | null>(null);

  let storeReq: AllocationRequest | null = null;
  try { storeReq = useAllocationStore().state.config; } catch { /* no store */ }

  const handleGenerate = async () => {
    if (!storeReq) { setError('请先生成配置方案'); return; }
    setLoading(true); setError(null);
    try {
      const resp = await generateVariants(storeReq);
      setData(resp);
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const variantKeys = ['defensive', 'balanced', 'growth'] as const;

  const chartData = data
    ? Object.entries(METRIC_LABELS).map(([key, label]) => ({
        metric: label,
        defensive: data.comparison[key as keyof typeof data.comparison]?.defensive ?? 0,
        balanced: data.comparison[key as keyof typeof data.comparison]?.balanced ?? 0,
        growth: data.comparison[key as keyof typeof data.comparison]?.growth ?? 0,
      }))
    : [];

  return (
    <div className="space-y-5">
      <div className="liquid-glass p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm text-white/70">
            <GitCompareArrows className="w-4 h-4 inline mr-2" style={{ color: '#9D7BFF' }} />
            三方案对比
          </h3>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded-md bg-[#3B6CFF]/20 text-[#5AA9FF] hover:bg-[#3B6CFF]/30 disabled:opacity-50"
          >
            {loading ? '生成中...' : '生成三方案'}
          </button>
        </div>

        {error && <div className="text-xs text-[#EE6666] mb-3">{error}</div>}

        {!data && !loading && (
          <div className="text-sm text-white/40 text-center py-8">点击"生成三方案"查看防御/均衡/进取三种配置对比</div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Variant cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {variantKeys.map((vk) => {
                const v = data.variants[vk];
                if (!v) return null;
                const color = VARIANT_COLORS[vk];
                return (
                  <div key={vk} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-sm text-white/80 font-medium">{VARIANT_LABELS[vk]}</span>
                      <span className="text-xs text-white/40 ml-auto">{RISK_LABELS[v.risk_tolerance]}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-white/55">预期收益</span><div className="data-number text-[#16C784]">{v.response.portfolio_metrics.expected_return}%</div></div>
                      <div><span className="text-white/55">波动率</span><div className="data-number text-[#FAC858]">{v.response.portfolio_metrics.volatility}%</div></div>
                      <div><span className="text-white/55">夏普</span><div className="data-number text-[#5470C6]">{v.response.portfolio_metrics.sharpe}</div></div>
                      <div><span className="text-white/55">最大回撤</span><div className="data-number text-[#EE6666]">{v.response.portfolio_metrics.max_drawdown}%</div></div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Comparison chart */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
              <div className="text-xs text-white/50 mb-2">指标对比</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="metric" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(20,20,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                    labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
                  />
                  {variantKeys.map((vk) => (
                    <Bar key={vk} dataKey={vk} name={VARIANT_LABELS[vk]} fill={VARIANT_COLORS[vk]} radius={[3, 3, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Equity comparison */}
            <div className="rounded-lg bg-[#3B6CFF]/[0.06] border border-[#3B6CFF]/15 p-3">
              <div className="text-xs text-white/55">
                权益占比: 防御 <span className="data-number text-[#5470C6]">{data.comparison.equity_ratio.defensive}%</span> |
                均衡 <span className="data-number text-[#FAC858]">{data.comparison.equity_ratio.balanced}%</span> |
                进取 <span className="data-number text-[#EE6666]">{data.comparison.equity_ratio.growth}%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
