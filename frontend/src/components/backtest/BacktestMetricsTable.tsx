import React from 'react';
import type { BacktestMetrics, ComparisonMode } from '@/types/backtest';
import { MODE_LABELS, MODE_COLORS } from '@/types/backtest';

interface Props {
  metrics: Record<string, BacktestMetrics>;
}

const METRIC_DEFS: { key: keyof BacktestMetrics; label: string; fmt: (v: number | null) => string; highlight?: 'higher' | 'lower' }[] = [
  { key: 'annualized_return', label: '年化收益', fmt: v => v == null ? '-' : `${v.toFixed(2)}%`, highlight: 'higher' },
  { key: 'annualized_volatility', label: '年化波动', fmt: v => v == null ? '-' : `${v.toFixed(2)}%`, highlight: 'lower' },
  { key: 'max_drawdown', label: '最大回撤', fmt: v => v == null ? '-' : `${v.toFixed(2)}%`, highlight: 'lower' },
  { key: 'max_drawdown_duration_days', label: '回撤天数', fmt: v => v == null ? '-' : `${v}天`, highlight: 'lower' },
  { key: 'sharpe_ratio', label: 'Sharpe', fmt: v => v == null ? '-' : v.toFixed(3), highlight: 'higher' },
  { key: 'sortino_ratio', label: 'Sortino', fmt: v => v == null ? '-' : v.toFixed(3), highlight: 'higher' },
  { key: 'calmar_ratio', label: 'Calmar', fmt: v => v == null ? '-' : v.toFixed(3), highlight: 'higher' },
  { key: 'monthly_win_rate', label: '月胜率', fmt: v => v == null ? '-' : `${v.toFixed(1)}%`, highlight: 'higher' },
  { key: 'avg_turnover', label: '平均换手', fmt: v => v == null ? '-' : `${v.toFixed(1)}%` },
  { key: 'total_rebalances', label: '调仓次数', fmt: v => v == null ? '-' : `${v}` },
  { key: 'taa_value_added', label: 'TAA增值', fmt: v => v == null ? '-' : `${v.toFixed(2)}%` },
];

export default function BacktestMetricsTable({ metrics }: Props) {
  const modes = Object.keys(metrics) as ComparisonMode[];
  if (modes.length === 0) return null;

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
          {METRIC_DEFS.map(({ key, label, fmt, highlight }) => {
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
        </tbody>
      </table>
    </div>
  );
}
