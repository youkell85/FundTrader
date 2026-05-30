import React, { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { RefreshCw, AlertTriangle, CheckCircle, Clock, TrendingUp, TrendingDown, History } from 'lucide-react';
import { checkRebalance, getRebalanceHistory } from '@/lib/api';
import { useAllocationStore } from '@/store/allocationStore';
import { MOCK_DATA } from '@/pages/mockData';
import type {
  RebalanceCheckResponse, RebalanceHistoryResponse,
} from '@/types/allocation';
import {
  ASSET_CLASS_LABELS, URGENCY_LABELS, URGENCY_COLORS,
  TRIGGER_TYPE_LABELS, STATUS_LABELS, STATUS_COLORS,
} from '@/types/allocation';

export default function RebalancePanel() {
  const [result, setResult] = useState<RebalanceCheckResponse | null>(null);
  const [history, setHistory] = useState<RebalanceHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'check' | 'history'>('check');
  const cachedCurrentRef = useRef<Record<string, number> | null>(null);
  const cachedTargetRef = useRef<Record<string, number> | null>(null);

  let storeOutput: any = null;
  try { storeOutput = useAllocationStore().state.output; } catch {}
  const d = storeOutput || MOCK_DATA;

  // Simulate current allocations with slight drift from target
  const simulateCurrentAllocations = (target: Record<string, number>): Record<string, number> => {
    const current: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of Object.entries(target)) {
      // Add random drift between -4% and +4%
      const drift = (Math.random() - 0.5) * 8;
      current[k] = Math.max(0, v + drift);
      total += current[k];
    }
    // Normalize to 100%
    for (const k of Object.keys(current)) {
      current[k] = Math.round((current[k] / total) * 1000) / 10;
    }
    return current;
  };

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const target = d.saa.allocations as Record<string, number>;
      if (!cachedCurrentRef.current || cachedTargetRef.current !== target) {
        cachedCurrentRef.current = simulateCurrentAllocations(target);
        cachedTargetRef.current = target;
      }
      const current = cachedCurrentRef.current;
      const res = await checkRebalance({
        target_allocations: target,
        current_allocations: current,
        risk_profile: d.user_profile.risk_tolerance,
        total_amount: d.user_profile.amount,
        last_rebalance_date: undefined,
        regime_changed: d.meta.circuit_breaker_triggered,
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || '检查失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = useCallback(async () => {
    try {
      const res = await getRebalanceHistory();
      setHistory(res);
    } catch {}
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const assetDeviations = useMemo(() => result?.deviations.filter(d => !d.is_group) || [], [result]);
  const groupDeviations = useMemo(() => result?.deviations.filter(d => d.is_group) || [], [result]);

  const deviationChartData = useMemo(() => assetDeviations
    .filter(d => d.deviation_pct > 0.3)
    .sort((a, b) => b.deviation_pct - a.deviation_pct)
    .map(d => ({
      name: ASSET_CLASS_LABELS[d.name] || d.name,
      deviation: d.deviation,
      fill: d.severity === 'critical' ? '#EE6666' : d.severity === 'warning' ? '#FAC858' : '#16C784',
    })), [assetDeviations]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg overflow-hidden border border-white/[0.08]">
            <button
              onClick={() => setView('check')}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                view === 'check' ? 'bg-white/[0.08] text-white' : 'text-white/45 hover:text-white/70'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />再平衡检查
            </button>
            <button
              onClick={() => setView('history')}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                view === 'history' ? 'bg-white/[0.08] text-white' : 'text-white/45 hover:text-white/70'
              }`}
            >
              <History className="w-3.5 h-3.5 inline mr-1.5" />调仓历史
            </button>
          </div>
        </div>
        {view === 'check' && (
          <button
            onClick={runCheck}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-[#5470C6]/20 text-[#5470C6] text-xs font-medium hover:bg-[#5470C6]/30 transition-colors disabled:opacity-50"
          >
            {loading ? '检查中...' : '执行检查'}
          </button>
        )}
      </div>

      {view === 'check' && (
        <>
          {error && (
            <div className="liquid-glass p-4 border-l-2 border-[#EE6666]">
              <p className="text-[#EE6666] text-xs">{error}</p>
            </div>
          )}

          {!result && !loading && (
            <div className="liquid-glass p-8 text-center">
              <RefreshCw className="w-10 h-10 text-white/40 mx-auto mb-3" />
              <p className="text-white/45 text-sm">点击"执行检查"分析当前持仓偏离度</p>
              <p className="text-white/50 text-xs mt-1">将模拟市场漂移后的持仓与SAA目标进行比较</p>
            </div>
          )}

          {loading && (
            <div className="liquid-glass p-8 text-center">
              <RefreshCw className="w-8 h-8 text-[#5470C6] mx-auto mb-3 animate-spin" />
              <p className="text-white/60 text-sm">正在分析偏离度与触发条件...</p>
            </div>
          )}

          {result && !loading && (
            <div className="space-y-4">
              {/* Summary Card */}
              <div className="liquid-glass p-4 md:p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
                      {result.should_rebalance ? (
                        <AlertTriangle className="w-4 h-4" style={{ color: URGENCY_COLORS[result.urgency] }} />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-[#16C784]" />
                      )}
                      {result.summary}
                    </h3>
                    <p className="text-white/55 text-xs mt-1">ID: {result.suggestion_id} | {result.generated_at}</p>
                  </div>
                  <div
                    className="px-2.5 py-1 rounded text-xs font-medium"
                    style={{
                      backgroundColor: `${URGENCY_COLORS[result.urgency]}20`,
                      color: URGENCY_COLORS[result.urgency],
                    }}
                  >
                    紧急度: {URGENCY_LABELS[result.urgency]}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  <MetricCard label="换手率" value={`${result.total_turnover}%`} />
                  <MetricCard label="预估成本" value={`${result.estimated_cost.toFixed(0)}元`} />
                  <MetricCard label="调仓笔数" value={`${result.actions.length}笔`} />
                  <MetricCard label="是否触发" value={result.should_rebalance ? '是' : '否'} color={result.should_rebalance ? '#EE6666' : '#16C784'} />
                </div>
              </div>

              {/* Triggers */}
              <div className="liquid-glass p-4 md:p-5">
                <h4 className="text-xs text-white/50 mb-3">触发条件</h4>
                <div className="space-y-2">
                  {result.triggers.map((t, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs">
                      <span className={t.triggered ? 'text-[#EE6666]' : 'text-[#16C784]'}>
                        {t.triggered ? '⚠' : '✓'}
                      </span>
                      <span className="text-white/70 font-medium w-28">{t.description}</span>
                      <span className="text-white/40 flex-1">{t.details}</span>
                      <span className="text-white/50 text-[10px] px-2 py-0.5 rounded bg-white/[0.04]">
                        {TRIGGER_TYPE_LABELS[t.trigger_type]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Deviation Chart */}
              {deviationChartData.length > 0 && (
                <div className="liquid-glass p-4 md:p-5">
                  <h4 className="text-xs text-white/50 mb-3">偏离度分布</h4>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={deviationChartData} layout="vertical" margin={{ left: 60, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} />
                        <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} width={60} />
                        <Tooltip
                          contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                          formatter={(v: number) => [`${v.toFixed(2)}%`, '偏离']}
                        />
                        <Bar dataKey="deviation" radius={[0, 4, 4, 0]}>
                          {deviationChartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Group deviations */}
                  {groupDeviations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/[0.06]">
                      <p className="text-[10px] text-white/50 mb-2">大类偏离</p>
                      <div className="flex flex-wrap gap-3">
                        {groupDeviations.map(g => (
                          <div key={g.name} className="flex items-center gap-2 text-xs">
                            <span className="text-white/50">{g.name === 'equity' ? '权益' : g.name === 'fixed_income' ? '固收' : g.name === 'alternative' ? '另类' : '现金'}</span>
                            <span style={{ color: g.severity === 'critical' ? '#EE6666' : g.severity === 'warning' ? '#FAC858' : '#16C784' }}>
                              {g.deviation > 0 ? '+' : ''}{g.deviation}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Trade Actions */}
              {result.actions.length > 0 && (
                <div className="liquid-glass p-4 md:p-5">
                  <h4 className="text-xs text-white/50 mb-3">调仓操作建议</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-white/50 border-b border-white/[0.06]">
                          {['优先', '资产', '方向', '当前', '目标', '变化', '金额', '基金'].map(h => (
                            <th key={h} className="text-left py-2 px-2 font-normal">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.actions.map((a, i) => (
                          <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                            <td className="py-2 px-2">
                              <span className={`inline-block w-5 h-5 rounded text-center leading-5 text-[10px] font-medium ${
                                a.priority === 1 ? 'bg-[#EE6666]/20 text-[#EE6666]' :
                                a.priority === 2 ? 'bg-[#FAC858]/20 text-[#FAC858]' :
                                'bg-white/[0.06] text-white/40'
                              }`}>{a.priority}</span>
                            </td>
                            <td className="py-2 px-2 text-white/70">{a.asset_label}</td>
                            <td className="py-2 px-2">
                              {a.direction === 'buy' ? (
                                <span className="text-[#16C784] flex items-center gap-0.5">
                                  <TrendingUp className="w-3 h-3" />买入
                                </span>
                              ) : (
                                <span className="text-[#EE6666] flex items-center gap-0.5">
                                  <TrendingDown className="w-3 h-3" />卖出
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-2 data-number text-white/50">{a.current_weight}%</td>
                            <td className="py-2 px-2 data-number text-white/70">{a.target_weight}%</td>
                            <td className="py-2 px-2 data-number" style={{ color: a.direction === 'buy' ? '#16C784' : '#EE6666' }}>
                              {a.direction === 'buy' ? '+' : '-'}{a.delta_weight}%
                            </td>
                            <td className="py-2 px-2 data-number text-white/60">{a.delta_amount.toLocaleString()}</td>
                            <td className="py-2 px-2 text-white/40 text-[10px]">{a.fund_name || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* History View */}
      {view === 'history' && (
        <div className="liquid-glass p-4 md:p-5">
          <h4 className="text-xs text-white/50 mb-4">历史调仓记录</h4>
          {!history ? (
            <p className="text-white/50 text-xs text-center py-6">加载中...</p>
          ) : history.history.length === 0 ? (
            <p className="text-white/50 text-xs text-center py-6">暂无调仓记录</p>
          ) : (
            <div className="space-y-3">
              {history.history.map(h => (
                <div key={h.entry_id} className="p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-white/50" />
                      <span className="text-white/60 text-xs data-number">{h.executed_at}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px]" style={{
                        backgroundColor: `${STATUS_COLORS[h.status]}15`,
                        color: STATUS_COLORS[h.status],
                      }}>{STATUS_LABELS[h.status]}</span>
                    </div>
                    <span className="text-white/50 text-[10px] px-2 py-0.5 rounded bg-white/[0.04]">
                      {TRIGGER_TYPE_LABELS[h.trigger_type] || h.trigger_type}
                    </span>
                  </div>
                  <p className="text-white/70 text-xs mb-2">{h.summary}</p>
                  <div className="flex items-center gap-4 text-[10px] text-white/55">
                    <span>{h.actions_count}笔操作</span>
                    <span>换手 {h.total_turnover}%</span>
                    <span>成本 {h.estimated_cost}元</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MetricCard = memo(function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
      <div className="text-white/55 text-[10px]">{label}</div>
      <div className="data-number mt-0.5 text-sm font-medium" style={{ color: color || '#ffffff' }}>{value}</div>
    </div>
  );
});
