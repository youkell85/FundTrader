import React from 'react';
import type { BacktestMetrics, ComparisonMode } from '@/types/backtest';
import { MODE_LABELS, MODE_COLORS } from '@/types/backtest';

interface Props {
  metrics: Record<string, BacktestMetrics>;
}

type MetricDef = {
  key: keyof BacktestMetrics;
  label: string;
  fmt: (v: number | null) => string;
  highlight?: 'higher' | 'lower';
  group?: string;
};

const METRIC_DEFS: MetricDef[] = [
  // 基础收益风险
  { key: 'annualized_return', label: '年化收益', fmt: v => v == null ? '—' : `${v.toFixed(2)}%`, highlight: 'higher', group: '基础收益风险' },
  { key: 'annualized_volatility', label: '年化波动', fmt: v => v == null ? '—' : `${v.toFixed(2)}%`, highlight: 'lower', group: '基础收益风险' },
  { key: 'max_drawdown', label: '最大回撤', fmt: v => v == null ? '—' : `${v.toFixed(2)}%`, highlight: 'lower', group: '基础收益风险' },
  { key: 'max_drawdown_duration_days', label: '回撤天数', fmt: v => v == null ? '—' : `${v}天`, highlight: 'lower', group: '基础收益风险' },
  { key: 'sharpe_ratio', label: '夏普比率', fmt: v => v == null ? '—' : v.toFixed(3), highlight: 'higher', group: '基础收益风险' },
  // 风险调整收益
  { key: 'sortino_ratio', label: '索提诺比率', fmt: v => v == null ? '—' : v.toFixed(3), highlight: 'higher', group: '风险调整收益' },
  { key: 'calmar_ratio', label: '卡玛比率', fmt: v => v == null ? '—' : v.toFixed(3), highlight: 'higher', group: '风险调整收益' },
  // 基准对比
  { key: 'information_ratio', label: '信息比率', fmt: v => v == null ? '—' : v.toFixed(3), highlight: 'higher', group: '基准对比' },
  { key: 'alpha', label: '阿尔法', fmt: v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, highlight: 'higher', group: '基准对比' },
  { key: 'beta', label: '贝塔', fmt: v => v == null ? '—' : v.toFixed(3), group: '基准对比' },
  { key: 'tracking_error', label: '跟踪误差', fmt: v => v == null ? '—' : `${v.toFixed(2)}%`, highlight: 'lower', group: '基准对比' },
  // 执行/增强
  { key: 'monthly_win_rate', label: '月胜率', fmt: v => v == null ? '—' : `${v.toFixed(1)}%`, highlight: 'higher', group: '执行/增强' },
  { key: 'avg_turnover', label: '平均换手', fmt: v => v == null ? '—' : `${v.toFixed(1)}%`, group: '执行/增强' },
  { key: 'total_rebalances', label: '调仓次数', fmt: v => v == null ? '—' : `${v}`, group: '执行/增强' },
  { key: 'taa_value_added', label: '战术调整增值', fmt: v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, highlight: 'higher', group: '执行/增强' },
];

export default function BacktestMetricsTable({ metrics }: Props) {
  const modes = Object.keys(metrics) as ComparisonMode[];
  if (modes.length === 0) return null;

  // Check if benchmark-dependent metrics are all missing
  const benchmarkKeys: (keyof BacktestMetrics)[] = ['information_ratio', 'alpha', 'beta', 'tracking_error'];
  const hasAnyBenchmark = modes.some(m => benchmarkKeys.some(k => metrics[m][k] != null));

  // Group metrics
  const groups = ['基础收益风险', '风险调整收益', '基准对比', '执行/增强'];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 overflow-x-auto">
      <h3 className="text-sm font-medium text-white/70 mb-4">绩效指标对比</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06]">
            <th className="text-left py-2 text-xs text-white/40 font-normal">指标</th>
            {modes.map(m => (
              <th key={m} className="text-right py-2 px-3">
                <span className="text-xs font-medium" style={{ color: MODE_COLORS[m] }}>{MODE_LABELS[m]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => {
            const groupDefs = METRIC_DEFS.filter(d => d.group === group);
            if (group === '基准对比' && !hasAnyBenchmark) {
              return (
                <React.Fragment key={group}>
                  <tr className="border-b border-white/[0.06]">
                    <td colSpan={modes.length + 1} className="py-2 text-[11px] text-white/30 font-medium">{group}</td>
                  </tr>
                  <tr className="border-b border-white/[0.03]">
                    <td className="py-3 text-white/30 italic" colSpan={modes.length + 1}>暂无基准数据</td>
                  </tr>
                </React.Fragment>
              );
            }
            return (
              <React.Fragment key={group}>
                <tr className="border-b border-white/[0.06]">
                  <td colSpan={modes.length + 1} className="py-2 text-[11px] text-white/30 font-medium">{group}</td>
                </tr>
                {groupDefs.map(({ key, label, fmt, highlight }) => {
                  const values = modes.map(m => metrics[m][key] as number | null);
                  const numericVals = values.filter(v => v != null) as number[];
                  let bestIdx = -1;
                  if (highlight && numericVals.length > 1) {
                    const target = highlight === 'higher' ? Math.max(...numericVals) : Math.min(...numericVals);
                    bestIdx = values.indexOf(target);
                  }

                  return (
                    <tr key={key} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="py-2 text-white/50">{label}</td>
                      {modes.map((m, i) => (
                        <td key={m} className={`text-right py-2 px-3 font-mono ${i === bestIdx ? 'text-green-400 font-medium' : 'text-white/70'}`}>
                          {fmt(metrics[m][key] as number | null)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
