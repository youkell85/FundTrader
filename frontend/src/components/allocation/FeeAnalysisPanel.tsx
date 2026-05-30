import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Receipt, Award } from 'lucide-react';
import { ASSET_CLASS_LABELS } from '@/types/allocation';
import type { FeeAnalysisResponse, AllocationRequest } from '@/types/allocation';
import { analyzeFees } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';

export default function FeeAnalysisPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FeeAnalysisResponse | null>(null);

  let storeOutput: any = null;
  try { storeOutput = useAllocationStore().state.output; } catch { /* no store */ }

  const handleAnalyze = async () => {
    if (!storeOutput?.funds?.length) { setError('请先生成配置方案'); return; }
    setLoading(true); setError(null);
    try {
      const resp = await analyzeFees({
        funds: storeOutput.funds,
        asset_class: 'all',
      });
      setData(resp);
    } catch (e: any) {
      setError(e.message || '分析失败');
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 80) return '#16C784';
    if (score >= 60) return '#FAC858';
    return '#EE6666';
  };

  const chartData = data?.analyses.map((a) => ({
    name: (ASSET_CLASS_LABELS[a.asset_class] || a.asset_class),
    ter: a.total_expense_ratio,
    avg: a.category_avg_ter,
  })) || [];

  return (
    <div className="space-y-5">
      <div className="liquid-glass p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm text-white/70">
            <Receipt className="w-4 h-4 inline mr-2" style={{ color: '#F59E0B' }} />
            费率评分分析
          </h3>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded-md bg-[#3B6CFF]/20 text-[#5AA9FF] hover:bg-[#3B6CFF]/30 disabled:opacity-50"
          >
            {loading ? '分析中...' : '分析费率'}
          </button>
        </div>

        {error && <div className="text-xs text-[#EE6666] mb-3">{error}</div>}

        {!data && !loading && (
          <div className="text-sm text-white/40 text-center py-8">点击"分析费率"查看基金费用效率评分</div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Recommendation */}
            <div className="p-3 rounded-lg bg-[#3B6CFF]/[0.06] border border-[#3B6CFF]/15">
              <div className="text-xs text-white/55">{data.recommendation}</div>
            </div>

            {/* TER vs Category Average Chart */}
            {chartData.length > 0 && (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
                <div className="text-xs text-white/50 mb-2">费率 vs 同类平均</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} unit="%" />
                    <Tooltip
                      contentStyle={{ background: 'rgba(20,20,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                      formatter={(v: number, name: string) => [`${v.toFixed(2)}%`, name === 'ter' ? '实际费率' : '同类平均']}
                    />
                    <Bar dataKey="ter" name="ter" fill="#F59E0B" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="avg" name="avg" fill="rgba(255,255,255,0.15)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Fund details table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/55 border-b border-white/[0.06]">
                    {['代码', '名称', '管理费', '托管费', 'TER', '效率评分', 'vs同类', '1年成本', '3年成本', '5年成本'].map((h) => (
                      <th key={h} className="text-left py-2 px-1.5 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.analyses.map((a) => (
                    <tr key={a.fund_code} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="py-2 px-1.5 data-number text-[#5AA9FF]">{a.fund_code}</td>
                      <td className="py-2 px-1.5 text-white/70 max-w-[100px] truncate">{a.fund_name}</td>
                      <td className="py-2 px-1.5 data-number text-white/60">{a.management_fee.toFixed(2)}%</td>
                      <td className="py-2 px-1.5 data-number text-white/60">{a.custody_fee.toFixed(2)}%</td>
                      <td className="py-2 px-1.5 data-number text-white/80">{a.total_expense_ratio.toFixed(2)}%</td>
                      <td className="py-2 px-1.5">
                        <div className="flex items-center gap-1">
                          <Award className="w-3 h-3" style={{ color: scoreColor(a.fee_efficiency_score) }} />
                          <span className="data-number" style={{ color: scoreColor(a.fee_efficiency_score) }}>
                            {a.fee_efficiency_score.toFixed(0)}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-1.5 data-number" style={{ color: a.fee_vs_category <= 0 ? '#16C784' : '#EE6666' }}>
                        {a.fee_vs_category > 0 ? '+' : ''}{a.fee_vs_category.toFixed(2)}%
                      </td>
                      <td className="py-2 px-1.5 data-number text-white/50">{a.cost_1y.toFixed(2)}%</td>
                      <td className="py-2 px-1.5 data-number text-white/50">{a.cost_3y.toFixed(2)}%</td>
                      <td className="py-2 px-1.5 data-number text-white/50">{a.cost_5y.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
