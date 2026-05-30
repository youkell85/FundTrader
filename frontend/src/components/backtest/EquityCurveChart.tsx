import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { BacktestCurvePoint, ComparisonMode } from '@/types/backtest';
import { MODE_LABELS, MODE_COLORS } from '@/types/backtest';

interface Props {
  curves: Record<string, BacktestCurvePoint[]>;
  initialAmount: number;
}

export default function EquityCurveChart({ curves, initialAmount }: Props) {
  const modes = Object.keys(curves) as ComparisonMode[];
  if (modes.length === 0) return null;

  // Merge all curves into unified date-indexed array
  const dateMap = new Map<string, Record<string, number>>();
  modes.forEach(mode => {
    curves[mode].forEach(pt => {
      const existing = dateMap.get(pt.date) || {};
      existing[mode] = pt.value;
      dateMap.set(pt.date, existing);
    });
  });

  const data = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals }));

  const formatValue = (v: number) => {
    if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
    return v.toFixed(0);
  };

  const formatReturn = (v: number) => {
    const ret = ((v - initialAmount) / initialAmount * 100).toFixed(1);
    return `${ret}%`;
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <h3 className="text-sm font-medium text-white/70 mb-4">净值曲线</h3>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={d => d.slice(0, 7)} interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={formatValue} />
          <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
            labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
            formatter={(val: number, name: string) => [<span key={name}>{formatValue(val)} ({formatReturn(val)})</span>, MODE_LABELS[name as ComparisonMode] || name]} />
          <Legend formatter={(v: string) => MODE_LABELS[v as ComparisonMode] || v} wrapperStyle={{ fontSize: 12 }} />
          {modes.map(mode => (
            <Line key={mode} type="monotone" dataKey={mode} stroke={MODE_COLORS[mode]} strokeWidth={1.5} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
